/* oxlint-disable no-await-in-loop -- the steps of one scenario must run in order */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseAdapterDocument } from '@/common/packages/adapter';
import type { EnabledConnection } from '@process/integrations/connections/core/registry';
import type { CliExecPort, CliExecRequest, CliExecResult } from '@process/integrations/connections/cli/cliExec';
import {
  collectOwnSecretValues,
  createCorePackageCliPort,
  createPackageCliService,
  scrubCliOutput,
  type PackageCliRunRecord,
} from '@process/integrations/connections/cli/packageCliService';

const PACKAGE_ID = 'com.community.context7';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const connectionsOf = (...raw: unknown[]) =>
  parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections: raw }).connections;

const cli = {
  kind: 'cli',
  id: 'ctx7',
  title: 'Context7 CLI',
  command: 'ctx7',
  args: ['docs'],
  display: 'terminal',
};
const tool = {
  kind: 'tool',
  id: 'fmt',
  title: 'Formatter',
  description: 'Formats files',
  command: 'prettier',
  args: ['run', 'format'],
};

const ok = (extra: Partial<CliExecResult> = {}): CliExecResult => ({
  exitCode: 0,
  output: 'done\n',
  truncated: false,
  timedOut: false,
  cancelled: false,
  ...extra,
});

const makeService = async (
  options: {
    connections?: unknown[];
    result?: CliExecResult | (() => Promise<CliExecResult>);
    files?: readonly string[];
    secrets?: readonly string[];
    pathEnv?: string;
  } = {}
) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'tomny-clisvc-'));
  roots.push(workspace);
  const connections = connectionsOf(...(options.connections ?? [cli, tool]));
  const enabled: EnabledConnection[] = connections.map((connection) => ({
    packageId: PACKAGE_ID,
    packageVersion: '1.0.0',
    key: `${connection.kind}:${'id' in connection ? connection.id : ''}`,
    connection,
    context: {
      packageId: PACKAGE_ID,
      packageVersion: '1.0.0',
      packageDirectory: workspace,
      readPackageFile: async () => Buffer.alloc(0),
    },
  }));
  const exec = vi.fn<CliExecPort>(async () =>
    typeof options.result === 'function' ? options.result() : (options.result ?? ok())
  );
  const exists = vi.fn(async (file: string) =>
    (options.files ?? ['C:\\bin\\ctx7.exe', 'C:\\bin\\prettier.exe'])
      .map((item) => item.toLowerCase())
      .includes(file.toLowerCase())
  );
  const records: PackageCliRunRecord[] = [];
  const service = createPackageCliService({
    registry: { enabledOfKind: async (kind) => enabled.filter((entry) => entry.connection.kind === kind) },
    exec,
    ports: { env: { PATH: options.pathEnv ?? 'C:\\bin;relative' }, exists, platform: 'win32' },
    baseEnv: () => ({ PATH: 'C:\\bin' }),
    secretValues: async () => options.secrets ?? [],
    record: async (record) => {
      records.push(record);
    },
    now: (() => {
      let tick = 1000;
      return () => (tick += 250);
    })(),
  });
  return { service, exec, exists, records, workspace };
};

const lastRequest = (exec: ReturnType<typeof vi.fn<CliExecPort>>): CliExecRequest =>
  exec.mock.calls[exec.mock.calls.length - 1]?.[0] as CliExecRequest;

