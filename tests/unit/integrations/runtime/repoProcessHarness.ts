/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  RepoProcessPorts,
  RepoProcessServiceSpec,
  RepoProcessSpec,
  SpawnRequest,
} from '@process/integrations/runtime/repoProcessPorts';
import { minimalBaseEnv } from '@process/integrations/runtime/repoProcessNodePorts';

export type FakeProcess = {
  req: SpawnRequest;
  pid: number;
  exited: boolean;
  exit: (code: number | null) => void;
  print: (text: string, stream?: 'stdout' | 'stderr') => void;
};

export type HarnessOptions = {
  /** Polls of the ready port that report "closed" before it opens. */
  readyAfterPolls?: number;
  neverReady?: boolean;
  alreadyListening?: number[];
  owner?: string;
  secrets?: Record<string, string>;
  hostEnv?: NodeJS.ProcessEnv;
  setupDone?: boolean;
  setupExitCode?: number;
};

export const makeHarness = (options: HarnessOptions = {}) => {
  let time = 0;
  let nextPid = 100;
  const sleeps: number[] = [];
  const kills: Array<{ pid: number; graceMs: number }> = [];
  const spawns: FakeProcess[] = [];
  const listening = new Set<number>(options.alreadyListening ?? []);
  const pending = new Map<number, number>();
  const marks = new Set<string>(options.setupDone === true ? ['*'] : []);
  const markCalls: string[] = [];

  const ports: RepoProcessPorts = {
    spawn: (req) => {
      const pid = nextPid++;
      let exitListener: ((code: number | null) => void) | undefined;
      let outputListener: ((stream: 'stdout' | 'stderr', chunk: string) => void) | undefined;
      const record: FakeProcess = {
        req,
        pid,
        exited: false,
        exit: (code) => {
          if (record.exited) return;
          record.exited = true;
          const port = Number(req.env['PORT']);
          listening.delete(port);
          exitListener?.(code);
        },
        print: (text, stream = 'stdout') => outputListener?.(stream, text),
      };
      spawns.push(record);
      if (req.args[0] === 'install' || req.args[0] === 'ci') {
        queueMicrotask(() => record.exit(options.setupExitCode ?? 0));
      } else if (options.neverReady !== true) {
        const port = Number(req.env['PORT']);
        if ((options.readyAfterPolls ?? 0) > 0) pending.set(port, options.readyAfterPolls ?? 0);
        else listening.add(port);
      }
      return {
        pid,
        onOutput: (listener) => {
          outputListener = listener;
        },
        onExit: (listener) => {
          exitListener = listener;
        },
      };
    },
    killTree: (pid, graceMs) => {
      kills.push({ pid, graceMs });
      spawns.find((record) => record.pid === pid)?.exit(null);
      return Promise.resolve();
    },
    isPortOpen: (port) => {
      if (listening.has(port)) return Promise.resolve(true);
      const remaining = pending.get(port);
      if (remaining !== undefined) {
        if (remaining <= 1) {
          pending.delete(port);
          listening.add(port);
          return Promise.resolve(true);
        }
        pending.set(port, remaining - 1);
      }
      return Promise.resolve(false);
    },
    describePortOwner: () => Promise.resolve(options.owner),
    clock: {
      now: () => time,
      sleep: (ms, signal) => {
        if (signal?.aborted === true) return Promise.reject(new Error('aborted'));
        sleeps.push(ms);
        time += ms;
        // Virtual time, but yield a macrotask so exits and aborts can interleave with the polling loops.
        return new Promise<void>((resolve, reject) => {
          setImmediate(() => (signal?.aborted === true ? reject(new Error('aborted')) : resolve()));
        });
      },
    },
    baseEnv: () => minimalBaseEnv(options.hostEnv ?? { PATH: '/bin', GITHUB_TOKEN: 'leak', OPENAI_API_KEY: 'leak' }),
    resolveSecret: (name) => Promise.resolve(options.secrets?.[name]),
    setupMarkers: {
      has: (key) => Promise.resolve(marks.has('*') || marks.has(key)),
      mark: (key) => {
        marks.add(key);
        markCalls.push(key);
        return Promise.resolve();
      },
    },
    nodeExecutable: '/electron/app',
  };
  return { ports, spawns, kills, sleeps, markCalls, listening };
};

export const settle = async (): Promise<void> => {
  for (let index = 0; index < 30; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- let chained microtasks and timers drain
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

export const service = (
  id: string,
  port: number,
  extra: Partial<RepoProcessServiceSpec> = {}
): RepoProcessServiceSpec => ({
  id,
  cwd: `source/${id}`,
  start: ['node', 'server.js'],
  ready: { port },
  ...extra,
});

const roots: string[] = [];
export const makePackage = async (serviceIds: string[]): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-proc-'));
  roots.push(root);
  for (const id of serviceIds) await mkdir(path.join(root, 'source', id), { recursive: true });
  return root;
};
export const cleanPackages = async (): Promise<void> => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
};

export const specFor = (packageDirectory: string, services: RepoProcessServiceSpec[]): RepoProcessSpec => ({
  packageDirectory,
  approvalHash: 'sha256-approved',
  services,
});
