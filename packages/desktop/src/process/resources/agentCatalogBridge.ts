import path from 'node:path';
import { app } from 'electron';
import { assistantChannels } from '@/common/types/agent/assistantChannels';
import { agentChannels } from '@/common/types/agent/agentChannels';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { AgentMetadata } from '@/common/types/agent/agentMetadata';

import { fetchProviderModelList } from '@process/services/tomnyModelDiscovery';
import { getReadyProviderStore } from '@process/services/tomnyProviderBridge';
import { readLegacyCatalog } from '@process/services/database/legacyCatalogReader';
import { discoverLegacyDatabasePaths } from '@process/services/database/runLegacyDatabaseMigrations';
import { ProcessConfig } from '@process/utils/initStorage';
import { createAssistantCatalogStore } from './assistantCatalogStore';
import { createAgentCatalogStore } from './agentCatalogStore';

const root = (): string => path.join(app.getPath('userData'), 'tomny-core');
type AssistantCatalogStore = ReturnType<typeof createAssistantCatalogStore>;
type AgentCatalogStore = ReturnType<typeof createAgentCatalogStore>;
let assistants: AssistantCatalogStore | undefined;
let agents: AgentCatalogStore | undefined;
const getAssistants = (): AssistantCatalogStore =>
  (assistants ??= createAssistantCatalogStore(path.join(root(), 'getAssistants().json')));
const getAgents = (): AgentCatalogStore => (agents ??= createAgentCatalogStore(path.join(root(), 'getAgents().json')));
let assistantMigration: Promise<void> | undefined;
let agentMigration: Promise<void> | undefined;
let legacyCatalog: ReturnType<typeof readLegacyCatalog> | undefined;
let registered = false;

const readLegacy = () => {
  legacyCatalog ??= readLegacyCatalog({
    databasePaths: discoverLegacyDatabasePaths(),
    readConfig: (key) => (ProcessConfig as unknown as { get(name: string): Promise<unknown> }).get(key),
  });
  return legacyCatalog;
};

const migrateAssistants = async (): Promise<void> => {
  if ((await getAssistants().list()).length > 0) return;
  await getAssistants().importExisting((await readLegacy()).assistants);
};
const readyAssistants = async (): Promise<void> => {
  assistantMigration ??= migrateAssistants().catch((error) => {
    assistantMigration = undefined;
    console.warn('[TomnyAssistantCatalog] compatibility import deferred:', error);
  });
  await assistantMigration;
};
const migrateAgents = async (): Promise<void> => {
  await getAgents().importLegacy((await readLegacy()).agents);
};
const readyAgents = async (): Promise<void> => {
  agentMigration ??= migrateAgents().catch((error) => {
    agentMigration = undefined;
    console.warn('[TomnyAgentCatalog] compatibility import deferred:', error);
  });
  await agentMigration;
};

export const listReadyAssistants = async (): Promise<Assistant[]> => {
  await readyAssistants();
  return getAssistants().list();
};
export const listReadyAgents = async (): Promise<AgentMetadata[]> => {
  await readyAgents();
  return getAgents().list();
};
export const createNativeAssistant = (input: Parameters<AssistantCatalogStore['create']>[0]): Promise<Assistant> =>
  getAssistants().create(input);

export const registerAgentCatalogBridge = (): void => {
  if (registered) return;
  registered = true;
  assistantChannels.list.provider(async () => {
    await readyAssistants();
    return getAssistants().list();
  });
  assistantChannels.create.provider((input) => getAssistants().create(input));
  assistantChannels.update.provider((input) => getAssistants().update(input));
  assistantChannels.delete.provider(({ id }) => getAssistants().remove(id));
  assistantChannels.setState.provider((input) => getAssistants().setState(input));
  assistantChannels.import.provider(({ assistants: rows }) => getAssistants().importMany(rows));

  agentChannels.getAvailableAgents.provider(async () => {
    await readyAgents();
    return getAgents().list();
  });
  agentChannels.refreshCustomAgents.provider(async () => {
    await readyAgents();
    await getAgents().refresh();
  });
  agentChannels.testCustomAgent.provider((input) => getAgents().test(input));
  agentChannels.createCustomAgent.provider((input) => getAgents().create(input));
  agentChannels.updateCustomAgent.provider(({ id, ...input }) => getAgents().update(id, input));
  agentChannels.deleteCustomAgent.provider(async ({ id }) => ({ deleted: await getAgents().remove(id) }));
  agentChannels.setAgentEnabled.provider(({ id, enabled }) => getAgents().setEnabled(id, enabled));
  agentChannels.checkAgentHealth.provider(async ({ backend }) => {
    const started = Date.now();
    const row = (await getAgents().list()).find((item) => item.id === backend || item.backend === backend);
    return row
      ? {
          available: row.available,
          latency: Date.now() - started,
          ...(!row.available ? { error: 'Command was not found.' } : {}),
        }
      : { available: false, latency: Date.now() - started, error: 'Agent was not found.' };
  });
  agentChannels.checkProviderHealth.provider(async (input) => {
    const started = Date.now();
    const provider = await (await getReadyProviderStore()).get(input.provider_id);
    if (!provider) {
      return {
        ...input,
        platform: '',
        status: 'unhealthy',
        elapsed_ms: Date.now() - started,
        message: 'Provider was not found.',
        error_kind: 'not_found',
      };
    }
    try {
      await fetchProviderModelList(provider);
      return { ...input, platform: provider.platform, status: 'healthy', elapsed_ms: Date.now() - started };
    } catch (error) {
      return {
        ...input,
        platform: provider.platform,
        status: 'unhealthy',
        elapsed_ms: Date.now() - started,
        message: error instanceof Error ? error.message : String(error),
        error_kind: 'connection_error',
      };
    }
  });
};

export const resetAgentCatalogBridgeForTests = (options?: {
  assistantStore?: ReturnType<typeof createAssistantCatalogStore>;
  agentStore?: ReturnType<typeof createAgentCatalogStore>;
}): void => {
  registered = false;
  legacyCatalog = undefined;
  assistantMigration = undefined;
  agentMigration = undefined;
  assistants = options?.assistantStore;
  agents = options?.agentStore;
};
