/* oxlint-disable no-await-in-loop -- the steps of one scenario must run in order */
import { describe, expect, it, vi } from 'vitest';
import {
  createNodeRuntimeProbePorts,
  createRuntimeProbe,
  findProgramOnPath,
  RUNTIME_IDS,
  RUNTIME_PROBE_TTL_MS,
  type ProbeExecResult,
  type RuntimeProbePorts,
} from '@process/integrations/connections/core/runtimeProbe';

type Fake = {
  ports: RuntimeProbePorts;
  exec: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
  clock: { now: number };
};

/** A machine made of a set of existing files and the output each program prints for its version flag. */
const makeMachine = (
  options: {
    platform?: NodeJS.Platform;
    path?: string;
    files?: readonly string[];
    outputs?: Readonly<Record<string, ProbeExecResult>>;
    env?: Record<string, string>;
  } = {}
): Fake => {
  const platform = options.platform ?? 'win32';
  const files = new Set((options.files ?? []).map((file) => file.toLowerCase()));
  const clock = { now: 1_000_000 };
  const exists = vi.fn(async (file: string) => files.has(file.toLowerCase()));
  const exec = vi.fn(async (file: string, args: readonly string[]): Promise<ProbeExecResult> => {
    const key = `${file} ${args.join(' ')}`.toLowerCase();
    const hit = Object.entries(options.outputs ?? {}).find(([name]) => key.startsWith(name.toLowerCase()));
    return hit?.[1] ?? { ok: false, output: '' };
  });
  const ports: RuntimeProbePorts = {
    exec,
    exists,
    now: () => clock.now,
    platform,
    env: { PATH: options.path ?? 'C:\\tools;C:\\Git\\cmd', PATHEXT: '.EXE;.CMD;.BAT', ...options.env },
    nodeVersion: '22.12.0',
  };
  return { ports, exec, exists, clock };
};

describe('findProgramOnPath', () => {
  it('searches only absolute PATH folders, in order, with the executable extensions', async () => {
    const machine = makeMachine({ files: ['C:\\tools\\git.exe'], path: '.;;relative\\bin;C:\\tools' });
    expect(await findProgramOnPath('git', machine.ports)).toBe('C:\\tools\\git.exe');
    const asked = machine.exists.mock.calls.map((call) => String(call[0]));
    // A relative or empty entry means "the current folder": a hostile workspace could plant a program there.
    expect(asked.every((file) => file.startsWith('C:\\tools'))).toBe(true);
  });

  it('refuses names that are paths or hold separators, without touching the disk', async () => {
    const machine = makeMachine({ files: ['C:\\tools\\git.exe'] });
    for (const name of ['..\\git', 'C:\\x\\git', 'a/b', '', 'git;calc', 'git exe']) {
      expect(await findProgramOnPath(name, machine.ports)).toBeUndefined();
    }
    expect(machine.exists).not.toHaveBeenCalled();
  });

  it('uses the Path spelling of Windows and posix delimiters elsewhere', async () => {
    const win = makeMachine({ files: ['C:\\x\\uv.exe'], env: { Path: 'C:\\x' } });
    delete (win.ports.env as Record<string, string>)['PATH'];
    expect(await findProgramOnPath('uv', win.ports)).toBe('C:\\x\\uv.exe');
    const posix = makeMachine({ platform: 'linux', path: '/usr/bin:/opt/bin', files: ['/opt/bin/go'] });
    expect(await findProgramOnPath('go', posix.ports)).toBe('/opt/bin/go');
  });
});

