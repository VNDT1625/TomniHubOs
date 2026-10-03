/**
 * Fixed Design VIU MCP lifecycle. This is Main-owned reviewed code selected by
 * the exact signed declaration; it never loads package JavaScript or accepts
 * package-provided host settings.
 */

import type { PackageListing, PackageStateChangedEvent } from '@/common/packages';
import type { IWorkerProcessFactory } from '@/common/platform';
import type { PackageRuntimeEntryLease } from '@process/extensions/package-manager/PackageManagerService';
import { createPackageArtifactProcessEndpoint } from './packageArtifactProcessEndpoint';
import type { DesignViuContributionManager, FixedDesignViuContributionService } from './designViuContributionManager';
import {
  createPackagePersistentContributionSupervisor,
  type PackagePersistentContributionBinding,
  type PackagePersistentContributionEvidence,
} from './persistentContributionSupervisor';

export type DesignViuMcpRuntimeEvidence = Readonly<{
  at: number;
  kind: 'started' | 'stopped' | 'start-failed';
  packageVersion?: string;
}>;

export type DesignViuPackageActivationLifecycle = Readonly<{
  initialize: () => Promise<void>;
  dispose: () => void;
}>;

type DesignViuPackageLifecycleSource = Readonly<{
  status: (packageId: string) => Promise<PackageListing>;
  onStateChanged: (listener: (event: PackageStateChangedEvent) => void) => () => void;
}>;

export type DesignViuMcpRuntime = Readonly<{
  initialize: () => Promise<void>;
  /** Re-evaluates the exact current Design contribution after a failed mutation. */
  reconcile: () => Promise<void>;
  /** Stops the exact Design endpoint and releases its artifact lease before mutation. */
  quiesce: (packageId: string) => Promise<void>;
  state: () => 'inactive' | 'active' | 'disposed';
  evidence: () => readonly DesignViuMcpRuntimeEvidence[];
  dispose: () => void;
}>;

type DesignViuMcpHost = Readonly<{ close: () => Promise<void> }>;

type DesignViuMcpRuntimeDeps = Readonly<{
  manager: DesignViuContributionManager;
  acquireRuntimeEntry?: (packageId: string, assetPath: string) => Promise<PackageRuntimeEntryLease>;
  workerFactory?: IWorkerProcessFactory;
  startHost?: (service: FixedDesignViuContributionService) => Promise<DesignViuMcpHost>;
  now?: () => number;
}>;

const startFixedHost = async (
  service: FixedDesignViuContributionService,
  deps: Pick<DesignViuMcpRuntimeDeps, 'acquireRuntimeEntry' | 'workerFactory'>
): Promise<DesignViuMcpHost> => {
  if (service.isCancelled()) throw new Error('DESIGN_VIU_CONTRIBUTION_INACTIVE');
  if (!deps.acquireRuntimeEntry || !deps.workerFactory) throw new Error('DESIGN_VIU_RUNTIME_UNAVAILABLE');
  const endpoint = await createPackageArtifactProcessEndpoint({
    binding: bindingFor(service),
    runtime: { entrypointId: service.contributionId, relativeEntryPath: 'runtime/design-viu-v1.cjs' },
    acquireRuntimeEntry: deps.acquireRuntimeEntry,
    workerFactory: deps.workerFactory,
  });
  if (service.isCancelled()) {
    await endpoint.stop();
    throw new Error('DESIGN_VIU_CONTRIBUTION_INACTIVE');
  }
  return Object.freeze({ close: endpoint.stop });
};

const bindingFor = (service: FixedDesignViuContributionService): PackagePersistentContributionBinding => ({
  surface: service.identity,
  contributionId: service.contributionId,
  artifactIntegrity: service.identity.artifactIntegrity,
});

/**
 * Defers every Design-owned Main service until the exact signed package has
 * reached installed-and-enabled state. The listener is generic lifecycle
 * control-plane state; it does not construct a package service on a clean base.
 */