describe('list and terminalLaunch', () => {
  it('lists every cli and tool that is on, with its fixed command line', async () => {
    const { service } = await makeService();
    expect(await service.list()).toEqual([
      { packageId: PACKAGE_ID, connectionId: 'ctx7', kind: 'cli', title: 'Context7 CLI', commandLine: 'ctx7 docs' },
      {
        packageId: PACKAGE_ID,
        connectionId: 'fmt',
        kind: 'tool',
        title: 'Formatter',
        description: 'Formats files',
        commandLine: 'prettier run format',
      },
    ]);
  });

  it('answers a terminal request with a title and one line, and runs nothing', async () => {
    const { service, exec } = await makeService();
    expect(await service.terminalLaunch({ packageId: PACKAGE_ID, connectionId: 'ctx7' })).toEqual({
      ok: true,
      title: 'Context7 CLI',
      commandLine: 'ctx7 docs',
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('refuses a request with anything but the two ids', async () => {
    const { service } = await makeService();
    const bad: unknown[] = [
      null,
      undefined,
      'ctx7',
      42,
      [],
      {},
      { packageId: PACKAGE_ID },
      { connectionId: 'ctx7' },
      { packageId: PACKAGE_ID, connectionId: 'ctx7', command: 'calc' },
      { packageId: PACKAGE_ID, connectionId: 'ctx7', cwd: 'C:\\' },
      { packageId: '../x', connectionId: 'ctx7' },
      { packageId: PACKAGE_ID, connectionId: 'Ctx 7' },
      { packageId: PACKAGE_ID, connectionId: 'ctx7;calc' },
      { packageId: 1, connectionId: 'ctx7' },
    ];
    for (const request of bad) {
      expect(await service.terminalLaunch(request)).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    }
  });

  it('offers a cli only: not a tool, not an unknown id, not a package that is off', async () => {
    const { service } = await makeService();
    for (const request of [
      { packageId: PACKAGE_ID, connectionId: 'fmt' },
      { packageId: PACKAGE_ID, connectionId: 'nope' },
      { packageId: 'com.other.pkg', connectionId: 'ctx7' },
    ]) {
      expect(await service.terminalLaunch(request)).toEqual({ ok: false, error: 'NOT_ENABLED' });
    }
  });

  it('never rejects when the registry fails', async () => {
    const service = createPackageCliService({
      registry: {
        enabledOfKind: async () => {
          throw new Error('registry down');
        },
      },
    });
    expect(await service.list()).toEqual([]);
    expect(await service.terminalLaunch({ packageId: PACKAGE_ID, connectionId: 'ctx7' })).toEqual({
      ok: false,
      error: 'UNAVAILABLE',
    });
  });
});

describe('run: what is executed', () => {
  it('runs the program found on PATH with the fixed arguments first, in the workspace, without secrets', async () => {
    const { service, exec, workspace } = await makeService();
    const outcome = await service.run({
      workspace,
      packageId: PACKAGE_ID,
      connectionId: 'ctx7',
      args: ['react', '-v'],
    });
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, output: 'done\n', timedOut: false, truncated: false });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(lastRequest(exec)).toMatchObject({
      file: 'C:\\bin\\ctx7.exe',
      args: ['docs', 'react', '-v'],
      cwd: workspace,
      env: { PATH: 'C:\\bin' },
      timeoutMs: 120_000,
      maxOutputBytes: 64 * 1024,
    });
  });

  it('runs a tool the same way', async () => {
    const { service, exec, workspace } = await makeService();
    await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'fmt', args: [] });
    expect(lastRequest(exec)).toMatchObject({ file: 'C:\\bin\\prettier.exe', args: ['run', 'format'] });
  });

  it('looks only in absolute PATH folders, never in the workspace', async () => {
    const { service, exec, exists, workspace } = await makeService({
      // A program planted in the workspace must not win, and a relative PATH entry means "here".
      files: [path.join(workspace0(), 'ctx7.exe')],
      pathEnv: 'relative;.;C:\\empty',
    });
    const outcome = await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] });
    expect(outcome).toMatchObject({ ok: false, code: 'RUNTIME_MISSING' });
    expect(exec).not.toHaveBeenCalled();
    expect(exists.mock.calls.every(([file]) => String(file).startsWith('C:\\empty'))).toBe(true);
  });

  it('passes the timeout asked for, never more than two minutes and never less than a second', async () => {
    const { service, exec, workspace } = await makeService();
    const timeoutFor = async (timeoutSeconds: number | undefined): Promise<number> => {
      await service.run({
        workspace,
        packageId: PACKAGE_ID,
        connectionId: 'ctx7',
        args: [],
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      });
      return lastRequest(exec).timeoutMs;
    };
    expect(await timeoutFor(undefined)).toBe(120_000);
    expect(await timeoutFor(5)).toBe(5000);
    expect(await timeoutFor(500)).toBe(120_000);
    expect(await timeoutFor(0)).toBe(1000);
    expect(await timeoutFor(-3)).toBe(1000);
    expect(await timeoutFor(Number.NaN)).toBe(120_000);
  });

  it('hands the abort signal to the runner so cancelling stops the process', async () => {
    const { service, exec, workspace } = await makeService();
    const controller = new AbortController();
    await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [], signal: controller.signal });
    expect(lastRequest(exec).signal).toBe(controller.signal);
  });
});

