import { describe, expect, it } from 'vitest';
import type { IMcpServer } from '../../../packages/desktop/src/common/config/storage';
import { McpRegistry } from '../../../packages/desktop/src/process/resources/mcpRegistry/mcpRegistry';
import {
  isPackageMcpServer,
  legacyPackageMcpOwner,
  packageConnectionMcpId,
  syncPackageMcpServers,
  upsertPackageConnectionMcp,
} from '../../../packages/desktop/src/process/resources/mcpRegistry/packageMcpSync';

const createRegistry = (initial: IMcpServer[] = []): McpRegistry => {
  let stored = structuredClone(initial);
  let counter = 0;
  return new McpRegistry(
    {
      get: () => Promise.resolve(structuredClone(stored)),
      set: (_key, value) => {
        stored = structuredClone(value);
        return Promise.resolve();
      },
    },
    () => 1_000,
    () => `generated-${++counter}`
  );
};

const contribution = (id: string, args: string[] = ['-y', 'docs-mcp@1.0.0'], packageId = 'com.community.docs') => ({
  id,
  title: `Docs ${id}`,
  command: 'npx' as const,
  args,
  key: `${packageId}/${id}`,
  packageId,
  packageVersion: '1.0.0',
});

const userServer = (name: string): IMcpServer => ({
  id: `user-${name}`,
  name,
  enabled: true,
  transport: { type: 'stdio', command: 'node', args: ['mine.js'] },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
});

describe('mirroring package MCP servers into the MCP catalog', () => {
  it('adds a declared server switched off, so nothing runs until the user enables it', async () => {
    const registry = createRegistry();
    const result = await syncPackageMcpServers(registry, { mcpServers: [contribution('docs')] });

    expect(result.added).toEqual(['package:com.community.docs/docs']);
    const [server] = await registry.list();
    expect(server).toMatchObject({
      id: 'package:com.community.docs/docs',
      enabled: false,
      transport: { type: 'stdio', command: 'npx', args: ['-y', 'docs-mcp@1.0.0'] },
    });
    expect(isPackageMcpServer(server)).toBe(true);
  });

  it('keeps the user’s choice when nothing changed, and does not add duplicates', async () => {
    const registry = createRegistry();
    await syncPackageMcpServers(registry, { mcpServers: [contribution('docs')] });
    await registry.toggle('package:com.community.docs/docs');

    const again = await syncPackageMcpServers(registry, { mcpServers: [contribution('docs')] });
    expect(again).toEqual({ added: [], updated: [], removed: [], skipped: [] });
    const servers = await registry.list();
    expect(servers).toHaveLength(1);
    expect(servers[0].enabled).toBe(true);
  });

  it('switches a server off again when an update changes what it launches', async () => {
    const registry = createRegistry();
    await syncPackageMcpServers(registry, { mcpServers: [contribution('docs')] });
    await registry.toggle('package:com.community.docs/docs');

    const result = await syncPackageMcpServers(registry, {
      mcpServers: [contribution('docs', ['-y', 'docs-mcp@2.0.0'])],
    });
    expect(result.updated).toEqual(['package:com.community.docs/docs']);
    const [server] = await registry.list();
    expect(server.enabled).toBe(false);
    expect(server.transport).toMatchObject({ args: ['-y', 'docs-mcp@2.0.0'] });
  });

  it('removes servers of packages that are gone and never touches the user’s own servers', async () => {
    const registry = createRegistry([userServer('mine')]);
    await syncPackageMcpServers(registry, { mcpServers: [contribution('docs'), contribution('wiki')] });
    expect(await registry.list()).toHaveLength(3);

    const result = await syncPackageMcpServers(registry, { mcpServers: [contribution('docs')] });
    expect(result.removed).toEqual(['package:com.community.docs/wiki']);
    const names = (await registry.list()).map((server) => server.name).toSorted();
    expect(names).toEqual(['Docs docs', 'mine']);

    await syncPackageMcpServers(registry, { mcpServers: [] });
    expect((await registry.list()).map((server) => server.name)).toEqual(['mine']);
  });

  it('skips a server whose name a user server already uses, instead of overwriting it', async () => {
    const registry = createRegistry([userServer('Docs docs')]);
    const result = await syncPackageMcpServers(registry, { mcpServers: [contribution('docs')] });
    expect(result.skipped).toEqual(['package:com.community.docs/docs']);
    const [server] = await registry.list();
    expect(server.id).toBe('user-Docs docs');
  });

  it('serializes overlapping syncs so they cannot lose each other’s writes', async () => {
    const registry = createRegistry();
    await Promise.all([
      syncPackageMcpServers(registry, { mcpServers: [contribution('a')] }),
      syncPackageMcpServers(registry, { mcpServers: [contribution('a'), contribution('b')] }),
      syncPackageMcpServers(registry, { mcpServers: [contribution('a'), contribution('b'), contribution('c')] }),
    ]);
    expect((await registry.list()).map((server) => server.id).toSorted()).toEqual([
      'package:com.community.docs/a',
      'package:com.community.docs/b',
      'package:com.community.docs/c',
    ]);
  });
});

