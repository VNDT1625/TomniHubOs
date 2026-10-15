/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { createPackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import { buildTomnyPackageFromRepo } from '@process/extensions/package-manager/repoPackaging/packager';
import {
  createConnectionRegistry,
  type ConnectionView,
  type LoadedPackage,
} from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { defineConnectionHost } from '@process/integrations/connections/core/types';
import {
  activateInstalledConnections,
  type InstallActivationConfirm,
} from '@process/integrations/connections/wiring/installActivation';
import { installLocalBuiltArtifact } from '@process/integrations/connections/wiring/localInstall';
import { createConnectionRuntime } from '@process/integrations/connections/wiring/connectionRuntime';
import { createLocalSigningKeys, localKeyDirectory } from '@process/integrations/connections/wiring/localKeys';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-activation-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

const PACKAGE_ID = 'com.community.sample';
const SKILL_KEY = 'skill:source/skills/a';
const MCP_KEY = 'mcp:docs';
const NOT_APPROVED = 'Bạn chưa duyệt, kết nối vẫn tắt. Có thể bật từng cái trong chi tiết gói.';
const NO_CONFIRMATION = 'Máy này chưa có hộp xác nhận, kết nối vẫn tắt. Có thể bật trong chi tiết gói.';

const skillConnection = { kind: 'skill', path: 'source/skills/a' };
const mcpConnection = {
  kind: 'mcp',
  id: 'docs',
  title: 'docs',
  transport: 'http',
  url: 'https://docs.example.com/mcp',
};
const cliConnection = { kind: 'cli', id: 'tool', title: 'Tool', command: 'tool', display: 'terminal' };

/** Fake hosts: a data kind (skill) and a code-running kind (mcp), both recording what they were asked to do. */
const fakeHosts = (calls: { enable: string[] }) => [
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
    disable: async () => undefined,
  }),
];

type Harness = {
  world: { loaded: LoadedPackage };
  registry: ReturnType<typeof createConnectionRegistry>;
  store: Awaited<ReturnType<typeof createJsonConnectionStateStore>>;
  calls: { enable: string[] };
  views: () => Promise<readonly ConnectionView[]>;
};

/** A package on disk with a skill, an mcp connection that needs a value (optional), and a cli that has no host. */
const harness = async (options: { missingEnv?: boolean; withCli?: boolean } = {}): Promise<Harness> => {
  const dir = await temp();
  await mkdir(path.join(dir, 'source', 'skills', 'a'), { recursive: true });
  await writeFile(path.join(dir, 'source', 'skills', 'a', 'SKILL.md'), '# a');
  const connections = [skillConnection, mcpConnection, ...(options.withCli ? [cliConnection] : [])];
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
    } as LoadedPackage,
  };
  const calls = { enable: [] as string[] };
  const store = createJsonConnectionStateStore(path.join(dir, 'connections.json'));
  await store.initialize();
  const registry = createConnectionRegistry({
    store,
    hosts: fakeHosts(calls),
    loadPackage: async (id) => (id === PACKAGE_ID ? world.loaded : undefined),
    listInstalledPackageIds: async () => [PACKAGE_ID],
    missingRequiredEnv: async (_id, names) => (options.missingEnv ? names : []),
    now: () => 1_000,
  });
  return {
    world,
    registry,
    store,
    calls,
    views: () => registry.view(PACKAGE_ID),
  };
};