describe('run: what is refused', () => {
  it.each([
    ['a shell separator', ['a;calc']],
    ['a pipe', ['a|calc']],
    ['a substitution', ['$(calc)']],
    ['a space', ['a b']],
    ['a quote', ['"a"']],
    ['a line break', ['a\ncalc']],
    ['an absolute path', ['/etc/passwd']],
    ['a drive path', ['C:/Windows/win.ini']],
    ['a parent folder', ['../../secret']],
    ['a flag that carries a path out', ['--out=../x']],
    ['too many arguments', Array.from({ length: 25 }, () => 'a')],
    ['an argument that is not a text', [42]],
  ])('refuses %s before anything runs', async (_name, args) => {
    const { service, exec, records, workspace } = await makeService();
    const outcome = await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args });
    expect(outcome).toMatchObject({ ok: false, code: 'ARGUMENT_REJECTED' });
    expect(exec).not.toHaveBeenCalled();
    expect(records).toEqual([expect.objectContaining({ outcome: 'refused', code: 'ARGUMENT_REJECTED' })]);
  });

  it('says which argument was refused and why, without repeating it', async () => {
    const { service, workspace } = await makeService();
    const outcome = await service.run({
      workspace,
      packageId: PACKAGE_ID,
      connectionId: 'ctx7',
      args: ['ok', 'bad;thing'],
    });
    expect(outcome).toMatchObject({ ok: false, code: 'ARGUMENT_REJECTED' });
    expect(outcome.ok === false ? outcome.message : '').toContain('Argument 2 was refused');
    expect(outcome.ok === false ? outcome.message : '').not.toContain('bad;thing');
  });

  it('refuses a cli that is not on, whatever its name', async () => {
    const { service, exec, workspace } = await makeService();
    for (const ids of [
      { packageId: PACKAGE_ID, connectionId: 'other' },
      { packageId: 'com.other.pkg', connectionId: 'ctx7' },
    ]) {
      expect(await service.run({ workspace, args: [], ...ids })).toMatchObject({ ok: false, code: 'NOT_ENABLED' });
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it('refuses a workspace that is not an existing absolute folder', async () => {
    const { service, exec, workspace } = await makeService();
    for (const bad of ['relative/folder', path.join(workspace, 'missing'), '']) {
      expect(
        await service.run({ workspace: bad, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] })
      ).toMatchObject({ ok: false, code: 'WORKSPACE_INVALID' });
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it('says in plain words that the program is not installed', async () => {
    const { service, exec, workspace } = await makeService({ files: [] });
    const outcome = await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] });
    expect(outcome).toMatchObject({ ok: false, code: 'RUNTIME_MISSING' });
    expect(outcome.ok === false ? outcome.message : '').toContain('"ctx7" is not installed on this machine');
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports a program that could not start without leaking the system message', async () => {
    const { service, records, workspace } = await makeService({
      result: ok({ exitCode: null, output: '', startError: 'spawn C:\\Users\\me\\x EACCES' }),
    });
    const outcome = await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] });
    expect(outcome).toEqual({ ok: false, code: 'START_FAILED', message: 'The program could not be started.' });
    expect(records[0]).toMatchObject({ outcome: 'failed', code: 'START_FAILED' });
  });
});

