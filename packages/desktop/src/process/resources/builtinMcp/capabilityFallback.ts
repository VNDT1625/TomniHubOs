/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fallback for auto-selected capabilities (2026-10-15). When the chosen set does not cover a request, the agent
 * climbs this ladder in order: (1) tools_search, (2) the `plugin` tool with action `map`, (3) the same tool with
 * action `connect`. This module holds the pure parts: the budgeted map, the connect rules and the per-conversation
 * activation list. Connect only records an activation; the next turn's selection includes it. Entries that need
 * approval are reported, never enabled. Code-running entries still pass the normal per-call approvals.
 * Process boundary: Main-process module, no DOM APIs.
 */

import type { CapabilityCandidate } from '@process/services/chatPipeline/stages/capabilitySelect';
import { closeMatches, skillLookupKey } from '@process/resources/skillDocument/nameMatch';

/** Map output budget per call. The list is truncated with a count when it does not fit. */
export const CAPABILITY_MAP_MAX_BYTES = 4_096;

const MAX_ACTIVATION_CONVERSATIONS = 200;
const MAX_ACTIVATIONS_PER_CONVERSATION = 32;
const TAIL_RESERVE_BYTES = 120;

export type PluginToolInput = Readonly<{ action: 'map' } | { action: 'connect'; id: string }>;
export type PluginToolResult = Readonly<{ text: string; isError: boolean }>;

const activations = new Map<string, Set<string>>();

/** Records a connect for the conversation's next turn. Bounded: the oldest conversation and entry are dropped first. */
export const activateCapability = (conversationId: string, id: string): void => {
  const current = activations.get(conversationId) ?? new Set<string>();
  activations.delete(conversationId);
  current.add(id);
  while (current.size > MAX_ACTIVATIONS_PER_CONVERSATION) {
    const oldest = current.values().next().value;
    if (oldest === undefined) break;
    current.delete(oldest);
  }
  activations.set(conversationId, current);
  while (activations.size > MAX_ACTIVATION_CONVERSATIONS) {
    const oldestConversation = activations.keys().next().value;
    if (oldestConversation === undefined) break;
    activations.delete(oldestConversation);
  }
};

/** Ids connected for this conversation and not yet consumed. */
export const activatedCapabilityIds = (conversationId: string): readonly string[] => [
  ...(activations.get(conversationId) ?? []),
];

const CONTROL_CHARACTERS = /\p{Cc}+/gu;
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:sk|ghp|xox[abp]|AKIA)[-_A-Za-z0-9]{8,}/g, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]'],
  [/\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]'],
];

