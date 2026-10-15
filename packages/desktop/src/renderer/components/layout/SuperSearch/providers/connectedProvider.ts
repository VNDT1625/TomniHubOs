/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderUnavailableError, type SearchHit, type SearchProvider } from '../engine/types';

/**
 * Connected providers: a capability the user already bound (today: an enabled, healthy MCP server
 * that exposes a search-like tool). Discovery is read-only. Running the tool needs a main-process
 * bridge with permission, egress and audit checks; until one is injected the source reports
 * `unavailable` instead of calling anything.
 */

export type ConnectedSearchTool = { serverId: string; serverName: string; toolName: string };

/** Minimal view of a configured MCP server (structurally compatible with `IMcpServer`). */
export type ConnectedServerInfo = {
  id: string;
  name: string;
  enabled: boolean;
  last_test_status?: 'connected' | 'disconnected' | 'error' | 'testing';
  tools?: ReadonlyArray<{ name: string }>;
};

/** Executes one search tool. Must enforce permissions and honour `signal`; supplied by the host. */
export type ConnectedInvoker = (
  tool: ConnectedSearchTool,
  query: string,
  limit: number,
  signal: AbortSignal
) => Promise<unknown>;

export type ConnectedResult = { title: string; url: string; snippet?: string };

const SEARCH_TOOL_PATTERN = /(^|[^a-z])(search|find|query|lookup)(?![a-z])/;

const isSearchToolName = (name: string): boolean =>
  SEARCH_TOOL_PATTERN.test(name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());

/** One search tool per enabled server whose last connection test succeeded. */
export const discoverSearchTools = (servers: readonly ConnectedServerInfo[]): ConnectedSearchTool[] =>
  servers.flatMap((server) => {
    if (!server.enabled || server.last_test_status !== 'connected') return [];
    const tool = server.tools?.find((candidate) => isSearchToolName(candidate.name));
    return tool ? [{ serverId: server.id, serverName: server.name, toolName: tool.name }] : [];
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const extractList = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.content)) {
    for (const part of record.content) {
      const text = asRecord(part)?.text;
      if (typeof text === 'string') {
        const parsed = extractList(parseJson(text));
        if (parsed.length > 0) return parsed;
      }
    }
  }
  return [];
};

/** Accepts a bare list, `{ results }`, or MCP text content holding either; everything else yields []. */
export const parseConnectedResults = (payload: unknown): ConnectedResult[] =>
  extractList(payload).flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.title !== 'string' || typeof record.url !== 'string') return [];
    const result: ConnectedResult = { title: record.title, url: record.url };
    if (typeof record.snippet === 'string') result.snippet = record.snippet;
    return [result];
  });

/** Builds the provider for one bound tool. `alias` must already be unique among all sources. */
export const createConnectedProvider = (
  tool: ConnectedSearchTool,
  invoke: ConnectedInvoker | undefined,
  alias: string
): SearchProvider => {
  const sourceId = `mcp:${tool.serverId}`;
  return {
    source: {
      id: sourceId,
      kind: 'connected',
      label: tool.serverName,
      defaultAlias: alias,
      includeInAllByDefault: true,
    },
    search: async ({ query, limit, signal }) => {
      if (!invoke) throw new ProviderUnavailableError('no-bridge');
      const results = parseConnectedResults(await invoke(tool, query, limit, signal)).slice(0, limit);
      return results.map(
        (result, index): SearchHit => ({
          id: `${sourceId}:${result.url}`,
          sourceId,
          title: result.title,
          subtitle: result.snippet,
          score: 1 - index / (results.length + 1),
          icon: 'connected',
          action: { kind: 'url', url: result.url },
        })
      );
    },
  };
};