describe('run: results, limits and evidence', () => {
  it('reports a non-zero exit and a timeout as outcomes, not as exceptions', async () => {
    const failed = await makeService({ result: ok({ exitCode: 2, output: 'bad\n' }) });
    expect(
      await failed.service.run({ workspace: failed.workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] })
    ).toMatchObject({ ok: true, exitCode: 2, output: 'bad\n' });
    expect(failed.records[0]).toMatchObject({ outcome: 'failed', exitCode: 2 });

    const slow = await makeService({ result: ok({ exitCode: null, timedOut: true, output: 'partial\n' }) });
    expect(
      await slow.service.run({ workspace: slow.workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] })
    ).toMatchObject({ ok: true, timedOut: true, exitCode: null });
    expect(slow.records[0]).toMatchObject({ outcome: 'timed-out' });

    const stopped = await makeService({ result: ok({ exitCode: null, cancelled: true }) });
    await stopped.service.run({
      workspace: stopped.workspace,
      packageId: PACKAGE_ID,
      connectionId: 'ctx7',
      args: [],
    });
    expect(stopped.records[0]).toMatchObject({ outcome: 'cancelled' });
  });

  it('scrubs the package secret values and recognisable secret formats from the output', async () => {
    const secret = 'hunter2-very-secret';
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const { service, workspace } = await makeService({
      secrets: [secret],
      result: ok({ output: `user=bob\nsecret: ${secret}\nagain ${secret}\nGITHUB_TOKEN=${token}\n` }),
    });
    const outcome = await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] });
    const output = outcome.ok ? outcome.output : '';
    expect(output).not.toContain(secret);
    expect(output).not.toContain(token);
    expect(output).toContain('user=bob');
    expect(output).toContain('[redacted]');
  });

  it('cuts a capped capture back to its last whole line so a secret cut by the cap cannot survive', async () => {
    const { service, workspace } = await makeService({
      secrets: ['abcdefghijklmnop'],
      result: ok({ truncated: true, output: 'line one\nline two\nabcdefgh' }),
    });
    const outcome = await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] });
    expect(outcome).toMatchObject({ ok: true, truncated: true, output: 'line one\nline two' });
  });

  it('leaves a content-free receipt: ids, counts and codes only', async () => {
    const { service, records, workspace } = await makeService({
      result: ok({ output: 'TOP-SECRET-OUTPUT' }),
    });
    await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: ['react', '--lang=en'] });
    expect(records).toEqual([
      {
        packageId: PACKAGE_ID,
        connectionId: 'ctx7',
        outcome: 'completed',
        exitCode: 0,
        argumentCount: 2,
        durationMs: expect.any(Number),
        truncated: false,
      },
    ]);
    const text = JSON.stringify(records);
    expect(text).not.toContain('react');
    expect(text).not.toContain('TOP-SECRET-OUTPUT');
    expect(text).not.toContain(workspace);
  });

  it('survives a receipt store that fails', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'tomny-clisvc-'));
    roots.push(workspace);
    const [connection] = connectionsOf(cli);
    const service = createPackageCliService({
      registry: {
        enabledOfKind: async (kind) =>
          kind === 'cli' && connection
            ? [
                {
                  packageId: PACKAGE_ID,
                  packageVersion: '1',
                  key: 'cli:ctx7',
                  connection,
                  context: {
                    packageId: PACKAGE_ID,
                    packageVersion: '1',
                    packageDirectory: workspace,
                    readPackageFile: async () => Buffer.alloc(0),
                  },
                },
              ]
            : [],
      },
      exec: async () => ok(),
      ports: { env: { PATH: 'C:\\bin' }, exists: async () => true, platform: 'win32' },
      record: async () => {
        throw new Error('disk full');
      },
    });
    expect(await service.run({ workspace, packageId: PACKAGE_ID, connectionId: 'ctx7', args: [] })).toMatchObject({
      ok: true,
    });
  });
});

