/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { createConnectionRegistry, type LoadedPackage } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { defineConnectionHost } from '@process/integrations/connections/core/types';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-session-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

const PACKAGE_ID = 'com.community.sample';
const SESSION_ENDED = 'Tắt khi thoát ứng dụng';
const CHANGED = 'Nội dung đã đổi, cần duyệt lại trước khi bật.';
const skillConnection = { kind: 'skill', path: 'source/skills/a' };
const mcpConnection = (id: string, url = `https://${id}.example.com/mcp`) => ({
  kind: 'mcp',
  id,
  title: id,
  transport: 'http',
  url,
});
const envItem = (connection: string, name: string) => ({
  kind: 'env-value',
  note: 'needs a value',
  connection,
  name,
  required: true,
});

type Calls = { enable: string[]; disable: string[] };

/** A package on disk with one data connection (skill) and one code-running connection (mcp), plus restartable registries. */
const setup = async (options: { connections?: unknown[]; openItems?: unknown[]; missingEnv?: boolean } = {}) => {
  const dir = await temp();
  await mkdir(path.join(dir, 'source', 'skills', 'a'), { recursive: true });
  await writeFile(path.join(dir, 'source', 'skills', 'a', 'SKILL.md'), '# a');
  const world: { loaded: LoadedPackage | undefined } = {
    loaded: {
      packageId: PACKAGE_ID,
      packageVersion: '1.0.0',
      packageDirectory: dir,
      adapter: parseAdapterDocument({
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections: options.connections ?? [skillConnection, mcpConnection('docs')],
        ...(options.openItems ? { openItems: options.openItems } : {}),
      }),
    },
  };
  const calls: Calls = { enable: [], disable: [] };
  const hosts = [
    defineConnectionHost({
      kind: 'mcp',
      check: async () => ({ ok: true }),
      describe: async (_ctx, connection) => ({
        kind: 'mcp',
        title: connection.id,
        lines: [{ label: 'URL', value: String((connection as { url?: unknown }).url ?? '') }],
        files: [],
      }),
      enable: async (_ctx, connection) => {
        calls.enable.push(connection.id);
        return { installed: [connection.id] };
      },
      disable: async (_ctx, connection) => {
        calls.disable.push(connection.id);
      },
    }),
    defineConnectionHost({
      kind: 'skill',
      check: async () => ({ ok: true }),
      describe: async () => ({
        kind: 'skill',
        title: 'a',
        lines: [{ label: 'Skill', value: 'a' }],
        files: ['source/skills/a/SKILL.md'],
      }),
      enable: async () => ({ installed: ['a'] }),
      disable: async () => undefined,
    }),
  ];
  const stateFile = path.join(dir, 'connections.json');
  /** One simulated application start over the same state file. */
  const boot = async (missingEnv: boolean = options.missingEnv === true) => {
    const store = createJsonConnectionStateStore(stateFile);
    await store.initialize();
    const registry = createConnectionRegistry({
      store,
      hosts,
      loadPackage: async (id) => (id === PACKAGE_ID ? world.loaded : undefined),
      listInstalledPackageIds: async () => (world.loaded ? [PACKAGE_ID] : []),
      missingRequiredEnv: async (_id: string, names: readonly string[]) => (missingEnv ? names : []),
      now: () => 1_000,
    });
    return { store, registry };
  };
  return { world, calls, stateFile, boot, ...(await boot()) };
};

const turnOn = async (registry: Awaited<ReturnType<typeof setup>>['registry'], key: string) => {
  await registry.syncPackage(PACKAGE_ID);
  const approval = await registry.describe(PACKAGE_ID, key);
  return registry.enable(PACKAGE_ID, key, approval.approvalHash);
};

