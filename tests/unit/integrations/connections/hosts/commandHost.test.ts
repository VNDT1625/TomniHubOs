/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PACKAGE_COMMAND_MAX_BYTES } from '@/common/integrations/commands/commandTemplate';
import { parseAdapterDocument } from '@/common/packages/adapter';
import {
  PACKAGE_COMMAND_TOO_LARGE,
  PACKAGE_COMMAND_UNAVAILABLE,
  createPackageCommandService,
} from '@process/integrations/connections/commands/packageCommandService';
import { createConnectionRegistry, type LoadedPackage } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import {
  ConnectionError,
  type AnyConnectionHost,
  type HostContext,
} from '@process/integrations/connections/core/types';
import { createCommandHost } from '@process/integrations/connections/hosts/data/commandHost';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-cmdhost-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const command = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'command',
  id,
  title: `Title ${id}`,
  path: `source/commands/${id}.md`,
  format: 'markdown',
  ...extra,
});

type Package = { id: string; connections: unknown[]; files: Record<string, string | Buffer> };

/** Real registry, real command host, real files; only the package list is faked. */
const setup = async (packages: Package[], host: AnyConnectionHost = createCommandHost()) => {
  const state = await temp();
  const dirs = new Map<string, string>();
  const adapters = new Map<string, LoadedPackage['adapter']>();
  for (const pkg of packages) {
    const dir = await temp();
    dirs.set(pkg.id, dir);
    await mkdir(path.join(dir, 'source', 'commands'), { recursive: true });
    for (const [file, content] of Object.entries(pkg.files)) {
      await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await writeFile(path.join(dir, file), content);
    }
    adapters.set(
      pkg.id,
      parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections: pkg.connections })
    );
  }
  const store = createJsonConnectionStateStore(path.join(state, 'connections.json'));
  await store.initialize();
  const registry = createConnectionRegistry({
    store,
    hosts: [host],
    loadPackage: async (packageId): Promise<LoadedPackage | undefined> => {
      const dir = dirs.get(packageId);
      const adapter = adapters.get(packageId);
      return dir && adapter ? { packageId, packageVersion: '1.0.0', packageDirectory: dir, adapter } : undefined;
    },
    listInstalledPackageIds: async () => [...dirs.keys()],
  });
  const turnOn = async (packageId: string, key: string): Promise<void> => {
    const { approvalHash } = await registry.describe(packageId, key);
    await registry.enable(packageId, key, approvalHash);
  };
  return { registry, store, dirs, turnOn, service: createPackageCommandService(async () => registry) };
};

