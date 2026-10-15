/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Role-chat conversations for the Hub company surface.
 *
 * Core mirror of the Company package's `openRoleChat` (the base app may not
 * import package code). It deliberately shares the package's role→conversation
 * `localStorage` map, so a role chatted with here and in the package is one
 * conversation. Differences: the briefing is compact (identity, responsibilities,
 * rules) and no separate primer turn is sent; the group-chat prompt restates the
 * agent's identity on every turn instead.
 */

import { ipcBridge } from '@/common';
import type { ICreateConversationParams } from '@/common/adapter/ipcBridge';
import type { ISessionMcpServer } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { ensureBackendMcpCatalog, toSessionMcpServer } from '@/renderer/hooks/mcp/catalog';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import {
  buildCliAgentParams,
  buildPresetAssistantParams,
} from '@/renderer/pages/conversation/utils/createConversationParams';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { fetchDetectedAgents } from '@/renderer/utils/model/agentTypes';
import type { CompanyStructure, RoleCapabilities, RoleNode } from '@process/company/companyOrchestrator';

/** Same key as the Company package so both surfaces share one conversation per role. */
export const ROLE_CONVERSATIONS_STORAGE_KEY = 'tomny.company.roleConversations';

const roleKey = (companyId: string, roleId: string): string => `${companyId}::${roleId}`;

const loadRoleConversations = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ROLE_CONVERSATIONS_STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
};

