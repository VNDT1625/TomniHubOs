import { describe, expect, it, vi } from 'vitest';
import type { PackageListing, PackageStateChangedEvent } from '@/common/packages';
import type { IdeMcpHost } from '@package-apps/ide/process/mcp/ideMcpHost';
import {
  createDesignViuMcpRuntime,
  createDesignViuPackageActivationLifecycle,
  type DesignViuMcpRuntime,
} from '@/process/resources/packageProcessRuntime/designViuMcpRuntime';
import type {
  DesignViuContributionManager,
  FixedDesignViuContributionService,
} from '@/process/resources/packageProcessRuntime/designViuContributionManager';

const service = (version = '1.0.0'): FixedDesignViuContributionService => {
  let cancelled = false;
  return Object.freeze({
    schemaVersion: 1,
    contributionId: 'design-viu-v1',
    identity: Object.freeze({
      packageId: 'com.tomni.design-studio',
      packageVersion: version,
      publisherId: 'com.tomni',
      artifactIntegrity: `sha256-${version === '1.0.0' ? 'a'.repeat(64) : 'b'.repeat(64)}`,
    }),
    isCancelled: () => cancelled,
    __cancel: () => {
      cancelled = true;
    },
  } as FixedDesignViuContributionService & { __cancel: () => void });
};

const host = (): IdeMcpHost => ({
  url: 'http://127.0.0.1:1234/sse',
  mcpUrl: 'http://127.0.0.1:1234/mcp',
  healthUrl: 'http://127.0.0.1:1234/health',
  port: 1234,
  close: vi.fn(async () => undefined),
});

const fakeManager = (current: () => FixedDesignViuContributionService | undefined) => {
  const listeners = new Set<() => void>();
  const manager: DesignViuContributionManager = {
    initialize: async () => undefined,
    refresh: async () => undefined,
    state: () => (current() ? 'active' : 'inactive'),
    activeService: current,
    onStateChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    evidence: () => [],
    cancel: () => undefined,
    dispose: () => undefined,
  };
  return { manager, emit: () => listeners.forEach((listener) => listener()) };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('fixed Design VIU MCP runtime', () => {
  it('keeps the clean base free of Design activation until the signed package is installed and enabled', async () => {
    let listing = { state: 'available', enabled: false } as Pick<PackageListing, 'state' | 'enabled'>;
    const listeners = new Set<(event: PackageStateChangedEvent) => void>();
    const activate = vi.fn(async () => undefined);
    const lifecycle = createDesignViuPackageActivationLifecycle({
      packages: {
        status: async () => listing as PackageListing,
        onStateChanged: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      activate,
    });

    await lifecycle.initialize();
    expect(activate).not.toHaveBeenCalled();

    listeners.forEach((listener) => listener({ id: 'com.tomni.unrelated', state: 'installed' }));
    await flush();
    expect(activate).not.toHaveBeenCalled();

    listing = { state: 'installed', enabled: false };
    listeners.forEach((listener) => listener({ id: 'com.tomni.design-studio', state: 'installed' }));
    await flush();
    expect(activate).not.toHaveBeenCalled();

    listing = { state: 'installed', enabled: true };
    listeners.forEach((listener) => listener({ id: 'com.tomni.design-studio', state: 'installed' }));
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));

    lifecycle.dispose();
    listeners.forEach((listener) => listener({ id: 'com.tomni.design-studio', state: 'installed' }));
    await flush();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('does not create a host without an admitted Design contribution', async () => {
    const current: FixedDesignViuContributionService | undefined = undefined;
    const manager = fakeManager(() => current);
    const startHost = vi.fn(async () => host());
    const runtime = createDesignViuMcpRuntime({ manager: manager.manager, startHost });

    await runtime.initialize();

    expect(startHost).not.toHaveBeenCalled();
    expect(runtime.state()).toBe('inactive');
    expect('activeHost' in runtime).toBe(false);
  });

  it('starts once for the admitted identity and closes live host on revocation', async () => {
    const admitted = service();
    let current: FixedDesignViuContributionService | undefined = admitted;
    const manager = fakeManager(() => current);
    const activeHost = host();
    const startHost = vi.fn(async () => activeHost);
    const runtime = createDesignViuMcpRuntime({ manager: manager.manager, startHost });

    await runtime.initialize();
    manager.emit();
    await flush();

    expect(startHost).toHaveBeenCalledTimes(1);
    expect(runtime.state()).toBe('active');

    admitted.__cancel();
    current = undefined;
    manager.emit();

    expect(activeHost.close).toHaveBeenCalledTimes(1);
    expect(runtime.state()).toBe('inactive');
    expect(runtime.evidence()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'stopped' })]));
  });

  it('quiesces only the exact Design runtime before a package mutation and can reconcile it after failure', async () => {
    const admitted = service();
    const manager = fakeManager(() => admitted);
    const activeHost = host();
    const startHost = vi.fn(async () => activeHost);
    const runtime = createDesignViuMcpRuntime({ manager: manager.manager, startHost });

    await runtime.initialize();
    await runtime.quiesce('com.tomni.other');
    expect(activeHost.close).not.toHaveBeenCalled();

    await runtime.quiesce('com.tomni.design-studio');
    expect(activeHost.close).toHaveBeenCalledTimes(1);
    expect(runtime.state()).toBe('inactive');

    await runtime.reconcile();
    expect(startHost).toHaveBeenCalledTimes(2);
    expect(runtime.state()).toBe('active');
  });

  it('closes a late host when lifecycle is revoked during start', async () => {
    const admitted = service();
    let current: FixedDesignViuContributionService | undefined = admitted;
    const manager = fakeManager(() => current);
    const lateHost = host();
    let resolveStart: ((value: IdeMcpHost) => void) | undefined;
    const runtime: DesignViuMcpRuntime = createDesignViuMcpRuntime({
      manager: manager.manager,
      startHost: () =>
        new Promise<IdeMcpHost>((resolve) => {
          resolveStart = resolve;
        }),
    });

    const initialized = runtime.initialize();
    await vi.waitFor(() => expect(resolveStart).toBeDefined());
    admitted.__cancel();
    current = undefined;
    manager.emit();
    resolveStart?.(lateHost);
    await initialized;

    expect(lateHost.close).toHaveBeenCalledTimes(1);
    expect(runtime.state()).toBe('inactive');
    expect(runtime.evidence()).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'started' })]));
  });
});