describe('connections of this app session', () => {
  it('a code-running connection that was on is off after a restart unless it is marked to start again', async () => {
    const t = await setup();
    await turnOn(t.registry, 'skill:source/skills/a');
    await turnOn(t.registry, 'mcp:docs');

    const next = await t.boot();
    await next.registry.reconcile();

    expect(next.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({
      enabled: false,
      status: 'off',
      reason: SESSION_ENDED,
    });
    expect(t.calls.disable).toContain('docs');
    // Data kinds run nothing and keep their state across the restart.
    expect(next.store.get(PACKAGE_ID, 'skill:source/skills/a')).toMatchObject({ enabled: true, status: 'on' });
  });

  it('a connection marked to start again is enabled once more without a prompt when its approval still matches', async () => {
    const t = await setup();
    await turnOn(t.registry, 'mcp:docs');
    await t.registry.setAutoStart(PACKAGE_ID, 'mcp:docs', true);
    const enabledBefore = t.calls.enable.length;

    const next = await t.boot();
    await next.registry.reconcile();

    expect(next.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({ enabled: true, status: 'on', autoStart: true });
    expect(t.calls.enable.length).toBe(enabledBefore + 1);
  });

  it('a start-again connection whose content changed while the app was closed stays off, with the reason', async () => {
    const t = await setup();
    await turnOn(t.registry, 'mcp:docs');
    await t.registry.setAutoStart(PACKAGE_ID, 'mcp:docs', true);
    t.world.loaded = {
      ...t.world.loaded!,
      adapter: parseAdapterDocument({
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections: [skillConnection, mcpConnection('docs', 'https://other.example.com/mcp')],
      }),
    };
    const enabledBefore = t.calls.enable.length;

    const next = await t.boot();
    await next.registry.reconcile();

    expect(next.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({
      enabled: false,
      status: 'needs-input',
      reason: CHANGED,
      autoStart: true,
    });
    expect(t.calls.enable.length).toBe(enabledBefore);
  });

  it('a revoked package never starts a start-again connection, and its data connections keep their state', async () => {
    const t = await setup();
    await turnOn(t.registry, 'skill:source/skills/a');
    await turnOn(t.registry, 'mcp:docs');
    await t.registry.setAutoStart(PACKAGE_ID, 'mcp:docs', true);
    t.world.loaded = { ...t.world.loaded!, trust: 'unsigned-revoked' };
    const enabledBefore = t.calls.enable.length;

    const next = await t.boot();
    await next.registry.reconcile();

    expect(next.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({ enabled: false, status: 'needs-input' });
    expect(t.calls.enable.length).toBe(enabledBefore);
    expect(next.store.get(PACKAGE_ID, 'skill:source/skills/a')).toMatchObject({ enabled: true, status: 'on' });
  });

  it('a start-again connection with a required value still missing stays off with the reason', async () => {
    const t = await setup({ connections: [mcpConnection('docs')], openItems: [envItem('docs', 'DOCS_TOKEN')] });
    await turnOn(t.registry, 'mcp:docs');
    await t.registry.setAutoStart(PACKAGE_ID, 'mcp:docs', true);

    // Next start: the value is still missing, so nothing starts and the record says why.
    const next = await t.boot(true);
    await next.registry.reconcile();

    expect(next.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({
      enabled: false,
      status: 'needs-input',
      reason: 'Cần nhập biến môi trường: DOCS_TOKEN',
    });
    expect(t.calls.enable.filter((id) => id === 'docs')).toHaveLength(1);
  });

  it('setAutoStart only applies to code-running connections that have a recorded state', async () => {
    const t = await setup();
    await expect(t.registry.setAutoStart(PACKAGE_ID, 'mcp:docs', true)).rejects.toMatchObject({
      code: 'UNKNOWN_CONNECTION',
    });
    await t.registry.syncPackage(PACKAGE_ID);
    await expect(t.registry.setAutoStart(PACKAGE_ID, 'skill:source/skills/a', true)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });

  it('the start-again choice survives turning the connection off and on again', async () => {
    const t = await setup();
    await turnOn(t.registry, 'mcp:docs');
    await t.registry.setAutoStart(PACKAGE_ID, 'mcp:docs', true);
    await t.registry.disable(PACKAGE_ID, 'mcp:docs');
    expect(t.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({ enabled: false, autoStart: true });
    await turnOn(t.registry, 'mcp:docs');
    expect(t.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({ enabled: true, autoStart: true });
  });

  it('a version 1 state file reads with autoStart false and is written back as version 2', async () => {
    const t = await setup();
    await t.registry.syncPackage(PACKAGE_ID);
    const { approvalHash: hash } = await t.registry.describe(PACKAGE_ID, 'mcp:docs');
    await writeFile(
      t.stateFile,
      JSON.stringify({
        schemaVersion: 1,
        records: [
          {
            packageId: PACKAGE_ID,
            packageVersion: '1.0.0',
            connectionKey: 'mcp:docs',
            enabled: true,
            status: 'on',
            approvalHash: hash,
          },
        ],
      })
    );

    const migrated = await t.boot();
    expect(migrated.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({ enabled: true, autoStart: false });

    await migrated.registry.reconcile();
    expect(migrated.store.get(PACKAGE_ID, 'mcp:docs')).toMatchObject({ enabled: false, reason: SESSION_ENDED });

    const file = JSON.parse(await readFile(t.stateFile, 'utf8')) as { schemaVersion: number };
    expect(file.schemaVersion).toBe(2);
  });
});
