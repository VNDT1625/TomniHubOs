/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A start-again connection (docs/platform/repotopackage-design.md section 9.4) keeps the approval it was given while it is
 * off. A restart checks that approval against the current content and starts the connection; changed content, revoked
 * trust, or a switch-off without start-again drop it. The real record shape a broken build left behind is covered too.
 */
/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAdapterDocument, type AdapterConnectionKind, type AdapterDocument } from '@/common/packages/adapter';
import {
  createConnectionRegistry,
  type ConnectionRegistry,
  type LoadedPackage,
} from '@process/integrations/connections/core/registry';
import {
  createJsonConnectionStateStore,
  type ConnectionStateStore,
} from '@process/integrations/connections/core/state';
import { defineConnectionHost, type AnyConnectionHost } from '@process/integrations/connections/core/types';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-autostart-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

const PACKAGE_ID = 'com.community.context-mode';
const NEEDS_APPROVAL = 'Cần duyệt lại trước khi tự bật khi mở ứng dụng.';
const CHANGED = 'Nội dung đã đổi, cần duyệt lại trước khi bật.';
const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/unit/integrations/connections/fixtures');
const KINDS: readonly AdapterConnectionKind[] = ['cli', 'hook', 'mcp', 'skill', 'rules', 'knowledge'];
const CODE_KINDS: ReadonlySet<string> = new Set(['cli', 'hook', 'mcp']);

type Calls = { enable: string[]; disable: string[] };
type World = { loaded: LoadedPackage | undefined; checkFailure?: string };
type Boot = { store: ConnectionStateStore; registry: ConnectionRegistry };
type ConnectionLike = { id?: string; path?: string; event?: string };
type StateFileRecord = { connectionKey: string; enabled: boolean; status: string; autoStart?: boolean };

const idOf = (connection: unknown): string => {
  const value = connection as ConnectionLike;
  return value.id ?? value.path ?? '';
};

/** Stateless fake hosts. Code kinds fail their check when the world says so; a PreCompact hook is unsupported, as in the app. */
const fakeHosts = (world: World, calls: Calls): AnyConnectionHost[] =>
  KINDS.map((kind) =>
    defineConnectionHost<AdapterConnectionKind>({
      kind,
      check: async (_context, connection) => {
        const value = connection as unknown as ConnectionLike;
        if (kind === 'hook' && value.event === 'PreCompact') {
          return { ok: false, reason: 'The event "PreCompact" is not supported yet.' };
        }
        if (CODE_KINDS.has(kind) && world.checkFailure !== undefined) return { ok: false, reason: world.checkFailure };
        return { ok: true };
      },
      describe: async (_context, connection) => ({
        kind,
        title: idOf(connection),
        lines: [{ label: 'Definition', value: JSON.stringify(connection) }],
        files: [],
      }),
      enable: async (_context, connection) => {
        calls.enable.push(idOf(connection));
        return { installed: [idOf(connection)] };
      },
      disable: async (_context, connection) => {
        calls.disable.push(idOf(connection));
      },
    })
  );

const mcp = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'mcp',
  id,
  title: id,
  transport: 'http',
  url: `https://${id}.example.com/mcp`,
  ...extra,
});

const adapterOf = (connections: unknown[]): AdapterDocument =>
  parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections });

/** One package on disk plus restartable registries over one state file. `boot()` is one application start. */
const harness = async (options: { adapter?: AdapterDocument; stateFile?: unknown } = {}) => {
  const dir = await temp();
  const stateFile = path.join(dir, 'connections.json');
  if (options.stateFile !== undefined) await writeFile(stateFile, JSON.stringify(options.stateFile), 'utf8');
  const world: World = {
    loaded: {
      packageId: PACKAGE_ID,
      packageVersion: '1.0.169',
      packageDirectory: dir,
      adapter: options.adapter ?? adapterOf([mcp('docs')]),
    },
  };
  const calls: Calls = { enable: [], disable: [] };
  const hosts = fakeHosts(world, calls);
  const boot = async (): Promise<Boot> => {
    const store = createJsonConnectionStateStore(stateFile);
    await store.initialize();
    const registry = createConnectionRegistry({
      store,
      hosts,
      loadPackage: async (id) => (id === PACKAGE_ID ? world.loaded : undefined),
      listInstalledPackageIds: async () => (world.loaded ? [PACKAGE_ID] : []),
      now: () => 1_000,
    });
    return { store, registry };
  };
  return { world, calls, boot, stateFile };
};

/** The person's approval: describe what would run, then enable with the hash that was shown. */
const approveAndEnable = async (registry: ConnectionRegistry, key: string) => {
  await registry.syncPackage(PACKAGE_ID);
  const approval = await registry.describe(PACKAGE_ID, key);
  return registry.enable(PACKAGE_ID, key, approval.approvalHash);
};