describe('activating the connections of a fresh install', () => {
  it('switches data kinds on without asking, and offers code-running kinds in one confirmation', async () => {
    const t = await harness();
    const views = await t.registry.syncPackage(PACKAGE_ID);
    const confirm = vi.fn<InstallActivationConfirm>(async () => ({ approved: true, autoStart: true }));

    const report = await activateInstalledConnections({ registry: t.registry, confirm }, PACKAGE_ID, views);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0].items.map((item) => item.key)).toEqual([MCP_KEY]);
    expect(report.enabled).toEqual([
      { key: SKILL_KEY, kind: 'skill', autoStart: false },
      { key: MCP_KEY, kind: 'mcp', autoStart: true },
    ]);
    expect(report.stayedOff).toEqual([]);
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: true, status: 'on', autoStart: true });
    expect(t.store.get(PACKAGE_ID, SKILL_KEY)).toMatchObject({ enabled: true, status: 'on' });
    expect(t.calls.enable).toEqual(['docs']);
  });

  it('a cancelled confirmation leaves every code-running connection off, with the reason, and keeps data on', async () => {
    const t = await harness();
    const views = await t.registry.syncPackage(PACKAGE_ID);
    const confirm = vi.fn<InstallActivationConfirm>(async () => ({ approved: false, autoStart: true }));

    const report = await activateInstalledConnections({ registry: t.registry, confirm }, PACKAGE_ID, views);

    expect(report.enabled.map((item) => item.key)).toEqual([SKILL_KEY]);
    expect(report.stayedOff).toEqual([{ key: MCP_KEY, reason: NOT_APPROVED }]);
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: false, status: 'off' });
    expect(t.calls.enable).toEqual([]);
  });

  it('without a confirmation window, code-running connections stay off with the reason', async () => {
    const t = await harness();
    const views = await t.registry.syncPackage(PACKAGE_ID);

    const report = await activateInstalledConnections({ registry: t.registry }, PACKAGE_ID, views);

    expect(report.enabled.map((item) => item.key)).toEqual([SKILL_KEY]);
    expect(report.stayedOff).toEqual([{ key: MCP_KEY, reason: NO_CONFIRMATION }]);
  });

  it('a connection whose required value is still missing is never offered and stays off with its reason', async () => {
    const t = await harness({ missingEnv: true });
    const views = await t.registry.syncPackage(PACKAGE_ID);
    const confirm = vi.fn<InstallActivationConfirm>(async () => ({ approved: true, autoStart: false }));

    const report = await activateInstalledConnections({ registry: t.registry, confirm }, PACKAGE_ID, views);

    expect(confirm).not.toHaveBeenCalled();
    expect(report.stayedOff).toEqual([{ key: MCP_KEY, reason: 'Cần nhập biến môi trường: DOCS_TOKEN' }]);
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: false, status: 'needs-input' });
  });

  it('a connection with no host is reported as unsupported and is not offered', async () => {
    const t = await harness({ withCli: true });
    const views = await t.registry.syncPackage(PACKAGE_ID);
    const confirm = vi.fn<InstallActivationConfirm>(async () => ({ approved: true, autoStart: false }));

    const report = await activateInstalledConnections({ registry: t.registry, confirm }, PACKAGE_ID, views);

    expect(report.stayedOff.map((item) => item.key)).toContain('cli:tool');
    expect(confirm.mock.calls.flatMap((call) => call[0].items.map((item) => item.key))).not.toContain('cli:tool');
  });

  it('content that changes while the confirmation is open is not started: the approval is checked again', async () => {
    const t = await harness();
    const views = await t.registry.syncPackage(PACKAGE_ID);
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

    const report = await activateInstalledConnections({ registry: t.registry, confirm }, PACKAGE_ID, views);

    expect(report.enabled.map((item) => item.key)).toEqual([SKILL_KEY]);
    expect(report.stayedOff).toEqual([
      expect.objectContaining({ key: MCP_KEY, reason: expect.stringContaining('review it again') }),
    ]);
    expect(t.store.get(PACKAGE_ID, MCP_KEY)).toMatchObject({ enabled: false });
    expect(t.calls.enable).toEqual([]);
  });
});

