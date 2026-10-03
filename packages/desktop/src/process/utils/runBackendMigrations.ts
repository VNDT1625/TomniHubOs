/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { migrateConfigStorage, migrateProviders } from '@/common/config/configMigration';
import { httpRequest } from '@/common/adapter/httpBridge';
import { mcpService } from '@/common/adapter/ipcBridge';
import { removeImageGenerationEnvKeys } from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer } from '@/common/config/storage';
import { getBuiltinMcpScriptPath, type ProcessConfig as ProcessConfigType } from './initStorage';
import { migrateAssistantsToBackend } from './migrateAssistants';

type ConfigFile = typeof ProcessConfigType;
type MigrationStepResult = boolean;
type McpImportServer = Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'>;
const BUILTIN_CHROME_DEVTOOLS_NAME = 'chrome-devtools';

const LEGACY_BACKEND_CLIENT_PREFERENCE_KEYS = [
  'assistants',
  'migration.assistantEnabledFixed',
  'migration.coworkDefaultSkillsAdded',
  'migration.builtinDefaultSkillsAdded_v2',
  'migration.promptsI18nAdded',
  'migration.assistantsSplitCustom',
] as const;

async function cleanupLegacyClientPreferences(): Promise<void> {
  const payloadEntries = LEGACY_BACKEND_CLIENT_PREFERENCE_KEYS.map((key): [string, null] => [key, null]);
  const payload = Object.fromEntries(payloadEntries);
  await httpRequest<void>('PUT', '/api/settings/client', payload);
}

const CLEANUP_STEPS: Array<{
  name: string;
  run: () => Promise<void>;
}> = [{ name: 'cleanupLegacyClientPreferences', run: async () => cleanupLegacyClientPreferences() }];

/**
 * The legacy image MCP accepted provider records and copied their credentials
 * into a stdio child environment. It stays registered for upgrade cleanup, but
 * remains disabled until a Main-owned, governed secret-lease protocol exists.
 */
function buildDisabledBuiltinImageGenerationServer(): McpImportServer {
  const scriptPath = getBuiltinMcpScriptPath('builtin-mcp-image-gen');
  const env: Record<string, string> = {};
  const serverConfig = {
    command: 'node',
    args: [scriptPath],
    env,
  };

  return {
    name: BUILTIN_IMAGE_GEN_NAME,
    description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
    enabled: false,
    builtin: true,
    transport: {
      type: 'stdio',
      command: 'node',
      args: [scriptPath],
      env,
    },
    original_json: JSON.stringify({ mcpServers: { [BUILTIN_IMAGE_GEN_NAME]: serverConfig } }, null, 2),
  };
}

function areStringArraysEqual(left?: string[], right?: string[]): boolean {
  const leftValue = left || [];
  const rightValue = right || [];
  return leftValue.length === rightValue.length && leftValue.every((item, index) => item === rightValue[index]);
}

function areStringRecordsEqual(left?: Record<string, string>, right?: Record<string, string>): boolean {
  const leftValue = left || {};
  const rightValue = right || {};
  const leftKeys = Object.keys(leftValue).toSorted();
  const rightKeys = Object.keys(rightValue).toSorted();
  return areStringArraysEqual(leftKeys, rightKeys) && leftKeys.every((key) => leftValue[key] === rightValue[key]);
}

function isSameStdioTransport(left: IMcpServer['transport'], right: IMcpServer['transport']): boolean {
  return (
    left.type === 'stdio' &&
    right.type === 'stdio' &&
    left.command === right.command &&
    areStringArraysEqual(left.args, right.args) &&
    areStringRecordsEqual(left.env, right.env)
  );
}

function buildDefaultMcpServers(): McpImportServer[] {
  const chromeConfig = {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
  };

  return [
    {
      name: BUILTIN_CHROME_DEVTOOLS_NAME,
      description: 'Default MCP server: chrome-devtools',
      enabled: false,
      builtin: true,
      transport: {
        type: 'stdio',
        command: chromeConfig.command,
        args: chromeConfig.args,
      },
      original_json: JSON.stringify({ mcpServers: { [BUILTIN_CHROME_DEVTOOLS_NAME]: chromeConfig } }, null, 2),
    },
  ];
}

async function isCommandAvailable(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: 3000 }, (error) => {
      if (!error) {
        resolve(true);
        return;
      }

      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        resolve(false);
        return;
      }

      resolve(true);
    });
  });
}

