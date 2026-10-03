import path from 'node:path';
import type { IWorkerProcess, IWorkerProcessFactory } from '@/common/platform';
import type { PackageRuntimeEntryLease } from '@process/extensions/package-manager/PackageManagerService';
import type {
  PackagePersistentContributionBinding,
  PackagePersistentContributionEndpoint,
} from './persistentContributionSupervisor';

const RUNTIME_PATH_PATTERN = /^runtime\/[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\.(?:cjs|mjs|js)$/;
const STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 2_000;

type PackageArtifactLifecycleEvent = 'ready' | 'stopped' | 'failed';

export type FixedPackageArtifactRuntime = Readonly<{
  entrypointId: string;
  relativeEntryPath: string;
}>;

export type PackageArtifactProcessEndpointDependencies = Readonly<{
  binding: PackagePersistentContributionBinding;
  runtime: FixedPackageArtifactRuntime;
  acquireRuntimeEntry: (packageId: string, assetPath: string) => Promise<PackageRuntimeEntryLease>;
  workerFactory: IWorkerProcessFactory;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
}>;

const isLifecycleEvent = (
  value: unknown
): value is Readonly<{ schemaVersion: 1; event: PackageArtifactLifecycleEvent }> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 2 &&
  (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
  ((value as { event?: unknown }).event === 'ready' ||
    (value as { event?: unknown }).event === 'stopped' ||
    (value as { event?: unknown }).event === 'failed');

const sameLeaseIdentity = (binding: PackagePersistentContributionBinding, lease: PackageRuntimeEntryLease): boolean =>
  lease.identity.packageId === binding.surface.packageId &&
  lease.identity.packageVersion === binding.surface.packageVersion &&
  lease.identity.publisherId === binding.surface.publisherId &&
  lease.identity.artifactIntegrity === binding.artifactIntegrity;

const waitFor = async (promise: Promise<void>, timeoutMs: number): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((_resolve, reject: (error: Error) => void) => {
        timeout = setTimeout(() => reject(new Error('PACKAGE_ARTIFACT_PROCESS_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/**
 * Starts one Core-selected entry from a verified package artifact. The package
 * cannot supply a path, argument, environment, or worker protocol: each is
 * fixed by reviewed Main wiring and re-verified under an asset-read lease.
 */
export const createPackageArtifactProcessEndpoint = async (
  deps: PackageArtifactProcessEndpointDependencies
): Promise<PackagePersistentContributionEndpoint> => {
  if (!RUNTIME_PATH_PATTERN.test(deps.runtime.relativeEntryPath)) {
    throw new Error('PACKAGE_ARTIFACT_PROCESS_INVALID_RUNTIME_PATH');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(deps.runtime.entrypointId)) {
    throw new Error('PACKAGE_ARTIFACT_PROCESS_INVALID_ENTRYPOINT');
  }

  const lease = await deps.acquireRuntimeEntry(deps.binding.surface.packageId, deps.runtime.relativeEntryPath);
  if (!sameLeaseIdentity(deps.binding, lease)) {
    lease.release();
    throw new Error('PACKAGE_ARTIFACT_PROCESS_IDENTITY_MISMATCH');
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    lease.release();
  };
  let worker: IWorkerProcess;
  try {
    worker = deps.workerFactory.fork(lease.entryPath, [], { cwd: path.dirname(lease.entryPath), env: {} });
  } catch (error) {
    release();
    throw error;
  }

  let exited = false;
  let stopped = false;
  let resolveTerminal: () => void = () => {};
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  let resolveReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject: (error: Error) => void) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const finish = (): void => {
    if (stopped) return;
    stopped = true;
    resolveTerminal();
  };

  worker.on('message', (message: unknown) => {
    if (!isLifecycleEvent(message)) return;
    if (message.event === 'ready') {
      resolveReady();
      return;
    }
    finish();
    if (message.event === 'failed') rejectReady(new Error('PACKAGE_ARTIFACT_PROCESS_START_FAILED'));
    else rejectReady(new Error('PACKAGE_ARTIFACT_PROCESS_STOPPED_DURING_START'));
  });
  worker.on('error', () => {
    finish();
    rejectReady(new Error('PACKAGE_ARTIFACT_PROCESS_START_FAILED'));
  });
  worker.on('exit', () => {
    exited = true;
    finish();
    rejectReady(new Error('PACKAGE_ARTIFACT_PROCESS_EXITED_DURING_START'));
  });

  let stopPromise: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    stopPromise ??= (async (): Promise<void> => {
      try {
        if (!stopped) worker.postMessage({ schemaVersion: 1, type: 'shutdown' });
        await waitFor(terminal, deps.stopTimeoutMs ?? STOP_TIMEOUT_MS).catch((): undefined => undefined);
      } finally {
        if (!exited) {
          try {
            worker.kill();
          } catch {
            // The process is already gone or cannot be signalled; the lease still closes.
          }
        }
        release();
      }
    })();
    return stopPromise;
  };

  try {
    await waitFor(ready, deps.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
  } catch (error) {
    await stop();
    throw error;
  }
  return Object.freeze({ stop });
};
