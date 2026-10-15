import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshotHandler: undefined as undefined | (() => Promise<unknown>),
  reportHandler: undefined as undefined | ((input: unknown) => Promise<boolean>),
  providerCalls: 0,
  emit: vi.fn(),
}));

vi.mock('@/common/types/agent/liveSessions', () => ({
  liveSessionsChannels: {
    snapshot: {
      provider: (handler: () => Promise<unknown>) => {
        mocks.providerCalls += 1;
        mocks.snapshotHandler = handler;
      },
    },
    report: {
      provider: (handler: (input: unknown) => Promise<boolean>) => {
        mocks.reportHandler = handler;
      },
    },
    changed: { emit: mocks.emit },
  },
}));

import { LiveSessionRegistry } from '@/process/system/liveSessions/liveSessionRegistry';

describe('registerLiveSessionsBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.providerCalls = 0;
    mocks.snapshotHandler = undefined;
    mocks.reportHandler = undefined;
    mocks.emit.mockClear();
  });

  it('serves the registry snapshot and is idempotent', async () => {
    const { registerLiveSessionsBridge } = await import('@/process/system/liveSessions/liveSessionsBridge');
    const registry = new LiveSessionRegistry();
    registry.report('browser', [{ id: 't', title: 'Tab', status: 'idle' }]);
    registerLiveSessionsBridge(registry);
    registerLiveSessionsBridge(registry);

    expect(mocks.providerCalls).toBe(1);
    const snapshot = (await mocks.snapshotHandler?.()) as { apps: Array<{ appId: string }> };
    expect(snapshot.apps.map((app) => app.appId)).toEqual(['browser']);
    registry.dispose();
  });

  it('returns an empty snapshot when the account guard throws', async () => {
    const { registerLiveSessionsBridge } = await import('@/process/system/liveSessions/liveSessionsBridge');
    const registry = new LiveSessionRegistry();
    registry.report('browser', [{ id: 't', title: 'Tab', status: 'idle' }]);
    registerLiveSessionsBridge(registry, () => {
      throw new Error('signed out');
    });

    const snapshot = (await mocks.snapshotHandler?.()) as { apps: unknown[] };
    expect(snapshot.apps).toEqual([]);
    registry.dispose();
  });

  it('pushes changes to the renderer', async () => {
    vi.useFakeTimers();
    const { registerLiveSessionsBridge } = await import('@/process/system/liveSessions/liveSessionsBridge');
    const registry = new LiveSessionRegistry({ throttleMs: 10 });
    registerLiveSessionsBridge(registry);
    registry.report('terminal', [{ id: 's', title: 'bash', status: 'working' }]);
    vi.advanceTimersByTime(20);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    registry.dispose();
    vi.useRealTimers();
  });

  describe('report from a trusted renderer app', () => {
    const tab = [{ id: 't', title: 'Doc', status: 'idle' }];

    it('stores the sessions under the given app id', async () => {
      const { registerLiveSessionsBridge } = await import('@/process/system/liveSessions/liveSessionsBridge');
      const registry = new LiveSessionRegistry();
      registerLiveSessionsBridge(registry);
      await expect(mocks.reportHandler?.({ appId: 'com.tomni.design-studio', sessions: tab })).resolves.toBe(true);
      expect(registry.snapshot().apps.map((app) => app.appId)).toEqual(['com.tomni.design-studio']);
      registry.dispose();
    });

    it('passes announced actions to the registry and still refuses host ids', async () => {
      const { registerLiveSessionsBridge } = await import('@/process/system/liveSessions/liveSessionsBridge');
      const registry = new LiveSessionRegistry();
      registerLiveSessionsBridge(registry);
      await expect(
        mocks.reportHandler?.({ appId: 'com.tomni.notes', sessions: tab, actions: { create: true, close: true } })
      ).resolves.toBe(true);
      expect(registry.snapshot().apps[0].actions).toEqual({ create: true, close: true });
      await expect(
        mocks.reportHandler?.({ appId: 'com.tomni.browser', sessions: tab, actions: { create: true } })
      ).resolves.toBe(false);
      expect(registry.snapshot().apps.map((app) => app.appId)).toEqual(['com.tomni.notes']);
      registry.dispose();
    });

    it('refuses ids the host reports itself, so a renderer cannot overwrite Chat, Terminal or Browser', async () => {
      const { registerLiveSessionsBridge } = await import('@/process/system/liveSessions/liveSessionsBridge');
      const registry = new LiveSessionRegistry();
      registerLiveSessionsBridge(registry);
      for (const appId of ['chat', 'terminal', 'com.tomni.browser']) {
        await expect(mocks.reportHandler?.({ appId, sessions: tab })).resolves.toBe(false);
      }
      expect(registry.snapshot().apps).toEqual([]);
      registry.dispose();
    });

    it('answers false without throwing for garbage input or a failing account guard', async () => {
      const { registerLiveSessionsBridge } = await import('@/process/system/liveSessions/liveSessionsBridge');
      const registry = new LiveSessionRegistry();
      registerLiveSessionsBridge(registry, () => {
        throw new Error('signed out');
      });
      await expect(mocks.reportHandler?.({ appId: 'x.y', sessions: tab })).resolves.toBe(false);
      await expect(mocks.reportHandler?.(null)).resolves.toBe(false);
      await expect(mocks.reportHandler?.({ appId: 42, sessions: 'no' })).resolves.toBe(false);
      expect(registry.snapshot().apps).toEqual([]);
      registry.dispose();
    });
  });
});