describe('a package whose MCP server is a connection gets no legacy catalog copy', () => {
  it('does not mirror the MCP server of a package with an MCP connection, switched off or on', async () => {
    const registry = createRegistry();
    const result = await syncPackageMcpServers(
      registry,
      { mcpServers: [contribution('context7', ['-y', 'ctx@1.0.0'], 'com.community.ctx')] },
      { connectionOwnedPackages: new Set(['com.community.ctx']) }
    );
    expect(result).toEqual({ added: [], updated: [], removed: [], skipped: [] });
    expect(await registry.list()).toEqual([]);
  });

  it('removes a legacy copy left by an earlier install once the package is connection-owned', async () => {
    const registry = createRegistry();
    await syncPackageMcpServers(registry, {
      mcpServers: [contribution('context7', ['-y', 'ctx@1.0.0'], 'com.community.ctx')],
    });
    expect((await registry.list()).map((server) => server.id)).toEqual(['package:com.community.ctx/context7']);
    const after = await syncPackageMcpServers(
      registry,
      { mcpServers: [contribution('context7', ['-y', 'ctx@1.0.0'], 'com.community.ctx')] },
      { connectionOwnedPackages: new Set(['com.community.ctx']) }
    );
    expect(after.removed).toEqual(['package:com.community.ctx/context7']);
    expect(await registry.list()).toEqual([]);
  });

  it('still mirrors packages that have no MCP connection', async () => {
    const registry = createRegistry();
    const result = await syncPackageMcpServers(
      registry,
      { mcpServers: [contribution('docs', ['-y', 'docs-mcp@1.0.0'], 'com.community.plain')] },
      { connectionOwnedPackages: new Set(['com.community.other']) }
    );
    expect(result.added).toEqual(['package:com.community.plain/docs']);
  });
});

describe('one source of truth for an MCP server that a connection runs', () => {
  const connection = {
    packageId: 'com.community.docs',
    packageVersion: '1.0.0',
    connectionId: 'docs',
    title: 'Docs docs',
    transport: { type: 'stdio' as const, command: 'npx', args: ['-y', 'docs-mcp@1.0.0'] },
  };
  const connectionId = packageConnectionMcpId('com.community.docs', 'docs');

  it('does not mirror a legacy launch that an enabled connection of the same package already runs', async () => {
    const registry = createRegistry();
    await upsertPackageConnectionMcp(registry, connection);
    const result = await syncPackageMcpServers(registry, { mcpServers: [contribution('docs')] });
    expect(result.added).toEqual([]);
    expect((await registry.list()).map((server) => server.id)).toEqual([connectionId]);
  });

  it('removes a legacy entry that was mirrored before the connection was enabled', async () => {
    const registry = createRegistry();
    await syncPackageMcpServers(registry, { mcpServers: [contribution('docs')] });
    await upsertPackageConnectionMcp(registry, connection);
    expect((await registry.list()).map((server) => server.id)).toEqual([connectionId]);
  });

  it('keeps the legacy entry of another package that happens to use the same launch', async () => {
    const registry = createRegistry();
    await syncPackageMcpServers(registry, { mcpServers: [contribution('docs', undefined, 'com.community.other')] });
    await upsertPackageConnectionMcp(registry, connection);
    expect((await registry.list()).map((server) => server.id).toSorted()).toEqual(
      ['package:com.community.other/docs', connectionId].toSorted()
    );
  });

  it('reads the package of a legacy id and nothing from other ids', () => {
    expect(legacyPackageMcpOwner('package:com.community.docs/docs')).toBe('com.community.docs');
    expect(legacyPackageMcpOwner(connectionId)).toBeUndefined();
    expect(legacyPackageMcpOwner('user-docs')).toBeUndefined();
  });
});