const realState = async (): Promise<{ schemaVersion: number; records: StateFileRecord[] }> =>
  JSON.parse(await readFile(path.join(FIXTURE_DIR, 'context-mode-state.json'), 'utf8')) as {
    schemaVersion: number;
    records: StateFileRecord[];
  };

const realAdapter = async (): Promise<AdapterDocument> =>
  parseAdapterDocument(JSON.parse(await readFile(path.join(FIXTURE_DIR, 'context-mode-adapter.json'), 'utf8')));

const KEY = {
  docs: 'mcp:docs',
  remote: 'mcp:remote',
  local: 'mcp:local',
};

describe('start-again connections keep their approval while off', () => {
  it('a restart starts a start-again connection that was switched off with its approval kept', async () => {
    const h = await harness();
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.docs);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.docs, true);
    await first.registry.disable(PACKAGE_ID, KEY.docs);
    expect(first.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: false, status: 'off', autoStart: true });
    expect(first.store.get(PACKAGE_ID, KEY.docs)?.approvalHash).toMatch(/^sha256-[a-f0-9]{64}$/u);

    const next = await h.boot();
    h.calls.enable.length = 0;
    await next.registry.reconcile();
    expect(next.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: true, status: 'on', autoStart: true });
    expect(h.calls.enable).toEqual(['docs']);
  });

  it('switching off without start-again drops the approval, so the next start does not run it', async () => {
    const h = await harness();
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.docs);
    await first.registry.disable(PACKAGE_ID, KEY.docs);
    expect(first.store.get(PACKAGE_ID, KEY.docs)?.approvalHash).toBeUndefined();

    const next = await h.boot();
    h.calls.enable.length = 0;
    await next.registry.reconcile();
    expect(next.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: false, status: 'off' });
    expect(h.calls.enable).toEqual([]);
  });

  it('a changed connection that is off loses its approval at the next sync and does not start', async () => {
    const h = await harness();
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.docs);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.docs, true);
    await first.registry.disable(PACKAGE_ID, KEY.docs);
    h.world.loaded = {
      ...h.world.loaded!,
      adapter: adapterOf([mcp('docs', { url: 'https://changed.example.com/mcp' })]),
    };

    const next = await h.boot();
    h.calls.enable.length = 0;
    await next.registry.reconcile();
    expect(next.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({
      enabled: false,
      status: 'needs-input',
      reason: CHANGED,
      autoStart: true,
    });
    expect(next.store.get(PACKAGE_ID, KEY.docs)?.approvalHash).toBeUndefined();
    expect(h.calls.enable).toEqual([]);
  });

  it('a failed check at launch keeps the approval, and the next launch with the check passing starts it', async () => {
    const h = await harness();
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.docs);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.docs, true);

    h.world.checkFailure = 'MCP runtime is not ready yet';
    const failing = await h.boot();
    await failing.registry.reconcile();
    expect(failing.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: false, autoStart: true });
    expect(failing.store.get(PACKAGE_ID, KEY.docs)?.approvalHash).toMatch(/^sha256-/u);

    h.world.checkFailure = undefined;
    h.calls.enable.length = 0;
    const healthy = await h.boot();
    await healthy.registry.reconcile();
    expect(healthy.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: true, status: 'on' });
    expect(h.calls.enable).toEqual(['docs']);
  });

  it('stopping the start-again choice while off drops the approval', async () => {
    const h = await harness();
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.docs);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.docs, true);
    await first.registry.disable(PACKAGE_ID, KEY.docs);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.docs, false);
    expect(first.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: false, autoStart: false });
    expect(first.store.get(PACKAGE_ID, KEY.docs)?.approvalHash).toBeUndefined();
  });

  it('a group alternative switched off by its sibling keeps its approval and starts again at the next launch', async () => {
    const h = await harness({ adapter: adapterOf([mcp('remote', { group: 'ctx' }), mcp('local', { group: 'ctx' })]) });
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.remote);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.remote, true);
    await approveAndEnable(first.registry, KEY.local);
    expect(first.store.get(PACKAGE_ID, KEY.remote)).toMatchObject({ enabled: false, autoStart: true });
    expect(first.store.get(PACKAGE_ID, KEY.remote)?.approvalHash).toMatch(/^sha256-/u);

    const next = await h.boot();
    await next.registry.reconcile();
    expect(next.store.get(PACKAGE_ID, KEY.remote)).toMatchObject({ enabled: true, status: 'on' });
    expect(next.store.get(PACKAGE_ID, KEY.local)).toMatchObject({ enabled: false });
  });

  it('a revoked package drops the approval of a start-again connection, so trust returning alone starts nothing', async () => {
    const h = await harness();
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.docs);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.docs, true);

    h.world.loaded = { ...h.world.loaded!, trust: 'unsigned-revoked' };
    const revoked = await h.boot();
    await revoked.registry.reconcile();
    expect(revoked.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: false, status: 'needs-input' });
    expect(revoked.store.get(PACKAGE_ID, KEY.docs)?.approvalHash).toBeUndefined();

    h.world.loaded = { ...h.world.loaded!, trust: undefined };
    h.calls.enable.length = 0;
    const trusted = await h.boot();
    await trusted.registry.reconcile();
    expect(trusted.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: false, autoStart: true });
    expect(h.calls.enable).toEqual([]);
  });

  it('a later reconcile in the same run (another package changed) does not start a connection the person turned off', async () => {
    const h = await harness();
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.docs);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.docs, true);
    await first.registry.reconcile();
    expect(first.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: true, status: 'on' });

    await first.registry.disable(PACKAGE_ID, KEY.docs);
    const enabledCalls = h.calls.enable.length;
    await first.registry.reconcile();
    expect(first.store.get(PACKAGE_ID, KEY.docs)).toMatchObject({ enabled: false, autoStart: true });
    expect(h.calls.enable.length).toBe(enabledCalls);
  });
});

