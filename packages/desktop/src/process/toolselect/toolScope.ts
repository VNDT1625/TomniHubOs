import { createHash } from 'node:crypto';

/**
 * The tool-name patterns one conversation is allowed to use. The tool-selector host is shared by every
 * conversation, so a scope id travels in the host URL and lets `tools_search` and `tools_guide` answer for
 * that conversation's tools only. A tool the conversation cannot load must not be offered to it.
 */
const MAX_SCOPES = 256;
const scopes = new Map<string, readonly string[]>();

/** The id is derived from the patterns, so the same tool set always gives the same URL. */
export const registerToolScope = (patterns: readonly string[]): string => {
  const normalized = [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))].toSorted();
  const id = createHash('sha256').update(normalized.join('\n')).digest('hex').slice(0, 16);
  scopes.delete(id);
  scopes.set(id, normalized);
  while (scopes.size > MAX_SCOPES) {
    const oldest = scopes.keys().next().value;
    if (oldest === undefined) break;
    scopes.delete(oldest);
  }
  return id;
};

/** Patterns of a registered scope; `undefined` for an unknown id, which callers treat as unrestricted. */
export const getToolScope = (id: string | null | undefined): readonly string[] | undefined =>
  id ? scopes.get(id) : undefined;
