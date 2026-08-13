import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/test-user-data' },
  ipcMain: { handle: vi.fn() },
}));

import {
  createFoundationHubTargets,
  executeFoundationHubRun,
  isFoundationMainFrame,
  parseFoundationRunId,
  parseFoundationRunPayload,
} from '../../../packages/desktop/src/process/bridge/foundationBridge';
import { RunKernel } from '../../../packages/desktop/src/process/foundation/runKernel';

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
    expect(
      parseFoundationRunPayload({ intent, candidates: [{ id: 'renderer-controlled', factors: { priority: 999 } }] })
    ).toEqual({
      intent,
    });
  });

  it.each([undefined, { intent: { ...intent, runId: '' }, candidates: [] }])(
    'rejects malformed renderer input before execution',
    (payload) => {
      expect(() => parseFoundationRunPayload(payload)).toThrow();
    }
  );

  it('accepts only the main frame and bounded run ids', () => {
    const mainFrame = {};
    expect(isFoundationMainFrame({ sender: { mainFrame }, senderFrame: mainFrame })).toBe(true);
    expect(isFoundationMainFrame({ sender: { mainFrame }, senderFrame: {} })).toBe(false);
    expect(parseFoundationRunId('run_1')).toBe('run_1');
    expect(() => parseFoundationRunId('')).toThrow('INVALID_FOUNDATION_RUN_ID');
  });

  it('discovers executable Hub targets in Main and never accepts renderer candidates', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([
        { id: 'local-core', kind: 'builtin', available: true, defaultModelKey: 'local-model' },
        { id: 'remote-core', kind: 'remote', available: true },
        { id: 'hidden-core', kind: 'cli', available: false },
      ]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'local answer', evidenceRefs: ['core-receipt'] }),
    };

    await expect(createFoundationHubTargets(coreRuntime)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local-core', kind: 'cli', priority: 20 }),
        expect.objectContaining({ id: 'remote-core', kind: 'cloud', priority: 30 }),
      ])
    );
    const result = await executeFoundationHubRun(new RunKernel(), coreRuntime, intent);
    expect(result).toMatchObject({ targetId: 'remote-core', text: 'local answer', receipt: { status: 'verified' } });
    expect(coreRuntime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'remote-core', requestId: intent.runId, prompt: intent.goal })
    );
  });
});
