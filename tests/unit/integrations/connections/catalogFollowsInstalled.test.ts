import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConnectionRegistry } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { createMcpHost } from '@process/integrations/connections/hosts/exec/mcpHost';
import { McpRegistry } from '@process/resources/mcpRegistry/mcpRegistry';
import { packageConnectionMcpId, upsertPackageConnectionMcp } from '@process/resources/mcpRegistry/packageMcpSync';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const INSTALLED = 'community.installed';
const QUARANTINED = 'community.quarantined';

/** Catalog and connection state of two packages: one installed and enabled, one quarantined but still recorded. */
const scenario = async (options: { failRemoval?: boolean } = {}) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tomny-catalog-sync-'));
  dirs.push(dir);
  let entries: Awaited<ReturnType<McpRegistry['list']>> = [];
  const catalog = new McpRegistry({
    get: async () => structuredClone(entries),
    set: async (_key, next) => {
      entries = structuredClone(next);
    },
  });
  const transport = { type: 'streamable_http' as const, url: 'https://service.example.com/mcp' };
  for (const packageId of [INSTALLED, QUARANTINED]) {
    await upsertPackageConnectionMcp(catalog, {
      packageId,
      packageVersion: '1.0.0',
      connectionId: 'mcp-main',
      title: `Server of ${packageId}`,
      transport,
    });
  }
  const store = createJsonConnectionStateStore(path.join(dir, 'connections.json'));
  await store.initialize();
  for (const packageId of [INSTALLED, QUARANTINED]) {
    await store.save({
      packageId,
      packageVersion: '1.0.0',
      connectionKey: 'mcp:mcp-main',
      enabled: true,
      status: 'on',
      approvedAt: 1_000,
      installed: [packageConnectionMcpId(packageId, 'mcp-main')],
    } as never);
  }
  const failingStore = options.failRemoval
    ? {
        ...store,
        removePackage: async (packageId: string): Promise<void> => {
          if (packageId === QUARANTINED) throw new Error('disk busy');
          await store.removePackage(packageId);
        },
      }
    : store;
  const host = createMcpHost({
    registry: async () => catalog,
    secretPort: () => ({ list: async () => [], resolve: async () => ({}) }),
    commandExists: async () => true,
  });
  const registry = createConnectionRegistry({
    store: failingStore as typeof store,
    hosts: [host],
    // Neither package is loadable here: only the installed list decides what is still installed.
    loadPackage: async () => undefined,
    listInstalledPackageIds: async () => [INSTALLED],
  });
  const catalogIds = async () => (await catalog.list()).map((server) => server.id).toSorted();
  return { registry, store, catalogIds };
};

describe('catalog follows the installed packages', () => {
  it('startup reconcile removes the catalog server of a quarantined package and keeps the installed one', async () => {
    const { registry, store, catalogIds } = await scenario();
    expect(await catalogIds()).toEqual(
      [packageConnectionMcpId(INSTALLED, 'mcp-main'), packageConnectionMcpId(QUARANTINED, 'mcp-main')].toSorted()
    );
    await registry.reconcile();
    expect(await catalogIds()).toEqual([packageConnectionMcpId(INSTALLED, 'mcp-main')]);
    expect(store.get(QUARANTINED, 'mcp:mcp-main')).toBeUndefined();
    expect(store.get(INSTALLED, 'mcp:mcp-main')).toBeDefined();
  });

  it('a failing record removal does not stop the catalog cleanup', async () => {
    const { registry, catalogIds } = await scenario({ failRemoval: true });
    await registry.reconcile();
    expect(await catalogIds()).toEqual([packageConnectionMcpId(INSTALLED, 'mcp-main')]);
  });

  it('removing a quarantined package alone takes its catalog server with it (no later reconcile needed)', async () => {
    const { registry, catalogIds } = await scenario();
    await registry.removePackage(QUARANTINED);
    expect(await catalogIds()).toEqual([packageConnectionMcpId(INSTALLED, 'mcp-main')]);
  });
});