export const createDesignViuPackageActivationLifecycle = (
  deps: Readonly<{
    packages: DesignViuPackageLifecycleSource;
    activate: () => Promise<void>;
  }>
): DesignViuPackageActivationLifecycle => {
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  let transitions: Promise<void> = Promise.resolve();

  const reconcile = (): Promise<void> => {
    const next = transitions
      .catch((): undefined => undefined)
      .then(async (): Promise<void> => {
        if (disposed) return;
        const listing = await deps.packages.status('com.tomni.design-studio');
        if (listing.state === 'installed' && listing.enabled) await deps.activate();
      });
    transitions = next;
    return next;
  };

  return Object.freeze({
    initialize: async () => {
      if (disposed || unsubscribe) return;
      unsubscribe = deps.packages.onStateChanged((event) => {
        if (event.id !== 'com.tomni.design-studio') return;
        void reconcile().catch((): undefined => undefined);
      });
      await reconcile();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
    },
  });
};

const matches = (
  binding: PackagePersistentContributionBinding,
  service: FixedDesignViuContributionService | undefined
): service is FixedDesignViuContributionService =>
  service !== undefined &&
  !service.isCancelled() &&
  service.contributionId === binding.contributionId &&
  service.identity.packageId === binding.surface.packageId &&
  service.identity.packageVersion === binding.surface.packageVersion &&
  service.identity.publisherId === binding.surface.publisherId &&
  service.identity.artifactIntegrity === binding.artifactIntegrity;

/**
 * Binds the fixed Design host to the generic digest-pinned contribution
 * lifecycle. The supervisor owns revocation and endpoint cleanup; this adapter
 * only selects the already-reviewed host for the fixed declaration.
 */
export const createDesignViuMcpRuntime = (deps: DesignViuMcpRuntimeDeps): DesignViuMcpRuntime => {
  const now = deps.now ?? Date.now;
  const startHost = (service: FixedDesignViuContributionService): Promise<DesignViuMcpHost> =>
    deps.startHost?.(service) ?? startFixedHost(service, deps);
  const records: DesignViuMcpRuntimeEvidence[] = [];
  let lastBinding: PackagePersistentContributionBinding | undefined;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  const record = (kind: DesignViuMcpRuntimeEvidence['kind'], service?: FixedDesignViuContributionService): void => {
    records.push(
      Object.freeze({ at: now(), kind, ...(service ? { packageVersion: service.identity.packageVersion } : {}) })
    );
    if (records.length > 32) records.splice(0, records.length - 32);
  };

  const lifecycle = createPackagePersistentContributionSupervisor({
    isBindingActive: async (binding) => matches(binding, disposed ? undefined : deps.manager.activeService()),
    createEndpoint: async (binding, _signal) => {
      const service = disposed ? undefined : deps.manager.activeService();
      if (!matches(binding, service)) return undefined;
      const host = await startHost(service);
      if (!matches(binding, disposed ? undefined : deps.manager.activeService())) {
        await host.close();
        return undefined;
      }
      return { stop: () => host.close() };
    },
    recordEvidence: async (event: PackagePersistentContributionEvidence) => {
      const service = disposed ? undefined : deps.manager.activeService();
      if (event.phase === 'started') {
        record('started', service);
      } else if (event.phase === 'stopped' && service) {
        record('stopped', service);
      } else if (event.phase === 'failed' || event.phase === 'rejected') {
        record('start-failed', service);
      }
    },
  });

  const reconcile = async (): Promise<void> => {
    const service = disposed ? undefined : deps.manager.activeService();
    if (!service || service.isCancelled()) {
      if (lastBinding) {
        record('stopped');
        const binding = lastBinding;
        lastBinding = undefined;
        await lifecycle.invalidate(binding.surface, binding.contributionId);
      }
      return;
    }
    const binding = bindingFor(service);
    lastBinding = binding;
    try {
      await lifecycle.activate(binding);
    } catch {
      if (!disposed && matches(binding, deps.manager.activeService())) record('start-failed', service);
    }
  };

  return Object.freeze({
    initialize: async () => {
      if (disposed || unsubscribe) return;
      unsubscribe = deps.manager.onStateChanged(() => {
        void reconcile();
      });
      await reconcile();
    },
    reconcile,
    quiesce: async (packageId) => {
      if (packageId !== 'com.tomni.design-studio' || !lastBinding) return;
      const binding = lastBinding;
      lastBinding = undefined;
      await lifecycle.invalidate(binding.surface, binding.contributionId);
    },
    state: () => {
      if (disposed) return 'disposed';
      const service = deps.manager.activeService();
      if (!service || service.isCancelled()) return 'inactive';
      return lifecycle.state(bindingFor(service)) === 'active' ? 'active' : 'inactive';
    },
    evidence: () => Object.freeze(records.map((entry) => structuredClone(entry))),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      void lifecycle.dispose();
    },
  });
};
