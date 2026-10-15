/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one answer to "can this machine run X?" for connection hosts (docs/platform/repotopackage-design.md section
 * 9.3, task T5.2): Node.js (carried by Electron), Python 3, uv, Git, Git Bash, Docker, Cargo and Go.
 *
 * - It never runs code that comes from a package or a repository. Programs are looked up only in the absolute
 *   folders of `PATH` (a folder named `.` or a relative one is skipped, so a workspace cannot plant `git.exe`), and
 *   the only thing ever run is the version flag of a program found that way, in a neutral folder with a minimal
 *   environment, without a shell.
 * - Results are cached for 60 seconds (a failed lookup too), so a screen full of connections asks the machine once.
 *   A lookup that is already running is shared.
 * - Every reason is a sentence a person can read and act on; it names what is missing and where to get it.
 * - Every operating-system touch goes through `RuntimeProbePorts`, so tests run without any real program.
 */

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { minimalBaseEnv } from '@process/integrations/runtime/repoProcessNodePorts';
import type { HostCheck } from './types';

export const RUNTIME_IDS = ['node', 'python', 'uv', 'git', 'git-bash', 'docker', 'cargo', 'go'] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];

export type RuntimeStatus =
  | Readonly<{ id: RuntimeId; ok: true; version?: string; location?: string; note?: string }>
  | Readonly<{ id: RuntimeId; ok: false; reason: string }>;

export type RuntimeRequirement = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string; missing: RuntimeId[] }>;

export type ProbeExecResult = Readonly<{ ok: boolean; output: string }>;

export type RuntimeProbePorts = Readonly<{
  /** Runs one program found on `PATH` with a fixed argument list. No shell; never inside a repository. */
  exec: (file: string, args: readonly string[]) => Promise<ProbeExecResult>;
  exists: (filePath: string) => Promise<boolean>;
  now: () => number;
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** The Node.js carried by Electron (`process.versions.node`). */
  nodeVersion: string;
}>;

export type RuntimeProbe = Readonly<{
  check: (id: RuntimeId) => Promise<RuntimeStatus>;
  checkAll: () => Promise<readonly RuntimeStatus[]>;
  /** All of `ids` must be present; otherwise one sentence listing what is missing. */
  require: (ids: readonly RuntimeId[]) => Promise<RuntimeRequirement>;
  /** The default `ProgramProbe` of the hosts: one program name of a command line. */
  programProbe: (program: string) => Promise<HostCheck>;
  /** Forget the cache (all, or one runtime) after the person installed something. */
  invalidate: (id?: RuntimeId) => void;
}>;

export const RUNTIME_PROBE_TTL_MS = 60_000;
const MAX_CACHED_PROGRAMS = 64;

type RuntimeLabel = Readonly<{ name: string; install: string }>;

const LABELS: Readonly<Record<RuntimeId, RuntimeLabel>> = {
  node: { name: 'Node.js', install: 'Node.js đi kèm Hub nên không cần cài thêm.' },
  python: {
    name: 'Python 3',
    install: 'Hãy cài Python 3 từ python.org (nhớ chọn "Add python.exe to PATH") rồi bật lại kết nối.',
  },
  uv: { name: 'uv', install: 'Hãy cài uv theo hướng dẫn ở docs.astral.sh/uv rồi bật lại kết nối.' },
  git: { name: 'Git', install: 'Hãy cài Git từ git-scm.com rồi bật lại kết nối.' },
  'git-bash': {
    name: 'Git Bash',
    install: 'Git Bash đi kèm Git for Windows: hãy cài Git từ git-scm.com (giữ tùy chọn Git Bash) rồi bật lại kết nối.',
  },
  docker: { name: 'Docker', install: 'Hãy cài Docker Desktop từ docker.com, mở nó lên rồi bật lại kết nối.' },
  cargo: { name: 'Cargo (Rust)', install: 'Hãy cài Rust bằng rustup (rustup.rs) rồi bật lại kết nối.' },
  go: { name: 'Go', install: 'Hãy cài Go từ go.dev/dl rồi bật lại kết nối.' },
};

