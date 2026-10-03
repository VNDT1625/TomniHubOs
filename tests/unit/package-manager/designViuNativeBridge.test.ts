import { describe, expect, it, vi } from 'vitest';
import { DESIGN_VIU_NATIVE_CHANNELS } from '@/common/packages';
import {
  createDesignViuNativeIpcLifecycle,
  registerDesignViuNativeIpcBridge,
} from '@/process/resources/packageProcessRuntime/designViuNativeBridge';
import type {
  DesignViuContributionManager,
  FixedDesignViuContributionService,
} from '@/process/resources/packageProcessRuntime/designViuContributionManager';

type Event = Readonly<{ trusted: boolean; ownerId?: string; accountId?: string }>;
type Handler = (event: Event, payload: unknown) => Promise<unknown>;

const activeService = (): FixedDesignViuContributionService & { cancel: () => void } => {
  let cancelled = false;
  return Object.freeze({
    schemaVersion: 1,
    contributionId: 'design-viu-v1',
    identity: Object.freeze({
      packageId: 'com.tomni.design-studio',
      packageVersion: '1.0.0',
      publisherId: 'com.tomni',
      artifactIntegrity: 'sha256-test',
    }),
    isCancelled: () => cancelled,
    cancel: () => {
      cancelled = true;
    },
  });
};

const fakeManager = (current: () => FixedDesignViuContributionService | undefined): DesignViuContributionManager => ({
  initialize: async () => undefined,
  refresh: async () => undefined,
  state: () => (current() ? 'active' : 'inactive'),
  activeService: current,
  onStateChanged: () => () => undefined,
  evidence: () => [],
  cancel: () => undefined,
  dispose: () => undefined,
});

const createHarness = (current: () => FixedDesignViuContributionService | undefined) => {
  const handlers = new Map<string, Handler>();
  const inspect = vi.fn(() => ({ projectId: 'private-project' }));
  const dispose = registerDesignViuNativeIpcBridge<Event>({
    host: {
      handle: (channel, handler) => handlers.set(channel, handler as Handler),
      removeHandler: (channel) => handlers.delete(channel),
    },
    manager: fakeManager(current),
    verifySender: (event) => event.trusted,
    ownerId: (event) => event.ownerId,
    requireAccount: () => {
      const accountId = currentEvent.accountId;
      if (!accountId) throw new Error('account required');
      return { accountId };
    },
    sessions: {
      inspect,
      previewTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      validate: vi.fn(() => ({ valid: true, revision: 0, diagnostics: [] })),
      createFramePlan: vi.fn(),
      getFramePlan: vi.fn(),
      refreshFrameLease: vi.fn(),
      submitFrameContribution: vi.fn(),
      reviewFramePlan: vi.fn(),
      commitFramePlan: vi.fn(),
    },
  });
  return { handlers, inspect, dispose };
};

let currentEvent: Event = { trusted: true, ownerId: 'sender-a', accountId: 'account-a' };

