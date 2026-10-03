import type { PackageIdentity } from '@/common/packages';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const INTEGRITY_PATTERN = /^sha256-[a-f0-9]{64}$/;

export type PackagePersistentContributionBinding = Readonly<{
  surface: PackageIdentity;
  contributionId: string;
  artifactIntegrity: string;
}>;

export type PackagePersistentContributionEvidence = Readonly<{
  kind: 'package-persistent-contribution.v1';
  phase: 'admitted' | 'started' | 'stopped' | 'rejected' | 'failed';
  binding: PackagePersistentContributionBinding;
  reason?: string;
}>;

/**
 * A verified, Main-owned endpoint. The package admission layer chooses the
 * implementation; this supervisor never accepts executable paths, arguments,
 * environment, code, or callable operations from a package.
 */
export type PackagePersistentContributionEndpoint = Readonly<{
  stop: () => Promise<void>;
}>;

export type PackagePersistentContributionSupervisorDependencies = Readonly<{
  isBindingActive: (binding: PackagePersistentContributionBinding) => Promise<boolean>;
  createEndpoint: (
    binding: PackagePersistentContributionBinding,
    signal: AbortSignal
  ) => Promise<PackagePersistentContributionEndpoint | undefined>;
  /** Durable, redacted lifecycle evidence. Admission fails closed when unavailable. */
  recordEvidence: (evidence: PackagePersistentContributionEvidence) => Promise<void>;
}>;

export type PackagePersistentContributionSupervisor = Readonly<{
  activate: (binding: PackagePersistentContributionBinding) => Promise<void>;
  /** Stops only the exact installed identity and contribution. */
  invalidate: (surface: PackageIdentity, contributionId: string) => Promise<void>;
  state: (binding: PackagePersistentContributionBinding) => 'inactive' | 'starting' | 'active' | 'disposed';
  dispose: () => Promise<void>;
}>;

type ActiveContribution = {
  binding: PackagePersistentContributionBinding;
  controller: AbortController;
  endpoint?: PackagePersistentContributionEndpoint;
  state: 'starting' | 'active';
  endpointStopped: boolean;
  terminal: boolean;
};

const sameIdentity = (left: PackageIdentity, right: PackageIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const sameBinding = (
  left: PackagePersistentContributionBinding,
  right: PackagePersistentContributionBinding
): boolean =>
  sameIdentity(left.surface, right.surface) &&
  left.contributionId === right.contributionId &&
  left.artifactIntegrity === right.artifactIntegrity;

const requireIdentifier = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`PACKAGE_PERSISTENT_CONTRIBUTION_INVALID_${label}`);
  }
  return normalized;
};

const requireBinding = (binding: PackagePersistentContributionBinding): PackagePersistentContributionBinding => {
  requireIdentifier(binding.surface.packageId, 'PACKAGE_ID');
  requireIdentifier(binding.surface.packageVersion, 'PACKAGE_VERSION');
  requireIdentifier(binding.surface.publisherId, 'PUBLISHER_ID');
  requireIdentifier(binding.contributionId, 'CONTRIBUTION_ID');
  if (!INTEGRITY_PATTERN.test(binding.artifactIntegrity)) {
    throw new Error('PACKAGE_PERSISTENT_CONTRIBUTION_INVALID_ARTIFACT');
  }
  return binding;
};

const slotFor = (binding: PackagePersistentContributionBinding): string =>
  `${binding.surface.packageId}:${binding.surface.publisherId}:${binding.contributionId}`;

const errorCode = (error: unknown): string =>
  error instanceof Error && error.message.startsWith('PACKAGE_PERSISTENT_CONTRIBUTION_')
    ? error.message
    : 'PACKAGE_PERSISTENT_CONTRIBUTION_FAILED';

/**
 * Serializes long-lived, package-owned contribution endpoints per package and
 * contribution. A new digest atomically supersedes the previous digest within
 * the same slot; Core retains no package implementation import or loader.
 */
