/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAdapterDocument, type AdapterDocument } from '@/common/packages/adapter';
import { computeApprovalHash } from '@process/integrations/connections/core/approval';
import { createConnectionRegistry, type LoadedPackage } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { ConnectionError, defineConnectionHost, type HostContext } from '@process/integrations/connections/core/types';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-registry-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PACKAGE_ID = 'com.community.sample';

const adapterWith = (connections: unknown[]): AdapterDocument =>
  parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections });

const hookConnection = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'hook',
  id,
  event: 'PostToolUse',
  command: 'node',
  args: ['source/hooks/run.js'],
  ...extra,
});
const skillConnection = { kind: 'skill', path: 'source/skills/a' };
const cliConnection = { kind: 'cli', id: 'tool', title: 'Tool', command: 'tool', display: 'terminal' };
const mcp = (id: string, group: string) => ({
  kind: 'mcp',
  id,
  title: id,
  transport: 'http',
  url: `https://${id}.example.com/mcp`,
  group,
});

type Calls = { enable: string[]; disable: string[]; reconcile: string[][] };

const setup = async (options: { connections: unknown[]; failEnable?: string; delayMs?: number }) => {
  const dir = await temp();
  await mkdir(path.join(dir, 'source', 'hooks'), { recursive: true });
  await mkdir(path.join(dir, 'source', 'skills', 'a'), { recursive: true });
  await writeFile(path.join(dir, 'source', 'hooks', 'run.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'source', 'skills', 'a', 'SKILL.md'), '# a');
  const adapter = adapterWith(options.connections);
  let loaded: LoadedPackage | undefined = {
    packageId: PACKAGE_ID,
    packageVersion: '1.0.0',
    packageDirectory: dir,
    adapter,
  };
  const calls: Calls = { enable: [], disable: [], reconcile: [] };
  let captured: HostContext | undefined;
  const delay = async () => {
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  };
  const hooks = defineConnectionHost({
    kind: 'hook',
    check: async () => ({ ok: true }),
    describe: async (_ctx, connection) => ({
      kind: 'hook',
      title: connection.id,
      lines: [{ label: 'Lệnh', value: `${connection.command} ${(connection.args ?? []).join(' ')}` }],
      files: ['source/hooks/run.js'],
    }),
    enable: async (ctx, connection) => {
      captured = ctx;
      calls.enable.push(connection.id);
      await delay();
      if (options.failEnable === connection.id) throw new Error('boom');
      return { installed: [connection.id] };
    },
    disable: async (_ctx, connection) => {
      calls.disable.push(connection.id);
    },
    reconcile: async ({ keep }) => {
      calls.reconcile.push([...keep]);
    },
  });
  const skills = defineConnectionHost({
    kind: 'skill',
    check: async () => ({ ok: true }),
    describe: async () => ({
      kind: 'skill',
      title: 'a',
      lines: [{ label: 'Skill', value: 'a' }],
      files: ['source/skills/a/SKILL.md'],
    }),
    enable: async () => {
      calls.enable.push('skill:a');
      return { installed: ['a'] };
    },
    disable: async () => {
      calls.disable.push('skill:a');
    },
  });
  const mcps = defineConnectionHost({
    kind: 'mcp',
    check: async () => ({ ok: true }),
    describe: async (_ctx, connection) => ({ kind: 'mcp', title: connection.id, lines: [], files: [] }),
    enable: async (_ctx, connection) => {
      calls.enable.push(connection.id);
      return { installed: [connection.id] };
    },
    disable: async (_ctx, connection) => {
      calls.disable.push(connection.id);
    },
  });
  const store = createJsonConnectionStateStore(path.join(dir, '..', `${path.basename(dir)}-state.json`));
  await store.initialize();
  const registry = createConnectionRegistry({
    store,
    hosts: [hooks, skills, mcps],
    loadPackage: async (id) => (id === PACKAGE_ID ? loaded : undefined),
    listInstalledPackageIds: async () => (loaded ? [PACKAGE_ID] : []),
    now: () => 1_000,
  });
  return {
    dir,
    calls,
    store,
    registry,
    context: () => captured,
    uninstall: () => {
      loaded = undefined;
    },
  };
};

describe('connection registry', () => {
  it('starts everything off, marks kinds without a host unsupported with a reason', async () => {
    const t = await setup({ connections: [hookConnection('h'), skillConnection, cliConnection] });
    const views = await t.registry.syncPackage(PACKAGE_ID);
    const byKey = new Map(views.map((view) => [view.key, view.state]));
    expect(byKey.get('hook:h')).toMatchObject({ enabled: false, status: 'off' });
    expect(byKey.get('skill:source/skills/a')).toMatchObject({ enabled: false, status: 'off' });
    expect(byKey.get('cli:tool')?.status).toBe('unsupported');
    expect(byKey.get('cli:tool')?.reason).toMatch(/cli/);
    expect(t.calls.enable).toEqual([]);
  });

  it('enables only with the hash Main computes, never with a guessed or stale one', async () => {
    const t = await setup({ connections: [hookConnection('h')] });
    await t.registry.syncPackage(PACKAGE_ID);
    await expect(t.registry.enable(PACKAGE_ID, 'hook:h', 'sha256-' + '0'.repeat(64))).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(t.calls.enable).toEqual([]);

    const approval = await t.registry.describe(PACKAGE_ID, 'hook:h');
    expect(approval.subject.lines[0]?.value).toContain('source/hooks/run.js');
    const state = await t.registry.enable(PACKAGE_ID, 'hook:h', approval.approvalHash);
    expect(state).toMatchObject({ enabled: true, status: 'on', approvedAt: 1_000, installed: ['h'] });
    expect(t.calls.enable).toEqual(['h']);
  });

  it('the approval changes when the script that would run changes', async () => {
    const t = await setup({ connections: [hookConnection('h')] });
    await t.registry.syncPackage(PACKAGE_ID);
    const before = await t.registry.describe(PACKAGE_ID, 'hook:h');
    await writeFile(path.join(t.dir, 'source', 'hooks', 'run.js'), 'console.log("evil")');
    const after = await t.registry.describe(PACKAGE_ID, 'hook:h');
    expect(after.approvalHash).not.toBe(before.approvalHash);
    await expect(t.registry.enable(PACKAGE_ID, 'hook:h', before.approvalHash)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
  });

  it('an update that changes running code turns the connection off; data kinds follow the update', async () => {
    const t = await setup({ connections: [hookConnection('h'), skillConnection] });
    await t.registry.syncPackage(PACKAGE_ID);
    for (const key of ['hook:h', 'skill:source/skills/a']) {
      const approval = await t.registry.describe(PACKAGE_ID, key);
      await t.registry.enable(PACKAGE_ID, key, approval.approvalHash);
    }
    t.calls.enable.length = 0;
    t.calls.disable.length = 0;

    await writeFile(path.join(t.dir, 'source', 'hooks', 'run.js'), 'console.log("changed")');
    await writeFile(path.join(t.dir, 'source', 'skills', 'a', 'SKILL.md'), '# a v2');
    const views = await t.registry.syncPackage(PACKAGE_ID);
    const byKey = new Map(views.map((view) => [view.key, view.state]));

    expect(byKey.get('hook:h')).toMatchObject({ enabled: false, status: 'needs-input' });
    expect(t.calls.disable).toContain('h');
    expect(byKey.get('skill:source/skills/a')).toMatchObject({ enabled: true, status: 'on' });
    expect(t.calls.enable).toEqual(['skill:a']);
  });

  it('an unchanged package keeps its enabled connections across a sync', async () => {
    const t = await setup({ connections: [hookConnection('h')] });
    await t.registry.syncPackage(PACKAGE_ID);
    const approval = await t.registry.describe(PACKAGE_ID, 'hook:h');
    await t.registry.enable(PACKAGE_ID, 'hook:h', approval.approvalHash);
    t.calls.disable.length = 0;
    const views = await t.registry.syncPackage(PACKAGE_ID);
    expect(views[0]?.state).toMatchObject({ enabled: true, status: 'on' });
    expect(t.calls.disable).toEqual([]);
  });

  it('turning on one alternative of a group turns the others off', async () => {
    const t = await setup({ connections: [mcp('remote', 'ctx'), mcp('local', 'ctx')] });
    await t.registry.syncPackage(PACKAGE_ID);
    const first = await t.registry.describe(PACKAGE_ID, 'mcp:remote');
    await t.registry.enable(PACKAGE_ID, 'mcp:remote', first.approvalHash);
    const second = await t.registry.describe(PACKAGE_ID, 'mcp:local');
    await t.registry.enable(PACKAGE_ID, 'mcp:local', second.approvalHash);

    expect(t.store.get(PACKAGE_ID, 'mcp:remote')).toMatchObject({ enabled: false, status: 'off' });
    expect(t.store.get(PACKAGE_ID, 'mcp:local')).toMatchObject({ enabled: true, status: 'on' });
    expect(t.calls.disable).toContain('remote');
  });

  it('a failing host leaves an error state, cleans up and reports HOST_FAILED', async () => {
    const t = await setup({ connections: [hookConnection('h')], failEnable: 'h' });
    await t.registry.syncPackage(PACKAGE_ID);
    const approval = await t.registry.describe(PACKAGE_ID, 'hook:h');
    await expect(t.registry.enable(PACKAGE_ID, 'hook:h', approval.approvalHash)).rejects.toBeInstanceOf(
      ConnectionError
    );
    expect(t.store.get(PACKAGE_ID, 'hook:h')).toMatchObject({ enabled: false, status: 'error', lastError: 'boom' });
    expect(t.calls.disable).toContain('h');
  });

  it('disable and removePackage switch connections off and forget the package', async () => {
    const t = await setup({ connections: [hookConnection('h'), hookConnection('k')] });
    await t.registry.syncPackage(PACKAGE_ID);
    for (const key of ['hook:h', 'hook:k']) {
      const approval = await t.registry.describe(PACKAGE_ID, key);
      await t.registry.enable(PACKAGE_ID, key, approval.approvalHash);
    }
    await t.registry.disable(PACKAGE_ID, 'hook:h');
    expect(t.store.get(PACKAGE_ID, 'hook:h')?.enabled).toBe(false);
    t.calls.disable.length = 0;
    await t.registry.removePackage(PACKAGE_ID);
    expect(t.calls.disable).toEqual(['k']);
    expect(t.store.list(PACKAGE_ID)).toEqual([]);
  });

  it('reconcile forgets uninstalled packages and tells hosts what to keep', async () => {
    const t = await setup({ connections: [hookConnection('h')] });
    await t.registry.syncPackage(PACKAGE_ID);
    const approval = await t.registry.describe(PACKAGE_ID, 'hook:h');
    await t.registry.enable(PACKAGE_ID, 'hook:h', approval.approvalHash);
    await t.registry.setAutoStart(PACKAGE_ID, 'hook:h', true);

    await t.registry.reconcile();
    expect(t.calls.reconcile.at(-1)).toEqual([`${PACKAGE_ID}\u0000hook:h`]);

    t.uninstall();
    await t.registry.reconcile();
    expect(t.store.list(PACKAGE_ID)).toEqual([]);
    expect(t.calls.reconcile.at(-1)).toEqual([]);
  });

  it('refuses unknown connections, unsupported kinds and packages that are not installed', async () => {
    const t = await setup({ connections: [cliConnection] });
    await t.registry.syncPackage(PACKAGE_ID);
    await expect(t.registry.describe(PACKAGE_ID, 'hook:nope')).rejects.toMatchObject({ code: 'UNKNOWN_CONNECTION' });
    await expect(t.registry.describe(PACKAGE_ID, 'cli:tool')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(t.registry.syncPackage('other.package')).rejects.toMatchObject({ code: 'PACKAGE_NOT_INSTALLED' });
  });

  it('gives hosts a package reader that refuses traversal and absolute paths', async () => {
    const t = await setup({ connections: [hookConnection('h')] });
    await t.registry.syncPackage(PACKAGE_ID);
    const approval = await t.registry.describe(PACKAGE_ID, 'hook:h');
    await t.registry.enable(PACKAGE_ID, 'hook:h', approval.approvalHash);
    const context = t.context();
    expect(context).toBeDefined();
    await expect(context!.readPackageFile('../outside.txt')).rejects.toMatchObject({ code: 'PATH_FORBIDDEN' });
    await expect(context!.readPackageFile('/etc/passwd')).rejects.toMatchObject({ code: 'PATH_FORBIDDEN' });
    await expect(context!.readPackageFile('source\\hooks\\run.js')).rejects.toMatchObject({ code: 'PATH_FORBIDDEN' });
    await expect(context!.readPackageFile('source/hooks')).rejects.toBeDefined();
    expect((await context!.readPackageFile('source/hooks/run.js')).toString()).toBe('console.log(1)');
  });

  it('runs calls for one package one at a time', async () => {
    const t = await setup({ connections: [hookConnection('h'), hookConnection('k')], delayMs: 30 });
    await t.registry.syncPackage(PACKAGE_ID);
    const a = await t.registry.describe(PACKAGE_ID, 'hook:h');
    const b = await t.registry.describe(PACKAGE_ID, 'hook:k');
    await Promise.all([
      t.registry.enable(PACKAGE_ID, 'hook:h', a.approvalHash),
      t.registry.enable(PACKAGE_ID, 'hook:k', b.approvalHash),
      t.registry.syncPackage(PACKAGE_ID),
    ]);
    expect(t.calls.enable).toEqual(['h', 'k']);
    expect(t.store.list(PACKAGE_ID).filter((state) => state.enabled)).toHaveLength(2);
  });
});

describe('approval hash', () => {
  it('is stable for equal data and changes with any shown line', () => {
    const connection = adapterWith([hookConnection('h')]).connections[0]!;
    const subject = { kind: 'hook' as const, title: 'h', lines: [{ label: 'a', value: 'b' }], files: [] };
    const first = computeApprovalHash(connection, subject, new Map());
    expect(computeApprovalHash(connection, subject, new Map())).toBe(first);
    expect(computeApprovalHash(connection, { ...subject, lines: [{ label: 'a', value: 'c' }] }, new Map())).not.toBe(
      first
    );
  });
});
