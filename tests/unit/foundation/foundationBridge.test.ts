import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHandlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler);
    }),
  },
}));

import { registerFoundationBridge } from '../../../packages/desktop/src/process/bridge/foundationBridge';
import type { RunIntent } from '../../../packages/desktop/src/common/foundation/runTypes';

describe('foundationBridge IPC handlers', () => {
  beforeEach(() => {
    mockHandlers.clear();
    registerFoundationBridge();
  });

  it('should register foundation:execute-run and foundation:get-events IPC channels', () => {
    expect(mockHandlers.has('foundation:execute-run')).toBe(true);
    expect(mockHandlers.has('foundation:get-events')).toBe(true);
  });

  it('should execute run via IPC handler and return receipt', async () => {
    const executeHandler = mockHandlers.get('foundation:execute-run')!;
    const intent: RunIntent = {
      runId: 'run_ipc_1',
      rootTaskId: 'task_root_ipc',
      surface: 'chat',
      goal: 'Run via IPC',
      constraints: [],
      successCriteria: [],
      workspaceScope: 'C:/workspace',
      userId: 'user_ipc',
      createdAt: Date.now(),
      correlationId: 'corr_ipc',
      policyVersion: '1.0.0',
    };
    const candidates = [{ id: 'agent_ipc_1', factors: { score: 1 } }];

    const response = (await executeHandler({}, { intent, candidates })) as {
      success: boolean;
      receipt: { status: string; runId: string };
    };

    expect(response.success).toBe(true);
    expect(response.receipt.status).toBe('verified');
    expect(response.receipt.runId).toBe('run_ipc_1');

    const getEventsHandler = mockHandlers.get('foundation:get-events')!;
    const eventsResponse = (await getEventsHandler({}, 'run_ipc_1')) as {
      success: boolean;
      events: readonly { eventType: string }[];
    };

    expect(eventsResponse.success).toBe(true);
    expect(eventsResponse.events.length).toBeGreaterThan(0);
  });
});