const saveRoleConversation = (key: string, conversationId: string): void => {
  try {
    const map = loadRoleConversations();
    map[key] = conversationId;
    window.localStorage.setItem(ROLE_CONVERSATIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // The mapping is an optimisation; a storage failure only costs a fresh chat.
  }
};

const ROLE_KIND_LABEL: Record<RoleNode['role'], string> = {
  president: 'President',
  'division-head': 'Division head',
  worker: 'Worker',
};

/** Compact company briefing used as the conversation's preset context. */
export const buildRoleBriefing = (params: {
  companyName: string;
  role: RoleNode;
  rules: readonly string[];
}): string => {
  const { companyName, role, rules } = params;
  const lines = [
    '# Company briefing',
    '',
    `**Company:** ${companyName}`,
    `**Your role:** ${role.name} (${ROLE_KIND_LABEL[role.role] ?? 'Member'})`,
  ];
  if (role.responsibilities?.trim()) lines.push(`**Responsibilities:** ${role.responsibilities.trim()}`);
  if (role.children.length > 0) {
    lines.push(`**You lead:** ${role.children.map((child) => child.name).join(', ')}`);
  }
  if (rules.length > 0) {
    lines.push('', '## Company rules', ...rules.map((rule) => `- ${rule}`));
  }
  return lines.join('\n');
};

const firstAvailableCli = (agents: AgentMetadata[]): AgentMetadata | null =>
  agents.find((agent) => agent.available !== false) ?? null;

/** Resolve the executor assigned to a role into conversation params, falling back to a runnable CLI. */
const buildParamsForRole = async (role: RoleNode, language: string): Promise<ICreateConversationParams | null> => {
  const assignment = role.assignment;

  if (assignment?.kind === 'assistant') {
    const assistants = await ipcBridge.assistants.list.invoke().catch((): Assistant[] => []);
    const assistant = (assistants || []).find((item) => item.id === assignment.refId);
    if (assistant) {
      const detected = await fetchDetectedAgents();
      const engine = assistant.preset_agent_type;
      const engineOk = detected.some(
        (agent) =>
          agent.available !== false && (agent.backend === engine || agent.agent_type === engine || agent.id === engine)
      );
      if (engineOk) return buildPresetAssistantParams(assistant, '', language);
      // A drafted assistant can name an engine that is not installed; run it on a real one.
      const fallback = firstAvailableCli(detected);
      if (fallback) {
        return buildPresetAssistantParams(
          { ...assistant, preset_agent_type: fallback.backend || fallback.agent_type },
          '',
          language
        );
      }
    }
  } else if (assignment?.kind === 'cli') {
    const detected = await fetchDetectedAgents();
    const agent = detected.find(
      (item) =>
        item.available !== false &&
        (item.id === assignment.refId || item.agent_type === assignment.refId || item.backend === assignment.refId)
    );
    if (agent) return buildCliAgentParams(agent, '');
  }

  const cli = firstAvailableCli(await fetchDetectedAgents());
  return cli ? buildCliAgentParams(cli, '') : null;
};

/** Apply the role's model only when it names a model of a configured provider (tomnyagentic only). */
const applyAssignmentModel = async (params: ICreateConversationParams, model?: string): Promise<void> => {
  if (!model || params.type !== 'tomnyagentic') return;
  const current = params.model as { use_model?: string } | undefined;
  if (!current || typeof current.use_model !== 'string') return;
  try {
    const providers = await ipcBridge.mode.listProviders.invoke();
    if (Array.isArray(providers) && providers.some((p) => Array.isArray(p.models) && p.models.includes(model))) {
      current.use_model = model;
    }
  } catch {
    // Keep the built-in default model.
  }
};

/**
 * Grant the role's skills, session mode and MCP servers onto the params. User
 * servers attach by id; built-in servers must travel as full session configs.
 */
const applyCapabilities = async (
  params: ICreateConversationParams,
  capabilities: RoleCapabilities | undefined
): Promise<void> => {
  if (!params.extra) params.extra = {};
  if (!capabilities) return;
  if (Array.isArray(capabilities.skills) && capabilities.skills.length > 0) {
    params.extra.preset_enabled_skills = capabilities.skills;
  }
  if (typeof capabilities.sessionMode === 'string' && capabilities.sessionMode.length > 0) {
    params.extra.session_mode = capabilities.sessionMode;
  }
  const grantedIds = Array.isArray(capabilities.mcpServerIds) ? capabilities.mcpServerIds : [];
  if (grantedIds.length === 0) return;
  try {
    const { allServers } = await ensureBackendMcpCatalog();
    const granted = new Set(grantedIds);
    const matched = allServers.filter((server) => granted.has(server.id) || granted.has(server.name));
    const resolved = new Set(matched.flatMap((server) => [server.id, server.name]));
    const ids = new Set([
      ...matched.filter((server) => server.builtin !== true).map((server) => server.id),
      ...grantedIds.filter((id) => !resolved.has(id)),
    ]);
    if (ids.size > 0) params.extra.selected_mcp_server_ids = [...ids];
    const sessionServers: ISessionMcpServer[] = matched
      .filter((server) => server.builtin === true)
      .map((server) => toSessionMcpServer(server));
    if (sessionServers.length > 0) params.extra.selected_session_mcp_servers = sessionServers;
  } catch {
    params.extra.selected_mcp_server_ids = grantedIds;
  }
};

/** Input for {@link ensureRoleConversation}. */
export type EnsureRoleConversationInput = {
  companyId: string;
  companyName: string;
  role: RoleNode;
  structure: CompanyStructure | null;
  rules: readonly string[];
  /** UI language, forwarded to the assistant params builder. */
  language: string;
};

/**
 * Open (or reuse) the 1-1 conversation with a company role.
 *
 * @returns the conversation id, or `null` when the role has no runnable executor
 * or the backend refused to create the conversation. Never throws.
 */
export const ensureRoleConversation = async (input: EnsureRoleConversationInput): Promise<string | null> => {
  const { companyId, companyName, role, rules, language } = input;
  try {
    const key = roleKey(companyId, role.id);
    const existingId = loadRoleConversations()[key];
    if (existingId && (await getConversationOrNull(existingId).catch((): null => null))) return existingId;

    const params = await buildParamsForRole(role, language);
    if (!params) return null;
    if (!params.extra) params.extra = {};
    await applyCapabilities(params, role.assignment?.capabilities);

    const briefing = buildRoleBriefing({ companyName, role, rules });
    const existingContext = typeof params.extra.preset_context === 'string' ? params.extra.preset_context : '';
    params.extra.preset_context = existingContext.length > 0 ? `${briefing}\n\n${existingContext}` : briefing;
    params.name = `${companyName} · ${role.name}`;
    await applyAssignmentModel(params, role.assignment?.model);

    const conversation = await ipcBridge.conversation.create.invoke(params);
    if (!conversation?.id) return null;
    saveRoleConversation(key, conversation.id);
    return conversation.id;
  } catch (error) {
    console.error('[CompanyHub] ensureRoleConversation failed:', error);
    return null;
  }
};