/** Program names a command line may start with that one runtime answers for. Anything else is looked up on `PATH`. */
const PROGRAM_RUNTIME: Readonly<Record<string, RuntimeId>> = {
  node: 'node',
  python: 'python',
  python3: 'python',
  pip: 'python',
  uv: 'uv',
  uvx: 'uv',
  git: 'git',
  docker: 'docker',
  cargo: 'cargo',
  go: 'go',
};

const VERSION_PATTERN = /(\d+(?:\.\d+){1,3})/u;
const PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const BATCH_EXTENSION = /\.(?:cmd|bat)$/iu;

const missingReason = (id: RuntimeId): string =>
  `Máy này chưa có ${LABELS[id].name} (không tìm thấy trong PATH). ${LABELS[id].install}`;

const pathApi = (platform: NodeJS.Platform): path.PlatformPath => (platform === 'win32' ? path.win32 : path.posix);

const executableExtensions = (env: RuntimeProbePorts['env']): string[] =>
  (env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => /^\.[a-z0-9]{1,5}$/u.test(extension));

/**
 * The absolute path of the first program called `name` in an absolute folder of `PATH`, or `undefined`. Relative and
 * empty `PATH` entries are skipped on purpose: they mean "the current folder", which can be a hostile workspace.
 */
export const findProgramOnPath = async (
  name: string,
  ports: Pick<RuntimeProbePorts, 'env' | 'exists' | 'platform'>
): Promise<string | undefined> => {
  if (!PROGRAM_NAME.test(name)) return undefined;
  const api = pathApi(ports.platform);
  const key = Object.keys(ports.env).find((candidate) => candidate.toUpperCase() === 'PATH');
  const folders = (key === undefined ? '' : (ports.env[key] ?? '')).split(api.delimiter);
  const extensions = ports.platform === 'win32' ? executableExtensions(ports.env) : [''];
  for (const folder of folders) {
    const cleaned = folder.trim().replace(/^"(.*)"$/u, '$1');
    if (cleaned === '' || !api.isAbsolute(cleaned)) continue;
    for (const extension of extensions) {
      const candidate = api.join(cleaned, `${name}${extension}`);
      // oxlint-disable-next-line no-await-in-loop -- first match in PATH order wins
      if (await ports.exists(candidate)) return candidate;
    }
  }
  return undefined;
};

const versionOf = (output: string): string | undefined => VERSION_PATTERN.exec(output)?.[1];

type Located = Readonly<{ location: string; version?: string; failed?: true }>;

/** Finds `name` on `PATH` and asks it for its version. A batch shim is only located: it cannot be run without a shell. */
const locate = async (
  ports: RuntimeProbePorts,
  name: string,
  versionArguments: readonly string[]
): Promise<Located | undefined> => {
  const location = await findProgramOnPath(name, ports);
  if (location === undefined) return undefined;
  if (BATCH_EXTENSION.test(location)) return { location };
  const result = await ports.exec(location, versionArguments).catch((): ProbeExecResult => ({ ok: false, output: '' }));
  if (!result.ok) return { location, failed: true };
  const version = versionOf(result.output);
  return version === undefined ? { location, failed: true } : { location, version };
};

const foundButBroken = (id: RuntimeId, location: string): RuntimeStatus => ({
  id,
  ok: false,
  reason: `Đã thấy ${LABELS[id].name} tại ${location} nhưng không chạy được lệnh kiểm tra phiên bản. Hãy cài lại ${LABELS[id].name} rồi bật lại kết nối.`,
});

const simpleRuntime = async (
  ports: RuntimeProbePorts,
  id: RuntimeId,
  program: string,
  versionArguments: readonly string[]
): Promise<RuntimeStatus> => {
  const found = await locate(ports, program, versionArguments);
  if (found === undefined) return { id, ok: false, reason: missingReason(id) };
  if (found.failed === true) return foundButBroken(id, found.location);
  return { id, ok: true, location: found.location, ...(found.version === undefined ? {} : { version: found.version }) };
};

