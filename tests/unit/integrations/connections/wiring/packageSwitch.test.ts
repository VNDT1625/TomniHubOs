/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { createConnectionRegistry, type LoadedPackage } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { defineConnectionHost } from '@process/integrations/connections/core/types';
import type { InstallActivationConfirm } from '@process/integrations/connections/wiring/installActivation';
import { setPackageEnabled } from '@process/integrations/connections/wiring/packageSwitch';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-package-switch-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

const PACKAGE_ID = 'com.community.sample';
const SKILL_KEY = 'skill:source/skills/a';
const MCP_KEY = 'mcp:docs';
const ALT_KEY = 'mcp:docs-alt';
const NOT_APPROVED = 'Bạn chưa duyệt, kết nối vẫn tắt. Có thể bật từng cái trong chi tiết gói.';
const REVOKED = 'Khóa ký của gói này trên máy đã bị thu hồi.';

const skillConnection = { kind: 'skill', path: 'source/skills/a' };
const mcpConnection = {
  kind: 'mcp',
  id: 'docs',
  title: 'docs',
  transport: 'http',
  url: 'https://docs.example.com/mcp',
};
const alternativeConnection = {
  kind: 'mcp',
  id: 'docs-alt',
  title: 'docs alt',
  transport: 'http',
  url: 'https://alt.example.com/mcp',
  group: 'docs',
};

type Calls = { enable: string[]; disable: string[] };

/** Fake hosts: a data kind (skill) and a code-running kind (mcp). `failDisable` makes the mcp host fail to stop. */
const fakeHosts = (calls: Calls, options: { failDisable?: boolean } = {}) => [
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
  defineConnectionHost({
    kind: 'mcp',
    check: async () => ({ ok: true }),
    describe: async (_ctx, connection) => ({
      kind: 'mcp',
      title: connection.id,
      lines: [
        { label: 'Lệnh', value: 'npx example-mcp' },
        { label: 'Biến môi trường', value: 'DOCS_TOKEN' },
      ],
      files: [],
    }),
    enable: async (_ctx, connection) => {
      calls.enable.push(connection.id);
      return { installed: [connection.id] };
    },
    disable: async (_ctx, connection) => {
      calls.disable.push(connection.id);
      if (options.failDisable) throw new Error('stop failed');
    },
  }),
];

type Harness = {
  world: { loaded: LoadedPackage };
  registry: ReturnType<typeof createConnectionRegistry>;
  store: Awaited<ReturnType<typeof createJsonConnectionStateStore>>;
  calls: Calls;
};

/** A package on disk: a skill, an mcp connection that may need a value, and optionally an alternative of the same group. */
const harness = async (
  options: { missingEnv?: boolean; revoked?: boolean; alternative?: boolean; failDisable?: boolean } = {}
): Promise<Harness> => {
  const dir = await temp();
  await mkdir(path.join(dir, 'source', 'skills', 'a'), { recursive: true });
  await writeFile(path.join(dir, 'source', 'skills', 'a', 'SKILL.md'), '# a');
  const primary = options.alternative ? { ...mcpConnection, group: 'docs' } : mcpConnection;
  const connections = [skillConnection, primary, ...(options.alternative ? [alternativeConnection] : [])];
  const openItems = [{ kind: 'env-value', note: 'token', connection: 'docs', name: 'DOCS_TOKEN', required: true }];
  const world = {
    loaded: {
      packageId: PACKAGE_ID,
      packageVersion: '1.0.0',
      packageDirectory: dir,
      adapter: parseAdapterDocument({
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections,
        openItems: options.missingEnv ? openItems : [],
      }),
      ...(options.revoked ? { trust: 'unsigned-revoked' as const } : {}),
    } as LoadedPackage,
  };
  const calls: Calls = { enable: [], disable: [] };
  const store = createJsonConnectionStateStore(path.join(dir, 'connections.json'));
  await store.initialize();
  const registry = createConnectionRegistry({
    store,
    hosts: fakeHosts(calls, { failDisable: options.failDisable }),
    loadPackage: async (id) => (id === PACKAGE_ID ? world.loaded : undefined),
    listInstalledPackageIds: async () => [PACKAGE_ID],
    missingRequiredEnv: async (_id, names) => (options.missingEnv ? names : []),
    now: () => 1_000,
  });
  return { world, registry, store, calls };
};

const approveAll = (autoStart: boolean) => vi.fn<InstallActivationConfirm>(async () => ({ approved: true, autoStart }));

