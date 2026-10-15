/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure planner that turns an assistant into the skills, plugins and hooks a single conversation should use.
 *
 * Rules (session scope):
 * - Selecting an assistant never changes a global switch and never enables anything the user has not already
 *   enabled. A plugin (MCP server) or hook that is missing or not enabled/approved becomes a notice instead.
 * - Hooks are an allowlist for the conversation: only the assistant's hooks that are already active run.
 * - Everything here is deterministic and free of I/O so main, renderer and tests share one decision.
 */

import type { Assistant } from '../assistantTypes';
import { planDefaultTools, type DefaultToolCandidate, type DefaultToolNotice } from './assistantDefaultTools';

/** Minimal per-assistant fields the planner needs. */
export type AssistantSessionSource = Pick<
  Assistant,
  'enabled_skills' | 'custom_skill_names' | 'enabled_plugins' | 'enabled_hooks'
> & { default_tools?: string[] };

/** What the host currently has. Callers build this from live settings, not from the assistant record. */
export type AssistantSessionAvailability = {
  /** Skill names the user can use right now (builtin, custom and extension). */
  skillNames: readonly string[];
  /** MCP servers (plugins) known to the host. `enabled` means the user turned them on in Settings. */
  plugins: readonly { id: string; enabled: boolean }[];
  /** Hook ids that are approved and enabled by the user. */
  activeHookIds: readonly string[];
  /** Tools the person can attach (built from installed MCP servers and built-in servers). Absent means none. */
  tools?: readonly DefaultToolCandidate[];
};

export type AssistantPlanNotice =
  | { kind: 'skill'; id: string; reason: 'not-installed' }
  | { kind: 'plugin'; id: string; reason: 'not-installed' | 'not-enabled' }
  | { kind: 'hook'; id: string; reason: 'not-active' }
  | DefaultToolNotice;

export type AssistantSessionPlan = {
  /** Skill names to select for the conversation. */
  skills: string[];
  /** Plugin (MCP server) ids to select for the conversation. */
  pluginIds: string[];
  /** Hook ids that form the conversation's hook allowlist. */
  hookIds: string[];
  /** Default tool ids to attach as pre-loaded schemas. Only tools whose server is enabled and approved. */
  toolIds: string[];
  /** Items that could not be applied, so the UI can explain them instead of enabling them silently. */
  notices: AssistantPlanNotice[];
};

/** Removes only the plugins an assistant applied, keeping the user's other selections (for example Super). */
export const dropAppliedPlugins = (selected: readonly string[], applied: readonly string[]): string[] => {
  const drop = new Set(applied);
  return selected.filter((id) => !drop.has(id));
};

/** Counts shown on picker cards, for example "3 skill · 2 plugin · 1 hook". */
export type AssistantItemCounts = { skills: number; plugins: number; hooks: number; tools: number };

const unique = (values: readonly string[] | undefined): string[] => [...new Set(values ?? [])];

/** Plans one conversation from an assistant against the host's current availability. */
export const planAssistantSession = (
  assistant: AssistantSessionSource,
  availability: AssistantSessionAvailability
): AssistantSessionPlan => {
  const notices: AssistantPlanNotice[] = [];
  const skillNames = new Set(availability.skillNames);
  const skills: string[] = [];
  for (const name of unique([...(assistant.enabled_skills ?? []), ...(assistant.custom_skill_names ?? [])])) {
    if (skillNames.has(name)) skills.push(name);
    else notices.push({ kind: 'skill', id: name, reason: 'not-installed' });
  }

  const plugins = new Map(availability.plugins.map((plugin) => [plugin.id, plugin.enabled] as const));
  const pluginIds: string[] = [];
  for (const id of unique(assistant.enabled_plugins)) {
    const enabled = plugins.get(id);
    if (enabled === undefined) notices.push({ kind: 'plugin', id, reason: 'not-installed' });
    else if (!enabled) notices.push({ kind: 'plugin', id, reason: 'not-enabled' });
    else pluginIds.push(id);
  }

  const activeHooks = new Set(availability.activeHookIds);
  const hookIds: string[] = [];
  for (const id of unique(assistant.enabled_hooks)) {
    if (activeHooks.has(id)) hookIds.push(id);
    else notices.push({ kind: 'hook', id, reason: 'not-active' });
  }

  const tools = planDefaultTools(assistant.default_tools, availability.tools ?? []);
  notices.push(...tools.notices);
  return { skills, pluginIds, hookIds, toolIds: tools.toolIds, notices };
};

/** Counts for picker cards. Duplicates are counted once, matching what the planner would select. */
export const countAssistantItems = (assistant: AssistantSessionSource): AssistantItemCounts => ({
  skills: new Set([...(assistant.enabled_skills ?? []), ...(assistant.custom_skill_names ?? [])]).size,
  plugins: new Set(assistant.enabled_plugins ?? []).size,
  hooks: new Set(assistant.enabled_hooks ?? []).size,
  tools: new Set(assistant.default_tools ?? []).size,
});