const pythonRuntime = async (ports: RuntimeProbePorts): Promise<RuntimeStatus> => {
  const candidates: ReadonlyArray<readonly [string, readonly string[]]> =
    ports.platform === 'win32'
      ? [
          ['python', ['--version']],
          ['py', ['-3', '--version']],
          ['python3', ['--version']],
        ]
      : [
          ['python3', ['--version']],
          ['python', ['--version']],
        ];
  let tooOld: string | undefined;
  let broken: string | undefined;
  for (const [program, args] of candidates) {
    // oxlint-disable-next-line no-await-in-loop -- candidates are tried in order
    const found = await locate(ports, program, args);
    if (found === undefined) continue;
    if (found.failed === true) {
      broken ??= found.location;
      continue;
    }
    const major = Number((found.version ?? '').split('.')[0]);
    if (found.version !== undefined && major < 3) {
      tooOld ??= found.version;
      continue;
    }
    return {
      id: 'python',
      ok: true,
      location: found.location,
      ...(found.version === undefined ? {} : { version: found.version }),
    };
  }
  if (tooOld !== undefined) {
    return {
      id: 'python',
      ok: false,
      reason: `Máy này chỉ có Python ${tooOld}, cũ hơn Python 3. ${LABELS.python.install}`,
    };
  }
  if (broken !== undefined) {
    return {
      id: 'python',
      ok: false,
      reason: `Đã thấy Python tại ${broken} nhưng nó không chạy được (trên Windows đây thường là lối tắt của Microsoft Store). ${LABELS.python.install}`,
    };
  }
  return { id: 'python', ok: false, reason: missingReason('python') };
};

const gitBashRuntime = async (ports: RuntimeProbePorts): Promise<RuntimeStatus> => {
  if (ports.platform !== 'win32') {
    return { id: 'git-bash', ok: true, note: 'Chỉ cần trên Windows; hệ điều hành này đã có sẵn bash.' };
  }
  const api = path.win32;
  const roots = new Set<string>();
  const git = await findProgramOnPath('git', ports);
  if (git !== undefined) {
    // git.exe sits in <root>\cmd, <root>\bin or <root>\mingw64\bin.
    const parent = api.dirname(api.dirname(git));
    roots.add(parent);
    roots.add(api.dirname(parent));
  }
  for (const variable of ['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)']) {
    const base = ports.env[variable];
    if (base !== undefined && api.isAbsolute(base)) roots.add(api.join(base, 'Git'));
  }
  const local = ports.env['LocalAppData'];
  if (local !== undefined && api.isAbsolute(local)) roots.add(api.join(local, 'Programs', 'Git'));
  for (const root of roots) {
    const bash = api.join(root, 'bin', 'bash.exe');
    // oxlint-disable-next-line no-await-in-loop -- a handful of well-known places
    if (await ports.exists(bash)) return { id: 'git-bash', ok: true, location: bash };
  }
  return { id: 'git-bash', ok: false, reason: missingReason('git-bash') };
};

const probeRuntime = (ports: RuntimeProbePorts, id: RuntimeId): Promise<RuntimeStatus> => {
  switch (id) {
    case 'node':
      return Promise.resolve({ id, ok: true, version: ports.nodeVersion, note: LABELS.node.install });
    case 'python':
      return pythonRuntime(ports);
    case 'git-bash':
      return gitBashRuntime(ports);
    case 'go':
      return simpleRuntime(ports, id, 'go', ['version']);
    case 'uv':
      return simpleRuntime(ports, id, 'uv', ['--version']);
    case 'git':
      return simpleRuntime(ports, id, 'git', ['--version']);
    case 'docker':
      return simpleRuntime(ports, id, 'docker', ['--version']);
    case 'cargo':
      return simpleRuntime(ports, id, 'cargo', ['--version']);
  }
};

type CacheEntry<T> = { at: number; value: Promise<T> };