describe('runtimeProbe: versions', () => {
  it('reports Node through Electron without running anything', async () => {
    const machine = makeMachine();
    const probe = createRuntimeProbe(machine.ports);
    expect(await probe.check('node')).toMatchObject({ id: 'node', ok: true, version: '22.12.0' });
    expect(machine.exec).not.toHaveBeenCalled();
    expect(machine.exists).not.toHaveBeenCalled();
  });

  it('reads the version of uv, git, docker, cargo and go', async () => {
    const machine = makeMachine({
      path: 'C:\\bin',
      files: ['C:\\bin\\uv.exe', 'C:\\bin\\git.exe', 'C:\\bin\\docker.exe', 'C:\\bin\\cargo.exe', 'C:\\bin\\go.exe'],
      outputs: {
        'c:\\bin\\uv.exe': { ok: true, output: 'uv 0.5.11 (abc 2024-12-19)\n' },
        'c:\\bin\\git.exe': { ok: true, output: 'git version 2.45.1.windows.1\n' },
        'c:\\bin\\docker.exe': { ok: true, output: 'Docker version 27.0.3, build 7d4bcd8\n' },
        'c:\\bin\\cargo.exe': { ok: true, output: 'cargo 1.82.0 (8f40fc59f 2024-08-21)\n' },
        'c:\\bin\\go.exe version': { ok: true, output: 'go version go1.22.3 windows/amd64\n' },
      },
    });
    const probe = createRuntimeProbe(machine.ports);
    const versions = Object.fromEntries(
      (await Promise.all((['uv', 'git', 'docker', 'cargo', 'go'] as const).map((id) => probe.check(id)))).map(
        (status) => [status.id, status.ok ? status.version : status.reason]
      )
    );
    expect(versions).toEqual({ uv: '0.5.11', git: '2.45.1', docker: '27.0.3', cargo: '1.82.0', go: '1.22.3' });
  });

  it('runs only the fixed version flag of a program it found itself', async () => {
    const machine = makeMachine({
      path: 'C:\\bin',
      files: ['C:\\bin\\git.exe'],
      outputs: { 'c:\\bin\\git.exe': { ok: true, output: 'git version 2.45.1' } },
    });
    await createRuntimeProbe(machine.ports).check('git');
    expect(machine.exec.mock.calls).toEqual([['C:\\bin\\git.exe', ['--version']]]);
  });

  it('says in Vietnamese what is missing and where to get it', async () => {
    const probe = createRuntimeProbe(makeMachine({ path: 'C:\\empty' }).ports);
    const expectations: Record<string, RegExp> = {
      python: /chưa có Python 3.*python\.org/su,
      uv: /chưa có uv.*astral/su,
      git: /chưa có Git .*git-scm\.com/su,
      'git-bash': /chưa có Git Bash.*git-scm\.com/su,
      docker: /chưa có Docker.*docker\.com/su,
      cargo: /chưa có Cargo.*rustup/su,
      go: /chưa có Go.*go\.dev/su,
    };
    for (const [id, pattern] of Object.entries(expectations)) {
      const status = await probe.check(id as (typeof RUNTIME_IDS)[number]);
      expect(status.ok).toBe(false);
      expect(status.ok === false ? status.reason : '').toMatch(pattern);
    }
  });

  it('says a program that is found but cannot run its version flag is broken', async () => {
    const machine = makeMachine({ path: 'C:\\bin', files: ['C:\\bin\\git.exe'] });
    const status = await createRuntimeProbe(machine.ports).check('git');
    expect(status.ok === false ? status.reason : '').toMatch(
      /Đã thấy Git tại C:\\bin\\git\.exe nhưng không chạy được/u
    );
  });

  it('does not run a batch shim, it only reports that it exists', async () => {
    const machine = makeMachine({ path: 'C:\\bin', files: ['C:\\bin\\go.cmd'] });
    const status = await createRuntimeProbe(machine.ports).check('go');
    expect(status).toMatchObject({ ok: true, location: 'C:\\bin\\go.cmd' });
    expect(machine.exec).not.toHaveBeenCalled();
  });
});