describe('the record shape a broken build left behind (sanitized copy of connections.json)', () => {
  it('code connections with start-again and no approval stay off at start and say they need one approval', async () => {
    const state = await realState();
    const adapter = await realAdapter();
    const h = await harness({ adapter, stateFile: state });
    const next = await h.boot();
    h.calls.enable.length = 0;
    await next.registry.reconcile();

    const codeRecords = state.records.filter((record) => CODE_KINDS.has(record.connectionKey.split(':')[0] ?? ''));
    expect(codeRecords).toHaveLength(16);
    for (const record of codeRecords) {
      const after = next.store.get(PACKAGE_ID, record.connectionKey);
      expect(after).toMatchObject({ enabled: false, autoStart: true });
      if (record.status === 'unsupported') expect(after?.status).toBe('unsupported');
      else expect(after).toMatchObject({ status: 'off', reason: NEEDS_APPROVAL });
    }
    const codeIds = new Set(adapter.connections.filter((c) => CODE_KINDS.has(c.kind)).map((c) => idOf(c)));
    expect(h.calls.enable.filter((id) => codeIds.has(id))).toEqual([]);
  });

  it('data connections (skills, rules, knowledge) stay on through the restart without a start-again choice', async () => {
    const state = await realState();
    const h = await harness({ adapter: await realAdapter(), stateFile: state });
    const next = await h.boot();
    await next.registry.reconcile();

    const dataRecords = state.records.filter((record) => !CODE_KINDS.has(record.connectionKey.split(':')[0] ?? ''));
    expect(dataRecords).toHaveLength(20);
    for (const record of dataRecords) {
      expect(next.store.get(PACKAGE_ID, record.connectionKey)).toMatchObject({ enabled: true, status: 'on' });
    }
  });

  it('after one approval, the start-again connection of that shape starts at the next launch', async () => {
    const state = await realState();
    const h = await harness({ adapter: await realAdapter(), stateFile: state });
    const first = await h.boot();
    await first.registry.reconcile();
    await approveAndEnable(first.registry, 'mcp:context-mode-source');
    expect(first.store.get(PACKAGE_ID, 'mcp:context-mode-source')).toMatchObject({
      enabled: true,
      status: 'on',
      autoStart: true,
    });

    const next = await h.boot();
    h.calls.enable.length = 0;
    await next.registry.reconcile();
    expect(next.store.get(PACKAGE_ID, 'mcp:context-mode-source')).toMatchObject({ enabled: true, status: 'on' });
    expect(h.calls.enable).toContain('context-mode-source');
  });

  it('lists the package while a legacy start-again connection waits for its approval (the real record shape)', async () => {
    const state = await realState();
    const h = await harness({ adapter: await realAdapter(), stateFile: state });
    const next = await h.boot();
    await next.registry.reconcile();
    await expect(next.registry.startApprovalNeeded()).resolves.toEqual([PACKAGE_ID]);
  });

  it('lists nothing once the start-again connection holds its approval', async () => {
    const h = await harness();
    const first = await h.boot();
    await approveAndEnable(first.registry, KEY.docs);
    await first.registry.setAutoStart(PACKAGE_ID, KEY.docs, true);
    await expect(first.registry.startApprovalNeeded()).resolves.toEqual([]);
  });
});
