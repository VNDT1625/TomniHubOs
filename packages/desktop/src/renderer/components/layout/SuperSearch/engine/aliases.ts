/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/** Maps a source id to the short alias that scopes a query to it (`fb: abc`). */
export type AliasMap = Readonly<Record<string, string>>;

export type ParsedQuery = {
  /** `all` or a source id. */
  scope: string;
  text: string;
  /** The alias exactly as it resolved (lowercase), or null when there was no prefix. */
  alias: string | null;
};

export const SCOPE_ALL = 'all';

const ALIAS_PATTERN = /^[a-z0-9_-]{1,12}$/;
const PREFIX_PATTERN = /^\s*([A-Za-z0-9_-]{1,12})\s*:\s*([\s\S]*)$/;

/** Aliases are short lowercase slugs; `all` is reserved for the every-source scope. */
export const isValidAlias = (alias: string): boolean => ALIAS_PATTERN.test(alias) && alias !== SCOPE_ALL;

/**
 * Splits `alias: text` into a scope and the text to search. Anything that does not start with a
 * known alias or source id (URLs, times such as `10:30`) is searched in the `all` scope unchanged.
 */
export const parseSuperQuery = (raw: string, aliases: AliasMap): ParsedQuery => {
  const match = PREFIX_PATTERN.exec(raw);
  if (!match) return { scope: SCOPE_ALL, text: raw.trim(), alias: null };
  const token = match[1].toLowerCase();
  const text = match[2].trim();
  if (token === SCOPE_ALL) return { scope: SCOPE_ALL, text, alias: SCOPE_ALL };
  for (const [sourceId, alias] of Object.entries(aliases)) {
    if (alias === token || sourceId.toLowerCase() === token) return { scope: sourceId, text, alias: token };
  }
  return { scope: SCOPE_ALL, text: raw.trim(), alias: null };
};

/**
 * Applies user overrides on top of the defaults. An override is ignored when it is malformed,
 * reserved, unknown, or already taken by another source, so the result is always collision-free.
 */
export const resolveAliasMap = (
  defaults: AliasMap,
  overrides: Readonly<Record<string, string | undefined>>
): AliasMap => {
  const resolved: Record<string, string> = { ...defaults };
  for (const [sourceId, value] of Object.entries(overrides)) {
    if (!(sourceId in defaults) || typeof value !== 'string') continue;
    const candidate = value.trim().toLowerCase();
    if (!isValidAlias(candidate)) continue;
    const taken = Object.entries(resolved).some(([otherId, alias]) => otherId !== sourceId && alias === candidate);
    if (taken) continue;
    resolved[sourceId] = candidate;
  }
  return resolved;
};
