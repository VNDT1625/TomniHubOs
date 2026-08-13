/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { RustSidecarClient } from '@process/experimentalCore/adapters/sidecar/rustSidecarClient';
import type { WindowsCreatorSandboxNativeClient } from './windowsSandboxProtocol';

const PROCESS_TREE_STOP_TIMEOUT_MS = 8_000;

type TrackedWindowsProcess = Pick<ChildProcessWithoutNullStreams, 'pid' | 'killed' | 'exitCode' | 'signalCode'> & {
  once?(event: 'exit', listener: () => void): unknown;
};

export type WindowsProcessTreeTerminator = (pid: number) => Promise<void>;

type WindowsCreatorSandboxNativeClientDelegate = Pick<WindowsCreatorSandboxNativeClient, 'start' | 'request' | 'stop'>;

export type WindowsCreatorSandboxProcessClientInput = {
  command: string;
  args: string[];
  cwd: string;
  requestTimeoutMs: number;
};

export type WindowsCreatorSandboxProcessClientDependencies = {
  spawnProcess?: typeof spawn;
  terminateProcessTree?: WindowsProcessTreeTerminator;
};

type ExecFileProcess = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean },
  callback: (error: Error | null) => void
) => unknown;

const defaultExecFileProcess: ExecFileProcess = (file, args, options, callback) => {
  execFile(file, args, options, (error) => callback(error));
};

const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

/** Force-stop a Windows process and all descendants without invoking a shell. */
export const terminateWindowsProcessTree = (
  pid: number,
  execFileProcess: ExecFileProcess = defaultExecFileProcess
): Promise<void> => {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return Promise.reject(new RangeError('Windows process tree PID must be a positive safe integer.'));
  }
  return new Promise((resolve, reject) => {
    execFileProcess(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { timeout: PROCESS_TREE_STOP_TIMEOUT_MS, windowsHide: true },
      (error) => {
        if (error) {
          reject(new Error(`Unable to terminate Windows sandbox process tree: ${error.message}`));
          return;
        }
        resolve();
      }
    );
  });
};

const processIsRunning = (
  process: TrackedWindowsProcess | undefined
): process is TrackedWindowsProcess & { pid: number } =>
  Boolean(
    process &&
    Number.isSafeInteger(process.pid) &&
    (process.pid ?? 0) > 0 &&
    process.exitCode === null &&
    process.signalCode === null
  );

/**
 * Bind deterministic process-tree cleanup to a native client. The native helper owns
 * Job Object cleanup; this host-side taskkill is a second, independently enforced stop.
 */
export const bindWindowsProcessTreeCleanup = (
  client: WindowsCreatorSandboxNativeClientDelegate,
  getProcess: () => TrackedWindowsProcess | undefined,
  terminateProcessTree: WindowsProcessTreeTerminator = terminateWindowsProcessTree
): WindowsCreatorSandboxNativeClient => {
  let stopInFlight: Promise<void> | undefined;
  let stopFailure: Error | undefined;
  let stopped = false;
  let stopRequested = false;
  let unexpectedExitObserved = false;
  let observedProcess: TrackedWindowsProcess | undefined;
  const unexpectedExitListeners = new Set<() => void>();

  const notifyUnexpectedExit = (): void => {
    if (stopRequested || unexpectedExitObserved) return;
    unexpectedExitObserved = true;
    for (const listener of unexpectedExitListeners) {
      try {
        listener();
      } catch {
        // A lifecycle observer cannot weaken deterministic client cleanup.
      }
    }
  };

  const observeProcessExit = (): void => {
    const process = getProcess();
    if (!process || process === observedProcess) return;
    observedProcess = process;
    if (processIsRunning(process)) {
      process.once?.('exit', notifyUnexpectedExit);
      return;
    }
    if (process.exitCode !== null || process.signalCode !== null) notifyUnexpectedExit();
  };

  const stop = (): Promise<void> => {
    if (stopped) return stopFailure ? Promise.reject(stopFailure) : Promise.resolve();
    if (stopInFlight) return stopInFlight;
    stopRequested = true;
    stopInFlight = (async () => {
      const process = getProcess();
      let terminationFailure: Error | undefined;
      if (processIsRunning(process)) {
        try {
          await terminateProcessTree(process.pid);
        } catch (error) {
          terminationFailure = toError(error);
        }
      }
      await client.stop();
      stopped = true;
      if (terminationFailure) {
        stopFailure = terminationFailure;
        throw terminationFailure;
      }
    })();
    return stopInFlight.finally(() => {
      stopInFlight = undefined;
    });
  };

  return {
    start: async () => {
      if (stopRequested) throw new Error('Windows sandbox process client is stopped.');
      const result = await client.start();
      observeProcessExit();
      return result;
    },
    request: <T>(
      method: string,
      params?: unknown,
      options?: Parameters<WindowsCreatorSandboxNativeClient['request']>[2]
    ) => {
      if (stopRequested) return Promise.reject(new Error('Windows sandbox process client is stopped.'));
      return client.request<T>(method, params, options).then((result) => {
        observeProcessExit();
        return result;
      });
    },
    stop,
    subscribeUnexpectedExit: (listener) => {
      observeProcessExit();
      if (unexpectedExitObserved) {
        try {
          listener();
        } catch {
          // A lifecycle observer cannot weaken deterministic client cleanup.
        }
        return () => undefined;
      }
      unexpectedExitListeners.add(listener);
      return () => {
        unexpectedExitListeners.delete(listener);
      };
    },
  };
};

/** Create the production sidecar client with its root process captured for tree cleanup. */
export const createWindowsCreatorSandboxProcessClient = (
  input: WindowsCreatorSandboxProcessClientInput,
  dependencies: WindowsCreatorSandboxProcessClientDependencies = {}
): WindowsCreatorSandboxNativeClient => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const delegateSpawn = dependencies.spawnProcess ?? spawn;
  const captureSpawn = ((...args: unknown[]) => {
    const spawned = Reflect.apply(delegateSpawn, undefined, args) as ChildProcessWithoutNullStreams;
    child = spawned;
    return spawned;
  }) as typeof spawn;
  const client = new RustSidecarClient(
    {
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      restartPolicy: 'never',
      requestTimeoutMs: input.requestTimeoutMs,
      startupTimeoutMs: 5_000,
      clientVersion: 'tomni-creator-sandbox-boundary-v1',
    },
    { spawnProcess: captureSpawn }
  );
  return bindWindowsProcessTreeCleanup(client, () => child, dependencies.terminateProcessTree);
};
