/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auto select capabilities (2026-10-15). Chooses the few skills, plugins (MCP servers) and hooks that fit one
 * request, so only those reach the agent. Attached entries (the chat (+) menu, an assistant, or an enabled and
 * connected registry server) are always chosen first, so they are available on the first turn without a search.
 * The rest are chosen deterministically by keyword and description scoring with fixed budgets. The optional `rank`
 * callback is a model path. It is time-bounded, and it can only pick among usable candidates; any other id it
 * returns is ignored.
 *
 * Security rules enforced here: an entry is usable only when the user enabled AND approved it. Disabled or
 * unapproved entries are counted, never named to the agent. Hooks are never narrowed by this selection (see docs).
 *
 * This step runs in Main before the agent starts. It is not a registered IChatStage, because persisted pipeline
 * definitions would not list a newly added stage.
 * Process boundary: Main-process module, no DOM APIs.
 */

import { readCapabilityMode, type ISessionMcpServer } from '@/common/config/storage';

export type CapabilityKind = 'skill' | 'plugin' | 'hook';

/** One entry the selector may choose. Holds only names and descriptions: no commands, URLs, headers or secrets. */
export type CapabilityCandidate = Readonly<{
  /** Stable id: `skill:<name>`, `mcp:<serverId>` or `hook:<hookId>`. */
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  /** Extra match terms, such as a hook matcher. */
  keywords?: readonly string[];
  /** Hook event. A hook is relevant to a turn only for that event. */
  event?: string;
  /** The user switched the entry on in Settings. */
  enabled: boolean;
  /** The user approved the entry. An entry that is not approved is never selected. */
  approved: boolean;
  /** The entry starts code (a stdio server, a hook command). It is never started silently. */
  runsCode: boolean;
  /** Installed package id of a skill that belongs to a package. The capability map lists it under that package. */
  group?: string;
  /** Skill names a package candidate expands to when it is chosen. Absent for MCP servers and hooks. */
  members?: readonly string[];
  /**
   * Attached to this conversation: an MCP server in the chat (+) menu, a plugin or skill of the applied assistant,
   * an enabled and connected registry server, or a server an assistant default tool names. Attached entries are
   * chosen before keyword scoring, up to {@link ATTACHED_LIMITS}, so they are usable on the first turn.
   */
  attached?: boolean;
}>;

/** Skill names one chosen package adds to a turn at most. Keeps the skill text small for a large package. */
export const MAX_PACKAGE_SKILLS_PER_TURN = 8;

export type CapabilityBudget = Readonly<{ maxSkills: number; maxPlugins: number; maxHooks: number; maxTotal: number }>;

/** Upper bounds per turn. They keep the tool and skill text small when the catalog is large. */
export const CAPABILITY_BUDGET: CapabilityBudget = { maxSkills: 4, maxPlugins: 3, maxHooks: 3, maxTotal: 8 };

/**
 * Caps on attached entries per turn, on top of {@link CAPABILITY_BUDGET}. An attached MCP server is restored with all
 * of its tools, so `maxPlugins` bounds the tool schemas sent to the model. Attached skills add one catalog line each.
 * Attached entries beyond these caps stay ordinary candidates (keyword or connect), so nothing is hidden silently.
 */
export const ATTACHED_LIMITS = { maxPlugins: 4, maxSkills: 8 } as const;

/** The model path gets this long before the deterministic result is used. */
export const CAPABILITY_RANK_TIMEOUT_MS = 2_000;

/** The hook event this chat turn dispatches. */
export const PROMPT_HOOK_EVENT = 'UserPromptSubmit';

export type CapabilityRankInput = Readonly<{ id: string; name: string; description: string }>;

/** Optional model path. It receives usable, non-hook candidates only and returns ids in preference order. */
export type CapabilityRank = (
  request: string,
  candidates: readonly CapabilityRankInput[],
  signal: AbortSignal
) => Promise<readonly string[]>;

export type CapabilitySelection = Readonly<{
  selectedIds: readonly string[];
  method: 'keyword' | 'model';
  /** Count of disabled or unapproved entries. They are counted only. */
  unusable: number;
}>;

const STOP_WORDS: ReadonlySet<string> = new Set(
  'the and for with this that from into please you your can use make how what cho của và với một các những này đó hãy giúp tôi bạn được có là không để'.split(
    ' '
  )
);

