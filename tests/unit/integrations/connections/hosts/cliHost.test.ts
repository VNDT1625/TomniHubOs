import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseAdapterDocument } from '@/common/packages/adapter';
import { createConnectionRegistry } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { createCliHosts, type CliProgramProbe } from '@process/integrations/connections/hosts/exec/cliHost';

const PACKAGE_ID = 'com.community.context7';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const cliConnection = (extra: Record<string, unknown> = {}) => ({
  kind: 'cli',
  id: 'ctx7',
  title: 'Context7 CLI',
  command: 'ctx7',
  args: ['docs'],
  display: 'terminal',
  source: 'npm',
  package: 'ctx7',
  ...extra,
});

const toolConnection = (extra: Record<string, unknown> = {}) => ({
  kind: 'tool',
  id: 'fmt',
  title: 'Formatter',
  description: 'Formats the files of the workspace',
  command: 'prettier',
  args: ['run', 'format'],
  ...extra,
});

const makeWorld = async (connections: unknown[], probe?: CliProgramProbe) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-clihost-'));
  roots.push(root);
  const packageDirectory = path.join(root, 'pkg');
  await mkdir(path.join(packageDirectory, 'source'), { recursive: true });
  const store = createJsonConnectionStateStore(path.join(root, 'state.json'));
  await store.initialize();
  const adapter = parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections });
  const programProbe = vi.fn<CliProgramProbe>(probe ?? (async () => ({ ok: true })));
  const registry = createConnectionRegistry({
    store,
    hosts: createCliHosts({ programProbe }),
    loadPackage: async (packageId) =>
      packageId === PACKAGE_ID ? { packageId, packageVersion: '1.0.0', packageDirectory, adapter } : undefined,
    listInstalledPackageIds: async () => [PACKAGE_ID],
  });
  await registry.syncPackage(PACKAGE_ID);
  const turnOn = async (key: string) => {
    const approval = await registry.describe(PACKAGE_ID, key);
    return registry.enable(PACKAGE_ID, key, approval.approvalHash);
  };
  return { registry, programProbe, turnOn, packageDirectory };
};

const textOf = (lines: readonly { label: string; value: string }[]): string =>
  lines.map((line) => `${line.label}: ${line.value}`).join(' | ');

