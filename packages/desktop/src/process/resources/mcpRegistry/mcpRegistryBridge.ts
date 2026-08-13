import { bridge } from '@office-ai/platform';
import type { IMcpServer } from '@/common/config/storage';
import { discoverLegacyDatabasePaths } from '@process/services/database/runLegacyDatabaseMigrations';
import { ProcessConfig } from '@process/utils/initStorage';
import { ExtensionMcpContributionSource } from './extensionMcpSource';
import { readLegacyMcpSources } from './legacyMcpImport';
import { McpRegistry, type McpServerDraft, type McpServerImport } from './mcpRegistry';

export const MCP_REGISTRY_CHANNELS = {
  list: 'mcp-registry.list',
  extensionList: 'mcp-registry.extension-list',
  create: 'mcp-registry.create',
  import: 'mcp-registry.import',
  update: 'mcp-registry.update',
  remove: 'mcp-registry.remove',
  toggle: 'mcp-registry.toggle',
} as const;

export const mcpRegistryChannels = {
  list: bridge.buildProvider<IMcpServer[], void>(MCP_REGISTRY_CHANNELS.list),
  extensionList: bridge.buildProvider<IMcpServer[], void>(MCP_REGISTRY_CHANNELS.extensionList),
  create: bridge.buildProvider<IMcpServer, McpServerDraft>(MCP_REGISTRY_CHANNELS.create),
  import: bridge.buildProvider<IMcpServer[], { servers: McpServerImport[] }>(MCP_REGISTRY_CHANNELS.import),
  update: bridge.buildProvider<IMcpServer, { id: string; data: Partial<McpServerDraft> }>(MCP_REGISTRY_CHANNELS.update),
  remove: bridge.buildProvider<void, { id: string }>(MCP_REGISTRY_CHANNELS.remove),
  toggle: bridge.buildProvider<IMcpServer, { id: string }>(MCP_REGISTRY_CHANNELS.toggle),
};

let registry: McpRegistry | undefined;
let legacyImportPromise: Promise<void> | undefined;

export const getMcpRegistry = (): McpRegistry => {
  registry ??= new McpRegistry(ProcessConfig);
  return registry;
};

export const ensureLegacyMcpImported = (service: McpRegistry = getMcpRegistry()): Promise<void> => {
  legacyImportPromise ??= readLegacyMcpSources({
    databasePaths: discoverLegacyDatabasePaths(),
    readConfig: (key) => ProcessConfig.get(key),
  })
    .then(async (servers) => {
      const imported = await service.importMany(servers);
      if (imported.length > 0) {
        console.info('[Tomny] Imported %d MCP servers from read-only legacy sources.', imported.length);
      }
    })
    .catch((error: unknown) => {
      console.warn('[Tomny] Legacy MCP import was skipped:', error);
    });
  return legacyImportPromise;
};

export const registerMcpRegistryBridge = (
  service: McpRegistry = getMcpRegistry(),
  extensionSource: ExtensionMcpContributionSource = new ExtensionMcpContributionSource()
): void => {
  let ready: Promise<void> | undefined;
  const whenReady = (): Promise<void> => (ready ??= ensureLegacyMcpImported(service));
  mcpRegistryChannels.list.provider(async () => (await whenReady(), service.list()));
  mcpRegistryChannels.extensionList.provider(() => extensionSource.list());
  mcpRegistryChannels.create.provider(async (draft) => (await whenReady(), service.create(draft)));
  mcpRegistryChannels.import.provider(async ({ servers }) => (await whenReady(), service.importMany(servers)));
  mcpRegistryChannels.update.provider(async ({ id, data }) => (await whenReady(), service.update(id, data)));
  mcpRegistryChannels.remove.provider(async ({ id }) => (await whenReady(), service.remove(id)));
  mcpRegistryChannels.toggle.provider(async ({ id }) => (await whenReady(), service.toggle(id)));
};
