/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Name tolerance for skill and capability lookups (2026-10-15). The map shows catalog ids such as `skill:<name>`,
 * while skill reads take the bare skill name. Both forms resolve here, and a miss returns close names instead of a
 * bare "unknown" so the agent can correct the call. Pure functions, no I/O.
 * Process boundary: Main-process module, no DOM APIs.
 */

const MAX_ECHO_CHARS = 80;
const MAX_SUGGESTIONS = 5;

/** Lookup key of a skill name or catalog id: trimmed, lowercase, without a leading `skill:` prefix. */
export const skillLookupKey = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  return trimmed.replace(/^skill:/u, '').trim();
};

/** Caller-supplied text shown back in an error: control characters removed and length capped. */
const echo = (value: string): string => {
  const plain = value.replace(/\p{Cc}+/gu, ' ').trim();
  return plain.slice(0, MAX_ECHO_CHARS);
};

const tokensOf = (value: string): string[] => value.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3);

/**
 * Up to a few names close to `query`, best first. A name scores when it contains the query, the query contains it,
 * or they share a word of three or more characters. Cheap enough for a catalog of a few thousand names.
 */
export const closeMatches = (query: string, names: readonly string[], limit = MAX_SUGGESTIONS): string[] => {
  const key = skillLookupKey(query);
  if (!key) return [];
  const queryTokens = new Set(tokensOf(key));
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    let score = 0;
    if (lower.includes(key)) score += 3;
    else if (key.includes(lower)) score += 2;
    for (const token of tokensOf(lower)) if (queryTokens.has(token)) score += 1;
    if (score > 0) scored.push({ name, score });
  }
  return scored
    .toSorted((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map((item) => item.name);
};

/** The error an agent reads when a skill name does not resolve. It explains the id form and lists close names. */
export const unknownSkillMessage = (requested: string, names: readonly string[]): string => {
  const close = closeMatches(requested, names);
  const hint =
    close.length > 0
      ? ` Close names: ${close.join(', ')}.`
      : ' No close name was found; use tools_search or the plugin tool with action "map" to list valid names.';
  return `Unknown skill "${echo(requested)}". Pass the exact skill name, or its id such as skill:<name> from the map.${hint}`;
};