describe('cli and tool hosts: what the person approves', () => {
  it('registers one host per kind', () => {
    expect(createCliHosts().map((host) => host.kind)).toEqual(['cli', 'tool']);
  });

  it('lists the exact command line, the limits and what is not enforced for a cli', async () => {
    const world = await makeWorld([cliConnection()]);
    const { subject } = await world.registry.describe(PACKAGE_ID, 'cli:ctx7');
    const text = textOf(subject.lines);
    expect(subject).toMatchObject({ kind: 'cli', title: 'Context7 CLI', files: [] });
    expect(subject.lines.find((line) => line.label === 'Command')?.value).toBe('ctx7 docs');
    expect(text).toContain('nothing runs when this is turned on');
    expect(text).toContain('tomny_package_cli: asks for your permission on every call');
    expect(text).toContain('stops after 120 seconds');
    expect(text).toContain('output kept to 64 KB with secrets scrubbed');
    expect(text).toContain('a path must stay inside the workspace');
    expect(text).toContain('the command is typed in, never run by itself');
    expect(text).toContain('Secrets given to the program: none');
    expect(text).toContain('npm package "ctx7" (the Hub does not install it)');
    expect(text).toContain('Outgoing network of the program: not restricted in this version');
  });

  it('describes a tool with its description and without a terminal entry', async () => {
    const world = await makeWorld([toolConnection()]);
    const { subject } = await world.registry.describe(PACKAGE_ID, 'tool:fmt');
    const text = textOf(subject.lines);
    expect(subject.kind).toBe('tool');
    expect(text).toContain('Command: prettier run format');
    expect(text).toContain('Description: Formats the files of the workspace');
    expect(text).not.toContain('Terminal menu');
  });

  it('only lists a setup command and a package folder, it never runs them', async () => {
    const world = await makeWorld([
      cliConnection({ setup: [['npm', 'install']], cwd: 'source/cli', source: 'source', package: undefined }),
    ]);
    const { subject } = await world.registry.describe(PACKAGE_ID, 'cli:ctx7');
    const text = textOf(subject.lines);
    expect(text).toContain('Setup (listed only, the Hub does not run it): npm install');
    expect(text).toContain('source/cli (listed only; the program runs in the workspace)');
    await world.turnOn('cli:ctx7');
    // The only thing asked of this machine is whether the command exists.
    expect(world.programProbe.mock.calls).toEqual(expect.arrayContaining([['ctx7']]));
    expect(world.programProbe.mock.calls.every(([program]) => program === 'ctx7')).toBe(true);
  });

  it('does not consult this machine when describing, so installing a program later keeps an approval valid', async () => {
    const world = await makeWorld([cliConnection()]);
    world.programProbe.mockClear();
    await world.registry.describe(PACKAGE_ID, 'cli:ctx7');
    expect(world.programProbe).not.toHaveBeenCalled();
  });

  it('asks for a new approval when the command line changes', async () => {
    const before = await makeWorld([cliConnection()]);
    const after = await makeWorld([cliConnection({ args: ['docs', 'evil'] })]);
    const first = await before.registry.describe(PACKAGE_ID, 'cli:ctx7');
    const second = await after.registry.describe(PACKAGE_ID, 'cli:ctx7');
    expect(second.approvalHash).not.toBe(first.approvalHash);
    await expect(after.registry.enable(PACKAGE_ID, 'cli:ctx7', first.approvalHash)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
  });
});

describe('cli and tool hosts: turning on and off', () => {
  it('records "ready to call" and installs nothing', async () => {
    const world = await makeWorld([cliConnection(), toolConnection()]);
    const state = await world.turnOn('cli:ctx7');
    expect(state).toMatchObject({ enabled: true, status: 'on', installed: ['cli:ctx7'] });
    const clis = await world.registry.enabledOfKind('cli');
    expect(clis.map((entry) => entry.key)).toEqual(['cli:ctx7']);
    expect(await world.registry.enabledOfKind('tool')).toEqual([]);

    await world.turnOn('tool:fmt');
    expect((await world.registry.enabledOfKind('tool')).map((entry) => entry.key)).toEqual(['tool:fmt']);
  });

  it('is idempotent in both directions and forgets the cli once it is off', async () => {
    const world = await makeWorld([cliConnection()]);
    await world.turnOn('cli:ctx7');
    await world.turnOn('cli:ctx7');
    expect(await world.registry.enabledOfKind('cli')).toHaveLength(1);
    await world.registry.disable(PACKAGE_ID, 'cli:ctx7');
    await world.registry.disable(PACKAGE_ID, 'cli:ctx7');
    expect(await world.registry.enabledOfKind('cli')).toEqual([]);
    await expect(world.registry.reconcile()).resolves.toBeUndefined();
  });

  it('says in words what to do when the program is missing, and never installs it', async () => {
    const reason = 'Máy này chưa có "ctx7" (không tìm thấy trong PATH). Hãy cài nó rồi bật lại kết nối.';
    const world = await makeWorld([cliConnection()], async () => ({ ok: false, reason }));
    const [view] = await world.registry.view(PACKAGE_ID);
    expect(view?.state.status).toBe('unsupported');
    expect(view?.state.reason).toContain('chưa có "ctx7"');
    expect(view?.state.reason).toContain('Hub không tự cài');
    expect(view?.state.reason).toContain('npm install -g ctx7');
    const approval = await world.registry.describe(PACKAGE_ID, 'cli:ctx7');
    await expect(world.registry.enable(PACKAGE_ID, 'cli:ctx7', approval.approvalHash)).rejects.toMatchObject({
      code: 'RUNTIME_MISSING',
    });
    expect(await world.registry.enabledOfKind('cli')).toEqual([]);
  });

  it('gives no install hint for a source it cannot name', async () => {
    const world = await makeWorld([cliConnection({ source: 'binary', package: undefined })], async () => ({
      ok: false,
      reason: 'Máy này chưa có "ctx7".',
    }));
    const [view] = await world.registry.view(PACKAGE_ID);
    expect(view?.state.reason).toBe('Máy này chưa có "ctx7".');
  });

  it('turns itself off at the next sync when the program disappears', async () => {
    let present = true;
    const world = await makeWorld([cliConnection()], async () =>
      present ? { ok: true } : { ok: false, reason: 'Máy này chưa có "ctx7".' }
    );
    await world.turnOn('cli:ctx7');
    present = false;
    await world.registry.syncPackage(PACKAGE_ID);
    expect(await world.registry.enabledOfKind('cli')).toEqual([]);
  });
});

describe('cli host defaults', () => {
  it('uses the shared runtime probe when none is supplied (node needs nothing installed)', async () => {
    const [host] = createCliHosts();
    const connection = parseAdapterDocument({
      schemaVersion: 1,
      generatedBy: 'classifier',
      connections: [cliConnection({ command: 'node', args: undefined, source: undefined, package: undefined })],
    }).connections[0];
    const context = {
      packageId: PACKAGE_ID,
      packageVersion: '1.0.0',
      packageDirectory: os.tmpdir(),
      readPackageFile: async () => Buffer.alloc(0),
    };
    expect(await host?.check(context, connection as never)).toEqual({ ok: true });
  });
});
