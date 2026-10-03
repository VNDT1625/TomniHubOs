import path from 'node:path';
import { app } from 'electron';
import { assistantChannels } from '@/common/types/agent/assistantChannels';
import { agentChannels } from '@/common/types/agent/agentChannels';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { AgentMetadata } from '@/common/types/agent/agentMetadata';

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
  (assistants ??= createAssistantCatalogStore(path.join(root(), 'assistants.json')));
const getAgents = (): AgentCatalogStore => (agents ??= createAgentCatalogStore(path.join(root(), 'agents.json')));
let assistantMigration: Promise<void> | undefined;
let agentMigration: Promise<void> | undefined;
type LegacyCatalogSnapshot = Awaited<ReturnType<typeof readLegacyCatalog>>;
let legacyCatalog: LegacyCatalogSnapshot | undefined;
let registered = false;

const readLegacy = async (): Promise<LegacyCatalogSnapshot> => {
  if (legacyCatalog) return legacyCatalog;
  try {
    const databasePaths = discoverLegacyDatabasePaths();
    if (databasePaths.length === 0) {
      legacyCatalog = { assistants: [], agents: [], providers: [] };
      return legacyCatalog;
    }
    legacyCatalog = await Promise.race([
      readLegacyCatalog({
        databasePaths,
        readConfig: (key) => (ProcessConfig as unknown as { get(name: string): Promise<unknown> }).get(key),
      }),
      new Promise<LegacyCatalogSnapshot>((resolve) =>
        setTimeout(() => resolve({ assistants: [], agents: [], providers: [] }), 1200)
      ),
    ]);
  } catch (error) {
    console.warn('[TomnyAgentCatalog] legacy database discovery skipped:', error);
    legacyCatalog = { assistants: [], agents: [], providers: [] };
  }
  return legacyCatalog;
};

export const BUILTIN_DEFAULT_ASSISTANTS: Assistant[] = [
  {
    id: 'tomny-assistant',
    source: 'builtin',
    name: 'Tomny General Assistant',
    name_i18n: {
      'en-US': 'Tomny General Assistant',
      'vi-VN': 'Trợ lý Tổng hợp Tomny',
      'zh-CN': 'Tomny 通用助手',
    },
    description: 'General-purpose intelligent assistant for planning, coding, and day-to-day tasks.',
    description_i18n: {
      'en-US': 'General-purpose intelligent assistant for planning, coding, and day-to-day tasks.',
      'vi-VN': 'Trợ lý thông minh tổng hợp hỗ trợ lập kế hoạch, viết mã và xử lý công việc hàng ngày.',
      'zh-CN': '通用智能助手，用于规划、编程和日常任务。',
    },
    avatar: '🤖',
    enabled: true,
    sort_order: 1,
    preset_agent_type: 'tomnyagentic',
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
  },
  {
    id: 'code-pro',
    source: 'builtin',
    name: 'Code Architect & Engineer',
    name_i18n: {
      'en-US': 'Code Architect & Engineer',
      'vi-VN': 'Kỹ sư & Kiến trúc sư Phần mềm',
      'zh-CN': '代码架构师与工程师',
    },
    description: 'Expert coding assistant for debugging, refactoring, code review, and full-stack development.',
    description_i18n: {
      'en-US': 'Expert coding assistant for debugging, refactoring, code review, and full-stack development.',
      'vi-VN': 'Trợ lý lập trình chuyên sâu hỗ trợ gỡ lỗi, tái cấu trúc, duyệt mã và phát triển full-stack.',
      'zh-CN': '专家级编程助手，用于调试、重构、代码审查和全栈开发。',
    },
    avatar: '⚡',
    enabled: true,
    sort_order: 2,
    preset_agent_type: 'tomnyagentic',
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
  },
  {
    id: 'cowork',
    source: 'builtin',
    name: 'Cowork Team Leader',
    name_i18n: {
      'en-US': 'Cowork Team Leader',
      'vi-VN': 'Trợ lý Điều phối Nhóm (Cowork)',
      'zh-CN': '协同团队主管',
    },
    description: 'Coordinates multi-agent workflows, task delegation, and cross-team collaboration.',
    description_i18n: {
      'en-US': 'Coordinates multi-agent workflows, task delegation, and cross-team collaboration.',
      'vi-VN': 'Điều phối luồng công việc đa agent, phân chia tác vụ và cộng tác nhóm.',
      'zh-CN': '协调多智能体工作流程、任务委派和跨团队协作。',
    },
    avatar: '👥',
    enabled: true,
    sort_order: 3,
    preset_agent_type: 'tomnyagentic',
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
  },
];

