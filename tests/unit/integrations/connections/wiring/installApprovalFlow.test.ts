/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import { defineConnectionHost } from '@process/integrations/connections/core/types';
import { createMcpHost } from '@process/integrations/connections/hosts/exec/mcpHost';
import { createPackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import { buildTomnyPackageFromRepo } from '@process/extensions/package-manager/repoPackaging/packager';
import { createConnectionRuntime } from '@process/integrations/connections/wiring/connectionRuntime';
import type {
  InstallActivationAnswer,
  InstallActivationRequest,
} from '@process/integrations/connections/wiring/installActivation';
import { installLocalBuiltArtifact } from '@process/integrations/connections/wiring/localInstall';
import { installReportLines } from '@process/integrations/connections/wiring/installReport';
import { createLocalSigningKeys, localKeyDirectory } from '@process/integrations/connections/wiring/localKeys';
import { McpRegistry } from '@process/resources/mcpRegistry/mcpRegistry';
import { syncPackageMcpServers } from '@process/resources/mcpRegistry/packageMcpSync';

const roots: string[] = [];
const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-approval-flow-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

const SKILL = '---\nname: demo-skill\ndescription: Does a demo\n---\n\n# Demo\n';
const MCP_KEY = 'mcp:context7';

/** An in-memory MCP catalog, the same store shape the app uses. */
const createCatalog = (): McpRegistry => {
  let stored: IMcpServer[] = [];
  let counter = 0;
  return new McpRegistry(
    {
      get: async () => structuredClone(stored),
      set: async (_key, value) => {
        stored = structuredClone(value);
      },
    },
    () => 1,
    () => `catalog-${++counter}`
  );
};

/** A hook host that only records what would run; the real hook engine is not needed to test the approval. */
const fakeHookHost = () =>
  defineConnectionHost({
    kind: 'hook',
    check: async () => ({ ok: true }),
    describe: async (_context, connection) => ({
      kind: 'hook',
      title: `${connection.event} hook`,
      lines: [
        { label: 'Source', value: 'package' },
        { label: 'Event', value: connection.event },
        { label: 'Command', value: connection.command },
        { label: 'Outgoing network of the hook', value: 'not restricted in this version' },
      ],
      files: [],
    }),
    enable: async () => ({ installed: ['hook'] }),
    disable: async () => undefined,
  });

const fakeSkillHost = () =>
  defineConnectionHost({
    kind: 'skill',
    check: async () => ({ ok: true }),
    describe: async () => ({
      kind: 'skill',
      title: 'demo-skill',
      lines: [{ label: 'Skill', value: 'demo' }],
      files: [],
    }),
    enable: async () => ({ installed: ['skill'] }),
    disable: async () => undefined,
  });

const boot = async (userData: string, catalog: McpRegistry) => {
  const rootDir = path.join(userData, 'tomny-packages');
  const keys = createLocalSigningKeys(localKeyDirectory(userData), () => ({
    directory: localKeyDirectory(userData),
  }));
  const service = createPackageManagerService({
    rootDir,
    appVersion: '1.2.0',
    catalog: [],
    catalogLoader: async () => [],
    isPackageSandboxActive: () => false,
    reservePackageSandboxMutation: () => ({ release: () => undefined }),
    localTrustedKeys: keys.trustedKeys,
  });
  await service.initialize();
  const runtime = createConnectionRuntime({
    stateFile: path.join(userData, 'connections.json'),
    packagesRoot: rootDir,
    packages: service,
    hosts: [
      createMcpHost({
        registry: async () => catalog,
        commandExists: async () => true,
        secretPort: () => ({ list: async () => [] }),
      }),
      fakeHookHost(),
      fakeSkillHost(),
    ],
    log: () => undefined,
  });
  await runtime.start();
  return { keys, service, runtime };
};

/** A plugin-shaped repository with one MCP server, one hook and one skill. */
const buildFixture = async (userData: string) => {
  const repo = path.join(userData, 'repo', 'demo-pack');
  await mkdir(path.join(repo, '.claude-plugin'), { recursive: true });
  await mkdir(path.join(repo, 'hooks'), { recursive: true });
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await mkdir(path.join(repo, 'skills', 'demo'), { recursive: true });
  await writeFile(
    path.join(repo, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'demo-pack', version: '1.0.0', description: 'Demo pack' })
  );
  await writeFile(
    path.join(repo, '.mcp.json'),
    JSON.stringify({ mcpServers: { context7: { command: 'npx', args: ['-y', 'ctx@1.0.0'] } } })
  );
  await writeFile(
    path.join(repo, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/a.js' }] }] },
    })
  );
  await writeFile(path.join(repo, 'scripts', 'a.js'), 'console.log("hook");\n');
  await writeFile(path.join(repo, 'skills', 'demo', 'SKILL.md'), SKILL);
  await writeFile(path.join(repo, 'README.md'), '# demo pack');
  return buildTomnyPackageFromRepo({
    source: '',
    workspaceRoot: repo,
    outputDirectory: path.join(userData, 'exports'),
    signing: { keyDirectory: localKeyDirectory(userData) },
  });
};