describe('secret scrubbing helpers', () => {
  it('collects only the values of the package own sets', async () => {
    const resolve = vi.fn(async (handle: string) =>
      handle === 'own-1' ? { API_KEY: 'own-secret-value', X: 'ab' } : { Y: 'granted-value-1' }
    );
    const values = await collectOwnSecretValues({
      list: async () => [
        { handle: 'own-1', label: 'a', fields: ['API_KEY', 'X'], origin: 'own', updatedAt: 1 },
        { handle: 'granted-1', label: 'b', fields: ['Y'], origin: 'granted', updatedAt: 1 },
      ],
      resolve,
    });
    expect(values).toEqual(['own-secret-value']);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('survives a store that fails or refuses', async () => {
    expect(
      await collectOwnSecretValues({
        list: async () => {
          throw new Error('locked');
        },
        resolve: async () => ({}),
      })
    ).toEqual([]);
    expect(
      await collectOwnSecretValues({
        list: async () => [{ handle: 'h', label: 'a', fields: ['K'], origin: 'own', updatedAt: 1 }],
        resolve: async () => {
          throw new Error('refused');
        },
      })
    ).toEqual([]);
  });

  it('ignores values too short to be a secret', () => {
    expect(scrubCliOutput('a ab abc', ['ab', 'abc'])).toBe('a ab abc');
    expect(scrubCliOutput('the longsecret value', ['longsecret'])).toBe('the [redacted] value');
  });
});

describe('the tool port', () => {
  it('lists what is on when no cli is named', async () => {
    const { service } = await makeService();
    const port = createCorePackageCliPort(service);
    const listed = await port.run({ workspace: 'x', args: [] });
    expect(listed.ok).toBe(true);
    expect(listed.message).toContain(`${PACKAGE_ID} / ctx7 (cli): ctx7 docs`);
    expect(listed.message).toContain(`${PACKAGE_ID} / fmt (tool): prettier run format - Formats files`);

    const none = createCorePackageCliPort(createPackageCliService({ registry: { enabledOfKind: async () => [] } }));
    expect(await none.run({ workspace: 'x', args: [] })).toEqual({
      ok: true,
      message: 'No package CLI or tool is turned on.',
    });
  });

  it('renders a run for the model: exit code, output, and failure as not ok', async () => {
    const good = await makeService({ result: ok({ output: 'hello\n' }) });
    const goodPort = createCorePackageCliPort(good.service);
    const run = await goodPort.run({
      workspace: good.workspace,
      packageId: PACKAGE_ID,
      connectionId: 'ctx7',
      args: [],
    });
    expect(run.ok).toBe(true);
    expect(run.message).toMatch(/^exit code 0 in [\d.]+ s\nhello/u);

    const bad = await makeService({ result: ok({ exitCode: 3, output: 'oops\n', truncated: true }) });
    const failure = await createCorePackageCliPort(bad.service).run({
      workspace: bad.workspace,
      packageId: PACKAGE_ID,
      connectionId: 'ctx7',
      args: [],
    });
    expect(failure.ok).toBe(false);
    expect(failure.message).toContain('exit code 3');
    expect(failure.message).toContain('[output cut at 64 KB]');

    const slow = await makeService({ result: ok({ exitCode: null, timedOut: true, output: 'part\n' }) });
    const timedOut = await createCorePackageCliPort(slow.service).run({
      workspace: slow.workspace,
      packageId: PACKAGE_ID,
      connectionId: 'ctx7',
      args: [],
    });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.message).toContain('Stopped after the time limit');

    const refused = await createCorePackageCliPort(good.service).run({
      workspace: good.workspace,
      packageId: PACKAGE_ID,
      connectionId: 'ctx7',
      args: ['a;b'],
    });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toContain('Argument 1 was refused');
  });
});

/** A folder that stands for "the workspace" in the planted-program test (it only needs a stable name). */
function workspace0(): string {
  return path.join(os.tmpdir(), 'tomny-planted-workspace');
}
