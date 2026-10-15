/**
 * Production wiring for the filter-before-load skill/tool selector.
 * Keeps the short catalog separate from full SKILL.md content.
 */
import path from 'node:path';
import { app } from 'electron';
import { createNativeSkillCatalog } from '@process/resources/nativePlatform/capabilityBridge';
import type { SkillSummary } from '@process/resources/nativePlatform/skillCatalog';
import type { HookView } from '@process/integrations/hooks/hookRegistry';
import { isPackageOwnedMcpServer, packageOwnerOfMcpServer } from '@process/resources/mcpRegistry/packageMcpSync';
import {
  readCapabilityMode,
  type IMcpServer,
  type ISessionMcpServer,
  type TChatConversation,
} from '@/common/config/storage';
import { getHookRegistry } from '@process/integrations/hookRuntime/hookDispatcher';
import {
  activatedCapabilityIds,
  createCapabilityFallback,
  packageCandidates,
} from '@process/resources/builtinMcp/capabilityFallback';
import {
  buildPackageAttachmentTurn,
  resolveCapabilityTurn,
  type CapabilityCandidate,
  type CapabilityTurn,
  type PackageAttachmentTurn,
  type PackagePluginEntry,
  type PackagePluginHealth,
} from '@process/services/chatPipeline/stages/capabilitySelect';
import type { ToolSelectorServerDeps } from '@process/resources/builtinMcp/toolSelectorServer';
import { createCatalog } from './catalog';
import { listBuiltinMcpToolCatalog } from './builtinToolCatalog';
import { createSelectionLog } from './selectionLog';
import { createToolSelector } from './toolSelector';

let services: ToolSelectorServerDeps | undefined;

/** Reads one conversation. The native conversation bridge sets it once at startup. */
type CapabilityConversationSource = (conversationId: string) => Promise<TChatConversation | undefined>;

/** Lists the MCP registry (every server with its enabled and connection state). Set once by the registry bridge. */
type CapabilityRegistrySource = () => Promise<readonly IMcpServer[]>;

let capabilityConversationSource: CapabilityConversationSource | undefined;
let capabilityRegistrySource: CapabilityRegistrySource | undefined;
let capabilitySkillCatalog: ReturnType<typeof createNativeSkillCatalog> | undefined;

/** Lets the auto-select code read a conversation snapshot. Called once by the native conversation bridge. */
export const configureCapabilityConversationSource = (source: CapabilityConversationSource): void => {
  capabilityConversationSource = source;
};

/** Lets auto select see the enabled MCP registry servers. Called once by the MCP registry bridge. */
export const configureCapabilityRegistrySource = (source: CapabilityRegistrySource): void => {
  capabilityRegistrySource = source;
};

const SNAPSHOT_KEYS = ['session_mcp_servers', 'selected_session_mcp_servers'] as const;

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const isSessionServer = (value: unknown): value is ISessionMcpServer => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ISessionMcpServer>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.transport === 'object' &&
    candidate.transport !== null
  );
};

const hookCandidates = async (): Promise<CapabilityCandidate[]> => {
  const registry = await getHookRegistry();
  if (!registry) return [];
  const views = await registry.listHooks();
  return views.map(
    (view): CapabilityCandidate => ({
      id: `hook:${view.id}`,
      kind: 'hook',
      name: view.pluginId ?? view.id,
      description: `${view.event} hook${view.matcher ? `, matcher ${view.matcher}` : ''}`,
      keywords: (view.matcher?.split(/[|,\s]+/) ?? []).filter(Boolean).slice(0, 8),
      event: view.event,
      enabled: view.enabled,
      approved: view.approved,
      runsCode: true,
    })
  );
};

/**
 * Enabled registry servers. A built-in server is included only when an assistant default tool names it, so the
 * built-in set does not grow every turn. A server the user switched off is never listed.
 */
const registryServersFor = async (referenced: ReadonlySet<string>): Promise<IMcpServer[]> => {
  if (!capabilityRegistrySource) return [];
  try {
    return (await capabilityRegistrySource()).filter(
      (server) => server.enabled === true && (server.builtin !== true || referenced.has(server.id))
    );
  } catch {
    return [];
  }
};

/** Server ids an assistant's default tools name: `<serverId>::<toolName>`. */
const defaultToolServerIds = (value: unknown): Set<string> => {
  const ids = stringsOf(value).map((id) => id.split('::')[0] ?? '');
  return new Set(ids.filter((id) => id.length > 0));
};