/** What the package mirror does after an install: a legacy copy only for packages without an MCP connection. */
const mirrorAfterInstall = async (catalog: McpRegistry, packageId: string, connections: readonly { key: string }[]) => {
  const hasMcp = connections.some((connection) => connection.key.startsWith('mcp:'));
  const owned = new Set(hasMcp ? [packageId] : []);
  await syncPackageMcpServers(
    catalog,
    {
      mcpServers: [
        {
          id: 'context7',
          title: 'context7',
          command: 'npx',
          args: ['-y', 'ctx@1.0.0'],
          key: `${packageId}/context7`,
          packageId,
          packageVersion: '1.0.0',
        },
      ],
    } as never,
    { connectionOwnedPackages: owned }
  );
};

describe('approving the code-running connections of a freshly installed package', () => {
  it('turns on the MCP server, the hook and the skill, with one entry in the catalog and a report that agrees', async () => {
    const userData = await tempRoot();
    const catalog = createCatalog();
    const app = await boot(userData, catalog);
    const built = await buildFixture(userData);
    expect(built.adapter?.connections.map((connection) => connection.kind)).toEqual(
      expect.arrayContaining(['mcp', 'hook', 'skill'])
    );
    const approve: InstallActivationAnswer = { approved: true, autoStart: true };
    const confirm = vi.fn(async (_request: InstallActivationRequest) => approve);

    const outcome = await installLocalBuiltArtifact(
      { keys: app.keys, packages: app.service, registry: app.runtime.registry, activation: { confirm } },
      built.artifactPath
    );

    // One consolidated question, and only for the code-running connections.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0].items.map((item) => item.kind).toSorted()).toEqual(['hook', 'mcp']);
    const hookKey = outcome.connections.find((connection) => connection.key.startsWith('hook:'))?.key ?? '';
    const skillKey = outcome.connections.find((connection) => connection.key.startsWith('skill:'))?.key ?? '';
    const expectedOn = [MCP_KEY, hookKey, skillKey].toSorted();
    const enabledKeys = (outcome.activation?.enabled ?? []).map((item) => item.key);
    expect(enabledKeys.toSorted()).toEqual(expectedOn);
    // The start-again choice applies to the code-running ones; a skill is data and has no such choice.
    const codeKinds = (outcome.activation?.enabled ?? []).filter((item) => item.kind !== 'skill');
    expect(codeKinds.every((item) => item.autoStart)).toBe(true);
    expect(outcome.activation?.stayedOff).toEqual([]);

    // The connection state, the catalog and the report agree.
    const views = await app.runtime.registry.view(outcome.packageId);
    const onKeys = views.filter((view) => view.state.enabled).map((view) => view.key);
    expect(onKeys.toSorted()).toEqual(expectedOn);
    await mirrorAfterInstall(catalog, outcome.packageId, outcome.connections);
    expect((await catalog.list()).map((server) => [server.id, server.enabled])).toEqual([
      [`pkgconn:${outcome.packageId}:context7`, true],
    ]);
    const report = installReportLines({ connections: outcome.connections, activation: outcome.activation }).join('\n');
    expect(report).toContain('Đã bật 3 kết nối');
    expect(report).toContain('MCP (1): `mcp:context7`');
    expect(report).toContain('tự bật khi mở lại ứng dụng');
    expect(report).not.toContain('Còn tắt');
    expect(report).not.toContain('đang tắt');
  });

  it('cancelled: the MCP server and the hook stay off with the reason, the catalog holds nothing for them, and the report says so', async () => {
    const userData = await tempRoot();
    const catalog = createCatalog();
    const app = await boot(userData, catalog);
    const built = await buildFixture(userData);
    const confirm = vi.fn(async (): Promise<InstallActivationAnswer> => ({ approved: false, autoStart: false }));

    const outcome = await installLocalBuiltArtifact(
      { keys: app.keys, packages: app.service, registry: app.runtime.registry, activation: { confirm } },
      built.artifactPath
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    // Data kinds (the skill) switch on without the question; code-running kinds stay off.
    expect(outcome.activation?.enabled.map((item) => item.key)).toEqual([
      outcome.connections.find((c) => c.key.startsWith('skill:'))?.key,
    ]);
    const views = await app.runtime.registry.view(outcome.packageId);
    expect(views.find((view) => view.key === MCP_KEY)?.state.enabled).toBe(false);
    await mirrorAfterInstall(catalog, outcome.packageId, outcome.connections);
    expect(await catalog.list()).toEqual([]);
    const report = installReportLines({ connections: outcome.connections, activation: outcome.activation }).join('\n');
    expect(report).toContain('Đã bật 1 kết nối');
    expect(report).toContain('Còn tắt 2 kết nối');
    expect(report).toContain('MCP (1): `mcp:context7` — Bạn chưa duyệt, kết nối vẫn tắt.');
    expect(report).not.toContain('Cài đặt → MCP (đang tắt)');
  });
});