/** Lowercase word set of a text, without stop words and one-letter tokens. Unicode-aware (Vietnamese included). */
export const tokenize = (text: string): Set<string> =>
  new Set(
    text
      .normalize('NFC')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  );

const scoreOf = (request: ReadonlySet<string>, candidate: CapabilityCandidate): number => {
  const nameTerms = tokenize(candidate.name);
  const keywordTerms = tokenize((candidate.keywords ?? []).join(' '));
  if (candidate.kind === 'hook') {
    // A hook without a matcher runs on every prompt of its event, so it is always relevant to the turn.
    if (keywordTerms.size === 0) return 1;
    let matches = 0;
    for (const term of request) if (keywordTerms.has(term) || nameTerms.has(term)) matches += 1;
    return matches;
  }
  const descriptionTerms = tokenize(candidate.description);
  let score = 0;
  for (const term of request) {
    if (nameTerms.has(term)) score += 3;
    else if (keywordTerms.has(term)) score += 2;
    else if (descriptionTerms.has(term)) score += 1;
  }
  return score;
};

const rankWithTimeout = async (
  rank: CapabilityRank,
  request: string,
  candidates: readonly CapabilityCandidate[],
  timeoutMs: number
): Promise<readonly string[] | undefined> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, timeoutMs);
  });
  const inputs = candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
  }));
  try {
    const picked = await Promise.race([
      rank(request, inputs, controller.signal).catch((): undefined => undefined),
      timeout,
    ]);
    if (!picked) return undefined;
    return picked.filter((id): id is string => typeof id === 'string');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * Chooses the entries for one request. Attached entries come first (up to {@link ATTACHED_LIMITS}); then ids in
 * `forcedIds` (connected earlier through the plugin tool) and keyword matches fill the rest of the budget. Only
 * usable entries are chosen, and the result never exceeds the budget plus the attached caps.
 */
export const selectCapabilities = async (input: {
  request: string;
  candidates: readonly CapabilityCandidate[];
  forcedIds?: readonly string[];
  budget?: CapabilityBudget;
  rank?: CapabilityRank;
  rankTimeoutMs?: number;
  turnEvent?: string;
}): Promise<CapabilitySelection> => {
  const budget = input.budget ?? CAPABILITY_BUDGET;
  const turnEvent = input.turnEvent ?? PROMPT_HOOK_EVENT;
  const isUsable = (candidate: CapabilityCandidate): boolean => candidate.enabled && candidate.approved;
  const usable = input.candidates.filter(
    (candidate) => isUsable(candidate) && (candidate.kind !== 'hook' || candidate.event === turnEvent)
  );
  const unusable = input.candidates.filter((candidate) => !isUsable(candidate)).length;
  const request = tokenize(input.request);
  const forced = new Set(input.forcedIds ?? []);
  let method: CapabilitySelection['method'] = 'keyword';
  const nonHook = usable.filter((candidate) => candidate.kind !== 'hook');
  const ranked =
    input.rank && nonHook.length > 0
      ? await rankWithTimeout(input.rank, input.request, nonHook, input.rankTimeoutMs ?? CAPABILITY_RANK_TIMEOUT_MS)
      : undefined;
  const usableIds = new Set(nonHook.map((candidate) => candidate.id));
  const modelOrder = new Map<string, number>();
  for (const id of ranked ?? []) {
    if (usableIds.has(id) && !modelOrder.has(id)) modelOrder.set(id, modelOrder.size);
  }
  if (modelOrder.size > 0) method = 'model';
  const scored = usable
    .map((candidate) => ({ candidate, score: scoreOf(request, candidate) }))
    .filter(({ candidate, score }) => score > 0 || forced.has(candidate.id) || modelOrder.has(candidate.id));

  // Attached entries are pinned first, in candidate order, up to their own caps. They do not compete with keywords.
  const attached = nonHook.filter((candidate) => candidate.attached === true);
  const pinnedPlugins = attached
    .filter((candidate) => candidate.kind === 'plugin')
    .slice(0, ATTACHED_LIMITS.maxPlugins)
    .map((candidate) => candidate.id);
  const pinnedSkills = attached
    .filter((candidate) => candidate.kind === 'skill')
    .slice(0, ATTACHED_LIMITS.maxSkills)
    .map((candidate) => candidate.id);
  const pinned = new Set([...pinnedPlugins, ...pinnedSkills]);

  const orderOf = (id: string): number => modelOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...scored].toSorted(
    (left, right) =>
      Number(forced.has(right.candidate.id)) - Number(forced.has(left.candidate.id)) ||
      orderOf(left.candidate.id) - orderOf(right.candidate.id) ||
      right.score - left.score ||
      left.candidate.id.localeCompare(right.candidate.id)
  );
  const take = (kind: CapabilityKind, max: number): string[] =>
    ordered
      .filter(({ candidate }) => candidate.kind === kind && !pinned.has(candidate.id))
      .slice(0, max)
      .map(({ candidate }) => candidate.id);
  const keywordPicks = [
    ...take('skill', budget.maxSkills),
    ...take('plugin', budget.maxPlugins),
    ...take('hook', budget.maxHooks),
  ].slice(0, budget.maxTotal);
  return { selectedIds: [...pinnedPlugins, ...pinnedSkills, ...keywordPicks], method, unusable };
};

