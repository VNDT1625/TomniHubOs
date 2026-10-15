/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile, spawn as spawnChild } from 'node:child_process';
import net from 'node:net';
import type { RepoProcessClock, RepoProcessPorts, SpawnedProcess } from './repoProcessPorts';

const IS_WINDOWS = process.platform === 'win32';

/** System variables a child may inherit. Anything else (tokens, API keys, proxy credentials) is dropped. */
const BASE_ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'LANG',
  'LC_ALL',
  'TZ',
]);

export const minimalBaseEnv = (source: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && BASE_ENV_ALLOWLIST.has(key.toUpperCase())) result[key] = value;
  }
  return result;
};

export const systemClock: RepoProcessClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new Error('aborted'));
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

const connectOnce = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

/** True when something accepts loopback connections on the port (IPv4 or IPv6). */
export const probeLoopbackPort = async (port: number): Promise<boolean> =>
  (await connectOnce('127.0.0.1', port)) || (await connectOnce('::1', port));

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 5000 }, (_error, stdout) => resolve(String(stdout ?? '')));
  });

const describeOwnerWindows = async (port: number): Promise<string | undefined> => {
  const table = await run('netstat', ['-ano', '-p', 'tcp']);
  const line = table
    .split(/\r?\n/u)
    .map((row) => row.trim().split(/\s+/u))
    .find((cols) => cols[3] === 'LISTENING' && /[:\]]\d+$/u.test(cols[1] ?? '') && cols[1]?.endsWith(`:${port}`));
  const pid = line?.[4];
  if (pid === undefined || !/^\d+$/u.test(pid)) return undefined;
  const task = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  const name = /^"([^"]+)"/u.exec(task.trim())?.[1];
  return name === undefined ? `pid ${pid}` : `${name} (pid ${pid})`;
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const killTreeWindows = (pid: number): Promise<void> =>
  new Promise((resolve) => {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => resolve());
  });

const killTreePosix = async (pid: number, graceMs: number): Promise<void> => {
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is already gone.
    }
  };
  signalGroup('SIGTERM');
  const deadline = Date.now() + graceMs;
  while (isAlive(pid) && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- polling for exit until the grace period ends
    await systemClock.sleep(50);
  }
  // Group kill also reaches grandchildren whose parent already exited.
  signalGroup('SIGKILL');
};

export type NodeRepoProcessPortsOptions = Readonly<{
  resolveSecret: RepoProcessPorts['resolveSecret'];
  setupMarkers: RepoProcessPorts['setupMarkers'];
  /** Defaults to the current executable; in Electron the caller must also rely on ELECTRON_RUN_AS_NODE. */
  nodeExecutable?: string;
}>;

const spawnProcess: RepoProcessPorts['spawn'] = (request) => {
  const useShell = IS_WINDOWS && request.command !== process.execPath;
  // Arguments are validated literal tokens (no shell metacharacters), so cmd.exe only resolves .cmd shims.
  const command = useShell ? (process.env['ComSpec'] ?? 'cmd.exe') : request.command;
  const args = useShell ? ['/d', '/s', '/c', request.command, ...request.args] : [...request.args];
  const exitListeners: Array<(code: number | null) => void> = [];
  const outputListeners: Array<(stream: 'stdout' | 'stderr', chunk: string) => void> = [];
  let exited = false;
  let exitCode: number | null = null;
  const finish = (code: number | null): void => {
    if (exited) return;
    exited = true;
    exitCode = code;
    for (const listener of exitListeners) listener(code);
  };
  const child = spawnChild(command, args, {
    cwd: request.cwd,
    env: { ...request.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WINDOWS,
    windowsHide: true,
    shell: false,
  });
  for (const stream of ['stdout', 'stderr'] as const) {
    child[stream].setEncoding('utf8');
    child[stream].on('data', (chunk: string) => {
      for (const listener of outputListeners) listener(stream, chunk);
    });
  }
  child.once('error', () => finish(null));
  child.once('exit', (code) => finish(code));
  const handle: SpawnedProcess = {
    pid: child.pid,
    onOutput: (listener) => {
      outputListeners.push(listener);
    },
    onExit: (listener) => {
      if (exited) listener(exitCode);
      else exitListeners.push(listener);
    },
  };
  return handle;
};

export const createNodeRepoProcessPorts = (options: NodeRepoProcessPortsOptions): RepoProcessPorts => ({
  spawn: spawnProcess,
  killTree: async (pid, graceMs) => {
    try {
      await (IS_WINDOWS ? killTreeWindows(pid) : killTreePosix(pid, graceMs));
    } catch {
      // Killing is best effort; the caller already treats the service as stopped.
    }
  },
  isPortOpen: probeLoopbackPort,
  describePortOwner: async (port) => {
    if (!IS_WINDOWS) return undefined;
    try {
      return await describeOwnerWindows(port);
    } catch {
      return undefined;
    }
  },
  clock: systemClock,
  baseEnv: () => minimalBaseEnv(),
  resolveSecret: options.resolveSecret,
  setupMarkers: options.setupMarkers,
  nodeExecutable: options.nodeExecutable ?? process.execPath,
});
