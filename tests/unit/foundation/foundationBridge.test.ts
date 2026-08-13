import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/test-user-data' },
  ipcMain: { handle: vi.fn() },
}));

import { parseFoundationRunPayload } from '../../../packages/desktop/src/process/bridge/foundationBridge';

const intent = {
  runId: 'run_1',
  rootTaskId: 'task_1',
  surface: 'hub',
  goal: 'Do a bounded task.',
  constraints: [],
  successCriteria: [],
  workspaceScope: 'C:/workspace',
  userId: 'user_1',
  createdAt: 1,
  correlationId: 'correlation_1',
  policyVersion: '1.0.0',
};

describe('Foundation bridge payload validation', () => {
  it('accepts a bounded, schema-valid Run payload', () => {
    expect(parseFoundationRunPayload({ intent, candidates: [{ id: 'cloud_1', factors: { priority: 1 } }] })).toEqual({
      intent,
      candidates: [{ id: 'cloud_1', factors: { priority: 1 } }],
    });
  });

  it.each([
    undefined,
    { intent, candidates: [{ id: '', factors: { priority: 1 } }] },
    { intent, candidates: [{ id: 'target', factors: { priority: Number.NaN } }] },
    { intent: { ...intent, runId: '' }, candidates: [] },
  ])('rejects malformed renderer input before execution', (payload) => {
    expect(() => parseFoundationRunPayload(payload)).toThrow();
  });
});