/** The candidates and the MCP servers one conversation's auto-select turn may restore. */
export type CapabilityPool = Readonly<{ candidates: CapabilityCandidate[]; servers: ISessionMcpServer[] }>;

/**
 * The candidate pool of one conversation. Attached entries are marked so auto select always chooses them: the MCP
 * servers in the conversation snapshot (chat (+) menu or assistant), the skills of the applied assistant, the servers
 * named by its default tools, and every enabled registry server (connected ones are usable; the rest need approval).
 * Holds names and descriptions only.
 */
export const loadCapabilityPool = async (conversation: TChatConversation | undefined): Promise<CapabilityPool> => {
  if (!conversation) return { candidates: [], servers: [] };
  const extra = conversation.extra as Record<string, unknown>;
  const excluded = new Set(stringsOf(extra.exclude_auto_inject_skills));
  const assistantSkills = new Set(stringsOf(extra.enabled_skills).map((name) => name.toLowerCase()));
  capabilitySkillCatalog ??= createNativeSkillCatalog();
  const summaries = await capabilitySkillCatalog.list();
  const skills = summaries.map((skill): CapabilityCandidate => {
    const enabled = !excluded.has(skill.name);
    return {
      id: `skill:${skill.name}`,
      kind: 'skill',
      name: skill.name,
      description: skill.description,
      enabled,
      approved: true,
      runsCode: false,
      attached: enabled && assistantSkills.has(skill.name.toLowerCase()),
      ...(skill.packageId ? { group: skill.packageId } : {}),
    };
  });
  const entries = summaries.map((skill) => ({
    name: skill.name,
    description: skill.description,
    packageId: skill.packageId,
    enabled: !excluded.has(skill.name),
  }));
  const packages = packageCandidates(entries);

  const servers = new Map<string, ISessionMcpServer>();
  for (const key of SNAPSHOT_KEYS) {
    const value = extra[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) if (isSessionServer(item)) servers.set(item.id, item);
  }
  const snapshotIds = new Set(servers.keys());
  const registered = new Map<string, IMcpServer>();
  for (const server of await registryServersFor(defaultToolServerIds(extra.assistant_default_tools))) {
    if (snapshotIds.has(server.id)) continue;
    registered.set(server.id, server);
    servers.set(server.id, { id: server.id, name: server.name, transport: server.transport });
  }
  const plugins = [...servers.values()].map((server): CapabilityCandidate => {
    const fromRegistry = registered.get(server.id);
    // A registry server is approved only after its last connection test succeeded.
    const approved = fromRegistry ? fromRegistry.last_test_status === 'connected' : true;
    return {
      id: `mcp:${server.id}`,
      kind: 'plugin',
      name: server.name,
      description: fromRegistry?.description?.trim() || `MCP server over ${server.transport.type} transport`,
      enabled: true,
      approved,
      runsCode: server.transport.type === 'stdio',
      attached: true,
    };
  });
  return {
    candidates: [...skills, ...packages, ...plugins, ...(await hookCandidates())],
    servers: [...servers.values()],
  };
};

/** The candidate pool of one conversation (see {@link loadCapabilityPool}). */
export const loadCapabilityCandidates = async (
  conversation: TChatConversation | undefined
): Promise<CapabilityCandidate[]> => (await loadCapabilityPool(conversation)).candidates;

/** The auto-select turn of a conversation, or undefined for manual ones, which keep the send path unchanged. */
export const resolveConversationCapabilityTurn = async (
  conversation: TChatConversation | undefined,
  request: string
): Promise<CapabilityTurn | undefined> => {
  if (!conversation) return undefined;
  const mode = (conversation.extra as Record<string, unknown>).capabilityMode;
  if (readCapabilityMode(mode) !== 'auto') return undefined;
  const pool = await loadCapabilityPool(conversation);
  return resolveCapabilityTurn({
    mode,
    request,
    candidates: pool.candidates,
    servers: pool.servers,
    forcedIds: activatedCapabilityIds(conversation.id),
  });
};

/** Skill summaries for the package attachment. A failing catalog read attaches nothing; it never fails the send. */
const skillSummariesOrEmpty = async (): Promise<SkillSummary[]> => {
  try {
    capabilitySkillCatalog ??= createNativeSkillCatalog();
    return await capabilitySkillCatalog.list();
  } catch {
    return [];
  }
};

