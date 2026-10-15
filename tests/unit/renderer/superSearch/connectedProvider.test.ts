import { describe, expect, it } from 'vitest';
import {
  createConnectedProvider,
  discoverSearchTools,
  parseConnectedResults,
  type ConnectedSearchTool,
} from '@/renderer/components/layout/SuperSearch/providers/connectedProvider';
import { ProviderUnavailableError } from '@/renderer/components/layout/SuperSearch/engine/types';
import { runSearch } from '@/renderer/components/layout/SuperSearch/engine/searchEngine';

const server = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Notion Docs',
  enabled: true,
  last_test_status: 'connected' as const,
  tools: [{ name: 'search_pages' }, { name: 'create_page' }],
  ...over,
});
const tool: ConnectedSearchTool = { serverId: 's1', serverName: 'Notion Docs', toolName: 'search_pages' };
const ctx = (query = 'roadmap') => ({ query, limit: 30, signal: new AbortController().signal });

describe('discoverSearchTools', () => {
  it('finds search-like tools on enabled, connected servers only', () => {
    expect(discoverSearchTools([server()])).toEqual([tool]);
    expect(discoverSearchTools([server({ enabled: false })])).toEqual([]);
    expect(discoverSearchTools([server({ last_test_status: 'error' })])).toEqual([]);
    expect(discoverSearchTools([server({ last_test_status: undefined })])).toEqual([]);
    expect(discoverSearchTools([server({ tools: [{ name: 'create_page' }] })])).toEqual([]);
    expect(discoverSearchTools([server({ tools: undefined })])).toEqual([]);
  });

  it('matches common naming styles but not look-alike words', () => {
    const names = ['search', 'web.search', 'findDocs', 'query-notes', 'lookup_user', 'research_topic', 'searchable'];
    const found = discoverSearchTools(names.map((name, index) => server({ id: 's' + index, tools: [{ name }] }))).map(
      (t) => t.toolName
    );
    expect(found).toEqual(['search', 'web.search', 'findDocs', 'query-notes', 'lookup_user']);
  });

  it('uses the first search tool of each server', () => {
    const tools = [{ name: 'search_pages' }, { name: 'search_users' }];
    expect(discoverSearchTools([server({ tools })])).toHaveLength(1);
  });
});

describe('parseConnectedResults', () => {
  it('reads MCP text content holding a JSON result list', () => {
    const payload = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ results: [{ title: 'Roadmap', url: 'https://n.example/1', snippet: 'Q4' }] }),
        },
      ],
    };
    expect(parseConnectedResults(payload)).toEqual([{ title: 'Roadmap', url: 'https://n.example/1', snippet: 'Q4' }]);
  });

  it('accepts a bare array and ignores malformed items and payloads', () => {
    expect(parseConnectedResults([{ title: 'A', url: 'https://a.example' }, { nope: 1 }, 'x', null])).toEqual([
      { title: 'A', url: 'https://a.example' },
    ]);
    expect(parseConnectedResults('not json')).toEqual([]);
    expect(parseConnectedResults(undefined)).toEqual([]);
    expect(parseConnectedResults({ content: [{ type: 'text', text: '{bad' }] })).toEqual([]);
  });
});

describe('createConnectedProvider', () => {
  it('describes a connected source with a unique, safe id and stays out of nothing by default', () => {
    const provider = createConnectedProvider(tool, undefined, 'notion');
    expect(provider.source).toMatchObject({
      id: 'mcp:s1',
      kind: 'connected',
      label: 'Notion Docs',
      defaultAlias: 'notion',
      includeInAllByDefault: true,
    });
  });

  it('calls the invoker with the query, limit and signal and maps results to ranked hits', async () => {
    const calls: unknown[] = [];
    const provider = createConnectedProvider(
      tool,
      async (invoked, query, limit, signal) => {
        calls.push({ invoked, query, limit, aborted: signal.aborted });
        return [
          { title: 'First', url: 'https://x.example/1' },
          { title: 'Second', url: 'https://x.example/2', snippet: 'more' },
        ];
      },
      'notion'
    );
    const hits = await provider.search(ctx());
    expect(calls).toEqual([{ invoked: tool, query: 'roadmap', limit: 30, aborted: false }]);
    expect(hits.map((h) => h.title)).toEqual(['First', 'Second']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits[1]).toMatchObject({
      subtitle: 'more',
      action: { kind: 'url', url: 'https://x.example/2' },
      sourceId: 'mcp:s1',
    });
  });

  it('is unavailable (not a crash) while no execution bridge is wired', async () => {
    const provider = createConnectedProvider(tool, undefined, 'notion');
    await expect(provider.search(ctx())).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('drops results whose url is not http(s) once it goes through the engine', async () => {
    const provider = createConnectedProvider(
      tool,
      async () => [
        { title: 'Bad', url: 'javascript:alert(1)' },
        { title: 'Good', url: 'https://ok.example' },
      ],
      'notion'
    );
    const states: Record<string, unknown> = {};
    await runSearch([provider], 'q', { signal: new AbortController().signal, onState: (id, s) => (states[id] = s) });
    expect((states['mcp:s1'] as { hits: Array<{ title: string }> }).hits.map((h) => h.title)).toEqual(['Good']);
  });
});