async function ensureBuiltinChromeDevtoolsAvailability(server?: IMcpServer): Promise<void> {
  if (
    !server ||
    server.name !== BUILTIN_CHROME_DEVTOOLS_NAME ||
    server.transport.type !== 'stdio' ||
    server.transport.command !== 'npx'
  ) {
    return;
  }

  const hasNpx = await isCommandAvailable(server.transport.command);
  if (hasNpx) {
    return;
  }

  try {
    await mcpService.testMcpConnection.invoke(server);
  } catch (error) {
    console.warn('[Migration] chrome-devtools MCP preflight failed', error);
  }
}

function buildOriginalJsonFromTransport(server: Pick<IMcpServer, 'name' | 'description' | 'transport'>): string {
  const transport_config =
    server.transport.type === 'stdio'
      ? {
          command: server.transport.command,
          args: server.transport.args || [],
          env: server.transport.env || {},
        }
      : {
          type: server.transport.type,
          url: server.transport.url,
          ...(server.transport.headers ? { headers: server.transport.headers } : {}),
        };

  return JSON.stringify(
    {
      mcpServers: {
        [server.name]: {
          ...(server.description ? { description: server.description } : {}),
          ...transport_config,
        },
      },
    },
    null,
    2
  );
}

async function ensureBootstrapMcpServersInDb(): Promise<void> {
  const existing = await mcpService.listServers.invoke();
  const existingByName = new Map((existing ?? []).map((server) => [server.name, server]));
  const existingImageServer = existingByName.get(BUILTIN_IMAGE_GEN_NAME);
  const imageServer = buildDisabledBuiltinImageGenerationServer();
  const defaultServers = buildDefaultMcpServers();
  const missing = [...defaultServers, imageServer].filter((server) => !existingByName.has(server.name));
  let imageServerUpdated = false;

  if (missing.length > 0) {
    await mcpService.batchImportServers.invoke({ servers: missing });
  }

  const existingChromeDevtools = existingByName.get(BUILTIN_CHROME_DEVTOOLS_NAME);
  if (
    existingChromeDevtools &&
    (existingChromeDevtools.builtin !== true ||
      !existingChromeDevtools.original_json ||
      existingChromeDevtools.original_json.trim() === '' ||
      existingChromeDevtools.original_json.trim() === '{}')
  ) {
    await mcpService.updateServer.invoke({
      id: existingChromeDevtools.id,
      data: {
        builtin: true,
        original_json: buildOriginalJsonFromTransport(existingChromeDevtools),
      },
    });
  }

  const refreshedServers = await mcpService.listServers.invoke();
  const chromeDevtoolsServer = refreshedServers.find((server) => server.name === BUILTIN_CHROME_DEVTOOLS_NAME);
  await ensureBuiltinChromeDevtoolsAvailability(chromeDevtoolsServer);

  if (existingImageServer && imageServer.transport.type === 'stdio') {
    const env =
      existingImageServer.transport.type === 'stdio'
        ? removeImageGenerationEnvKeys(existingImageServer.transport.env || {})
        : {};
    const updatedTransport = {
      ...imageServer.transport,
      env,
    };
    const original_json = JSON.stringify(
      {
        mcpServers: {
          [BUILTIN_IMAGE_GEN_NAME]: {
            command: updatedTransport.command,
            args: updatedTransport.args || [],
            env,
          },
        },
      },
      null,
      2
    );
    const imageTransportChanged = !isSameStdioTransport(existingImageServer.transport, updatedTransport);
    const imageOriginalJsonChanged = existingImageServer.original_json !== original_json;
    const imageEnabledChanged = existingImageServer.enabled !== false;
    const imageServerChanged = imageTransportChanged || imageOriginalJsonChanged || imageEnabledChanged;
    console.info(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      existingImageServer.id,
      imageTransportChanged ? 'yes' : 'no',
      imageOriginalJsonChanged ? 'yes' : 'no',
      imageServerChanged ? 'yes' : 'no'
    );
    if (imageServerChanged) {
      const updatedImageServer = await mcpService.updateServer.invoke({
        id: existingImageServer.id,
        data: {
          transport: updatedTransport,
          original_json,
        },
      });
      if (updatedImageServer.enabled) {
        await mcpService.toggleServer.invoke({ id: updatedImageServer.id });
      }
      imageServerUpdated = true;
    }
  }

  console.info(
    '[Migration] MCP bootstrap completed, imported %d missing defaults, updated image server: %s, provider-backed image MCP: disabled pending governed Main protocol',
    missing.length,
    imageServerUpdated ? 'yes' : 'no'
  );
}