/** Runtime with the fake hosts only, over a real package built by the packager and installed by the package manager. */
const installHarness = async (userData: string) => {
  const rootDir = path.join(userData, 'tomny-packages');
  const keys = createLocalSigningKeys(localKeyDirectory(userData), () => ({
    directory: localKeyDirectory(userData),
  }));
  const packages = createPackageManagerService({
    rootDir,
    appVersion: '1.2.0',
    catalog: [],
    catalogLoader: async () => [],
    isPackageSandboxActive: () => false,
    reservePackageSandboxMutation: () => ({ release: () => undefined }),
    localTrustedKeys: keys.trustedKeys,
  });
  await packages.initialize();
  const calls = { enable: [] as string[] };
  const runtime = createConnectionRuntime({
    stateFile: path.join(userData, 'connections.json'),
    packagesRoot: rootDir,
    packages,
    builtinHosts: fakeHosts(calls),
    log: () => undefined,
  });
  await runtime.start();
  return { keys, packages, runtime, calls };
};

const buildPackage = async (userData: string) => {
  const repo = path.join(userData, 'repo', 'mixed');
  await mkdir(path.join(repo, 'skills', 'a'), { recursive: true });
  await writeFile(path.join(repo, 'skills', 'a', 'SKILL.md'), '---\nname: a\ndescription: Does a\n---\n\n# A\n');
  await writeFile(path.join(repo, 'README.md'), '# demo');
  await writeFile(
    path.join(repo, '.mcp.json'),
    JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-mcp@1.0.0'] } } })
  );
  return buildTomnyPackageFromRepo({
    source: '',
    workspaceRoot: repo,
    outputDirectory: path.join(userData, 'exports'),
    signing: { keyDirectory: localKeyDirectory(userData) },
  });
};

describe('installing a package built on this machine with activation', () => {
  it('turns on the data connections and, once approved, the code-running ones, and says so in the outcome', async () => {
    const userData = await temp();
    const app = await installHarness(userData);
    const built = await buildPackage(userData);
    const confirm = vi.fn<InstallActivationConfirm>(async () => ({ approved: true, autoStart: true }));

    const outcome = await installLocalBuiltArtifact(
      { keys: app.keys, packages: app.packages, registry: app.runtime.registry, activation: { confirm } },
      built.artifactPath
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    const enabled = outcome.activation?.enabled.map((item) => item.key) ?? [];
    expect(enabled).toEqual(expect.arrayContaining(['skill:source/skills/a', 'mcp:docs']));
    expect(outcome.connections.every((connection) => connection.status === 'on')).toBe(true);
    const mcp = (await app.runtime.registry.view(outcome.packageId)).find((view) => view.key === 'mcp:docs');
    expect(mcp?.state).toMatchObject({ enabled: true, autoStart: true });
    expect(app.calls.enable).toEqual(['docs']);
  });

  it('a refused confirmation keeps the code-running connections off and reports them', async () => {
    const userData = await temp();
    const app = await installHarness(userData);
    const built = await buildPackage(userData);
    const confirm = vi.fn<InstallActivationConfirm>(async () => ({ approved: false, autoStart: false }));

    const outcome = await installLocalBuiltArtifact(
      { keys: app.keys, packages: app.packages, registry: app.runtime.registry, activation: { confirm } },
      built.artifactPath
    );

    expect(outcome.activation?.enabled.map((item) => item.key)).toEqual(['skill:source/skills/a']);
    expect(outcome.activation?.stayedOff).toEqual([{ key: 'mcp:docs', reason: NOT_APPROVED }]);
    expect(app.calls.enable).toEqual([]);
  });

  it('an install that does not ask for activation (an update) switches nothing on', async () => {
    const userData = await temp();
    const app = await installHarness(userData);
    const built = await buildPackage(userData);

    const outcome = await installLocalBuiltArtifact(
      { keys: app.keys, packages: app.packages, registry: app.runtime.registry },
      built.artifactPath
    );

    expect(outcome.activation).toBeUndefined();
    expect(outcome.connections.every((connection) => connection.status === 'off')).toBe(true);
  });
});