describe('the package master switch', () => {
  it('turning the package on switches data kinds on and asks once for the code-running kinds', async () => {
    const t = await harness();
    const confirm = approveAll(true);

    const report = await setPackageEnabled({ registry: t.registry, confirm }, PACKAGE_ID, true);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0].items.map((item) => item.key)).toEqual([MCP_KEY]);
    expect(report.enabled).toEqual([
      { key: SKILL_KEY, kind: 'skill', autoStart: false },
      { key: MCP_KEY, kind: 'mcp', autoStart: true },
    ]);
    expect(report.stayedOff).toEqual([]);
    expect(t.store.get(PACKAGE_ID, SKILL_KEY)).toMatchObject({ enabled: true, status: 'on' });
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: true, status: 'on', autoStart: true });
    expect(t.calls.enable).toEqual(['docs']);
  });

  it('turning the package off turns every enabled connection off', async () => {
    const t = await harness();
    await setPackageEnabled({ registry: t.registry, confirm: approveAll(false) }, PACKAGE_ID, true);

    const report = await setPackageEnabled({ registry: t.registry }, PACKAGE_ID, false);

    expect(report.enabled).toEqual([]);
    expect(report.stayedOff.map((item) => item.key).toSorted()).toEqual([MCP_KEY, SKILL_KEY].toSorted());
    expect(t.store.get(PACKAGE_ID, SKILL_KEY)).toMatchObject({ enabled: false, status: 'off' });
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: false, status: 'off' });
    expect(t.calls.disable).toEqual(['docs']);
  });

  it('a cancelled confirmation keeps every code-running connection off, with the reason, and data stays on', async () => {
    const t = await harness();
    const confirm = vi.fn<InstallActivationConfirm>(async () => ({ approved: false, autoStart: true }));

    const report = await setPackageEnabled({ registry: t.registry, confirm }, PACKAGE_ID, true);

    expect(report.enabled.map((item) => item.key)).toEqual([SKILL_KEY]);
    expect(report.stayedOff).toEqual([{ key: MCP_KEY, reason: NOT_APPROVED }]);
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: false, status: 'off' });
    expect(t.calls.enable).toEqual([]);
  });

  it('without a confirmation window, code-running connections stay off', async () => {
    const t = await harness();

    const report = await setPackageEnabled({ registry: t.registry }, PACKAGE_ID, true);

    expect(report.enabled.map((item) => item.key)).toEqual([SKILL_KEY]);
    expect(report.stayedOff.map((item) => item.key)).toEqual([MCP_KEY]);
    expect(t.calls.enable).toEqual([]);
  });

  it('a package whose signing key was revoked: code-running connections are refused, data still switches on', async () => {
    const t = await harness({ revoked: true });
    const confirm = approveAll(true);

    const report = await setPackageEnabled({ registry: t.registry, confirm }, PACKAGE_ID, true);

    expect(confirm).not.toHaveBeenCalled();
    expect(report.enabled.map((item) => item.key)).toEqual([SKILL_KEY]);
    expect(report.stayedOff).toEqual([
      expect.objectContaining({ key: MCP_KEY, reason: expect.stringContaining(REVOKED) }),
    ]);
    expect(t.calls.enable).toEqual([]);
  });

  it('the registry itself refuses to enable revoked code, even when called with a hash', async () => {
    const t = await harness({ revoked: true });
    const { approvalHash } = await t.registry.describe(PACKAGE_ID, MCP_KEY);

    await expect(t.registry.enable(PACKAGE_ID, MCP_KEY, approvalHash)).rejects.toThrow(REVOKED);
    expect(t.calls.enable).toEqual([]);
  });

  it('content that changes while the confirmation is open is not started: the approval is checked again', async () => {
    const t = await harness();
    const confirm = vi.fn<InstallActivationConfirm>(async () => {
      // Something rewrites the connection after the person was shown the first version.
      t.world.loaded = {
        ...t.world.loaded,
        adapter: parseAdapterDocument({
          schemaVersion: 1,
          generatedBy: 'classifier',
          connections: [skillConnection, { ...mcpConnection, url: 'https://evil.example.com/mcp' }],
        }),
      };
      return { approved: true, autoStart: true };
    });

    const report = await setPackageEnabled({ registry: t.registry, confirm }, PACKAGE_ID, true);

    expect(report.enabled.map((item) => item.key)).toEqual([SKILL_KEY]);
    expect(report.stayedOff).toEqual([
      expect.objectContaining({ key: MCP_KEY, reason: expect.stringContaining('review it again') }),
    ]);
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: false });
    expect(t.calls.enable).toEqual([]);
  });

  it('two alternatives of one group: only the first is offered, the other stays off with the group reason', async () => {
    const t = await harness({ alternative: true });
    const confirm = approveAll(false);

    const report = await setPackageEnabled({ registry: t.registry, confirm }, PACKAGE_ID, true);

    expect(confirm.mock.calls[0]?.[0].items.map((item) => item.key)).toEqual([MCP_KEY]);
    expect(report.enabled.map((item) => item.key)).toEqual([SKILL_KEY, MCP_KEY]);
    expect(report.stayedOff).toEqual([{ key: ALT_KEY, reason: expect.stringContaining('nhóm "docs"') }]);
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: true });
    expect(t.store.get(PACKAGE_ID, ALT_KEY)).toMatchObject({ enabled: false });
  });

  it('a connection whose required value is still missing is never offered and stays off with its reason', async () => {
    const t = await harness({ missingEnv: true });
    const confirm = approveAll(false);

    const report = await setPackageEnabled({ registry: t.registry, confirm }, PACKAGE_ID, true);

    expect(confirm).not.toHaveBeenCalled();
    expect(report.stayedOff).toEqual([{ key: MCP_KEY, reason: 'Cần nhập biến môi trường: DOCS_TOKEN' }]);
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: false, status: 'needs-input' });
  });

  it('a connection whose host fails to stop is reported with the failure, and the others still turn off', async () => {
    const t = await harness({ failDisable: true });
    await setPackageEnabled({ registry: t.registry, confirm: approveAll(false) }, PACKAGE_ID, true);

    const report = await setPackageEnabled({ registry: t.registry }, PACKAGE_ID, false);

    expect(report.stayedOff).toContainEqual({ key: MCP_KEY, reason: 'stop failed' });
    expect(t.store.get(PACKAGE_ID, SKILL_KEY)).toMatchObject({ enabled: false });
  });
});
