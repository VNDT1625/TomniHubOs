/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SearchHit, SearchProvider } from '../engine/types';
import { findRecentPages, MAX_PAGE_SUGGESTIONS } from './recentPages';

/**
 * Address-bar style web sources. Everything here is computed locally: no query leaves the app
 * until the user activates a hit, which opens the URL in the in-app Browser.
 */

export type WebEngine = {
  id: string;
  label: string;
  defaultAlias: string;
  /** True for general web search engines; false for site-specific search (Facebook, X, ...). */
  isSearchEngine: boolean;
  searchUrl: (query: string) => string;
};

export const WEB_ENGINES: readonly WebEngine[] = [
  {
    id: 'google',
    label: 'Google',
    defaultAlias: 'g',
    isSearchEngine: true,
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'bing',
    label: 'Bing',
    defaultAlias: 'b',
    isSearchEngine: true,
    searchUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    defaultAlias: 'ddg',
    isSearchEngine: true,
    searchUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    defaultAlias: 'y',
    isSearchEngine: true,
    searchUrl: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    defaultAlias: 'fb',
    isSearchEngine: false,
    searchUrl: (q) => `https://www.facebook.com/search/top?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'x',
    label: 'X',
    defaultAlias: 'x',
    isSearchEngine: false,
    searchUrl: (q) => `https://x.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'youtube',
    label: 'YouTube',
    defaultAlias: 'yt',
    isSearchEngine: false,
    searchUrl: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  },
  {
    id: 'github',
    label: 'GitHub',
    defaultAlias: 'gh',
    isSearchEngine: false,
    searchUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    defaultAlias: 'rd',
    isSearchEngine: false,
    searchUrl: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    defaultAlias: 'wiki',
    isSearchEngine: false,
    searchUrl: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  },
];

export type WebLabels = {
  webLabel: string;
  searchWith: (engine: string, query: string) => string;
  openSite: (host: string) => string;
};

type KnownSite = { id: string; name: string; url: string; keywords: readonly string[] };

const KNOWN_SITES: readonly KnownSite[] = [
  { id: 'facebook', name: 'Facebook', url: 'https://www.facebook.com/', keywords: ['fb', 'meta'] },
  { id: 'x', name: 'X', url: 'https://x.com/', keywords: ['x', 'twitter'] },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', keywords: ['yt'] },
  { id: 'google', name: 'Google', url: 'https://www.google.com/', keywords: [] },
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/', keywords: ['mail', 'email'] },
  { id: 'github', name: 'GitHub', url: 'https://github.com/', keywords: ['gh', 'git'] },
  { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/', keywords: [] },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org/', keywords: ['wiki'] },
  { id: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/', keywords: [] },
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/', keywords: [] },
  { id: 'zalo', name: 'Zalo', url: 'https://chat.zalo.me/', keywords: [] },
  { id: 'shopee', name: 'Shopee', url: 'https://shopee.vn/', keywords: [] },
  { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/', keywords: [] },
];

const HOST_PATTERN = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d{2,5})?([/?#]\S*)?$/i;
const MAX_SITE_HITS = 4;

/** Only http(s) addresses or bare hosts count; `javascript:`, `file:` and friends never do. */
export const looksLikeUrl = (value: string): boolean => {
  const text = value.trim();
  if (text.length === 0 || /\s/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).href.length > 0;
    } catch {
      return false;
    }
  }
  return HOST_PATTERN.test(text);
};

/** Returns an absolute http(s) URL for address-like input, or null. */
export const toNavigableUrl = (value: string): string | null => {
  if (!looksLikeUrl(value)) return null;
  const text = value.trim();
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).href;
  } catch {
    return null;
  }
};

const normalise = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const siteScore = (site: KnownSite, query: string): number => {
  const name = normalise(site.name);
  const hostLabel = new URL(site.url).hostname.replace(/^www\./, '').split('.')[0];
  if (site.keywords.includes(query) || name === query) return 0.95;
  if (query.length < 2) return 0;
  if (name.startsWith(query) || hostLabel.startsWith(query)) return 0.9;
  if (site.keywords.some((keyword) => keyword.startsWith(query))) return 0.7;
  if (name.includes(query)) return 0.6;
  return 0;
};

