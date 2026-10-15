/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FeedConnector, YoutubeConnector } from '@/common/types/platform/notificationHub';
import { parseFeed, type FeedFetcher } from '../notifications/feedConnector';
import {
  clampInterval,
  cleanText,
  type ConnectorCursor,
  type NotificationSourceAdapter,
  type SourceItem,
  type SourceSyncResult,
} from './sourceAdapter';

const FIRST_FEED_ITEMS = 3;
const MAX_FEED_ITEMS_PER_SYNC = 20;
export const MAX_SEEN_PER_FEED = 300;
const SYNC_TIMEOUT_MS = 30_000;

const CHANNEL_ID = /^UC[\w-]{22}$/;

export const youtubeFeedUrl = (channelId: string): string =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

/** Fetches a feed and returns the entries not seen before, oldest first, plus the next cursor. */
const syncFeedUrl = async (
  url: string,
  cursor: ConnectorCursor | undefined,
  fetchFeed: FeedFetcher,
  signal: AbortSignal,
  now: () => number,
  toItem: (entry: ReturnType<typeof parseFeed>['entries'][number], feedTitle: string) => SourceItem
): Promise<SourceSyncResult> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, SYNC_TIMEOUT_MS);
  let xml: string;
  try {
    xml = await fetchFeed(url, controller.signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
  const feed = parseFeed(xml);
  const seen = new Set(cursor?.seen ?? []);
  const fresh = feed.entries.filter((entry) => !seen.has(entry.id));
  const chosen = (cursor ? fresh.slice(0, MAX_FEED_ITEMS_PER_SYNC) : fresh.slice(0, FIRST_FEED_ITEMS)).toReversed();
  const items = chosen.map((entry) => {
    const item = toItem(entry, feed.title);
    return { ...item, createdAt: entry.publishedAt && entry.publishedAt <= now() ? entry.publishedAt : undefined };
  });
  const nextSeen = [...new Set([...feed.entries.map((entry) => entry.id), ...(cursor?.seen ?? [])])];
  return { items, cursor: { seen: nextSeen.slice(0, MAX_SEEN_PER_FEED) } };
};

/** RSS/Atom feeds: blogs, GitHub releases, status pages, newsletters. */
export const createFeedSource = (fetchFeed: FeedFetcher): NotificationSourceAdapter<FeedConnector> => ({
  kind: 'feed',
  source: 'feed',
  validate: (draft, base) => {
    const url = cleanText(draft.url, 2000);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { error: 'url' };
    } catch {
      return { error: 'url' };
    }
    return { connector: { ...base, kind: 'feed', url, intervalMinutes: clampInterval(draft.intervalMinutes, 30) } };
  },
  sourceChanged: (before, after) => before.url !== after.url,
  sync: ({ connector, cursor, signal, now }) =>
    syncFeedUrl(connector.url, cursor, fetchFeed, signal, now, (entry, feedTitle) => ({
      key: `${connector.id}:${entry.id}`,
      title: entry.title,
      body: entry.summary,
      url: entry.link,
      account: feedTitle || undefined,
      rawRef: `feed:${entry.id.slice(0, 200)}`,
    })),
});

/**
 * Turns a channel id, a channel URL or an @handle into a channel id. Handles
 * need one public page fetch; nothing is signed in and no API key is used.
 */
export const resolveYoutubeChannel = async (
  input: string,
  fetchText: FeedFetcher,
  signal: AbortSignal
): Promise<string | undefined> => {
  const value = input.trim();
  if (CHANNEL_ID.test(value)) return value;
  const fromPath = /\/channel\/(UC[\w-]{22})/.exec(value)?.[1] ?? /[?&]channel_id=(UC[\w-]{22})/.exec(value)?.[1];
  if (fromPath) return fromPath;
  const handle = /^@([\w.-]{3,100})$/.exec(value)?.[1] ?? /youtube\.com\/@([\w.-]{3,100})/i.exec(value)?.[1];
  const legacy = /youtube\.com\/(c|user)\/([\w.-]{1,100})/i.exec(value);
  const page = handle
    ? `https://www.youtube.com/@${handle}`
    : legacy
      ? `https://www.youtube.com/${legacy[1]}/${legacy[2]}`
      : undefined;
  if (!page) return undefined;
  const html = await fetchText(page, signal);
  return (
    /<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1]
  );
};

/** New uploads of a YouTube channel through its public feed. Comments need the paid-quota API and are not read. */
export const createYoutubeSource = (fetchFeed: FeedFetcher): NotificationSourceAdapter<YoutubeConnector> => ({
  kind: 'youtube',
  source: 'youtube',
  validate: async (draft, base, existing) => {
    const raw = cleanText(draft.channelId, 300);
    if (!raw) return { error: 'channel' };
    if (existing && existing.channelId === raw) {
      return {
        connector: {
          ...base,
          kind: 'youtube',
          channelId: raw,
          intervalMinutes: clampInterval(draft.intervalMinutes, 60, 15),
        },
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const channelId = await resolveYoutubeChannel(raw, fetchFeed, controller.signal);
      if (!channelId) return { error: 'channel' };
      return {
        connector: {
          ...base,
          kind: 'youtube',
          channelId,
          intervalMinutes: clampInterval(draft.intervalMinutes, 60, 15),
        },
      };
    } catch {
      return { error: 'channel' };
    } finally {
      clearTimeout(timer);
    }
  },
  sourceChanged: (before, after) => before.channelId !== after.channelId,
  account: (connector) => connector.label,
  sync: ({ connector, cursor, signal, now }) =>
    syncFeedUrl(youtubeFeedUrl(connector.channelId), cursor, fetchFeed, signal, now, (entry, feedTitle) => ({
      key: `${connector.id}:${entry.id}`,
      sender: feedTitle || connector.label,
      title: entry.title,
      body: '',
      url: entry.link,
      account: connector.label,
      rawRef: `youtube:${entry.id.slice(0, 200)}`,
    })),
});