const PROTOCOL_LINE =
  'Protocol when a needed capability is missing, in order: 1) tools_search with a short query; 2) the plugin tool with action "map" to list every skill, plugin and hook with its id; 3) the plugin tool with action "connect" and that id for a plugin or hook, or skills_read with the skill name for a skill. Use the exact id or name from the map.';

const clipText = (value: string, max: number): string => {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * Short text for the model: what was chosen, what is already attached (its tools are loaded, so no search is
 * needed), each chosen skill with a one-line description, and the fallback ladder for anything not attached.
 */
export const renderCapabilityHint = (input: {
  skills: readonly string[];
  plugins: readonly string[];
  hooks: number;
  /** Plugins (MCP servers) attached this turn. Their tools are already in the tool list. */
  attachedPlugins?: readonly string[];
  /** Chosen skills with descriptions. Absent means names only. */
  skillCatalog?: readonly Readonly<{ name: string; description: string }>[];
}): string => {
  const catalog = input.skillCatalog ?? input.skills.map((name) => ({ name, description: '' }));
  const attached = input.attachedPlugins ?? [];
  const skillLines =
    catalog.length > 0
      ? [
          '- skills (read the body with skills_read by name):',
          ...catalog.map((skill) =>
            skill.description ? `  - ${skill.name}: ${clipText(skill.description, 120)}` : `  - ${skill.name}`
          ),
        ]
      : ['- skills: none'];
  return [
    'Capabilities chosen for this request (auto select). Prefer these over anything else.',
    attached.length > 0
      ? `- attached, already loaded (their tools are in your tool list; use them directly, do not search): ${attached.join(', ')}`
      : '- attached: none',
    `- plugins: ${input.plugins.length > 0 ? input.plugins.join(', ') : 'none'}`,
    ...skillLines,
    `- hooks relevant to this prompt: ${input.hooks}`,
    PROTOCOL_LINE,
  ].join('\n');
};

/**
 * Enabled package plugins attach to every conversation, in every capability mode (2026-10-16). Their MCP servers join
 * the run identity, and a short block tells the model how to use them. A package server that auto select already
 * attached counts against this limit too, so one turn carries at most this many package servers, newest first.
 */
export const PACKAGE_PLUGIN_ATTACH_LIMIT = 4;

/** Tool names listed per plugin in the block. The rest are summarised by a count. */
const MAX_LISTED_PLUGIN_TOOLS = 12;

/** Connection state of an enabled package plugin, from its last connection test. */
export type PackagePluginHealth = 'connected' | 'untested' | 'failing';

/**
 * One enabled package-owned MCP server, prepared by the wiring. It holds names, state and counts only: no command, URL,
 * header, environment value or test diagnostic, so no secret reaches the model through it.
 */
export type PackagePluginEntry = Readonly<{
  /** Registry server id (`pkgconn:<package>:<connection>`, or a legacy `package:` id). */
  serverId: string;
  /** The name the run registers the server under. Its tools are named `mcp__<serverName>__<tool>`. */
  serverName: string;
  title: string;
  packageId: string;
  /** Last registry update. When the limit applies, the most recently updated plugins are kept. */
  updatedAt: number;
  health: PackagePluginHealth;
  /** Tool names known from the last connection test. Empty when unknown. */
  toolNames: readonly string[];
  /** Skills of the package that the conversation has not opted out of. */
  skills: readonly Readonly<{ name: string; description: string }>[];
  /** Hooks of the package that would run now. They run on their events without any call. */
  hookCount: number;
  /** The MCP server the run registers when the plugin is attached. */
  session: ISessionMcpServer;
}>;

/** The package plugins of one turn: the servers to register, their ids, and the context block. */
export type PackageAttachmentTurn = Readonly<{
  /** Merged into the run identity by name; the conversation snapshot keeps priority. Never sent to the renderer. */
  mcpServers: readonly ISessionMcpServer[];
  attachedServerIds: readonly string[];
  hint: string;
}>;

type PackagePluginSkip = Readonly<{ entry: PackagePluginEntry; reason: 'failing' | 'limit' }>;

const PLUGIN_STATUS: Readonly<Record<PackagePluginHealth, string>> = {
  connected: 'enabled and connected',
  untested: 'enabled but not connected yet (no connection test has passed); attached, it starts with the run',
  failing: 'enabled but not connected',
};

const pluginLines = (entry: PackagePluginEntry): string[] => {
  const listed = entry.toolNames
    .slice(0, MAX_LISTED_PLUGIN_TOOLS)
    .map((name) => `mcp__${entry.serverName}__${clipText(name, 80)}`);
  const hidden = entry.toolNames.length - listed.length;
  const tools =
    listed.length > 0
      ? `${listed.join(', ')}${hidden > 0 ? ` and ${hidden} more` : ''}`
      : `mcp__${entry.serverName}__<tool> (names are known at run start)`;
  const skills = entry.skills.map((skill) =>
    skill.description.trim() ? `    - ${skill.name}: ${clipText(skill.description, 120)}` : `    - ${skill.name}`
  );
  return [
    `- ${clipText(entry.title, 80)} (package ${entry.packageId}): MCP server ${entry.serverName}, ${PLUGIN_STATUS[entry.health]}.`,
    `  tools: ${tools}`,
    ...(skills.length > 0 ? ['  skills (read the body with skills_read by name):', ...skills] : ['  skills: none']),
    `  hooks: ${entry.hookCount > 0 ? `${entry.hookCount} run automatically on their events; nothing to call` : 'none'}`,
    `  fallback, only if its tools are missing from your tool list: the plugin tool with action "connect" and id "mcp:${entry.serverId}"`,
  ];
};

/** Context block for the enabled package plugins. Names, state and counts only; it names no command, URL or secret. */
const renderPackagePluginHint = (
  attached: readonly PackagePluginEntry[],
  skipped: readonly PackagePluginSkip[]
): string =>
  [
    attached.length > 0
      ? 'Enabled plugins are attached to this conversation in every capability mode. Their tools are in your tool list: call them directly.'
      : 'Enabled plugins of this conversation are not attached this turn.',
    ...attached.flatMap(pluginLines),
    ...skipped.map(({ entry, reason }) =>
      reason === 'failing'
        ? `- ${clipText(entry.title, 80)} (package ${entry.packageId}): enabled but not connected and not attached this turn (its last connection test failed; reconnect it in Settings).`
        : `- ${clipText(entry.title, 80)} (package ${entry.packageId}): enabled, not attached this turn (the limit is ${PACKAGE_PLUGIN_ATTACH_LIMIT} package plugins per turn).`
    ),
    'Do not call tools_search or the plugin map to find an attached plugin. Its hooks run by themselves; do not call them.',
  ].join('\n');

/**
 * The package plugins attached to one turn, or undefined when there are no enabled package plugins (then the send is
 * unchanged). A plugin whose last connection test failed is never attached and is named as not connected. A plugin not
 * yet tested is attached, because its connection is on. The rest are attached newest first, up to the limit; the ones
 * `alreadyAttachedIds` names (chosen by auto select) count first. Pure: the wiring gathers the entries.
 */
export const buildPackageAttachmentTurn = (input: {
  entries: readonly PackagePluginEntry[];
  alreadyAttachedIds?: readonly string[];
  limit?: number;
}): PackageAttachmentTurn | undefined => {
  if (input.entries.length === 0) return undefined;
  const limit = input.limit ?? PACKAGE_PLUGIN_ATTACH_LIMIT;
  const already = new Set(input.alreadyAttachedIds ?? []);
  const newest = [...input.entries].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.serverId.localeCompare(right.serverId)
  );
  const usable = newest.filter((entry) => entry.health !== 'failing');
  const kept = usable.filter((entry) => already.has(entry.serverId));
  const room = Math.max(0, limit - kept.length);
  const fresh = usable.filter((entry) => !already.has(entry.serverId)).slice(0, room);
  const picked = new Set([...kept, ...fresh].map((entry) => entry.serverId));
  const attached = newest.filter((entry) => picked.has(entry.serverId));
  const skipped = newest
    .filter((entry) => !picked.has(entry.serverId))
    .map((entry): PackagePluginSkip => ({ entry, reason: entry.health === 'failing' ? 'failing' : 'limit' }));
  return {
    mcpServers: attached.map((entry) => entry.session),
    attachedServerIds: attached.map((entry) => entry.serverId),
    hint: renderPackagePluginHint(attached, skipped),
  };
};