describe('runtimeProbe: Python', () => {
  it('finds python, then the py launcher on Windows', async () => {
    const viaLauncher = makeMachine({
      path: 'C:\\bin',
      files: ['C:\\bin\\py.exe'],
      outputs: { 'c:\\bin\\py.exe -3 --version': { ok: true, output: 'Python 3.12.4\n' } },
    });
    expect(await createRuntimeProbe(viaLauncher.ports).check('python')).toMatchObject({ ok: true, version: '3.12.4' });
  });

  it('prefers python3 on posix', async () => {
    const machine = makeMachine({
      platform: 'linux',
      path: '/usr/bin',
      files: ['/usr/bin/python3'],
      outputs: { '/usr/bin/python3 --version': { ok: true, output: 'Python 3.11.2' } },
    });
    expect(await createRuntimeProbe(machine.ports).check('python')).toMatchObject({ ok: true, version: '3.11.2' });
  });

  it('names the Microsoft Store shortcut when python exists but does not run', async () => {
    const machine = makeMachine({
      path: 'C:\\Users\\a\\WindowsApps',
      files: ['C:\\Users\\a\\WindowsApps\\python.exe'],
    });
    const status = await createRuntimeProbe(machine.ports).check('python');
    expect(status.ok === false ? status.reason : '').toMatch(/Microsoft Store/u);
  });

  it('refuses Python 2 with its version in the sentence', async () => {
    const machine = makeMachine({
      path: 'C:\\bin',
      files: ['C:\\bin\\python.exe'],
      outputs: { 'c:\\bin\\python.exe': { ok: true, output: 'Python 2.7.18' } },
    });
    const status = await createRuntimeProbe(machine.ports).check('python');
    expect(status.ok === false ? status.reason : '').toMatch(/chỉ có Python 2\.7\.18, cũ hơn Python 3/u);
  });
});

describe('runtimeProbe: Git Bash', () => {
  it('finds bash.exe next to the Git that PATH points to', async () => {
    const machine = makeMachine({
      path: 'C:\\Program Files\\Git\\cmd',
      files: ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'],
    });
    expect(await createRuntimeProbe(machine.ports).check('git-bash')).toMatchObject({
      ok: true,
      location: 'C:\\Program Files\\Git\\bin\\bash.exe',
    });
  });

  it('falls back to the usual install folders when git is not on PATH', async () => {
    const machine = makeMachine({
      path: 'C:\\empty',
      files: ['D:\\Programs\\Git\\bin\\bash.exe'],
      env: { ProgramFiles: 'D:\\Programs' },
    });
    expect((await createRuntimeProbe(machine.ports).check('git-bash')).ok).toBe(true);
  });

  it('is not needed outside Windows', async () => {
    const machine = makeMachine({ platform: 'darwin', path: '/usr/bin' });
    expect(await createRuntimeProbe(machine.ports).check('git-bash')).toMatchObject({ ok: true });
  });
});