const MIGRATION_STEPS: Array<{
  name: string;
  run: (configFile: ConfigFile) => Promise<MigrationStepResult>;
}> = [
  { name: 'migrateConfigStorage', run: async (configFile) => (await migrateConfigStorage(configFile), true) },
  { name: 'migrateProviders', run: async (configFile) => (await migrateProviders(configFile), true) },
  {
    name: 'ensureBootstrapMcpServersInDb',
    run: async () => (await ensureBootstrapMcpServersInDb(), true),
  },
  {
    name: 'ensureCronMcpRegistered',
    run: async () => {
      const { ensureCronMcpRegistered } = await import('@process/cron/registerCronMcp');
      return ensureCronMcpRegistered();
    },
  },
  {
    name: 'ensureManagerMcpRegistered',
    run: async () => {
      const { ensureManagerMcpRegistered } = await import('@process/manager/registerManagerMcp');
      return ensureManagerMcpRegistered();
    },
  },
  {
    name: 'ensureSystemInfoMcpRegistered',
    run: async () => {
      const { ensureSystemInfoMcpRegistered } = await import('@process/system/registerSystemInfoMcp');
      return ensureSystemInfoMcpRegistered();
    },
  },
  {
    name: 'ensureAutomationMcpRegistered',
    run: async () => {
      const { ensureAutomationMcpRegistered } = await import('@process/automation/registerAutomationMcp');
      return ensureAutomationMcpRegistered();
    },
  },
  {
    name: 'ensureRealtimeKnowledgeMcpRegistered',
    run: async () => {
      const { ensureRealtimeKnowledgeMcpRegistered } = await import('@process/knowledge/registerRealtimeKnowledgeMcp');
      return ensureRealtimeKnowledgeMcpRegistered();
    },
  },
  { name: 'migrateAssistantsToBackend', run: async (configFile) => migrateAssistantsToBackend(configFile) },
  {
    name: 'ensureBootstrapAgents',
    run: async () => ensureBootstrapAgents(),
  },
];

type BootstrapAgentEntry = {
  name: string;
  command: string;
  args?: string[];
  icon?: string;
  description?: string;
  yolo_id?: string;
};

const ANTIGRAVITY_COMMAND = process.platform === 'win32' ? 'agi.exe' : 'agi';

const getBootstrapAgents = (): BootstrapAgentEntry[] => [
  {
    name: 'DeepSeek TUI',
    command: 'deepseek-tui',
    args: ['acp'],
    icon: 'ai-china/deepseek.svg',
    description: 'DeepSeek Terminal UI (codewhale)',
    yolo_id: 'yolo',
  },
  {
    name: 'Antigravity',
    command: ANTIGRAVITY_COMMAND,
    args: ['acp'],
    icon: 'tools/antigravity.svg',
    description: 'Antigravity CLI (agi.exe / agi)',
    yolo_id: 'yolo',
  },
  {
    name: 'Tomny Strict Claude',
    command: process.execPath,
    args: [getBuiltinMcpScriptPath('strict-claude-acp')],
    icon: 'ai-china/deepseek.svg',
    description:
      'Claude ACP adapter for Strict IDE Mode. Native filesystem and shell tools are disabled before execution.',
  },
];

type MinimalAgentRow = {
  id: string;
  name?: string;
  command?: string;
  args?: string[];
  icon?: string;
  description?: string;
  yolo_id?: string;
  agent_source?: string;
};

type BootstrapAgentPayload = {
  name: string;
  command: string;
  icon?: string;
  args?: string[];
  advanced?: {
    description?: string;
    yolo_id?: string;
  };
};

function buildBootstrapAgentPayload(entry: BootstrapAgentEntry): BootstrapAgentPayload {
  return {
    name: entry.name,
    command: entry.command,
    icon: entry.icon,
    args: entry.args,
    advanced:
      entry.description || entry.yolo_id
        ? {
            description: entry.description,
            yolo_id: entry.yolo_id,
          }
        : undefined,
  };
}

