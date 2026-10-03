import { describe, expect, it, vi } from 'vitest';
import type { IWorkerProcess, IWorkerProcessFactory } from '@/common/platform';
import type { PackageRuntimeEntryLease } from '@/process/extensions/package-manager/PackageManagerService';
import { createPackageArtifactProcessEndpoint } from '@/process/resources/packageProcessRuntime/packageArtifactProcessEndpoint';

const binding = {
  surface: { packageId: 'com.tomni.design-studio', packageVersion: '1.0.0', publisherId: 'com.tomni' },
  contributionId: 'design-viu-v1',
  artifactIntegrity: `sha256-${'a'.repeat(64)}`,
} as const;

const lease = (release = vi.fn()): PackageRuntimeEntryLease => ({
  entryPath: 'C:/packages/design/runtime/design-viu-v1.cjs',
  identity: { ...binding.surface, artifactIntegrity: binding.artifactIntegrity },
  release,
});

const workerHarness = (): {
  worker: IWorkerProcess;
  emit: (event: string, value?: unknown) => void;
  postMessage: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
} => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const postMessage = vi.fn();
  const kill = vi.fn();
  return {
    worker: {
      postMessage,
      on: (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return {} as IWorkerProcess;
      },
      kill,
    },
    emit: (event, value?: unknown) => listeners.get(event)?.forEach((listener) => listener(value)),
    postMessage,
    kill,
  };
};

describe('verified package artifact process endpoint', () => {
  it('starts only after the child reports an exact ready event and holds the artifact lease until stop', async () => {
    const harness = workerHarness();
    const release = vi.fn();
    const fork = vi.fn(() => harness.worker);
    const endpointPromise = createPackageArtifactProcessEndpoint({
      binding,
      runtime: { entrypointId: 'design-viu-v1', relativeEntryPath: 'runtime/design-viu-v1.cjs' },
      acquireRuntimeEntry: async () => lease(release),
      workerFactory: { fork } satisfies IWorkerProcessFactory,
    });

    await vi.waitFor(() => expect(fork).toHaveBeenCalledTimes(1));
    harness.emit('message', { schemaVersion: 1, event: 'ready' });
    const endpoint = await endpointPromise;

    expect(fork).toHaveBeenCalledWith('C:/packages/design/runtime/design-viu-v1.cjs', [], {
      cwd: 'C:/packages/design/runtime',
      env: {},
    });
    expect(release).not.toHaveBeenCalled();

    const stopped = endpoint.stop();
    expect(harness.postMessage).toHaveBeenCalledWith({ schemaVersion: 1, type: 'shutdown' });
    harness.emit('message', { schemaVersion: 1, event: 'stopped' });
    await stopped;

    expect(harness.kill).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('fails closed on malformed lifecycle messages and releases the lease after startup timeout', async () => {
    const harness = workerHarness();
    const release = vi.fn();
    const endpoint = createPackageArtifactProcessEndpoint({
      binding,
      runtime: { entrypointId: 'design-viu-v1', relativeEntryPath: 'runtime/design-viu-v1.cjs' },
      acquireRuntimeEntry: async () => lease(release),
      workerFactory: { fork: () => harness.worker } satisfies IWorkerProcessFactory,
      startupTimeoutMs: 1,
      stopTimeoutMs: 1,
    });

    harness.emit('message', { schemaVersion: 1, event: 'ready', injected: true });
    await expect(endpoint).rejects.toThrow('PACKAGE_ARTIFACT_PROCESS_TIMEOUT');
    expect(harness.kill).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects an artifact lease that does not match the admitted digest before forking', async () => {
    const release = vi.fn();
    const fork = vi.fn();
    await expect(
      createPackageArtifactProcessEndpoint({
        binding,
        runtime: { entrypointId: 'design-viu-v1', relativeEntryPath: 'runtime/design-viu-v1.cjs' },
        acquireRuntimeEntry: async () => ({
          ...lease(release),
          identity: { ...binding.surface, artifactIntegrity: `sha256-${'b'.repeat(64)}` },
        }),
        workerFactory: { fork } satisfies IWorkerProcessFactory,
      })
    ).rejects.toThrow('PACKAGE_ARTIFACT_PROCESS_IDENTITY_MISMATCH');
    expect(fork).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
