/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RSS 2.0 / Atom reader for feed connectors (blogs, YouTube channels, GitHub
 * releases, status pages...). Feed text is untrusted: tags are stripped and
 * only http(s) links are kept.
 */

export type FeedEntry = { id: string; title: string; summary: string; link?: string; publishedAt?: number };

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 50;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });

const textOf = (raw: string | undefined): string => {
  if (!raw) return '';
  const cdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(cdata.replace(/<[^>]+>/g, ' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const tag = (block: string, name: string): string | undefined =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)?.[1];

const safeLink = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(decodeEntities(value.trim()));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const timeOf = (value: string | undefined): number | undefined => {
  const parsed = value ? Date.parse(textOf(value)) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Parses RSS `<item>` or Atom `<entry>` blocks, newest first as the feed lists them. */
export const parseFeed = (xml: string): { title: string; entries: FeedEntry[] } => {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const channel = isAtom ? xml : (tag(xml, 'channel') ?? xml);
  const feedTitle = textOf(tag(channel.replace(/<(item|entry)[\s>][\s\S]*$/i, ''), 'title'));
  const entries: FeedEntry[] = [];
  for (const block of blocks.slice(0, MAX_ENTRIES)) {
    const title = textOf(tag(block, 'title')).slice(0, 300);
    const link = isAtom
      ? safeLink(
          /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(block)?.[1] ??
            /<link[^>]*href=["']([^"']+)["']/i.exec(block)?.[1]
        )
      : safeLink(textOf(tag(block, 'link')));
    const id = textOf(tag(block, isAtom ? 'id' : 'guid')) || link || title;
    if (!id) continue;
    entries.push({
      id: id.slice(0, 500),
      title: title || link || id,
      summary: textOf(tag(block, isAtom ? 'summary' : 'description') ?? tag(block, 'content')).slice(0, 400),
      link,
      publishedAt: timeOf(tag(block, isAtom ? 'updated' : 'pubDate') ?? tag(block, 'published')),
    });
  }
  return { title: feedTitle, entries };
};

export type FeedFetcher = (url: string, signal: AbortSignal) => Promise<string>;

/** Fetches a feed over http(s) with a size cap. */
export const fetchFeedText: FeedFetcher = async (url, signal) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Feed URL must be http(s)');
  const response = await fetch(parsed, {
    signal,
    redirect: 'follow',
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
  });
  if (!response.ok) throw new Error(`Feed request failed (${response.status})`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_FEED_BYTES) throw new Error('Feed is too large');
  const text = await response.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('Feed is too large');
  return text;
};