describe('Design Viu fixed native ABI', () => {
  it('does not register Design channels until the reviewed contribution is admitted and removes them on revoke', () => {
    let service: FixedDesignViuContributionService | undefined;
    const listeners = new Set<() => void>();
    const handlers = new Map<string, Handler>();
    const createSessions = vi.fn(() => ({
      inspect: () => ({ projectId: 'private-project' }),
      previewTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      validate: () => ({ valid: true, revision: 0, diagnostics: [] }),
    }));
    const manager: DesignViuContributionManager = {
      initialize: async () => undefined,
      refresh: async () => undefined,
      state: () => (service ? 'active' : 'inactive'),
      activeService: () => service,
      onStateChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      evidence: () => [],
      cancel: () => undefined,
      dispose: () => undefined,
    };
    const dispose = createDesignViuNativeIpcLifecycle<Event>({
      host: {
        handle: (channel, handler) => handlers.set(channel, handler as Handler),
        removeHandler: (channel) => handlers.delete(channel),
      },
      manager,
      verifySender: (event) => event.trusted,
      ownerId: (event) => event.ownerId,
      requireAccount: () => ({ accountId: 'account-a' }),
      createSessions,
    });

    expect(handlers).toHaveLength(0);
    service = activeService();
    expect(createSessions).not.toHaveBeenCalled();
    listeners.forEach((listener) => listener());
    expect([...handlers.keys()].toSorted()).toEqual(Object.values(DESIGN_VIU_NATIVE_CHANNELS).toSorted());
    expect(createSessions).toHaveBeenCalledTimes(1);

    service = undefined;
    listeners.forEach((listener) => listener());
    expect(handlers).toHaveLength(0);
    dispose();
  });

  it('registers only the ten fixed channels and derives an account/sender-scoped workspace', async () => {
    currentEvent = { trusted: true, ownerId: 'sender-a', accountId: 'account-a' };
    const service = activeService();
    const harness = createHarness(() => service);
    expect([...harness.handlers.keys()].toSorted()).toEqual(Object.values(DESIGN_VIU_NATIVE_CHANNELS).toSorted());

    await expect(
      harness.handlers.get(DESIGN_VIU_NATIVE_CHANNELS.v2Inspect)?.(currentEvent, { workspaceKey: 'canvas-1' })
    ).resolves.toEqual({
      ok: true,
      data: { projectId: 'private-project' },
    });
    expect(harness.inspect).toHaveBeenCalledWith(expect.stringMatching(/^design-viu:[a-f0-9]{64}$/));
    expect(JSON.stringify(harness.inspect.mock.calls)).not.toContain('account-a');
    expect(JSON.stringify(harness.inspect.mock.calls)).not.toContain('canvas-1');
    harness.dispose();
    expect(harness.handlers).toHaveLength(0);
  });

  it('fails closed for untrusted, unsigned-out, inactive, and raw-path operations', async () => {
    currentEvent = { trusted: true, ownerId: 'sender-a', accountId: 'account-a' };
    let service: FixedDesignViuContributionService | undefined = activeService();
    const harness = createHarness(() => service);
    await expect(
      harness.handlers.get(DESIGN_VIU_NATIVE_CHANNELS.v2Inspect)?.(
        { trusted: false, ownerId: 'sender-a', accountId: 'account-a' },
        { workspaceKey: 'canvas' }
      )
    ).resolves.toEqual({ ok: false, code: 'DESIGN_VIU_SENDER_UNTRUSTED' });
    currentEvent = { trusted: true, ownerId: 'sender-a' };
    await expect(
      harness.handlers.get(DESIGN_VIU_NATIVE_CHANNELS.v2Inspect)?.(currentEvent, { workspaceKey: 'canvas' })
    ).resolves.toEqual({
      ok: false,
      code: 'DESIGN_VIU_ACCOUNT_REQUIRED',
    });
    currentEvent = { trusted: true, ownerId: 'sender-a', accountId: 'account-a' };
    service = undefined;
    await expect(
      harness.handlers.get(DESIGN_VIU_NATIVE_CHANNELS.v2Inspect)?.(currentEvent, { workspaceKey: 'canvas' })
    ).resolves.toEqual({
      ok: false,
      code: 'DESIGN_VIU_CONTRIBUTION_INACTIVE',
    });
    service = activeService();
    await expect(
      harness.handlers.get(DESIGN_VIU_NATIVE_CHANNELS.assetGrant)?.(currentEvent, { path: 'C:\\secret.png' })
    ).resolves.toEqual({
      ok: false,
      code: 'DESIGN_VIU_OPERATION_DENIED',
    });
  });

  it('redacts the workspace and reports cancellation when a contribution is revoked during an operation', async () => {
    currentEvent = { trusted: true, ownerId: 'sender-a', accountId: 'account-a' };
    const service = activeService();
    const harness = createHarness(() => service);
    harness.inspect.mockImplementationOnce(() => {
      service.cancel();
      return { projectId: 'private-project' };
    });
    await expect(
      harness.handlers.get(DESIGN_VIU_NATIVE_CHANNELS.v2Inspect)?.(currentEvent, { workspaceKey: 'canvas' })
    ).resolves.toEqual({
      ok: false,
      code: 'DESIGN_VIU_CANCELLED',
    });
  });
});