/** Catalog text made safe to show a model: no control characters, no secret-looking values, bounded length. */
export const safeCatalogText = (value: string, max: number): string => {
  let text = value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

type MapRow = Readonly<{ candidate: CapabilityCandidate; indent: string }>;

/**
 * Orders the map rows: each package line is followed by its skills, indented, so the agent sees a plugin as one unit.
 * Every candidate appears exactly once; a skill whose package is not in the list is kept at the end.
 */
const mapSequence = (ordered: readonly CapabilityCandidate[]): MapRow[] => {
  const packageIds = new Set(ordered.filter((candidate) => candidate.members !== undefined).map((c) => c.name));
  const skillsByPackage = new Map<string, CapabilityCandidate[]>();
  for (const candidate of ordered) {
    if (candidate.group === undefined) continue;
    skillsByPackage.set(candidate.group, [...(skillsByPackage.get(candidate.group) ?? []), candidate]);
  }
  const rows: MapRow[] = [];
  for (const candidate of ordered) {
    if (candidate.group !== undefined && packageIds.has(candidate.group)) continue;
    rows.push({ candidate, indent: '' });
    if (candidate.members === undefined) continue;
    for (const skill of skillsByPackage.get(candidate.name) ?? []) rows.push({ candidate: skill, indent: '  ' });
  }
  for (const [group, skills] of skillsByPackage) {
    if (packageIds.has(group)) continue;
    for (const skill of skills) rows.push({ candidate: skill, indent: '' });
  }
  return rows;
};

/**
 * The compact map of every candidate: id, kind, name, state and one short line. Budgeted to
 * {@link CAPABILITY_MAP_MAX_BYTES}; entries that do not fit are counted in the tail line.
 */
export const buildCapabilityMap = (
  candidates: readonly CapabilityCandidate[],
  maxBytes: number = CAPABILITY_MAP_MAX_BYTES
): Readonly<{ text: string; shown: number; omitted: number }> => {
  const header =
    'Capability map: entries this conversation may use. "enabled" and "approved" show their state. Use the plugin tool with action "connect" and an id for a plugin or hook; read a skill with skills_read and its name. Skills of a package are indented under it.';
  const ordered = [...candidates].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  );
  const sequence = mapSequence(ordered);
  const lines: string[] = [];
  let used = Buffer.byteLength(header, 'utf8');
  for (const { candidate, indent } of sequence) {
    const state = `${candidate.enabled ? 'enabled' : 'disabled'}, ${
      candidate.approved ? 'approved' : 'needs approval in Settings'
    }`;
    const line = `${indent}- ${candidate.id} | ${candidate.kind} | ${safeCatalogText(candidate.name, 60)} | ${state} | ${safeCatalogText(candidate.description, 120)}`;
    const size = Buffer.byteLength(line, 'utf8') + 1;
    if (used + size + TAIL_RESERVE_BYTES > maxBytes) break;
    lines.push(line);
    used += size;
  }
  const omitted = sequence.length - lines.length;
  const tail = omitted > 0 ? [`... ${omitted} more not shown; narrow the list with tools_search.`] : [];
  return { text: [header, ...lines, ...tail].join('\n'), shown: lines.length, omitted };
};

/** Entries a connect answer lists by name for a package. Keeps the answer short. */
const MAX_LISTED_PACKAGE_SKILLS = 8;

/**
 * Entries a connect id can name: the exact id first, else the bare name (`skill:x` and `x` both work). More than one
 * match is returned as is, so the caller can ask for an exact id instead of guessing.
 */
const findCandidates = (id: string, candidates: readonly CapabilityCandidate[]): CapabilityCandidate[] => {
  const exact = candidates.filter((candidate) => candidate.id === id);
  if (exact.length > 0) return exact;
  const key = skillLookupKey(id);
  return candidates.filter((candidate) => candidate.name.toLowerCase() === key);
};

const nextStepFor = (candidate: CapabilityCandidate): string => {
  if (candidate.kind === 'skill') {
    return `Read it with skills_read (name "${safeCatalogText(candidate.name, 80)}") before using it.`;
  }
  if (candidate.members !== undefined) {
    const listed = candidate.members.slice(0, MAX_LISTED_PACKAGE_SKILLS).join(', ');
    return `Its skills are ${listed || 'none'}; read the one you need with skills_read by its name.`;
  }
  if (candidate.kind === 'hook') return 'Hooks run on their own event; this only keeps it in the next turn.';
  if (candidate.runsCode) return 'It starts code, so each of its tool calls still goes through the normal approval.';
  return 'Its tools are available from the next turn; call tools_search with the purpose to get their exact names.';
};

/**
 * Runs one plugin-tool action against the conversation's candidates. Only enabled and approved entries can be
 * connected; anything else is refused with a reason the agent can pass on to the user.
 */
export const runPluginTool = (
  input: PluginToolInput,
  candidates: readonly CapabilityCandidate[],
  conversationId: string
): PluginToolResult => {
  if (input.action === 'map') return { text: buildCapabilityMap(candidates).text, isError: false };
  const matches = findCandidates(input.id, candidates);
  if (matches.length > 1) {
    const ids = matches.map((candidate) => candidate.id).join(', ');
    return {
      text: `"${safeCatalogText(input.id, 80)}" matches more than one entry: ${ids}. Connect with one exact id.`,
      isError: true,
    };
  }
  const target = matches[0];
  if (!target) {
    const close = closeMatches(
      input.id,
      candidates.map((candidate) => candidate.id)
    );
    const hint = close.length > 0 ? ` Close ids: ${close.join(', ')}.` : '';
    return {
      text: `Unknown entry "${safeCatalogText(input.id, 80)}".${hint} Call the plugin tool with action "map" to list valid ids.`,
      isError: true,
    };
  }
  if (!target.enabled) {
    return {
      text: `${target.name} is disabled. The user must enable it in Settings; it was not switched on.`,
      isError: true,
    };
  }
  if (!target.approved) {
    return { text: `${target.name} needs approval in Settings. It was not enabled automatically.`, isError: true };
  }
  activateCapability(conversationId, target.id);
  return {
    text: `Connected ${target.name} (${target.kind}) for the next turn. ${nextStepFor(target)}`,
    isError: false,
  };
};