export const createPackagePersistentContributionSupervisor = (
  deps: PackagePersistentContributionSupervisorDependencies
): PackagePersistentContributionSupervisor => {
  const active = new Map<string, ActiveContribution>();
  const transitions = new Map<string, Promise<void>>();
  let disposed = false;

  const evidence = async (
    phase: PackagePersistentContributionEvidence['phase'],
    binding: PackagePersistentContributionBinding,
    reason?: string
  ): Promise<void> => {
    try {
      await deps.recordEvidence({
        kind: 'package-persistent-contribution.v1',
        phase,
        binding,
        ...(reason === undefined ? {} : { reason }),
      });
    } catch {
      throw new Error('PACKAGE_PERSISTENT_CONTRIBUTION_EVIDENCE_UNAVAILABLE');
    }
  };

  const stop = async (record: ActiveContribution, reason: string): Promise<void> => {
    const shouldRecordEvidence = !record.terminal;
    if (shouldRecordEvidence) record.terminal = true;
    if (!record.controller.signal.aborted) record.controller.abort(reason);
    if (record.endpoint !== undefined && !record.endpointStopped) {
      record.endpointStopped = true;
      try {
        await record.endpoint.stop();
      } catch {
        // Revocation has already been enforced through the abort signal.
      }
    }
    if (shouldRecordEvidence) await evidence('stopped', record.binding, reason);
  };

  const runTransition = async (slot: string, work: () => Promise<void>): Promise<void> => {
    const previous = transitions.get(slot) ?? Promise.resolve();
    const next = previous.catch((): undefined => undefined).then(work);
    transitions.set(slot, next);
    try {
      await next;
    } finally {
      if (transitions.get(slot) === next) transitions.delete(slot);
    }
  };

  const removeIfCurrent = (slot: string, record: ActiveContribution): void => {
    if (active.get(slot) === record) active.delete(slot);
  };

  return {
    activate: async (rawBinding) => {
      const binding = requireBinding(rawBinding);
      const slot = slotFor(binding);
      await runTransition(slot, async () => {
        if (disposed) throw new Error('PACKAGE_PERSISTENT_CONTRIBUTION_DISPOSED');
        const previous = active.get(slot);
        if (previous !== undefined && !previous.terminal && sameBinding(previous.binding, binding)) return;
        if (previous !== undefined) {
          removeIfCurrent(slot, previous);
          await stop(previous, 'PACKAGE_PERSISTENT_CONTRIBUTION_REPLACED');
        }
        if (!(await deps.isBindingActive(binding))) {
          await evidence('rejected', binding, 'PACKAGE_PERSISTENT_CONTRIBUTION_BINDING_INACTIVE');
          throw new Error('PACKAGE_PERSISTENT_CONTRIBUTION_BINDING_INACTIVE');
        }

        const record: ActiveContribution = {
          binding,
          controller: new AbortController(),
          state: 'starting',
          endpointStopped: false,
          terminal: false,
        };
        active.set(slot, record);
        try {
          await evidence('admitted', binding);
          const endpoint = await deps.createEndpoint(binding, record.controller.signal);
          if (endpoint === undefined) {
            throw new Error('PACKAGE_PERSISTENT_CONTRIBUTION_UNAVAILABLE');
          }
          record.endpoint = endpoint;
          if (record.controller.signal.aborted || !(await deps.isBindingActive(binding))) {
            throw new Error(
              record.controller.signal.aborted
                ? 'PACKAGE_PERSISTENT_CONTRIBUTION_REVOKED'
                : 'PACKAGE_PERSISTENT_CONTRIBUTION_BINDING_INACTIVE'
            );
          }
          record.state = 'active';
          await evidence('started', binding);
        } catch (error) {
          const code = errorCode(error);
          removeIfCurrent(slot, record);
          try {
            await stop(record, code);
          } catch (stopError) {
            if (errorCode(stopError) === 'PACKAGE_PERSISTENT_CONTRIBUTION_EVIDENCE_UNAVAILABLE') {
              throw stopError;
            }
          }
          if (code === 'PACKAGE_PERSISTENT_CONTRIBUTION_EVIDENCE_UNAVAILABLE') throw error;
          if (
            code !== 'PACKAGE_PERSISTENT_CONTRIBUTION_REVOKED' &&
            code !== 'PACKAGE_PERSISTENT_CONTRIBUTION_BINDING_INACTIVE'
          ) {
            await evidence('failed', binding, code);
          }
          throw error instanceof Error && error.message === code ? error : new Error(code);
        }
      });
    },
    invalidate: async (surface, rawContributionId) => {
      const contributionId = requireIdentifier(rawContributionId, 'CONTRIBUTION_ID');
      for (const [slot, record] of active) {
        if (record.binding.contributionId !== contributionId || !sameIdentity(record.binding.surface, surface))
          continue;
        removeIfCurrent(slot, record);
        await stop(record, 'PACKAGE_PERSISTENT_CONTRIBUTION_REVOKED');
      }
    },
    state: (rawBinding) => {
      if (disposed) return 'disposed';
      const binding = requireBinding(rawBinding);
      const record = active.get(slotFor(binding));
      if (record === undefined || record.terminal || !sameBinding(record.binding, binding)) return 'inactive';
      return record.state;
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      const records = [...active.entries()];
      active.clear();
      await Promise.all(records.map(async ([, record]) => stop(record, 'PACKAGE_PERSISTENT_CONTRIBUTION_DISPOSED')));
    },
  };
};
