import { describe, expect, it } from 'vitest';
import { findRecentPages, recordRecentPage } from '@/renderer/components/layout/SuperSearch/providers/recentPages';
import { createEngineProvider, WEB_ENGINES } from '@/renderer/components/layout/SuperSearch/providers/webSources';

const memory = () => {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
};

describe('recent pages', () => {
  it('remembers opened pages, newest first, without duplicates', () => {
    const storage = memory();
    recordRecentPage({ title: 'Facebook', url: 'https://www.facebook.com/' }, storage);
    recordRecentPage({ title: 'Face Blog', url: 'https://blog.example/face' }, storage);
    recordRecentPage({ title: 'Facebook', url: 'https://www.facebook.com/' }, storage);
    expect(findRecentPages('face', storage).map((p) => p.title)).toEqual(['Facebook', 'Face Blog']);
  });

  it('ignores non-http(s) pages and caps results at 10', () => {
    const storage = memory();
    recordRecentPage({ title: 'bad', url: 'javascript:alert(1)' }, storage);
    for (let i = 0; i < 15; i += 1) recordRecentPage({ title: `Page ${i}`, url: `https://e.example/${i}` }, storage);
    expect(findRecentPages('bad', storage)).toEqual([]);
    expect(findRecentPages('page', storage)).toHaveLength(10);
  });

  it('lists page names (top 10) before the search row in an engine source', async () => {
    const storage = memory();
    for (let i = 0; i < 12; i += 1) recordRecentPage({ title: `Rau ma ${i}`, url: `https://r.example/${i}` }, storage);
    const google = WEB_ENGINES.find((engine) => engine.id === 'google');
    if (!google) throw new Error('google engine missing');
    const provider = createEngineProvider(
      google,
      {
        webLabel: 'Web',
        searchWith: (engine, query) => `Search ${engine} ${query}`,
        openSite: (host) => `Open ${host}`,
      },
      storage
    );
    const hits = (await provider.search({ query: 'rau', limit: 30, signal: new AbortController().signal })).toSorted(
      (a, b) => b.score - a.score
    );
    expect(hits.slice(0, 10).every((hit) => hit.title.startsWith('Rau ma'))).toBe(true);
    expect(hits).toHaveLength(11);
    expect(hits.at(-1)?.title).toBe('Search Google rau');
  });
});