describe('command host', () => {
  it('is off after install, and a turned-on command is listed and expanded from the package file', async () => {
    const { registry, turnOn, service } = await setup([
      {
        id: 'com.community.kit',
        connections: [command('triage', { description: 'Fix an issue', argumentHint: '[issue]' })],
        files: {
          'source/commands/triage.md': '---\ndescription: ignored here\n---\nFix issue $1 carefully.\nAll: $ARGUMENTS',
        },
      },
    ]);
    const [view] = await registry.syncPackage('com.community.kit');
    expect(view?.state.status).toBe('off');
    expect(await service.list()).toEqual([]);

    await turnOn('com.community.kit', 'command:triage');
    expect(await service.list()).toEqual([
      { name: 'triage', description: 'Fix an issue', packageId: 'com.community.kit', argumentHint: '[issue]' },
    ]);
    expect(await service.expand('/triage 42 "extra words"')).toEqual({
      name: 'triage',
      packageId: 'com.community.kit',
      modelInput: 'Fix issue 42 carefully.\nAll: 42 "extra words"',
    });
  });

  it('describes the command without a shell line, and counts syntax that will not run', async () => {
    const { registry } = await setup([
      {
        id: 'com.community.kit',
        connections: [command('ship')],
        files: { 'source/commands/ship.md': 'Run !`git push` then read @notes.md' },
      },
    ]);
    const { subject } = await registry.describe('com.community.kit', 'command:ship');
    expect(subject.files).toEqual(['source/commands/ship.md']);
    const labels = subject.lines.map((line) => line.label);
    expect(labels).toContain('Command');
    expect(labels).toContain('Not run');
    expect(subject.lines.find((line) => line.label === 'Not run')?.value).toContain('1 shell');
    expect(subject.lines.map((line) => line.label.toLowerCase())).not.toContain('args');
  });

  it('does not run shell substitution when a command is used', async () => {
    const { turnOn, service } = await setup([
      {
        id: 'com.community.kit',
        connections: [command('ship')],
        files: { 'source/commands/ship.md': 'Status: !`node -e "process.exit(9)"` and !{whoami}' },
      },
    ]);
    await turnOn('com.community.kit', 'command:ship');
    const expansion = await service.expand('/ship');
    expect(expansion?.modelInput).toBe('Status: !`node -e "process.exit(9)"` and !{whoami}');
  });

  it('turning it off removes it from the list and from expansion', async () => {
    const { registry, turnOn, service } = await setup([
      { id: 'com.community.kit', connections: [command('a')], files: { 'source/commands/a.md': 'A' } },
    ]);
    await registry.syncPackage('com.community.kit');
    await turnOn('com.community.kit', 'command:a');
    expect(await service.list()).toHaveLength(1);
    await registry.disable('com.community.kit', 'command:a');
    expect(await service.list()).toEqual([]);
    expect(await service.expand('/a')).toBeUndefined();
    // Idempotent: a second disable of something that is off is not an error.
    await expect(registry.disable('com.community.kit', 'command:a')).resolves.toMatchObject({ enabled: false });
  });

  it('removing the package takes its commands with it', async () => {
    const { registry, turnOn, service } = await setup([
      { id: 'com.community.kit', connections: [command('a')], files: { 'source/commands/a.md': 'A' } },
    ]);
    await registry.syncPackage('com.community.kit');
    await turnOn('com.community.kit', 'command:a');
    await registry.removePackage('com.community.kit');
    expect(await service.list()).toEqual([]);
  });

  it('follows an edited template without asking again (data kind), and the hash covers the content', async () => {
    const { registry, dirs, turnOn, service } = await setup([
      { id: 'com.community.kit', connections: [command('a')], files: { 'source/commands/a.md': 'old $ARGUMENTS' } },
    ]);
    await registry.syncPackage('com.community.kit');
    const before = await registry.describe('com.community.kit', 'command:a');
    await turnOn('com.community.kit', 'command:a');
    await writeFile(path.join(dirs.get('com.community.kit') ?? '', 'source', 'commands', 'a.md'), 'new $ARGUMENTS');
    const after = await registry.describe('com.community.kit', 'command:a');
    expect(after.approvalHash).not.toBe(before.approvalHash);
    // A data kind follows the updated package by itself: still on, now recorded under the new hash.
    const [view] = await registry.syncPackage('com.community.kit');
    expect(view?.state).toMatchObject({ enabled: true, status: 'on', approvalHash: after.approvalHash });
    // The old hash no longer enables it.
    await registry.disable('com.community.kit', 'command:a');
    await expect(registry.enable('com.community.kit', 'command:a', before.approvalHash)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    await turnOn('com.community.kit', 'command:a');
    expect((await service.expand('/a x'))?.modelInput).toBe('new x');
  });

  it('gives a plugin prefix to commands whose names collide, and to a built-in word', async () => {
    const { turnOn, service } = await setup([
      {
        id: 'pkg-a',
        connections: [
          command('inspect', { plugin: 'source/plugins/alpha' }),
          command('boost', { plugin: 'source/plugins/alpha' }),
        ],
        files: { 'source/commands/inspect.md': 'A inspect', 'source/commands/boost.md': 'A boost' },
      },
      {
        id: 'pkg-b',
        connections: [command('inspect', { plugin: 'source/plugins/beta' })],
        files: { 'source/commands/inspect.md': 'B inspect' },
      },
    ]);
    for (const [pkg, key] of [
      ['pkg-a', 'command:inspect'],
      ['pkg-a', 'command:boost'],
      ['pkg-b', 'command:inspect'],
    ] as const) {
      await turnOn(pkg, key);
    }
    expect((await service.list()).map((item) => item.name).toSorted()).toEqual([
      'alpha:boost',
      'alpha:inspect',
      'beta:inspect',
    ]);
    expect((await service.expand('/alpha:inspect go'))?.modelInput).toBe('A inspect\n\nARGUMENTS: go');
    expect((await service.expand('/beta:inspect'))?.modelInput).toBe('B inspect');
    // The bare word is nobody's command, and `/boost` stays the built-in mode.
    expect(await service.expand('/inspect')).toBeUndefined();
    expect(await service.expand('/boost')).toBeUndefined();
  });

  it('is not a command when it is not at the start, is unknown, or the line is plain text', async () => {
    const { turnOn, service } = await setup([
      { id: 'com.community.kit', connections: [command('a')], files: { 'source/commands/a.md': 'A' } },
    ]);
    await turnOn('com.community.kit', 'command:a');
    expect(await service.expand('hello /a')).toBeUndefined();
    expect(await service.expand('/nope')).toBeUndefined();
    expect(await service.expand('hello')).toBeUndefined();
  });

  it('marks a command unsupported when its file is missing, too large, empty, or outside source/', async () => {
    const { registry } = await setup([
      {
        id: 'com.community.kit',
        connections: [
          command('missing'),
          command('big'),
          command('empty'),
          command('outside', { path: 'adapter/outside.md' }),
        ],
        files: {
          'source/commands/big.md': 'x'.repeat(PACKAGE_COMMAND_MAX_BYTES + 1),
          'source/commands/empty.md': '---\ndescription: x\n---\n',
          'adapter/outside.md': 'sneaky',
        },
      },
    ]);
    const views = await registry.syncPackage('com.community.kit');
    const byKey = new Map(views.map((view) => [view.key, view.state]));
    for (const id of ['missing', 'big', 'empty', 'outside']) {
      expect(byKey.get(`command:${id}`)?.status).toBe('unsupported');
    }
    expect(byKey.get('command:big')?.reason).toContain('64');
    expect(byKey.get('command:outside')?.reason).toContain('source');
    await expect(
      registry
        .describe('com.community.kit', 'command:big')
        .then((a) => registry.enable('com.community.kit', 'command:big', a.approvalHash))
    ).rejects.toMatchObject({ code: 'RUNTIME_MISSING' });
  });

  it('a Gemini TOML command expands {{args}}', async () => {
    const { turnOn, service } = await setup([
      {
        id: 'com.community.kit',
        connections: [command('plan', { path: 'source/commands/plan.toml', format: 'gemini-toml' })],
        files: { 'source/commands/plan.toml': 'description = "Plan"\nprompt = "Plan this: {{args}}"\n' },
      },
    ]);
    await turnOn('com.community.kit', 'command:plan');
    expect((await service.expand('/plan the move'))?.modelInput).toBe('Plan this: the move');
  });

  it('reports the command as unavailable, not as plain text, when its file vanished after it was turned on', async () => {
    const { dirs, turnOn, service } = await setup([
      { id: 'com.community.kit', connections: [command('a')], files: { 'source/commands/a.md': 'A' } },
    ]);
    await turnOn('com.community.kit', 'command:a');
    await rm(path.join(dirs.get('com.community.kit') ?? '', 'source', 'commands', 'a.md'));
    await expect(service.expand('/a')).rejects.toThrow(PACKAGE_COMMAND_UNAVAILABLE);
  });

  it('refuses an expansion above the size cap with a stable error', async () => {
    const { turnOn, service } = await setup([
      { id: 'com.community.kit', connections: [command('a')], files: { 'source/commands/a.md': 'Echo $ARGUMENTS' } },
    ]);
    await turnOn('com.community.kit', 'command:a');
    await expect(service.expand(`/a ${'z'.repeat(250_000)}`)).rejects.toThrow(PACKAGE_COMMAND_TOO_LARGE);
  });

  it('never rejects the menu list when the registry fails', async () => {
    const service = createPackageCommandService(async () => {
      throw new Error('registry down');
    });
    expect(await service.list()).toEqual([]);
    expect(await service.expand('/anything')).toBeUndefined();
  });
});

const contextReading = (read: HostContext['readPackageFile']): HostContext => ({
  packageId: 'p',
  packageVersion: '1',
  packageDirectory: '/nowhere',
  readPackageFile: read,
});

describe('command host reader guard', () => {
  const host = createCommandHost();
  const connection = (path_: string) =>
    parseAdapterDocument({
      schemaVersion: 1,
      generatedBy: 'classifier',
      connections: [command('x', { path: path_ })],
    }).connections[0];

  it('passes a traversal refusal from the guarded reader through as the reason, never reading a file itself', async () => {
    const context = contextReading(async () => {
      throw new ConnectionError('PATH_FORBIDDEN', 'Path leaves the package: source/commands/x.md');
    });
    const checked = await host.check(context, connection('source/commands/x.md') as never);
    expect(checked).toEqual({ ok: false, reason: 'Path leaves the package: source/commands/x.md' });
  });

  it('only ever asks the reader for the connection path', async () => {
    const asked: string[] = [];
    const context = contextReading(async (relative) => {
      asked.push(relative);
      return Buffer.from('Body');
    });
    await host.check(context, connection('source/commands/x.md') as never);
    await host.describe(context, connection('source/commands/x.md') as never);
    expect(new Set(asked)).toEqual(new Set(['source/commands/x.md']));
  });

  it('enable returns the command id and disable and reconcile do nothing', async () => {
    const context = contextReading(async () => Buffer.from('Body'));
    await expect(host.enable(context, connection('source/commands/x.md') as never)).resolves.toEqual({
      installed: ['x'],
    });
    await expect(host.disable(context, connection('source/commands/x.md') as never, ['x'])).resolves.toBeUndefined();
    await expect(host.reconcile?.({ keep: new Set() })).resolves.toBeUndefined();
  });
});
