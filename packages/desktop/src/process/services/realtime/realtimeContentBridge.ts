import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { foundationTrustedOrigin } from '@process/bridge/foundationBridge';
import { createPinnedProviderDiscoveryFetch } from '@process/services/security/providerDiscovery/providerDiscoveryBridge';
import {
  NEWS_EGRESS_DENIED,
  requireNewsEgressAdmission,
  type NewsEgressAuthority,
  type NewsEgressOperation,
} from '@process/services/security/newsEgressAuthority';
import {
  REALTIME_CONTENT_CHANNEL,
  REALTIME_ARTICLE_CHANNEL,
  type RealtimeArticleReadResult,
  type RealtimeCity,
  type RealtimeMarketRange,
  type RealtimeHuggingFaceKind,
  type RealtimePoint,
  type RealtimeEntry,
  type RealtimeReadRequest,
  type RealtimeReadResult,
  type RealtimeSource,
} from '@/common/types/platform/realtimeContent';

type ReadFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type RealtimeContentBridgeOptions = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender?: (event: IpcMainInvokeEvent) => boolean;
  fetchRemote?: ReadFetch;
  authority?: NewsEgressAuthority;
  now?: () => Date;
}>;

const SOURCES = new Set<RealtimeSource>(['news', 'github', 'huggingface', 'weather', 'market']);
const CITY_COORDS: Record<RealtimeCity, string> = {
  hanoi: 'latitude=21.0285&longitude=105.8542',
  hochiminh: 'latitude=10.8231&longitude=106.6297',
  danang: 'latitude=16.0544&longitude=108.2022',
};
const OPERATIONS: Record<RealtimeSource, NewsEgressOperation> = {
  news: 'rss-refresh',
  github: 'github-trending',
  huggingface: 'huggingface-models',
  weather: 'weather',
  market: 'market-data',
};
const MARKET_RANGES: Record<RealtimeMarketRange, Readonly<{ interval: string; range: string }>> = {
  '1d': { interval: '5m', range: '1d' },
  '1w': { interval: '1h', range: '5d' },
  '1m': { interval: '1d', range: '1mo' },
  '1y': { interval: '1wk', range: '1y' },
  '5y': { interval: '1mo', range: '5y' },
};
const TTL_MS = 300_000;
const MIN_MANUAL_REFRESH_MS = 30_000;
const MAX_ITEMS = 24;
const MAX_TEXT = 900;
const allowedOperations = new Set<NewsEgressOperation>([...Object.values(OPERATIONS), 'feed-validation']);

/**
 * Main-owned admission for ONLY the explicitly enumerated, credential-free GET
 * providers. It does not authorize arbitrary URLs, methods or package transports.
 */
export const REALTIME_PUBLIC_READ_AUTHORITY: NewsEgressAuthority = {
  authorize: async ({ operation }) => ({ decision: allowedOperations.has(operation) ? 'allow' : 'deny' }),
};
const clean = (input: unknown, max = MAX_TEXT): string =>
  typeof input === 'string'
    ? input
        .replace(/\p{Cc}/gu, ' ')
        .trim()
        .slice(0, max)
    : '';
const validLink = (input: unknown): string | undefined => {
  if (typeof input !== 'string' || input.length > 2048) return undefined;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
};
const recordOf = (input: unknown): Record<string, unknown> | undefined =>
  input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
const numberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const requestOf = (raw: unknown): RealtimeReadRequest | undefined => {
  const data = recordOf(raw);
  if (!data || Object.keys(data).some((key) => !['source', 'city', 'range', 'force', 'kind'].includes(key)))
    return undefined;
  if (!SOURCES.has(data.source as RealtimeSource)) return undefined;
  if (data.city !== undefined && !Object.hasOwn(CITY_COORDS, String(data.city))) return undefined;
  if (data.range !== undefined && (data.source !== 'market' || !Object.hasOwn(MARKET_RANGES, String(data.range))))
    return undefined;
  if (data.force !== undefined && typeof data.force !== 'boolean') return undefined;
  if (
    data.kind !== undefined &&
    (data.source !== 'huggingface' || !['models', 'datasets', 'spaces'].includes(String(data.kind)))
  )
    return undefined;
  return {
    source: data.source as RealtimeSource,
    city: (data.city as RealtimeCity | undefined) ?? 'hanoi',
    ...(data.range ? { range: data.range as RealtimeMarketRange } : {}),
    ...(data.force === true ? { force: true } : {}),
    ...(data.kind ? { kind: data.kind as RealtimeHuggingFaceKind } : {}),
  };
};
const escapedXml = (value: string): string =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
const xmlField = (item: string, tag: string): string => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'iu').exec(item);
  return clean(match ? escapedXml(match[1] ?? '') : '');
};
const newsFromXml = (xml: string, sourceLabel: string): RealtimeEntry[] =>
  [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/giu)]
    .slice(0, MAX_ITEMS)
    .map((match) => {
      const item = match[1] ?? '';
      const url = validLink(xmlField(item, 'link'));
      if (!url) return undefined;
      return {
        id: url,
        title: xmlField(item, 'title'),
        description: xmlField(item, 'description'),
        url,
        publishedAt: xmlField(item, 'pubDate'),
        sourceLabel,
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item && !!item.title);
const reposFromJson = (json: unknown): RealtimeEntry[] => {
  const data = recordOf(json);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.slice(0, MAX_ITEMS).flatMap((input): RealtimeEntry[] => {
    const item = recordOf(input);
    const name = clean(item?.full_name, 160);
    const url = validLink(item?.html_url);
    if (!name || !url || new URL(url).hostname !== 'github.com') return [];
    return [
      {
        id: name,
        title: name,
        description: clean(item?.description),
        url,
        language: clean(item?.language, 60),
        value: numberOf(item?.stargazers_count),
        forks: numberOf(item?.forks_count),
        unit: 'stars',
      },
    ];
  });
};
const modelsFromJson = (json: unknown, kind: RealtimeHuggingFaceKind = 'models'): RealtimeEntry[] => {
  const items = Array.isArray(json) ? json : [];
  return items.slice(0, MAX_ITEMS).flatMap((input): RealtimeEntry[] => {
    const item = recordOf(input);
    const name = clean(item?.id, 200);
    if (!/^[\w.-]+(?:\/[\w.-]+)?$/u.test(name)) return [];
    return [
      {
        id: name,
        title: name,
        description: clean(kind === 'models' ? item?.pipeline_tag : item?.description, 120),
        url: `https://huggingface.co/${kind === 'models' ? '' : `${kind}/`}${name}`,
        value: numberOf(kind === 'spaces' ? item?.likes : item?.downloads),
        unit: kind === 'spaces' ? 'likes' : 'downloads',
      },
    ];
  });
};
const weatherFromJson = (json: unknown, city: RealtimeCity): RealtimeEntry[] => {
  const data = recordOf(json);
  const current = recordOf(data?.current);
  const daily = recordOf(data?.daily);
  const hourly = recordOf(data?.hourly);
  const temp = numberOf(current?.temperature_2m);
  if (temp === undefined) return [];
  const highs = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
  const lows = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
  const hours = Array.isArray(hourly?.time) ? hourly.time : [];
  const temperatures = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : [];
  const currentTime = typeof current?.time === 'string' ? current.time : '';
  const forecast: RealtimePoint[] = hours
    .flatMap((time, index): RealtimePoint[] => {
      const value = numberOf(temperatures[index]);
      return typeof time === 'string' && value !== undefined && time >= currentTime
        ? [{ time: time.slice(0, 32), value }]
        : [];
    })
    .slice(0, 8);
  return [
    {
      id: city,
      title: { hanoi: 'Hà Nội', hochiminh: 'TP. Hồ Chí Minh', danang: 'Đà Nẵng' }[city],
      description: `H: ${numberOf(highs[0]) ?? '—'}° · L: ${numberOf(lows[0]) ?? '—'}°`,
      value: temp,
      unit: '°C',
      forecast,
      weatherCode: numberOf(current?.weather_code),
    },
  ];
};
const marketFromJson = (json: unknown, name: string): RealtimeEntry[] => {
  const data = recordOf(json);
  const chart = recordOf(data?.chart);
  const result = Array.isArray(chart?.result) ? recordOf(chart.result[0]) : undefined;
  const meta = recordOf(result?.meta);
  const price = numberOf(meta?.regularMarketPrice);
  if (price === undefined) return [];
  const previous = numberOf(meta?.chartPreviousClose) ?? numberOf(meta?.previousClose);
  const indicators = recordOf(result?.indicators);
  const quote = Array.isArray(indicators?.quote) ? recordOf(indicators.quote[0]) : undefined;
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(quote?.close) ? quote.close : [];
  const history: RealtimePoint[] = timestamps
    .flatMap((timestamp, index): RealtimePoint[] => {
      const value = numberOf(closes[index]);
      return typeof timestamp === 'number' && Number.isFinite(timestamp) && value !== undefined
        ? [{ time: new Date(timestamp * 1000).toISOString(), value }]
        : [];
    })
    .slice(-120);
  return [
    {
      id: name,
      title: name,
      description: clean(meta?.shortName, 120),
      value: price,
      changePercent: previous && previous > 0 ? ((price - previous) / previous) * 100 : undefined,
      history,
    },
  ];
};

export const readPublicRealtimeSource = async (
  request: RealtimeReadRequest,
  fetchRemote: ReadFetch,
  now: () => Date = () => new Date()
): Promise<RealtimeEntry[]> => {
  const today = now();
  if (request.source === 'github') {
    const since = new Date(today.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
    const url = `https://api.github.com/search/repositories?q=created%3A%3E${since}&sort=stars&order=desc&per_page=24`;
    return reposFromJson(await checkedJson(fetchRemote, url));
  }
  if (request.source === 'huggingface') {
    const kind = request.kind ?? 'models';
    const sort = kind === 'spaces' ? 'likes' : 'downloads';
    return modelsFromJson(
      await checkedJson(fetchRemote, `https://huggingface.co/api/${kind}?sort=${sort}&direction=-1&limit=24`),
      kind
    );
  }
  if (request.source === 'news') {
    const feeds = [
      { url: 'https://hnrss.org/frontpage', label: 'Hacker News' },
      { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', label: 'BBC World' },
      { url: 'https://www.theguardian.com/world/rss', label: 'The Guardian' },
    ] as const;
    const results = await Promise.allSettled(
      feeds.map(async (feed) => newsFromXml(await (await checked(fetchRemote, feed.url)).text(), feed.label))
    );
    const entries = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    if (entries.length === 0 && results.every((result) => result.status === 'rejected')) throw new Error('OFFLINE');
    const unique = new Map<string, RealtimeEntry>();
    for (const entry of entries) if (entry.url && !unique.has(entry.url)) unique.set(entry.url, entry);
    return [...unique.values()]
      .toSorted((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0))
      .slice(0, MAX_ITEMS);
  }
  if (request.source === 'weather') {
    const city = request.city ?? 'hanoi';
    const query = CITY_COORDS[city];
    const url = `https://api.open-meteo.com/v1/forecast?${query}&current=temperature_2m,weather_code&hourly=temperature_2m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2`;
    return weatherFromJson(await checkedJson(fetchRemote, url), city);
  }
  // These are actual index quotes, NOT futures prices or invented series.
  const symbols = [
    ['S&P 500', '%5EGSPC'],
    ['NASDAQ', '%5EIXIC'],
    ['Bitcoin', 'BTC-USD'],
    ['VIX', '%5EVIX'],
  ];
  const timeframe = MARKET_RANGES[request.range ?? '1m'];
  const readings = await Promise.allSettled(
    symbols.map(async ([label, symbol]) =>
      marketFromJson(
        await checkedJson(
          fetchRemote,
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${timeframe.interval}&range=${timeframe.range}`
        ),
        label
      )
    )
  );
  return readings.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
};
const PUBLIC_HOSTS = new Set([
  'hnrss.org',
  'feeds.bbci.co.uk',
  'www.theguardian.com',
  'api.github.com',
  'huggingface.co',
  'api.open-meteo.com',
  'query1.finance.yahoo.com',
]);
const checked = async (fetchRemote: ReadFetch, url: string): Promise<Response> => {
  const destination = new URL(url);
  if (
    destination.protocol !== 'https:' ||
    !PUBLIC_HOSTS.has(destination.hostname) ||
    destination.username ||
    destination.password
  )
    throw new Error(NEWS_EGRESS_DENIED);
  const response = await fetchRemote(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, application/rss+xml, application/xml, text/xml',
      'User-Agent': 'TomniHubOS-Realtime/1.0',
    },
    redirect: 'manual',
  });
  if (response.status === 429 || response.status === 403) throw new Error('RATE_LIMITED');
  if (!response.ok) throw new Error('OFFLINE');
  return response;
};
const checkedJson = async (fetchRemote: ReadFetch, url: string): Promise<unknown> =>
  (await checked(fetchRemote, url)).json();

/** Best-effort plain-text extraction. Content is rendered as text, never trusted HTML. */
export const extractArticleParagraphs = (html: string): string[] => {
  const sanitized = html
    .replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<!--([\s\S]*?)-->/gu, ' ');
  const region =
    /<article\b[^>]*>[\s\S]*?<\/article>/iu.exec(sanitized)?.[0] ??
    /<main\b[^>]*>[\s\S]*?<\/main>/iu.exec(sanitized)?.[0] ??
    sanitized;
  return [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)]
    .map((match) =>
      clean(
        escapedXml(match[1] ?? '')
          .replace(/&nbsp;/giu, ' ')
          .replace(/\s+/gu, ' '),
        900
      )
    )
    .filter((paragraph) => paragraph.length >= 48)
    .slice(0, 18);
};

/** Bounded Main-only transport with sender admission, pinned destinations, cache and singleflight. */
export const registerRealtimeContentBridge = (options: RealtimeContentBridgeOptions): (() => void) => {
  const fetchRemote = options.fetchRemote ?? createPinnedProviderDiscoveryFetch();
  const now = options.now ?? (() => new Date());
  const cache = new Map<string, { until: number; result: RealtimeReadResult }>();
  const pending = new Map<string, Promise<RealtimeReadResult>>();
  const manualRefreshAt = new Map<string, number>();
  const permittedArticles = new Map<string, { url: string; until: number }>();
  const articleCache = new Map<string, { until: number; paragraphs: readonly string[] }>();
  options.ipcMain.handle(REALTIME_CONTENT_CHANNEL, async (event, raw: unknown): Promise<RealtimeReadResult> => {
    if (!(options.verifySender ?? ((e) => !!foundationTrustedOrigin(e)))(event)) return { ok: false, code: 'DENIED' };
    const request = requestOf(raw);
    if (!request) return { ok: false, code: 'INVALID' };
    const key = `${request.source}:${request.city ?? ''}:${request.range ?? ''}:${request.kind ?? ''}`;
    const hit = cache.get(key);
    const lastManual = manualRefreshAt.get(key);
    const canForce =
      request.force === true && (lastManual === undefined || now().getTime() - lastManual >= MIN_MANUAL_REFRESH_MS);
    if (hit && hit.until > now().getTime() && !canForce) return hit.result;
    const inflight = pending.get(key);
    if (inflight) return inflight;
    if (canForce) manualRefreshAt.set(key, now().getTime());
    const work = (async (): Promise<RealtimeReadResult> => {
      try {
        await requireNewsEgressAdmission(
          options.authority ?? REALTIME_PUBLIC_READ_AUTHORITY,
          OPERATIONS[request.source]
        );
        const items = await readPublicRealtimeSource(request, fetchRemote, now);
        if (items.length === 0) return { ok: false, code: 'UNAVAILABLE' };
        const result: RealtimeReadResult = { ok: true, source: request.source, updatedAt: now().toISOString(), items };
        cache.set(key, { until: now().getTime() + TTL_MS, result });
        if (request.source === 'news') {
          permittedArticles.clear();
          articleCache.clear();
          for (const item of items) {
            if (item.url && validLink(item.url))
              permittedArticles.set(item.id, { url: item.url, until: now().getTime() + TTL_MS });
          }
        }
        return result;
      } catch (error) {
        if (error instanceof Error && error.message === NEWS_EGRESS_DENIED) return { ok: false, code: 'DENIED' };
        return {
          ok: false,
          code: error instanceof Error && error.message === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'OFFLINE',
        };
      }
    })();
    pending.set(key, work);
    try {
      return await work;
    } finally {
      pending.delete(key);
    }
  });
  options.ipcMain.handle(REALTIME_ARTICLE_CHANNEL, async (event, raw: unknown): Promise<RealtimeArticleReadResult> => {
    if (!(options.verifySender ?? ((e) => !!foundationTrustedOrigin(e)))(event)) return { ok: false, code: 'DENIED' };
    const data = recordOf(raw);
    if (!data || Object.keys(data).length !== 1 || typeof data.articleId !== 'string' || data.articleId.length > 2048)
      return { ok: false, code: 'INVALID' };
    const match = permittedArticles.get(data.articleId);
    if (!match || match.until <= now().getTime()) return { ok: false, code: 'DENIED' };
    const cached = articleCache.get(data.articleId);
    if (cached && cached.until > now().getTime()) return { ok: true, paragraphs: cached.paragraphs };
    try {
      await requireNewsEgressAdmission(options.authority ?? REALTIME_PUBLIC_READ_AUTHORITY, 'feed-validation');
      const response = await fetchRemote(match.url, {
        method: 'GET',
        headers: { Accept: 'text/html, application/xhtml+xml, text/plain', 'User-Agent': 'TomniHubOS-Realtime/1.0' },
        redirect: 'manual',
      });
      if (response.status === 429 || response.status === 403) return { ok: false, code: 'RATE_LIMITED' };
      if (!response.ok) return { ok: false, code: 'OFFLINE' };
      const mime = response.headers.get('content-type') ?? '';
      if (mime && !/^(text\/html|text\/plain|application\/xhtml\+xml)/iu.test(mime))
        return { ok: false, code: 'UNAVAILABLE' };
      const html = await response.text();
      if (html.length > 1_048_576) return { ok: false, code: 'UNAVAILABLE' };
      const paragraphs = extractArticleParagraphs(html);
      if (paragraphs.length) articleCache.set(data.articleId, { until: now().getTime() + TTL_MS, paragraphs });
      return paragraphs.length ? { ok: true, paragraphs } : { ok: false, code: 'UNAVAILABLE' };
    } catch (error) {
      return { ok: false, code: error instanceof Error && error.message === NEWS_EGRESS_DENIED ? 'DENIED' : 'OFFLINE' };
    }
  });
  return () => {
    options.ipcMain.removeHandler(REALTIME_CONTENT_CHANNEL);
    options.ipcMain.removeHandler(REALTIME_ARTICLE_CHANNEL);
    permittedArticles.clear();
    articleCache.clear();
    manualRefreshAt.clear();
    cache.clear();
    pending.clear();
  };
};