function findBootstrapAgent(existing: MinimalAgentRow[], entry: BootstrapAgentEntry): MinimalAgentRow | undefined {
  return existing.find(
    (agent) =>
      agent.name === entry.name ||
      agent.command === entry.command ||
      agent.id === entry.command ||
      agent.id === entry.name
  );
}

function needsBootstrapAgentUpdate(existing: MinimalAgentRow, entry: BootstrapAgentEntry): boolean {
  return (
    existing.name !== entry.name ||
    existing.command !== entry.command ||
    existing.icon !== entry.icon ||
    existing.description !== entry.description ||
    existing.yolo_id !== entry.yolo_id ||
    !areStringArraysEqual(existing.args, entry.args)
  );
}

async function ensureBootstrapAgents(): Promise<boolean> {
  let existing: MinimalAgentRow[] = [];
  try {
    const raw = await httpRequest<unknown>('GET', '/api/agents');
    existing = (Array.isArray(raw) ? raw : []) as MinimalAgentRow[];
  } catch (error) {
    console.warn('[Tomny] Bootstrap agents: failed to fetch existing agents, will retry next launch', error);
    return false;
  }

  console.info(`[Tomny] Bootstrap agents: found ${existing.length} existing agent(s)`);

  let changed = 0;

  for (const entry of getBootstrapAgents()) {
    const matchedAgent = findBootstrapAgent(existing, entry);
    const payload = buildBootstrapAgentPayload(entry);

    if (matchedAgent) {
      if (!needsBootstrapAgentUpdate(matchedAgent, entry)) {
        console.info(`[Tomny] Bootstrap agents: "${entry.name}" already registered, skipping`);
        continue;
      }

      if (matchedAgent.agent_source && matchedAgent.agent_source !== 'custom') {
        console.info(
          `[Tomny] Bootstrap agents: "${entry.name}" is managed by source "${matchedAgent.agent_source}", skipping update`
        );
        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop -- bootstrap migrations intentionally run sequentially at startup.
        await httpRequest<unknown>('PUT', `/api/agents/custom/${matchedAgent.id}`, payload);
        console.info(`[Tomny] Bootstrap agents: updated "${entry.name}" (command=${entry.command})`);
        changed += 1;
      } catch (error) {
        console.warn(`[Tomny] Bootstrap agents: failed to update "${entry.name}"`, error);
      }
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- bootstrap migrations intentionally run sequentially at startup.
      const result = await httpRequest<unknown>('POST', '/api/agents/custom', payload);
      console.info(`[Tomny] Bootstrap agents: registered "${entry.name}" (command=${entry.command})`, result);
      changed += 1;
    } catch (error) {
      console.warn(`[Tomny] Bootstrap agents: failed to register "${entry.name}"`, error);
    }
  }

  // Trigger a refresh so the backend re-scans PATH for the new agents
  if (changed > 0) {
    console.info(`[Tomny] Bootstrap agents: changed ${changed} agent(s), triggering refresh`);
    try {
      await httpRequest<void>('POST', '/api/agents/refresh');
    } catch (error) {
      console.warn('[Tomny] Bootstrap agents: refresh failed (non-fatal)', error);
    }
  }

  return true;
}

export async function runBackendMigrations(configFile: ConfigFile): Promise<void> {
  await CLEANUP_STEPS.reduce<Promise<void>>(async (previous, step) => {
    await previous;
    const start = Date.now();
    try {
      await step.run();
      console.info(`[Tomny] Backend migration step completed: ${step.name} (${Date.now() - start}ms)`);
    } catch (error) {
      console.error(`[Tomny] Backend migration step failed: ${step.name} (${Date.now() - start}ms)`, error);
    }
  }, Promise.resolve());

  await MIGRATION_STEPS.reduce<Promise<void>>(async (previous, step) => {
    await previous;
    const start = Date.now();
    try {
      const completed = await step.run(configFile);
      const elapsed = Date.now() - start;
      if (!completed) {
        console.warn(`[Tomny] Backend migration step incomplete: ${step.name} (${elapsed}ms)`);
        return;
      }
      console.info(`[Tomny] Backend migration step completed: ${step.name} (${elapsed}ms)`);
    } catch (error) {
      const elapsed = Date.now() - start;
      console.error(`[Tomny] Backend migration step failed: ${step.name} (${elapsed}ms)`, error);
    }
  }, Promise.resolve());
}