/** Well-known sites matching `query`, best first. */
export const findKnownSites = (query: string): KnownSite[] => {
  const needle = normalise(query);
  return KNOWN_SITES.map((site) => ({ site, score: siteScore(site, needle) }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, MAX_SITE_HITS)
    .map(({ site }) => site);
};

const urlHit = (sourceId: string, url: string, title: string, score: number, icon: SearchHit['icon']): SearchHit => ({
  id: `${sourceId}:${url}`,
  sourceId,
  title,
  subtitle: url,
  score,
  icon,
  action: { kind: 'url', url },
});

type PageStorage = Parameters<typeof findRecentPages>[1];

const navigationHits = (
  sourceId: string,
  query: string,
  labels: WebLabels,
  maxScore = 1,
  storage?: PageStorage
): SearchHit[] => {
  const hits: SearchHit[] = [];
  findRecentPages(query, storage).forEach((page, index) => {
    hits.push(urlHit(sourceId, page.url, page.title, Math.min(maxScore, 0.93 - index * 0.01), 'site'));
  });
  const address = toNavigableUrl(query);
  if (address) hits.push(urlHit(sourceId, address, labels.openSite(new URL(address).host), maxScore, 'web'));
  const needle = normalise(query);
  for (const site of findKnownSites(query)) {
    hits.push(urlHit(sourceId, site.url, site.name, Math.min(maxScore, 0.95, siteScore(site, needle)), 'site'));
  }
  return hits;
};

const searchHit = (sourceId: string, engine: WebEngine, query: string, score: number, labels: WebLabels): SearchHit =>
  urlHit(sourceId, engine.searchUrl(query), labels.searchWith(engine.label, query), score, 'web');

/** The `web` source: address/site suggestions plus a search on the chosen default engine. */
export const createWebProvider = (labels: WebLabels, defaultEngineId: string): SearchProvider => ({
  source: { id: 'web', kind: 'web', label: labels.webLabel, defaultAlias: 'w', includeInAllByDefault: true },
  search: async ({ query }) => {
    const engines = WEB_ENGINES.filter((engine) => engine.isSearchEngine);
    const preferred = engines.find((engine) => engine.id === defaultEngineId) ?? engines[0];
    const others = engines.filter((engine) => engine !== preferred);
    return [
      ...navigationHits('web', query, labels),
      searchHit('web', preferred, query, 0.6, labels),
      ...others.map((engine, index) => searchHit('web', engine, query, 0.5 - index * 0.05, labels)),
    ];
  },
});

/** One named site or engine (`fb:`, `g:`, ...). Its first hit always searches that site. */
export const createEngineProvider = (engine: WebEngine, labels: WebLabels, storage?: PageStorage): SearchProvider => ({
  source: {
    id: engine.id,
    kind: 'site',
    label: engine.label,
    defaultAlias: engine.defaultAlias,
    includeInAllByDefault: false,
  },
  search: async ({ query }) => [
    ...navigationHits(engine.id, query, labels, 0.95, storage).slice(0, MAX_PAGE_SUGGESTIONS),
    searchHit(engine.id, engine, query, 0.5, labels),
  ],
});

/** A user-added site search built from a link template; the query is encoded into `{q}`. */
export const createCustomProvider = (
  definition: { id: string; label: string; alias: string; urlTemplate: string },
  labels: WebLabels
): SearchProvider => ({
  source: {
    id: definition.id,
    kind: 'site',
    label: definition.label,
    defaultAlias: definition.alias,
    includeInAllByDefault: false,
  },
  search: async ({ query }) => {
    const hits = [
      urlHit(
        definition.id,
        definition.urlTemplate.replaceAll('{q}', encodeURIComponent(query)),
        labels.searchWith(definition.label, query),
        1,
        'web'
      ),
    ];
    const home = new URL(definition.urlTemplate.replaceAll('{q}', 'x')).origin + '/';
    hits.push(urlHit(definition.id, home, definition.label, 0.5, 'site'));
    return hits;
  },
});