/** A skill row a package candidate is built from. */
type PackageSkillEntry = Readonly<{
  name: string;
  description: string;
  packageId?: string | undefined;
  enabled: boolean;
}>;

/**
 * One plugin candidate per installed package, listing its skills as members. A package is enabled while any of its
 * skills is enabled. Connecting the package (id `package:<id>`) brings its skills in together for the next turn.
 */
export const packageCandidates = (skills: readonly PackageSkillEntry[]): CapabilityCandidate[] => {
  const byPackage = new Map<string, PackageSkillEntry[]>();
  for (const skill of skills) {
    if (skill.packageId === undefined) continue;
    byPackage.set(skill.packageId, [...(byPackage.get(skill.packageId) ?? []), skill]);
  }
  return [...byPackage].map(([packageId, members]): CapabilityCandidate => {
    const count = members.length;
    const listed = members
      .slice(0, MAX_LISTED_PACKAGE_SKILLS)
      .map((member) => member.name)
      .join(', ');
    return {
      id: `package:${packageId}`,
      kind: 'plugin',
      name: packageId,
      description: `Installed package with ${count} skill${count === 1 ? '' : 's'}: ${listed}`,
      enabled: members.some((member) => member.enabled),
      approved: true,
      runsCode: false,
      members: members.map((member) => member.name),
    };
  });
};

export type CapabilityFallback = Readonly<{
  run: (conversationId: string | undefined, input: PluginToolInput) => Promise<PluginToolResult>;
}>;

/**
 * How long one conversation's candidate pool is reused by the plugin tool. A map followed by a connect in the same
 * burst loads the pool once instead of once per call; enabled state can be up to this old.
 */
export const CAPABILITY_POOL_TTL_MS = 8_000;
const MAX_CACHED_POOLS = 50;

/**
 * Builds the fallback from a loader that reads a conversation's candidates. Needs a bound conversation. The pool is
 * cached per conversation for {@link CAPABILITY_POOL_TTL_MS}; concurrent calls share one load, and a failed load is
 * not cached.
 */
export const createCapabilityFallback = (
  loadCandidates: (conversationId: string) => Promise<readonly CapabilityCandidate[]>,
  options: Readonly<{ ttlMs?: number; now?: () => number }> = {}
): CapabilityFallback => {
  const ttlMs = options.ttlMs ?? CAPABILITY_POOL_TTL_MS;
  const now = options.now ?? Date.now;
  const pools = new Map<string, Readonly<{ loadedAt: number; pending: Promise<readonly CapabilityCandidate[]> }>>();
  const poolFor = (conversationId: string): Promise<readonly CapabilityCandidate[]> => {
    const cached = pools.get(conversationId);
    if (cached && now() - cached.loadedAt < ttlMs) return cached.pending;
    const pending = loadCandidates(conversationId);
    pools.delete(conversationId);
    pools.set(conversationId, { loadedAt: now(), pending });
    while (pools.size > MAX_CACHED_POOLS) {
      const oldest = pools.keys().next().value;
      if (oldest === undefined) break;
      pools.delete(oldest);
    }
    pending.catch((): void => {
      if (pools.get(conversationId)?.pending === pending) pools.delete(conversationId);
    });
    return pending;
  };
  return {
    run: async (conversationId, input) => {
      if (!conversationId) {
        return { text: 'This session has no conversation, so plugin lookup is unavailable.', isError: true };
      }
      return runPluginTool(input, await poolFor(conversationId), conversationId);
    },
  };
};
