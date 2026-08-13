import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/test-user-data', isPackaged: false },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ isDestroyed: () => false })) },
  ipcMain: { handle: vi.fn() },
}));

import {
  createFoundationHubTargets,
  executeFoundationHubRun,
  foundationTrustedOrigin,
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

  it('uses only the configured development origin of the owning main frame', () => {
    const previous = process.env.ELECTRON_RENDERER_URL;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/app';
    const trustedFrame = { url: 'http://localhost:5173/foundation' };
    const foreignFrame = { url: 'https://untrusted.example/foundation' };
    try {
      expect(foundationTrustedOrigin({ sender: { mainFrame: trustedFrame }, senderFrame: trustedFrame })).toBe(
        'http://localhost:5173'
      );
      expect(
        foundationTrustedOrigin({ sender: { mainFrame: foreignFrame }, senderFrame: foreignFrame })
      ).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.ELECTRON_RENDERER_URL;
      else process.env.ELECTRON_RENDERER_URL = previous;
    }
  });

  it('discovers executable Hub targets in Main and never accepts renderer candidates', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([
        { id: 'local-core', kind: 'builtin', available: true, defaultModelKey: 'local-model' },
        { id: 'remote-core', kind: 'remote', available: true, networkHost: 'api.example.test' },
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
    const result = await executeFoundationHubRun(new RunKernel(), coreRuntime, intent, 'app://foundation');
    expect(result).toMatchObject({ targetId: 'remote-core', text: 'local answer', receipt: { status: 'verified' } });
    expect(coreRuntime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'remote-core',
        requestId: intent.runId,
        prompt: intent.goal,
        contextIdentity: expect.objectContaining({
          surface: intent.surface,
          agentId: 'tomny',
          personalId: intent.userId,
        }),
      })
    );
  });
});