const migrateAssistants = async (): Promise<void> => {
  const current = await getAssistants().list();
  if (current.length === 0) {
    await getAssistants().importExisting(BUILTIN_DEFAULT_ASSISTANTS);
  }
  try {
    const legacy = (await readLegacy()).assistants;
    if (legacy.length > 0) {
      await getAssistants().importExisting(legacy);
    }
  } catch (error) {
    console.warn('[TomnyAssistantCatalog] legacy assistant import skipped:', error);
  }
};
const readyAssistants = async (): Promise<void> => {
  assistantMigration ??= migrateAssistants().catch((error) => {
    assistantMigration = undefined;
    console.warn('[TomnyAssistantCatalog] compatibility import deferred:', error);
  });
  await Promise.race([assistantMigration, new Promise<void>((resolve) => setTimeout(resolve, 300))]);
};
const migrateAgents = async (): Promise<void> => {
  try {
    const legacy = (await readLegacy()).agents;
    if (legacy.length > 0) {
      await getAgents().importLegacy(legacy);
    }
  } catch (error) {
    console.warn('[TomnyAgentCatalog] legacy agent import skipped:', error);
  }
};
const readyAgents = async (): Promise<void> => {
  agentMigration ??= migrateAgents().catch((error) => {
    agentMigration = undefined;
    console.warn('[TomnyAgentCatalog] compatibility import deferred:', error);
  });
  await Promise.race([agentMigration, new Promise<void>((resolve) => setTimeout(resolve, 300))]);
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
  void readyAssistants();
  void readyAgents();
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
    try {
      await readyAgents();
      return await getAgents().list();
    } catch (error) {
      console.error('[TomnyAgentCatalog] getAvailableAgents failed:', error);
      return [];
    }
  });
  agentChannels.refreshCustomAgents.provider(async () => {
    try {
      await readyAgents();
      await getAgents().refresh();
    } catch (error) {
      console.error('[TomnyAgentCatalog] refreshCustomAgents failed:', error);
    }
  });
  agentChannels.testCustomAgent.provider(async (input) => {
    try {
      return await getAgents().test(input);
    } catch (error) {
      return { step: 'fail_cli', error: error instanceof Error ? error.message : String(error) };
    }
  });
  agentChannels.createCustomAgent.provider(async (input) => {
    try {
      return await getAgents().create(input);
    } catch (error) {
      console.error('[TomnyAgentCatalog] createCustomAgent failed:', error);
      throw error;
    }
  });
  agentChannels.updateCustomAgent.provider(async ({ id, ...input }) => {
    try {
      return await getAgents().update(id, input);
    } catch (error) {
      console.error('[TomnyAgentCatalog] updateCustomAgent failed:', error);
      throw error;
    }
  });
  agentChannels.deleteCustomAgent.provider(async ({ id }) => {
    try {
      return { deleted: await getAgents().remove(id) };
    } catch (error) {
      console.error('[TomnyAgentCatalog] deleteCustomAgent failed:', error);
      return { deleted: false };
    }
  });
  agentChannels.setAgentEnabled.provider(async ({ id, enabled }) => {
    try {
      return await getAgents().setEnabled(id, enabled);
    } catch (error) {
      console.error('[TomnyAgentCatalog] setAgentEnabled failed:', error);
      throw error;
    }
  });
  agentChannels.checkAgentHealth.provider(async ({ backend }) => {
    const started = Date.now();
    try {
      const row = (await getAgents().list()).find((item) => item.id === backend || item.backend === backend);
      return row
        ? {
            available: row.available,
            latency: Date.now() - started,
            ...(!row.available ? { error: 'Command was not found.' } : {}),
          }
        : { available: false, latency: Date.now() - started, error: 'Agent was not found.' };
    } catch (error) {
      return { available: false, latency: Date.now() - started, error: String(error) };
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