/** Hook views for the package attachment. A failing hook registry attaches no hook counts; it never fails the send. */
const hookViewsOrEmpty = async (): Promise<HookView[]> => {
  try {
    const registry = await getHookRegistry();
    return registry ? await registry.listHooks() : [];
  } catch {
    return [];
  }
};

/** Connection state from the last connection test. Only a failed test marks a plugin as failing. */
const healthOf = (status: IMcpServer['last_test_status']): PackagePluginHealth => {
  if (status === 'connected') return 'connected';
  return status === 'error' || status === 'disconnected' ? 'failing' : 'untested';
};

/**
 * The enabled package-owned MCP servers, each with the skills and active hooks of its package. Names, state and counts
 * only. Independent of the capability mode: a package plugin the user enabled is part of every conversation.
 */
const packagePluginEntries = async (conversation: TChatConversation): Promise<PackagePluginEntry[]> => {
  if (!capabilityRegistrySource) return [];
  let registry: readonly IMcpServer[];
  try {
    registry = await capabilityRegistrySource();
  } catch {
    return [];
  }
  const owned = registry.filter((server) => server.enabled === true && isPackageOwnedMcpServer(server));
  if (owned.length === 0) return [];
  const excluded = new Set(stringsOf((conversation.extra as Record<string, unknown>).exclude_auto_inject_skills));
  const [summaries, hooks] = await Promise.all([skillSummariesOrEmpty(), hookViewsOrEmpty()]);
  return owned.flatMap((server): PackagePluginEntry[] => {
    const packageId = packageOwnerOfMcpServer(server);
    if (!packageId) return [];
    return [
      {
        serverId: server.id,
        serverName: server.name,
        title: server.extension?.displayName?.trim() || server.name,
        packageId,
        updatedAt: server.updated_at,
        health: healthOf(server.last_test_status),
        toolNames: (server.tools ?? []).map((tool) => tool.name).filter((name) => name.trim().length > 0),
        skills: summaries
          .filter((skill) => skill.packageId === packageId && !excluded.has(skill.name))
          .map((skill) => ({ name: skill.name, description: skill.description })),
        hookCount: hooks.filter((hook) => hook.pluginId === packageId && hook.active).length,
        session: { id: server.id, name: server.name, transport: server.transport },
      },
    ];
  });
};

/**
 * The enabled package plugins of one conversation for this send, in every capability mode. Undefined when no package
 * plugin is enabled, so such a send is unchanged. `autoTurn` is the auto select turn when there is one: the servers it
 * already chose count against the same per-turn limit.
 */
export const resolvePackageAttachmentTurn = async (
  conversation: TChatConversation | undefined,
  autoTurn?: CapabilityTurn
): Promise<PackageAttachmentTurn | undefined> => {
  if (!conversation) return undefined;
  return buildPackageAttachmentTurn({
    entries: await packagePluginEntries(conversation),
    alreadyAttachedIds: autoTurn?.mcpServerIds ?? [],
  });
};

const loadCandidatesById = async (conversationId: string): Promise<CapabilityCandidate[]> =>
  loadCapabilityCandidates(await capabilityConversationSource?.(conversationId));

/** Build the singleton used by every Core surface's Skill Workflow capability. */
export const getToolSelectorServices = (): ToolSelectorServerDeps => {
  if (services) return services;
  const skills = createNativeSkillCatalog();
  const catalog = createCatalog({
    loadSkills: async () =>
      (await skills.list()).map((skill) => ({
        id: `skill:${skill.name}`,
        source: 'skill' as const,
        name: skill.name,
        description: skill.description,
        keywords: [skill.source, skill.relative_location ?? ''].filter(Boolean),
      })),
    // Keep searchable metadata for built-in surface tools. Full schemas still
    // come from the live ToolMap, so discovery stays small without claiming the
    // IDE or Agent Orchestrator is unavailable.
    loadMcpTools: async () => listBuiltinMcpToolCatalog(),
  });
  const selectionLog = createSelectionLog({
    filePath: path.join(app.getPath('userData'), 'tomny-core', 'selection-log.json'),
  });
  services = {
    toolSelector: createToolSelector({ catalog, selectionLog, topK: 5, maxRounds: 3 }),
    selectionLog,
    readSkill: (name, resource) => skills.read(name, resource),
    refreshCatalog: async () => {
      await catalog.refresh();
    },
    capabilityFallback: createCapabilityFallback(loadCandidatesById),
  };
  return services;
};