/** The auto-select result for one turn. Absent for manual conversations, which keep today's behaviour. */
export type CapabilityTurn = Readonly<{
  mode: 'auto';
  /** Conversation snapshot ids of the MCP servers that may run this turn. */
  mcpServerIds: readonly string[];
  /**
   * Chosen MCP servers that must be restored for this turn even when the conversation snapshot does not hold them
   * (enabled registry servers, or servers an assistant names). They carry the same fields a snapshot entry does and
   * are never sent to the renderer.
   */
  mcpServers: readonly ISessionMcpServer[];
  skillNames: readonly string[];
  hookIds: readonly string[];
  method: CapabilitySelection['method'];
  unusable: number;
  hint: string;
}>;

const rawIdOf = (id: string): string => id.slice(id.indexOf(':') + 1);

/**
 * Resolves the turn choice. Returns undefined unless the conversation mode is `auto`, so a manual send
 * takes exactly the path it took before this feature. `servers` lists every MCP server the turn may restore.
 */
export const resolveCapabilityTurn = async (input: {
  mode: unknown;
  request: string;
  candidates: readonly CapabilityCandidate[];
  forcedIds?: readonly string[];
  rank?: CapabilityRank;
  servers?: readonly ISessionMcpServer[];
}): Promise<CapabilityTurn | undefined> => {
  if (readCapabilityMode(input.mode) !== 'auto') return undefined;
  const selection = await selectCapabilities({
    request: input.request,
    candidates: input.candidates,
    ...(input.forcedIds ? { forcedIds: input.forcedIds } : {}),
    ...(input.rank ? { rank: input.rank } : {}),
  });
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate] as const));
  const chosen = selection.selectedIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is CapabilityCandidate => candidate !== undefined);
  const chosenSkills = chosen.filter((candidate) => candidate.kind === 'skill').map((candidate) => candidate.name);
  const plugins = chosen.filter((candidate) => candidate.kind === 'plugin');
  const servers = plugins.filter((candidate) => candidate.members === undefined);
  // A chosen package brings its skills in as a unit; the skill names are only added, never a server id.
  const packageSkills = plugins.flatMap((candidate) => (candidate.members ?? []).slice(0, MAX_PACKAGE_SKILLS_PER_TURN));
  const skills = [...new Set([...chosenSkills, ...packageSkills])];
  const hooks = chosen.filter((candidate) => candidate.kind === 'hook');
  const serverById = new Map((input.servers ?? []).map((server) => [server.id, server] as const));
  const turnServers = servers
    .map((candidate) => serverById.get(rawIdOf(candidate.id)))
    .filter((server): server is ISessionMcpServer => server !== undefined);
  const skillCatalog = skills.map((name) => {
    const entry =
      chosen.find((candidate) => candidate.kind === 'skill' && candidate.name === name) ??
      input.candidates.find((candidate) => candidate.kind === 'skill' && candidate.name === name);
    return { name, description: entry?.description ?? '' };
  });
  return {
    mode: 'auto',
    mcpServerIds: servers.map((candidate) => rawIdOf(candidate.id)),
    mcpServers: turnServers,
    skillNames: skills,
    hookIds: hooks.map((candidate) => rawIdOf(candidate.id)),
    method: selection.method,
    unusable: selection.unusable,
    hint: renderCapabilityHint({
      skills,
      plugins: plugins.map((candidate) => candidate.name),
      hooks: hooks.length,
      attachedPlugins: servers.filter((candidate) => candidate.attached === true).map((candidate) => candidate.name),
      skillCatalog,
    }),
  };
};
