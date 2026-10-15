/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HubNotification,
  NotificationCategory,
  NotificationDigestItem,
  NotificationLevel,
  NotificationPeriod,
  NotificationQuery,
  NotificationRules,
  NotificationSummary,
} from '@/common/types/platform/notificationHub';
import { NOTIFICATION_LEVELS, NOTIFICATION_SOURCE_KINDS } from '@/common/types/platform/notificationHub';
import { redactSecrets } from '../notificationTriage/redaction';
import { atLeast, deliveryOf, levelRank } from '../notificationTriage/triagePolicy';

/**
 * Local, deterministic views over stored notifications for the drawer's
 * "what did I miss" card and for agents. No model is involved; agents phrase
 * the result themselves. Output is redacted: secrets (codes, tokens, numbers)
 * are masked and filtered noise carries no snippet.
 */

const HOUR_MS = 60 * 60_000;
const PERIOD_MS: Partial<Record<NotificationPeriod, number>> = {
  '1h': HOUR_MS,
  '24h': 24 * HOUR_MS,
  '7d': 7 * 24 * HOUR_MS,
};
export const DEFAULT_QUERY_LIMIT = 20;
export const MAX_QUERY_LIMIT = 100;
const MAX_HIGHLIGHTS = 8;
const SNIPPET_CHARS = 200;

const PERIODS: readonly NotificationPeriod[] = ['1h', 'today', '24h', '7d', 'all'];

/** Validates an untrusted query (IPC or agent tool input). */
export const normalizeQuery = (raw: unknown): NotificationQuery => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const query: NotificationQuery = {};
  const period = PERIODS.find((value) => value === input.period);
  if (period) query.period = period;
  if (typeof input.sinceMs === 'number' && Number.isFinite(input.sinceMs) && input.sinceMs >= 0)
    query.sinceMs = input.sinceMs;
  const source = NOTIFICATION_SOURCE_KINDS.find((value) => value === input.source);
  if (source) query.source = source;
  if (typeof input.connectorId === 'string' && input.connectorId.length <= 512) query.connectorId = input.connectorId;
  const minLevel = NOTIFICATION_LEVELS.find((value) => value === input.minLevel);
  if (minLevel) query.minLevel = minLevel;
  if (input.unreadOnly === true) query.unreadOnly = true;
  if (typeof input.text === 'string' && input.text.trim()) query.text = input.text.trim().slice(0, 200);
  if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
    query.limit = Math.min(MAX_QUERY_LIMIT, Math.max(1, Math.round(input.limit)));
  }
  return query;
};