describe('runtimeProbe: cache', () => {
  const gitMachine = () =>
    makeMachine({
      path: 'C:\\bin',
      files: ['C:\\bin\\git.exe'],
      outputs: { 'c:\\bin\\git.exe': { ok: true, output: 'git version 2.45.1' } },
    });

  it('asks the machine once inside the time to live and again after it', async () => {
    const machine = gitMachine();
    const probe = createRuntimeProbe(machine.ports);
    await probe.check('git');
    machine.clock.now += RUNTIME_PROBE_TTL_MS - 1;
    await probe.check('git');
    expect(machine.exec).toHaveBeenCalledTimes(1);
    machine.clock.now += 2;
    await probe.check('git');
    expect(machine.exec).toHaveBeenCalledTimes(2);
  });

  it('shares a lookup that is already running', async () => {
    const machine = gitMachine();
    const probe = createRuntimeProbe(machine.ports);
    await Promise.all([probe.check('git'), probe.check('git'), probe.check('git')]);
    expect(machine.exec).toHaveBeenCalledTimes(1);
  });

  it('caches a missing runtime too, until invalidated', async () => {
    const machine = makeMachine({ path: 'C:\\bin' });
    const probe = createRuntimeProbe(machine.ports);
    expect((await probe.check('uv')).ok).toBe(false);
    machine.exists.mockClear();
    expect((await probe.check('uv')).ok).toBe(false);
    expect(machine.exists).not.toHaveBeenCalled();
    probe.invalidate('uv');
    await probe.check('uv');
    expect(machine.exists).toHaveBeenCalled();
  });

  it('turns an exec that throws into a sentence, not a rejection', async () => {
    const machine = makeMachine({ path: 'C:\\bin', files: ['C:\\bin\\git.exe'] });
    machine.exec.mockRejectedValue(new Error('spawn EPERM'));
    const status = await createRuntimeProbe(machine.ports).check('git');
    expect(status.ok).toBe(false);
  });

  it('honours a custom time to live', async () => {
    const machine = gitMachine();
    const probe = createRuntimeProbe(machine.ports, { ttlMs: 10 });
    await probe.check('git');
    machine.clock.now += 11;
    await probe.check('git');
    expect(machine.exec).toHaveBeenCalledTimes(2);
  });

  it('reports every runtime at once', async () => {
    const statuses = await createRuntimeProbe(gitMachine().ports).checkAll();
    expect(statuses.map((status) => status.id)).toEqual([...RUNTIME_IDS]);
  });
});

describe('runtimeProbe: requirements and the program probe', () => {
  it('lists what is missing in one sentence', async () => {
    const probe = createRuntimeProbe(makeMachine({ path: 'C:\\bin' }).ports);
    const result = await probe.require(['node', 'uv', 'docker', 'uv']);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.missing).toEqual(['uv', 'docker']);
      expect(result.reason).toMatch(/uv.*Docker/su);
    }
    expect(await probe.require(['node'])).toEqual({ ok: true });
  });

  it('answers a program name from its runtime, and any other name from PATH', async () => {
    const machine = makeMachine({
      path: 'C:\\bin',
      files: ['C:\\bin\\npm.cmd'],
      outputs: { 'c:\\bin\\python.exe': { ok: true, output: 'Python 3.12.0' } },
    });
    const probe = createRuntimeProbe(machine.ports);
    expect(await probe.programProbe('node')).toEqual({ ok: true });
    expect(await probe.programProbe('npm')).toEqual({ ok: true });
    const pip = await probe.programProbe('pip');
    expect(pip.ok).toBe(false);
    expect(pip.ok === false ? pip.reason : '').toMatch(/Python 3/u);
    const flask = await probe.programProbe('flask');
    expect(flask.ok === false ? flask.reason : '').toMatch(/chưa có "flask"/u);
  });

  it('never looks up or runs something that is not a plain program name', async () => {
    const machine = makeMachine({ files: ['C:\\tools\\evil.exe'] });
    const probe = createRuntimeProbe(machine.ports);
    for (const name of ['..\\evil', 'C:\\tools\\evil', './evil', 'a b', '']) {
      const result = await probe.programProbe(name);
      expect(result.ok).toBe(false);
    }
    expect(machine.exec).not.toHaveBeenCalled();
    // A name that is a property of Object.prototype is just an unknown program.
    expect((await probe.programProbe('constructor')).ok).toBe(false);
  });
});

describe('the real machine ports', () => {
  it('report the Node.js inside Electron and need no program for it', async () => {
    const ports = createNodeRuntimeProbePorts();
    expect(ports.nodeVersion).toBe(process.versions.node);
    const status = await createRuntimeProbe(ports).check('node');
    expect(status).toMatchObject({ ok: true, version: process.versions.node });
  });

  it('really runs the version flag of a program found on PATH, in a neutral folder', async () => {
    const ports = createNodeRuntimeProbePorts();
    const node = await findProgramOnPath('node', ports);
    if (node === undefined) return;
    const result = await ports.exec(node, ['--version']);
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/v\d+\.\d+\.\d+/u);
  });
});
