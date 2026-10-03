import { describe, expect, it, vi } from 'vitest';
import {
  createPackagePersistentContributionSupervisor,
  type PackagePersistentContributionBinding,
} from '@/process/resources/packageProcessRuntime/persistentContributionSupervisor';

const binding: PackagePersistentContributionBinding = {
  surface: {
    packageId: 'com.tomni.design-studio',
    packageVersion: '1.0.0',
    publisherId: 'com.tomni',
  },
  contributionId: 'design-viu-v1',
  artifactIntegrity: `sha256-${'a'.repeat(64)}`,
};

const createSupervisor = (
  overrides: Partial<Parameters<typeof createPackagePersistentContributionSupervisor>[0]> = {}
) => {
  const stop = vi.fn(async () => undefined);
  const createEndpoint = vi.fn(async () => ({ stop }));
  const recordEvidence = vi.fn(async () => undefined);
  const supervisor = createPackagePersistentContributionSupervisor({
    isBindingActive: async () => true,
    createEndpoint,
    recordEvidence,
    ...overrides,
  });
  return { supervisor, stop, createEndpoint, recordEvidence };
};

describe('PackagePersistentContributionSupervisor', () => {
  it('starts one digest-pinned endpoint exactly once for repeated activation', async () => {
    const { supervisor, createEndpoint } = createSupervisor();

    await supervisor.activate(binding);
    await supervisor.activate(binding);

    expect(createEndpoint).toHaveBeenCalledTimes(1);
    expect(supervisor.state(binding)).toBe('active');
  });

  it('fails closed before endpoint creation when the installed binding is inactive', async () => {
    const inactive = createSupervisor({ isBindingActive: async () => false });

    await expect(inactive.supervisor.activate(binding)).rejects.toThrow(
      'PACKAGE_PERSISTENT_CONTRIBUTION_BINDING_INACTIVE'
    );

    expect(inactive.createEndpoint).not.toHaveBeenCalled();
    expect(inactive.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'rejected', reason: 'PACKAGE_PERSISTENT_CONTRIBUTION_BINDING_INACTIVE' })
    );
  });

  it('records a terminal failure after cleaning up an unavailable endpoint', async () => {
    const unavailable = createSupervisor({ createEndpoint: async () => undefined });

    await expect(unavailable.supervisor.activate(binding)).rejects.toThrow(
      'PACKAGE_PERSISTENT_CONTRIBUTION_UNAVAILABLE'
    );

    expect(unavailable.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'failed', reason: 'PACKAGE_PERSISTENT_CONTRIBUTION_UNAVAILABLE' })
    );
  });

  it('stops an active digest before admitting a replacement digest in the same contribution slot', async () => {
    const { supervisor, stop, createEndpoint } = createSupervisor();
    const replacement = { ...binding, artifactIntegrity: `sha256-${'b'.repeat(64)}` };

    await supervisor.activate(binding);
    await supervisor.activate(replacement);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(createEndpoint).toHaveBeenCalledTimes(2);
    expect(supervisor.state(binding)).toBe('inactive');
    expect(supervisor.state(replacement)).toBe('active');
  });

  it('revokes only the exact installed identity and stops a startup endpoint once it arrives', async () => {
    let release: (() => void) | undefined;
    let startSignal: AbortSignal | undefined;
    const endpointReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = vi.fn(async () => undefined);
    const { supervisor } = createSupervisor({
      createEndpoint: async (_binding, signal) => {
        startSignal = signal;
        await endpointReady;
        return { stop };
      },
    });
    const otherIdentity = {
      ...binding.surface,
      packageId: 'com.tomni.other-package',
    };

    const starting = supervisor.activate(binding);
    await vi.waitFor(() => expect(startSignal).toBeDefined());
    await supervisor.invalidate(otherIdentity, binding.contributionId);
    expect(startSignal?.aborted).toBe(false);

    await supervisor.invalidate(binding.surface, binding.contributionId);
    expect(startSignal?.aborted).toBe(true);
    release?.();

    await expect(starting).rejects.toThrow('PACKAGE_PERSISTENT_CONTRIBUTION_REVOKED');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('waits for uninstall to release the active runtime lease and denies reacquisition after revocation', async () => {
    let bindingActive = true;
    let releaseStop: (() => void) | undefined;
    let signalStopStarted: (() => void) | undefined;
    const stopStarted = new Promise<void>((resolve) => {
      signalStopStarted = resolve;
    });
    const stopReleased = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const stop = vi.fn(async () => {
      signalStopStarted?.();
      await stopReleased;
    });
    const createEndpoint = vi.fn(async () => ({ stop }));
    const { supervisor, recordEvidence } = createSupervisor({
      isBindingActive: async () => bindingActive,
      createEndpoint,
    });

    await supervisor.activate(binding);
    const uninstalling = supervisor.invalidate(binding.surface, binding.contributionId);
    await stopStarted;
    expect(supervisor.state(binding)).toBe('inactive');

    bindingActive = false;
    const reacquiring = supervisor.activate(binding);
    releaseStop?.();

    await uninstalling;
    await expect(reacquiring).rejects.toThrow('PACKAGE_PERSISTENT_CONTRIBUTION_BINDING_INACTIVE');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(createEndpoint).toHaveBeenCalledTimes(1);
    expect(recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'stopped', reason: 'PACKAGE_PERSISTENT_CONTRIBUTION_REVOKED' })
    );
    expect(recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'rejected', reason: 'PACKAGE_PERSISTENT_CONTRIBUTION_BINDING_INACTIVE' })
    );
  });
  it('keeps lifecycle evidence redacted and terminates all live endpoints on disposal', async () => {
    const evidence: unknown[] = [];
    const { supervisor, stop } = createSupervisor({
      recordEvidence: async (event) => evidence.push(event),
    });

    await supervisor.activate(binding);
    await supervisor.dispose();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(supervisor.state(binding)).toBe('disposed');
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'admitted' }),
        expect.objectContaining({ phase: 'started' }),
        expect.objectContaining({ phase: 'stopped', reason: 'PACKAGE_PERSISTENT_CONTRIBUTION_DISPOSED' }),
      ])
    );
    expect(JSON.stringify(evidence)).not.toContain('secret');
  });
});
