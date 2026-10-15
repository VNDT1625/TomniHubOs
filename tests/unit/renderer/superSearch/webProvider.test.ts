import { describe, expect, it } from 'vitest';
import {
  createCustomProvider,
  createEngineProvider,
  createWebProvider,
  findKnownSites,
  looksLikeUrl,
  toNavigableUrl,
  WEB_ENGINES,
  type WebLabels,
} from '@/renderer/components/layout/SuperSearch/providers/webSources';

const labels: WebLabels = {
  webLabel: 'Web',
  searchWith: (engine, query) => `Search ${engine} for "${query}"`,
  openSite: (host) => `Open ${host}`,
};
const ctx = (query: string) => ({ query, limit: 30, signal: new AbortController().signal });
const engine = (id: string) => {
  const found = WEB_ENGINES.find((e) => e.id === id);
  if (!found) throw new Error(`missing engine ${id}`);
  return found;
};

describe('looksLikeUrl / toNavigableUrl', () => {
  it('recognises addresses the way an address bar does', () => {
    for (const value of [
      'facebook.com',
      'https://x.com/y',
      'localhost:3000',
      'www.example.org/a?b=1',
      '127.0.0.1:8080',
    ]) {
      expect(looksLikeUrl(value), value).toBe(true);
    }
    for (const value of ['facebook', 'hello world', 'a.b c', 'javascript:alert(1)', 'file:///C:/secrets', '']) {
      expect(looksLikeUrl(value), value).toBe(false);
    }
  });

  it('adds https when the scheme is missing and keeps http(s) as typed', () => {
    expect(toNavigableUrl('facebook.com')).toBe('https://facebook.com/');
    expect(toNavigableUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(toNavigableUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('findKnownSites', () => {
  it('matches by name, domain and short keyword, best first', () => {
    expect(findKnownSites('facebook')[0]?.id).toBe('facebook');
    expect(findKnownSites('fb')[0]?.id).toBe('facebook');
    expect(findKnownSites('face')[0]?.id).toBe('facebook');
    expect(findKnownSites('zzzzzz')).toEqual([]);
  });
});

describe('createWebProvider', () => {
  const provider = createWebProvider(labels, 'google');

  it('suggests the site first and offers a search on the default engine', async () => {
    const hits = await provider.search(ctx('facebook'));
    expect(hits[0]).toMatchObject({ action: { kind: 'url', url: 'https://www.facebook.com/' }, icon: 'site' });
    expect(
      hits.some((hit) => hit.action.kind === 'url' && hit.action.url === 'https://www.google.com/search?q=facebook')
    ).toBe(true);
    expect(hits[0].score).toBeGreaterThan(hits.at(-1)?.score ?? 1);
  });

  it('treats a typed address as the best hit', async () => {
    const hits = await provider.search(ctx('example.com/path'));
    expect(hits[0]).toMatchObject({
      title: 'Open example.com',
      score: 1,
      action: { kind: 'url', url: 'https://example.com/path' },
    });
  });

  it('encodes the query it sends to a search engine', async () => {
    const hits = await provider.search(ctx('a b&c=d'));
    const urls = hits.flatMap((hit) => (hit.action.kind === 'url' ? [hit.action.url] : []));
    expect(urls).toContain('https://www.google.com/search?q=a%20b%26c%3Dd');
  });

  it('never turns a script scheme into a navigation', async () => {
    const hits = await provider.search(ctx('javascript:alert(1)'));
    const urls = hits.flatMap((hit) => (hit.action.kind === 'url' ? [hit.action.url] : []));
    expect(urls.every((url) => url.startsWith('https://'))).toBe(true);
    expect(urls.some((url) => url.includes('javascript:alert'))).toBe(false);
  });

  it('exposes the web source as part of All with the configured default alias', () => {
    expect(provider.source).toMatchObject({ id: 'web', kind: 'web', defaultAlias: 'w', includeInAllByDefault: true });
  });
});

describe('createEngineProvider', () => {
  it('searches the named site and stays out of All by default', async () => {
    const provider = createEngineProvider(engine('facebook'), labels);
    expect(provider.source).toMatchObject({
      id: 'facebook',
      kind: 'site',
      defaultAlias: 'fb',
      includeInAllByDefault: false,
    });
    const hits = await provider.search(ctx('abc'));
    expect(hits[0].action).toEqual({ kind: 'url', url: 'https://www.facebook.com/search/top?q=abc' });
    expect(hits[0].title).toBe('Search Facebook for "abc"');
  });

  it('ships X and the main web search engines with short aliases', () => {
    expect(engine('x').defaultAlias).toBe('x');
    expect(engine('google').defaultAlias).toBe('g');
    expect(engine('yahoo').searchUrl('q')).toBe('https://search.yahoo.com/search?p=q');
    expect(new Set(WEB_ENGINES.map((e) => e.defaultAlias)).size).toBe(WEB_ENGINES.length);
  });
});

describe('createCustomProvider', () => {
  it('builds a site search from a user link template with the query encoded', async () => {
    const provider = createCustomProvider(
      { id: 'custom-maps', label: 'Maps', alias: 'maps', urlTemplate: 'https://www.google.com/maps/search/{q}' },
      labels
    );
    expect(provider.source).toMatchObject({
      id: 'custom-maps',
      kind: 'site',
      defaultAlias: 'maps',
      includeInAllByDefault: false,
    });
    const hits = await provider.search(ctx('quan an & cafe'));
    expect(hits[0].action).toEqual({ kind: 'url', url: 'https://www.google.com/maps/search/quan%20an%20%26%20cafe' });
    expect(hits[1].action).toEqual({ kind: 'url', url: 'https://www.google.com/' });
  });
});
