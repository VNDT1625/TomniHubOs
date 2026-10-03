import { describe, expect, it, vi } from 'vitest';

const electronHarness = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/test-user-data', isPackaged: false },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ isDestroyed: () => false })) },
  ipcMain: { handle: electronHarness.handle },
}));

import {
  createFoundationConversationRuntime,
  createFoundationHubTargets,
  createHubGoalSurfacePlanCache,
  createFoundationRunLifecycle,
  executeFoundationHubRun,
  foundationTrustedOrigin,
  isFoundationMainFrame,
  parseFoundationRunId,
  parseFoundationRunPayload,
  registerFoundationBridge,
  registerHubGoalSurfaceActionBridge,
  registerHubGoalSurfacePlanningBridge,
} from '../../../packages/desktop/src/process/bridge/foundationBridge';
import { FoundationTrustRuntime, RunKernel } from '../../../packages/desktop/src/process/foundation/runKernel';
import { TrustBroker } from '../../../packages/desktop/src/process/foundation/trustBroker';

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
  it('accepts only opaque account/window-bound C4 action IDs and never calls the controller for forged payloads', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const controller = {
      prepare: vi.fn().mockResolvedValue({
        actionId: 'action-1',
        consent: { packageId: 'com.tomni.ide', operationId: 'workspace-write' },
      }),
      execute: vi.fn(),
      cancel: vi.fn().mockReturnValue(true),
      revokeAccount: vi.fn(),
      revokeOwner: vi.fn(),
    };
    registerHubGoalSurfaceActionBridge({
      ipcMain: {
        handle: (channel, handler) =>
          handlers.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>),
        removeHandler: vi.fn(),
      },
      controller,
      requireAuthenticatedAccount: vi.fn(),
      accountId: () => 'account-1',
      ownerIdForEvent: () => 'electron:1',
      verifySender: () => true,
    });
    const prepare = handlers.get('hub-goal-surface.prepare-local-action');
    if (!prepare) throw new Error('C4 action prepare handler was not registered.');

    await expect(prepare({}, { planId: 'plan-1', stepIndex: 0, packageId: 'forged' })).resolves.toEqual({
      ok: false,
      code: 'HUB_GOAL_SURFACE_ACTION_REQUEST_INVALID',
    });
    expect(controller.prepare).not.toHaveBeenCalled();
    await expect(prepare({}, { planId: 'plan-1', stepIndex: 0 })).resolves.toEqual({
      ok: true,
      actionId: 'action-1',
      consent: { packageId: 'com.tomni.ide', operationId: 'workspace-write' },
    });
    expect(controller.prepare).toHaveBeenCalledWith({
      accountId: 'account-1',
      ownerId: 'electron:1',
      planId: 'plan-1',
      stepIndex: 0,
    });
  });

  it('lists only Main-projected restart-cancelled C4 observations for the authenticated account', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const listRestartCancelledForAccount = vi.fn().mockResolvedValue([
      {
        kind: 'surface-ai-observation.v1',
        version: 1,
        observationKey: 'sha256-observation-key',
        identity: {
          accountId: 'account-1',
          runId: 'run-1',
          invocationId: 'invocation-1',
          operationId: 'apply-instruction',
          surface: { packageId: 'com.tomni.runtime-pilot', packageVersion: '1.0.0', publisherId: 'com.tomni' },
          artifactIntegrity: `sha256-${'a'.repeat(64)}`,
        },
        state: 'cancelled',
        createdAt: 10,
        updatedAt: 20,
        lastSequence: 2,
        progress: [{ sequence: 1, phase: 'running', completed: 1, total: 2, observedAt: 11 }],
        result: { sequence: 2, artifactRefs: ['artifact:1'], evidenceRefs: ['evidence:1'], observedAt: 12 },
        cancellation: { sequence: 3, reason: 'restart-recovery', observedAt: 20 },
      },
    ]);
    const controller = {
      prepare: vi.fn(),
      execute: vi.fn(),
      cancel: vi.fn(),
      revokeAccount: vi.fn(),
      revokeOwner: vi.fn(),
    };
    registerHubGoalSurfaceActionBridge({
      ipcMain: {
        handle: (channel, handler) =>
          handlers.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>),
        removeHandler: vi.fn(),
      },
      controller,
      requireAuthenticatedAccount: vi.fn(),
      accountId: () => 'account-1',
      ownerIdForEvent: () => 'electron:1',
      verifySender: () => true,
      listRestartCancelledForAccount,
    });
    const list = handlers.get('hub-goal-surface.list-restart-cancelled');
    if (!list) throw new Error('C4 recovery handler was not registered.');

    await expect(list({}, { accountId: 'forged' })).resolves.toEqual({
      ok: false,
      code: 'HUB_GOAL_SURFACE_ACTION_REQUEST_INVALID',
    });
    expect(listRestartCancelledForAccount).not.toHaveBeenCalled();
    await expect(list({}, undefined)).resolves.toEqual({
      ok: true,
      observations: [
        {
          runId: 'run-1',
          invocationId: 'invocation-1',
          operationId: 'apply-instruction',
          state: 'cancelled',
          createdAt: 10,
          updatedAt: 20,
          progress: [{ sequence: 1, phase: 'running', completed: 1, total: 2, observedAt: 11 }],
          artifactRefs: ['artifact:1'],
          evidenceRefs: ['evidence:1'],
          cancellation: { reason: 'restart-recovery', observedAt: 20 },
        },
      ],
    });
    expect(listRestartCancelledForAccount).toHaveBeenCalledWith('account-1');
    const result = await list({}, undefined);
    expect(JSON.stringify(result)).not.toContain('account-1');
    expect(JSON.stringify(result)).not.toContain('com.tomni.runtime-pilot');
    expect(JSON.stringify(result)).not.toContain('artifactIntegrity');
  });

  it('rejects untrusted and signed-out restart-recovery queries without reading evidence', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    let trusted = false;
    const requireAuthenticatedAccount = vi.fn();
    registerHubGoalSurfaceActionBridge({
      ipcMain: {
        handle: (channel, handler) =>
          handlers.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>),
        removeHandler: vi.fn(),
      },
      requireAuthenticatedAccount,
      accountId: () => 'account-1',
      ownerIdForEvent: () => 'electron:1',
      verifySender: () => trusted,
    });
    const list = handlers.get('hub-goal-surface.list-restart-cancelled');
    if (!list) throw new Error('C4 recovery handler was not registered.');
    expect(handlers.has('hub-goal-surface.prepare-local-action')).toBe(false);
    expect(handlers.has('hub-goal-surface.execute-local-action')).toBe(false);
    expect(handlers.has('hub-goal-surface.cancel-local-action')).toBe(false);

    await expect(list({}, undefined)).resolves.toEqual({
      ok: false,
      code: 'HUB_GOAL_SURFACE_ACTION_SENDER_UNTRUSTED',
    });
    expect(requireAuthenticatedAccount).not.toHaveBeenCalled();

    trusted = true;
    requireAuthenticatedAccount.mockImplementation(() => {
      throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
    });
    await expect(list({}, undefined)).resolves.toEqual({
      ok: false,
      code: 'HUB_GOAL_SURFACE_ACTION_ACCOUNT_REQUIRED',
    });
    requireAuthenticatedAccount.mockReset();
    await expect(list({}, undefined)).resolves.toEqual({
      ok: false,
      code: 'HUB_GOAL_SURFACE_ACTION_UNAVAILABLE',
    });
  });

  it('keeps an action plan only in a short-lived Main cache bound to its account and renderer owner', () => {
    let time = 100;
    const cache = createHubGoalSurfacePlanCache({ now: () => time, ttlMs: 10 });
    const plan = {
      schemaVersion: 1,
      requestId: 'request_1',
      goalDigest: `sha256-${'a'.repeat(64)}`,
      requirementCount: 0,
      steps: [],
    } as const;
    cache.retain({
      requestId: 'request_1',
      accountId: 'account_1',
      ownerId: 'electron:1',
      modelSelectionReceipt: 'model-selection:sha256-test',
      goal: 'private goal',
      plan,
    });
    expect(cache.take('request_1', 'account_1', 'electron:2')).toBeUndefined();
    expect(cache.take('request_1', 'account_1', 'electron:1')).toMatchObject({ goal: 'private goal', plan });
    expect(cache.take('request_1', 'account_1', 'electron:1')).toBeUndefined();
    cache.retain({
      requestId: 'request_2',
      accountId: 'account_1',
      ownerId: 'electron:1',
      modelSelectionReceipt: 'model-selection:sha256-test',
      goal: 'private goal',
      plan: { ...plan, requestId: 'request_2' },
    });
    time += 10;
    expect(cache.take('request_2', 'account_1', 'electron:1')).toBeUndefined();
  });

  it('accepts only bounded task text and Main-owned metadata for Surface planning', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const coordinator = {
      plan: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: 'main-request-1',
        goalDigest: `sha256-${'a'.repeat(64)}`,
        requirementCount: 1,
        steps: [],
      }),
    };
    registerHubGoalSurfacePlanningBridge({
      ipcMain: {
        handle: (channel, handler) => {
          handlers.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>);
        },
        removeHandler: vi.fn(),
      },
      coordinator,
      requireAuthenticatedAccount: vi.fn(),
      verifySender: () => true,
      createRequestId: () => 'main-request-1',
      now: () => new Date('2030-01-01T00:00:00.000Z'),
    });
    const handler = handlers.get('hub-goal-surface.plan');
    if (handler === undefined) throw new Error('Goal Surface planning handler was not registered.');

    await expect(handler({}, { goal: 'Create a local-first notes application.' })).resolves.toEqual({
      ok: true,
      plan: expect.objectContaining({ requestId: 'main-request-1' }),
    });
    expect(coordinator.plan).toHaveBeenCalledWith({
      requestId: 'main-request-1',
      goal: 'Create a local-first notes application.',
      requestedAt: '2030-01-01T00:00:00.000Z',
    });
    await expect(handler({}, { goal: 'valid', targetId: 'renderer-selected' })).resolves.toEqual({
      ok: false,
      code: 'HUB_GOAL_SURFACE_REQUEST_INVALID',
    });
    expect(coordinator.plan).toHaveBeenCalledTimes(1);
  });

  it('does not retain an action plan when Main observes a changed model selection during derivation', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const cache = createHubGoalSurfacePlanCache();
    registerHubGoalSurfacePlanningBridge({
      ipcMain: {
        handle: (channel, handler) => {
          handlers.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>);
        },
        removeHandler: vi.fn(),
      },
      coordinator: {
        plan: vi.fn().mockResolvedValue({
          schemaVersion: 1,
          requestId: 'main-request-2',
          goalDigest: `sha256-${'b'.repeat(64)}`,
          requirementCount: 0,
          steps: [],
        }),
      },
      requireAuthenticatedAccount: vi.fn(),
      verifySender: () => true,
      createRequestId: () => 'main-request-2',
      planCache: cache,
      accountId: () => 'account_1',
      ownerIdForEvent: () => 'electron:1',
      modelSelectionReceipt: vi
        .fn()
        .mockResolvedValueOnce('model-selection:sha256-before')
        .mockResolvedValueOnce('model-selection:sha256-after'),
    });
    const handler = handlers.get('hub-goal-surface.plan');
    if (handler === undefined) throw new Error('Goal Surface planning handler was not registered.');

    await expect(handler({}, { goal: 'Build a local application.' })).resolves.toEqual({
      ok: false,
      code: 'HUB_GOAL_SURFACE_UNAVAILABLE',
    });
    expect(cache.take('main-request-2', 'account_1', 'electron:1')).toBeUndefined();
  });

  it('requires Main-owned Account authority after sender validation and before Foundation execution', async () => {
    electronHarness.handle.mockClear();
    const previous = process.env.ELECTRON_RENDERER_URL;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    const requireAuthenticatedAccount = vi.fn(() => {
      throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
    });
    try {
      registerFoundationBridge({
        coreRuntime: {
          listTargets: async () => [],
          execute: async () => ({ text: '', evidenceRefs: [] }),
        },
        requireAuthenticatedAccount,
      });
      const handler = electronHarness.handle.mock.calls.find(([channel]) => channel === 'foundation:execute-run')?.[1];
      if (handler === undefined) throw new Error('Foundation run handler was not registered.');
      const frame = { url: 'http://localhost:5173/foundation' };
      await expect(
        handler({ sender: { mainFrame: frame, isDestroyed: () => false }, senderFrame: frame }, { intent })
      ).resolves.toEqual({ success: false, error: 'FOUNDATION_EXECUTION_REJECTED' });
      expect(requireAuthenticatedAccount).toHaveBeenCalledOnce();
    } finally {
      if (previous === undefined) delete process.env.ELECTRON_RENDERER_URL;
      else process.env.ELECTRON_RENDERER_URL = previous;
    }
  });

  it('fails closed when a live Main Account subject is unavailable instead of using a renderer owner', async () => {
    electronHarness.handle.mockClear();
    const previous = process.env.ELECTRON_RENDERER_URL;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    try {
      registerFoundationBridge({
        coreRuntime: {
          listTargets: async () => [{ id: 'main-local-core', kind: 'local', available: true }],
          executeToCompletion: vi.fn(),
        },
        requireAuthenticatedAccount: vi.fn(),
        accountId: () => '',
      });
      const handler = electronHarness.handle.mock.calls.find(([channel]) => channel === 'foundation:execute-run')?.[1];
      if (handler === undefined) throw new Error('Foundation run handler was not registered.');
      const frame = { url: 'http://localhost:5173/foundation' };
      await expect(
        handler(
          { sender: { mainFrame: frame, isDestroyed: () => false }, senderFrame: frame },
          { intent: { ...intent, runId: 'foundation-main-owner-override', userId: 'renderer-forged-owner' } }
        )
      ).resolves.toEqual({ success: false, error: 'FOUNDATION_EXECUTION_REJECTED' });
    } finally {
      if (previous === undefined) delete process.env.ELECTRON_RENDERER_URL;
      else process.env.ELECTRON_RENDERER_URL = previous;
    }
  });

  it('rejects Foundation event reads without a Main-owned account or from an untrusted sender', async () => {
    electronHarness.handle.mockClear();
    const previous = process.env.ELECTRON_RENDERER_URL;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      registerFoundationBridge({
        coreRuntime: {
          listTargets: async () => [],
          execute: async () => ({ text: '', evidenceRefs: [] }),
        },
        requireAuthenticatedAccount: vi.fn(),
        accountId: () => '',
      });
      const handler = electronHarness.handle.mock.calls.find(([channel]) => channel === 'foundation:get-events')?.[1];
      if (handler === undefined) throw new Error('Foundation events handler was not registered.');
      const trustedFrame = { url: 'http://localhost:5173/foundation' };
      const trustedEvent = { sender: { mainFrame: trustedFrame, isDestroyed: () => false }, senderFrame: trustedFrame };

      await expect(handler(trustedEvent, 'run_events_owner')).resolves.toEqual({
        success: false,
        error: 'FOUNDATION_EVENTS_REJECTED',
      });
      const foreignFrame = { url: 'https://untrusted.example/foundation' };
      await expect(
        handler(
          { sender: { mainFrame: foreignFrame, isDestroyed: () => false }, senderFrame: foreignFrame },
          'run_events_owner'
        )
      ).resolves.toEqual({ success: false, error: 'FOUNDATION_EVENTS_REJECTED' });
    } finally {
      consoleError.mockRestore();
      if (previous === undefined) delete process.env.ELECTRON_RENDERER_URL;
      else process.env.ELECTRON_RENDERER_URL = previous;
    }
  });

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

  it('uses an exact Main-only target pin and fails rather than selecting a fallback target', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([
        { id: 'local-core', kind: 'local', available: true, defaultModelKey: 'local-model' },
        { id: 'cloud-core', kind: 'builtin', available: true, defaultModelKey: 'app-provider:provider:gpt' },
      ]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'pinned answer', evidenceRefs: [] }),
    };

    await expect(
      createFoundationHubTargets(coreRuntime, { allowedTargetIds: ['cloud-core'], modelKey: 'model-1' })
    ).resolves.toEqual([expect.objectContaining({ id: 'cloud-core' })]);
    await expect(
      executeFoundationHubRun(
        new RunKernel(),
        coreRuntime,
        { ...intent, constraints: ['target:cloud-core'] },
        'app://foundation',
        undefined,
        { allowedTargetIds: ['cloud-core'], modelKey: 'model-1' }
      )
    ).resolves.toMatchObject({ targetId: 'cloud-core', text: 'pinned answer' });
    expect(coreRuntime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'cloud-core', modelKey: 'model-1' })
    );
    await expect(createFoundationHubTargets(coreRuntime, { allowedTargetIds: ['missing-core'] })).rejects.toThrow(
      'FOUNDATION_HUB_TARGET_PIN_UNAVAILABLE'
    );
  });

  it('uses one Main-owned injected Trust authority for a governed run', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'local-core', kind: 'local', available: true }]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'governed answer', evidenceRefs: [] }),
    };
    const trustBroker = new TrustBroker({
      allowedCapabilities: ['target.execute'],
      allowedOrigins: ['tomny://surface-ai-operation'],
    });
    const authorize = vi.spyOn(trustBroker, 'authorize');

    await expect(
      executeFoundationHubRun(
        new RunKernel(),
        coreRuntime,
        { ...intent, runId: 'governed-run', constraints: ['target:local-core'] },
        'tomny://surface-ai-operation',
        undefined,
        { allowedTargetIds: ['local-core'], trustBroker }
      )
    ).resolves.toMatchObject({ text: 'governed answer', receipt: { status: 'verified' } });

    // Foundation performs a preflight and a live execution check against the
    // same injected authority; no second broker is constructed for the run.
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(coreRuntime.executeToCompletion).toHaveBeenCalledOnce();
  });

  it('binds RunKernel preflight and an externally supplied governed scope to one Foundation trust identity', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'local-core', kind: 'local', available: true }]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'runtime-bound answer', evidenceRefs: [] }),
    };
    const trustBroker = new TrustBroker({
      allowedCapabilities: ['target.execute'],
      allowedOrigins: ['tomny://foundation-runtime-test'],
      policyVersion: 'foundation-runtime-v1',
    });
    const trustRuntime = new FoundationTrustRuntime({ trustBroker, actorId: () => 'user_1' });
    const kernel = trustRuntime.createRunKernel();
    const authorize = vi.spyOn(trustBroker, 'authorize');

    await expect(
      executeFoundationHubRun(
        kernel,
        coreRuntime,
        {
          ...intent,
          runId: 'runtime-bound-run',
          policyVersion: 'foundation-runtime-v1',
          capabilityGrant: ['target.execute'],
        },
        'tomny://foundation-runtime-test',
        undefined,
        { allowedTargetIds: ['local-core'], trustRuntime, trustBroker }
      )
    ).resolves.toMatchObject({ receipt: { status: 'verified' }, text: 'runtime-bound answer' });

    expect(kernel.securityAdapter.trustBroker).toBe(trustRuntime.trustBroker);
    expect(trustRuntime.trustBroker).toBe(trustBroker);
    // RunKernel preflight/target checks and the governed target/final-egress
    // checks all reach this one broker instance.
    expect(authorize).toHaveBeenCalledTimes(4);
  });

  it('fails closed before start when the Main-owned Foundation trust runtime is revoked', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'local-core', kind: 'local', available: true }]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'must not run', evidenceRefs: [] }),
    };
    const trustRuntime = new FoundationTrustRuntime({
      actorId: () => 'user_1',
      policy: {
        allowedCapabilities: ['target.execute'],
        allowedNetworkHosts: [],
        trustedPackageIds: [],
        allowedOrigins: ['tomny://foundation-runtime-test'],
        requireApprovalForMutation: true,
        capabilityGrantTtlMs: 60_000,
        policyVersion: 'foundation-runtime-v1',
      },
    });
    const kernel = trustRuntime.createRunKernel();
    trustRuntime.revoke('account signed out');

    await expect(
      executeFoundationHubRun(
        kernel,
        coreRuntime,
        {
          ...intent,
          runId: 'revoked-runtime-run',
          policyVersion: 'foundation-runtime-v1',
          capabilityGrant: ['target.execute'],
        },
        'tomny://foundation-runtime-test',
        undefined,
        { allowedTargetIds: ['local-core'], trustRuntime }
      )
    ).rejects.toThrow('FOUNDATION_TRUST_RUNTIME_REVOKED');
    expect(coreRuntime.executeToCompletion).not.toHaveBeenCalled();
    expect(kernel.eventStore.getEventsByRunId('revoked-runtime-run')).toEqual([]);
  });

  it('forwards a Main-only per-run MCP host without adding it to any renderer payload', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'local-core', kind: 'local', available: true }]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'tool-backed answer', evidenceRefs: [] }),
    };
    const mcpServers = [
      {
        name: 'tomny-package-surface-operation',
        url: 'http://127.0.0.1:49152/sse',
        headers: [{ name: 'Authorization', value: 'Bearer main-only' }],
      },
    ];

    await executeFoundationHubRun(
      new RunKernel(),
      coreRuntime,
      { ...intent, runId: 'surface-operation-run', constraints: ['target:local-core'] },
      'tomny://surface-operation-test',
      undefined,
      { allowedTargetIds: ['local-core'], mcpServers }
    );

    expect(coreRuntime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ contextIdentity: expect.objectContaining({ mcpServers }) })
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

  it('runs an explicitly injected remote target through the same Run and Trust boundary', async () => {
    const remoteExecute = vi.fn().mockResolvedValue({ text: 'remote answer', evidenceRefs: ['remote-receipt'] });
    const externalTargetProvider = {
      providerId: 'signed-remote-catalog',
      listTargets: vi.fn().mockResolvedValue([
        {
          id: 'remote-catalog:research',
          kind: 'cloud' as const,
          priority: 50,
          networkHost: 'remote.example.test',
          requestedCapabilities: ['target.execute'],
          execute: remoteExecute,
        },
      ]),
    };
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'z-core-target', kind: 'local', available: true }]),
      executeToCompletion: vi.fn(),
    };

    await expect(
      createFoundationHubTargets(coreRuntime, { externalTargetProviders: [externalTargetProvider] })
    ).resolves.toMatchObject([{ id: 'remote-catalog:research' }, { id: 'z-core-target' }]);

    const result = await executeFoundationHubRun(
      new RunKernel(),
      coreRuntime,
      { ...intent, runId: 'external-remote-run', constraints: ['target:remote-catalog:research'] },
      'app://foundation',
      undefined,
      { externalTargetProviders: [externalTargetProvider] }
    );

    expect(result).toMatchObject({
      targetId: 'remote-catalog:research',
      text: 'remote answer',
      receipt: { status: 'verified' },
    });
    expect(externalTargetProvider.listTargets).toHaveBeenCalledTimes(2);
    expect(remoteExecute).toHaveBeenCalledWith(
      expect.objectContaining({ intent: expect.objectContaining({ runId: 'external-remote-run' }) })
    );
    expect(coreRuntime.executeToCompletion).not.toHaveBeenCalled();
  });

  it('rejects an injected target that collides with a Core target instead of selecting one implicitly', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'core-target', kind: 'local', available: true }]),
      executeToCompletion: vi.fn(),
    };
    const externalTargetProvider = {
      providerId: 'optional-source',
      listTargets: vi.fn().mockResolvedValue([
        {
          id: 'core-target',
          kind: 'cloud' as const,
          priority: 99,
          networkHost: 'collision.example.test',
          execute: vi.fn(),
        },
      ]),
    };

    await expect(
      createFoundationHubTargets(coreRuntime, { externalTargetProviders: [externalTargetProvider] })
    ).rejects.toThrow('FOUNDATION_HUB_TARGET_ID_COLLISION:core-target');
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

  it('returns a terminal error when Core execution fails after starting', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'available-local', kind: 'local', available: true }]),
      executeToCompletion: vi.fn().mockRejectedValue(new Error('CORE_OUTPUT_EMPTY')),
      cancel: vi.fn().mockResolvedValue(false),
    };
    const runtime = createFoundationConversationRuntime(coreRuntime as never, { kernel: new RunKernel() });

    const started = runtime.start(
      'failing-request',
      'available-local',
      'start and fail',
      'C:/workspace',
      undefined,
      'read-only',
      'conversation-session'
    );

    await expect(started.terminal).resolves.toMatchObject({
      type: 'error',
      text: expect.stringContaining('CORE_OUTPUT_EMPTY'),
    });
  });

  it('synchronizes intent userId to trustRuntime actorId avoiding actor mismatch when account is logged in', async () => {
    const coreRuntime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'local-engine', kind: 'local', available: true }]),
      executeToCompletion: vi.fn().mockResolvedValue({ text: 'online answer', evidenceRefs: ['core-receipt'] }),
      cancel: vi.fn().mockResolvedValue(false),
    };
    const trustRuntime = new FoundationTrustRuntime({
      actorId: () => 'authenticated-account-123',
      policy: {
        allowedCapabilities: ['target.execute'],
        allowedNetworkHosts: [],
        trustedPackageIds: [],
        allowedOrigins: ['tomny://native-conversation'],
        requireApprovalForMutation: false,
        capabilityGrantTtlMs: 60_000,
        policyVersion: 'foundation-v1',
      },
    });
    const assertSpy = vi.spyOn(trustRuntime, 'assertRunStart');

    const kernel = trustRuntime.createRunKernel();
    const lifecycle = createFoundationRunLifecycle(coreRuntime, { kernel, trustRuntime });

    const started = lifecycle.start({
      requestId: 'online-account-request',
      targetId: 'local-engine',
      prompt: 'chat message',
      workspace: 'C:/workspace',
      permissionMode: 'workspace-write',
      sessionId: 'online-account-session',
      contextIdentity: {
        surface: 'chat',
        personalId: 'account-v1-hashedprofileid',
      },
    });

    await expect(started.terminal).resolves.toBeUndefined();
    expect(assertSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'authenticated-account-123',
      }),
      'tomny://native-conversation'
    );
  });
});
