import { describe, expect, it } from 'vitest';
import type { IMcpServer } from '../../../packages/desktop/src/common/config/storage';
import { McpRegistry } from '../../../packages/desktop/src/process/resources/mcpRegistry/mcpRegistry';
import {
  packageConnectionMcpId,
  removePackageConnectionMcp,
  syncPackageMcpServers,
  upsertPackageConnectionMcp,
} from '../../../packages/desktop/src/process/resources/mcpRegistry/packageMcpSync';

/*
 * The package com.community.context-mode declares one legacy MCP server (npx context-mode@1.0.169, titled
 * "Context Mode") and two MCP connections (node start.mjs in source/ and in source/.codex-plugin). A connection and the
 * legacy entry differ in launch and in name case, so only one of them may remain in the catalog.
 */
const PACKAGE_ID = 'com.community.context-mode';
const LEGACY_ID = `package:${PACKAGE_ID}/context-mode`;

const createRegistry = (): McpRegistry => {
  let stored: IMcpServer[] = [];
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

const legacyContribution = {
  id: 'context-mode',
  title: 'Context Mode',
  command: 'npx',
  args: ['-y', 'context-mode@1.0.169'],
  key: `${PACKAGE_ID}/context-mode`,
  packageId: PACKAGE_ID,
  packageVersion: '1.0.169',
};

const sourceConnection = {
  packageId: PACKAGE_ID,
  packageVersion: '1.0.169',
  connectionId: 'context-mode-source',
  title: 'context-mode',
  transport: { type: 'stdio' as const, command: 'node', args: ['start.mjs'], cwd: 'source' },
};

const codexConnection = {
  packageId: PACKAGE_ID,
  packageVersion: '1.0.169',
  connectionId: 'context-mode-source-2',
  title: 'context-mode',
  transport: { type: 'stdio' as const, command: 'node', args: ['start.mjs'], cwd: 'source/.codex-plugin' },
};

const idsOf = async (registry: McpRegistry): Promise<string[]> =>
  (await registry.list()).map((server) => server.id).toSorted();

describe('one Context Mode server when the legacy entry and a connection of the same package exist', () => {
  it('removes the legacy entry when the first connection is enabled', async () => {
    const registry = createRegistry();
    await syncPackageMcpServers(registry, { mcpServers: [legacyContribution] });
    expect(await idsOf(registry)).toEqual([LEGACY_ID]);

    await upsertPackageConnectionMcp(registry, sourceConnection);
    expect(await idsOf(registry)).toEqual([packageConnectionMcpId(PACKAGE_ID, 'context-mode-source')]);
  });

  it('does not mirror the legacy entry again while a connection of the package runs it', async () => {
    const registry = createRegistry();
    await upsertPackageConnectionMcp(registry, sourceConnection);
    const result = await syncPackageMcpServers(registry, { mcpServers: [legacyContribution] });
    expect(result.added).toEqual([]);
    expect(await idsOf(registry)).toEqual([packageConnectionMcpId(PACKAGE_ID, 'context-mode-source')]);
  });

  it('keeps the legacy entry out when the second connection of the package is enabled as well', async () => {
    const registry = createRegistry();
    await upsertPackageConnectionMcp(registry, sourceConnection);
    await upsertPackageConnectionMcp(registry, codexConnection);
    const servers = await registry.list();
    expect(servers.some((server) => server.id === LEGACY_ID)).toBe(false);
    expect(servers.map((server) => server.id).toSorted()).toEqual(
      [
        packageConnectionMcpId(PACKAGE_ID, 'context-mode-source'),
        packageConnectionMcpId(PACKAGE_ID, 'context-mode-source-2'),
      ].toSorted()
    );
  });

  it('brings the legacy entry back once every connection of the package is switched off', async () => {
    const registry = createRegistry();
    await upsertPackageConnectionMcp(registry, sourceConnection);
    await removePackageConnectionMcp(registry, [packageConnectionMcpId(PACKAGE_ID, 'context-mode-source')]);
    const result = await syncPackageMcpServers(registry, { mcpServers: [legacyContribution] });
    expect(result.added).toEqual([LEGACY_ID]);
    expect(await idsOf(registry)).toEqual([LEGACY_ID]);
  });

  it('leaves the legacy entry of another package with the same name alone', async () => {
    const registry = createRegistry();
    const other = { ...legacyContribution, packageId: 'com.community.other', key: 'com.community.other/context-mode' };
    await syncPackageMcpServers(registry, { mcpServers: [other] });
    await upsertPackageConnectionMcp(registry, sourceConnection);
    expect(await idsOf(registry)).toEqual(
      ['package:com.community.other/context-mode', packageConnectionMcpId(PACKAGE_ID, 'context-mode-source')].toSorted()
    );
  });
});