const statusToCheck = (status: RuntimeStatus): HostCheck =>
  status.ok === false ? { ok: false, reason: status.reason } : { ok: true };

export const createRuntimeProbe = (
  ports: RuntimeProbePorts,
  options: Readonly<{ ttlMs?: number }> = {}
): RuntimeProbe => {
  const ttl = options.ttlMs ?? RUNTIME_PROBE_TTL_MS;
  const runtimes = new Map<RuntimeId, CacheEntry<RuntimeStatus>>();
  const programs = new Map<string, CacheEntry<HostCheck>>();

  const cached = <K, T>(cache: Map<K, CacheEntry<T>>, key: K, load: () => Promise<T>): Promise<T> => {
    const entry = cache.get(key);
    if (entry !== undefined && ports.now() - entry.at < ttl) return entry.value;
    const value = load();
    cache.set(key, { at: ports.now(), value });
    return value;
  };

  const check = (id: RuntimeId): Promise<RuntimeStatus> =>
    cached(runtimes, id, () =>
      probeRuntime(ports, id).catch(
        (): RuntimeStatus => ({
          id,
          ok: false,
          reason: `Không kiểm tra được ${LABELS[id].name} trên máy này. ${LABELS[id].install}`,
        })
      )
    );

  const programProbe = async (program: string): Promise<HostCheck> => {
    const runtime = Object.hasOwn(PROGRAM_RUNTIME, program) ? PROGRAM_RUNTIME[program] : undefined;
    if (runtime !== undefined) return statusToCheck(await check(runtime));
    if (!PROGRAM_NAME.test(program)) {
      return { ok: false, reason: `"${program.slice(0, 40)}" không phải tên chương trình hợp lệ.` };
    }
    if (programs.size >= MAX_CACHED_PROGRAMS) programs.clear();
    return cached(programs, program, async (): Promise<HostCheck> => {
      const location = await findProgramOnPath(program, ports).catch((): undefined => undefined);
      return location === undefined
        ? {
            ok: false,
            reason: `Máy này chưa có "${program}" (không tìm thấy trong PATH). Hãy cài nó rồi bật lại kết nối.`,
          }
        : { ok: true };
    });
  };

  return {
    check,
    checkAll: () => Promise.all(RUNTIME_IDS.map((id) => check(id))),
    require: async (ids) => {
      const statuses = await Promise.all([...new Set(ids)].map((id) => check(id)));
      const missing = statuses.flatMap((status) => (status.ok === false ? [status] : []));
      if (missing.length === 0) return { ok: true };
      return { ok: false, reason: missing.map((status) => status.reason).join(' '), missing: missing.map((s) => s.id) };
    },
    programProbe,
    invalidate: (id) => {
      if (id === undefined) {
        runtimes.clear();
        programs.clear();
      } else {
        runtimes.delete(id);
      }
    },
  };
};

const run = (file: string, args: readonly string[]): Promise<ProbeExecResult> =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        timeout: 5000,
        windowsHide: true,
        // A neutral folder: Windows looks in the current folder before `PATH`, and a repository must never be it.
        cwd: os.tmpdir(),
        env: minimalBaseEnv(),
        maxBuffer: 64 * 1024,
        shell: false,
      },
      (error, stdout, stderr) => resolve({ ok: error === null, output: `${String(stdout)}\n${String(stderr)}` })
    );
  });

/** The real machine: `PATH` of the Hub, the file system, `child_process` and the Node.js inside Electron. */
export const createNodeRuntimeProbePorts = (): RuntimeProbePorts => ({
  exec: run,
  exists: (filePath) =>
    access(filePath).then(
      () => true,
      () => false
    ),
  now: () => Date.now(),
  platform: process.platform,
  env: process.env,
  nodeVersion: process.versions.node,
});

let shared: RuntimeProbe | undefined;

/** The probe every host shares, so the 60 second cache is one cache. */
export const getRuntimeProbe = (): RuntimeProbe => (shared ??= createRuntimeProbe(createNodeRuntimeProbePorts()));
