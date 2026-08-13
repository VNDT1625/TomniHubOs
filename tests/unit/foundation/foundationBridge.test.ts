import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/test-user-data', isPackaged: false },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ isDestroyed: () => false })) },
  ipcMain: { handle: vi.fn() },
}));

import {
  createFoundationConversationRuntime,
  createFoundationHubTargets,
  createFoundationRunLifecycle,
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
        {
          id: 'cloud-provider-core',
          kind: 'builtin',
          available: true,
          defaultModelKey: 'app-provider:provider-id:gpt-5.6',
        },
        { id: 'loopback-engine', kind: 'local', available: true, defaultModelKey: 'qwen-local' },
        { id: 'remote-core', kind: 'remote', available: true, networkHost: 'api.example.test' },
        { id: 'hidden-core', kind: 'cli', available: false },
      ]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'local answer', evidenceRefs: ['core-receipt'] }),
    };

    await expect(createFoundationHubTargets(coreRuntime)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local-core', kind: 'cli', priority: 20 }),
        expect.objectContaining({ id: 'cloud-provider-core', kind: 'cloud', priority: 30 }),
        expect.objectContaining({ id: 'loopback-engine', kind: 'local', priority: 40 }),
        expect.objectContaining({ id: 'remote-core', kind: 'cloud', priority: 30 }),
      ])
    );
    const result = await executeFoundationHubRun(new RunKernel(), coreRuntime, intent, 'app://foundation');
    expect(result).toMatchObject({
      targetId: 'loopback-engine',
      text: 'local answer',
      receipt: { status: 'verified' },
    });
    expect(coreRuntime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'loopback-engine',
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

  it('binds the selected cloud model to its Main-resolved network host before Foundation grants execution', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([
        {
          id: 'tomny-core',
          kind: 'builtin',
          available: true,
          defaultModelKey: 'app-provider:provider-1:model-1',
        },
      ]),
      resolveNetworkHost: vi.fn().mockResolvedValue('models.example.test'),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'cloud answer', evidenceRefs: ['core-receipt'] }),
    };

    const result = await executeFoundationHubRun(
      new RunKernel(),
      coreRuntime,
      { ...intent, runId: 'cloud-run' },
      'tomny://cloud-test'
    );

    expect(result).toMatchObject({ targetId: 'tomny-core', text: 'cloud answer', receipt: { status: 'verified' } });
    expect(coreRuntime.resolveNetworkHost).toHaveBeenCalledWith('tomny-core', 'app-provider:provider-1:model-1');
  });

  it('routes native conversations through Foundation while preserving the selected Core execution input', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'local-engine', kind: 'local', available: true }]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'offline answer', evidenceRefs: ['core-receipt'] }),
      cancel: vi.fn().mockResolvedValue(false),
    };
    const runtime = createFoundationConversationRuntime(coreRuntime as never, { kernel: new RunKernel() });

    const started = runtime.start(
      'conversation-request',
      'local-engine',
      'work offline',
      'C:/workspace',
      'local-model',
      'read-only',
      'conversation-session'
    );

    await expect(started.terminal).resolves.toBeUndefined();
    expect(coreRuntime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'conversation-request',
        targetId: 'local-engine',
        prompt: 'work offline',
        workspace: 'C:/workspace',
        modelKey: 'local-model',
        permissionMode: 'read-only',
        sessionId: 'conversation-session',
      })
    );
  });

  it('routes compatibility start/cancel lifecycle through Foundation while preserving Core capability context', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'local-engine', kind: 'local', available: true }]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'offline answer', evidenceRefs: ['core-receipt'] }),
      cancel: vi.fn().mockResolvedValue(false),
    };
    const kernel = new RunKernel();
    const lifecycle = createFoundationRunLifecycle(coreRuntime, { kernel });

    const started = lifecycle.start({
      requestId: 'compatibility-request',
      targetId: 'local-engine',
      prompt: 'keep the Core stream',
      workspace: 'C:/workspace',
      permissionMode: 'workspace-write',
      sessionId: 'compatibility-session',
      contextIdentity: {
        surface: 'testing',
        personalId: 'user_1',
        capabilityGrants: ['workspace.read'],
        availableCapabilities: ['core.workspace'],
      },
    });

    await expect(started.terminal).resolves.toBeUndefined();
    expect(coreRuntime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'compatibility-request',
        contextIdentity: expect.objectContaining({
          capabilityGrants: ['workspace.read'],
          availableCapabilities: ['core.workspace'],
        }),
      })
    );
    expect(kernel.eventStore.getEventsByRunId('compatibility-request').map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['run.created', 'policy.decided', 'outcome.verified'])
    );
    await expect(lifecycle.cancel('compatibility-request')).resolves.toBe(false);
    expect(coreRuntime.cancel).toHaveBeenCalledWith('compatibility-request');
  });

  it('returns a terminal error when Foundation rejects a native conversation before Core starts', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'available-local', kind: 'local', available: true }]),
      executeToCompletion: vi.fn(),
      cancel: vi.fn().mockResolvedValue(false),
    };
    const runtime = createFoundationConversationRuntime(coreRuntime as never, { kernel: new RunKernel() });

    const started = runtime.start(
      'rejected-request',
      'missing-target',
      'do not start Core',
      'C:/workspace',
      undefined,
      'read-only',
      'conversation-session'
    );

    await expect(started.terminal).resolves.toMatchObject({ type: 'error' });
    expect(coreRuntime.executeToCompletion).not.toHaveBeenCalled();
  });
});