/** Start of a period; `today` is local midnight. */
export const periodStart = (period: NotificationPeriod | undefined, now: number): number => {
  if (!period || period === 'all') return 0;
  if (period === 'today') {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  return now - (PERIOD_MS[period] ?? 0);
};

const matches = (item: HubNotification, query: NotificationQuery, since: number): boolean => {
  if (item.createdAt < since) return false;
  if (query.source && item.source !== query.source) return false;
  if (query.connectorId && item.connectorId !== query.connectorId) return false;
  if (query.minLevel && !atLeast(item.level, query.minLevel)) return false;
  if (query.unreadOnly && item.read) return false;
  if (query.text) {
    const needle = query.text.toLowerCase();
    const haystack = `${item.title}\n${item.sender ?? ''}\n${item.sourceLabel}\n${item.account ?? ''}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
};

/** Matching items, newest first. */
export const queryNotifications = (
  items: readonly HubNotification[],
  query: NotificationQuery,
  now: number
): HubNotification[] => {
  const since = query.sinceMs ?? periodStart(query.period ?? '24h', now);
  return items
    .filter((item) => matches(item, query, since))
    .toSorted((left, right) => right.createdAt - left.createdAt);
};

export const toDigestItem = (
  item: HubNotification,
  rules: Pick<NotificationRules, 'interruptLevel'>
): NotificationDigestItem => ({
  id: item.id,
  level: item.level,
  category: item.category,
  delivery: deliveryOf(item, rules),
  source: item.source,
  sourceLabel: item.sourceLabel,
  ...(item.account ? { account: item.account } : {}),
  ...(item.sender ? { sender: item.sender } : {}),
  title: redactSecrets(item.title).slice(0, 300),
  snippet: item.level === 'P3' ? '' : redactSecrets(item.body).slice(0, SNIPPET_CHARS),
  createdAt: item.createdAt,
  read: item.read,
  ...(item.url ? { url: item.url } : {}),
  ...(item.route ? { route: item.route } : {}),
});

const clock = (time: number): string => {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const LEVEL_WORDS: Record<NotificationLevel, string> = {
  P0: 'urgent',
  P1: 'important',
  P2: 'for the digest',
  P3: 'filtered as noise',
};

/** Counts, sources, senders and the most important items of a period, plus an English digest. */
export const summarizeNotifications = (
  items: readonly HubNotification[],
  query: NotificationQuery,
  rules: Pick<NotificationRules, 'interruptLevel'>,
  now: number
): NotificationSummary => {
  const since = query.sinceMs ?? periodStart(query.period ?? 'today', now);
  const scoped = queryNotifications(items, { ...query, sinceMs: since, minLevel: query.minLevel }, now);
  const byLevel: Record<NotificationLevel, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byCategory: Partial<Record<NotificationCategory, number>> = {};
  const sources = new Map<string, NotificationSummary['bySource'][number]>();
  const senders = new Map<string, number>();
  for (const item of scoped) {
    byLevel[item.level] += 1;
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    const key = item.connectorId ?? item.source;
    const entry = sources.get(key) ?? { key, label: item.sourceLabel, source: item.source, count: 0, unread: 0 };
    entry.count += 1;
    if (!item.read) entry.unread += 1;
    sources.set(key, entry);
    if (item.sender && item.level !== 'P3') senders.set(item.sender, (senders.get(item.sender) ?? 0) + 1);
  }
  const highlights = scoped
    .filter((item) => item.level === 'P0' || item.level === 'P1')
    .toSorted((left, right) => levelRank(left.level) - levelRank(right.level) || right.createdAt - left.createdAt)
    .slice(0, MAX_HIGHLIGHTS)
    .map((item) => toDigestItem(item, rules));
  const bySource = [...sources.values()].toSorted((left, right) => right.count - left.count);
  const topSenders = [...senders.entries()]
    .map(([sender, count]) => ({ sender, count }))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, 5);
  const unread = scoped.filter((item) => !item.read).length;

  const lines: string[] = [];
  if (scoped.length === 0) {
    lines.push(`No notifications since ${clock(since)}.`);
  } else {
    const levels = NOTIFICATION_LEVELS.filter((level) => byLevel[level] > 0)
      .map((level) => `${byLevel[level]} ${LEVEL_WORDS[level]}`)
      .join(', ');
    lines.push(`Since ${clock(since)}: ${scoped.length} notifications (${unread} unread) — ${levels}.`);
    for (const item of highlights) {
      const who = item.sender ? ` from ${item.sender}` : '';
      const state = item.read ? '' : ' [unread]';
      lines.push(
        `- ${LEVEL_WORDS[item.level]}: [${item.sourceLabel}]${who}: "${item.title}" at ${clock(item.createdAt)}${state}`
      );
    }
    lines.push(
      `Sources: ${bySource
        .slice(0, 6)
        .map((entry) => `${entry.label} ${entry.count}`)
        .join(', ')}.`
    );
    if (byLevel.P3 > 0) lines.push(`${byLevel.P3} low-value notifications were filtered out and not shown.`);
  }
  return {
    since,
    until: now,
    total: scoped.length,
    unread,
    byLevel,
    bySource,
    byCategory,
    topSenders,
    highlights,
    text: lines.join('\n'),
  };
};
