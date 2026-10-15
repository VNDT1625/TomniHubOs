/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { OsConnector, OsNotificationApp } from '@/common/types/platform/notificationHub';
import { clampInterval, cleanText, type NotificationSourceAdapter } from './sourceAdapter';

/**
 * Notifications other desktop apps raised in Windows (Zalo, Telegram Desktop,
 * Discord, Outlook, Teams, browsers showing Gmail or Messenger pushes…).
 *
 * Windows keeps them in the per-user notification list
 * (`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db`). The hub
 * opens it read-only, reads toasts newer than its cursor and parses only the
 * visible text lines of each toast. Nothing is written, dismissed or sent
 * anywhere. Other platforms, or a Windows build that keeps the list elsewhere,
 * report `unsupported` instead of failing silently.
 */

export type OsToast = {
  /** Monotonic order in the Windows list. */
  order: number;
  /** The app's notification id (AppUserModelId or path). */
  appId: string;
  /** FILETIME ticks (100 ns since 1601) as Windows stores them. */
  arrivalTime: number;
  /** Toast XML payload. */
  payload: string;
};

/** Reads the Windows notification list; injected so tests and other platforms use a fake. */
export type OsToastReader = {
  /** Toasts with `order` above `afterOrder`, oldest first. */
  read: (afterOrder: number, limit: number) => Promise<OsToast[]>;
  /** Highest order present, to start after on first sync. */
  maxOrder: () => Promise<number>;
  /** Apps with toasts since `sinceFileTime`, for the picker. */
  apps: (sinceFileTime: number) => Promise<Array<{ appId: string; count: number; lastArrival: number }>>;
};

const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000;

export const fileTimeToMs = (fileTime: number): number => Math.round(fileTime / 10_000 - FILETIME_EPOCH_OFFSET_MS);
export const msToFileTime = (ms: number): number => (ms + FILETIME_EPOCH_OFFSET_MS) * 10_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (/^#x/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });

/** Visible text lines of a toast payload; attribution and action labels are left out. */
export const parseToastText = (payload: string): string[] => {
  const visual = /<visual[\s>][\s\S]*?<\/visual>/i.exec(payload)?.[0] ?? payload;
  const lines: string[] = [];
  for (const match of visual.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/gi)) {
    if (/placement=["']attribution["']/i.test(match[1] ?? '')) continue;
    const value = decode((match[2] ?? '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (value) lines.push(value.slice(0, 600));
  }
  return lines.slice(0, 4);
};

/** Readable name for an app id: `com.squirrel.Discord.Discord` → Discord, `C:\…\Zalo.exe` → Zalo. */
export const appLabel = (appId: string): string => {
  const known: Array<[RegExp, string]> = [
    [/zalo/i, 'Zalo'],
    [/telegram/i, 'Telegram'],
    [/discord/i, 'Discord'],
    [/messenger/i, 'Messenger'],
    [/whatsapp/i, 'WhatsApp'],
    [/teams/i, 'Microsoft Teams'],
    [/outlook/i, 'Outlook'],
    [/slack/i, 'Slack'],
    [/msedge|microsoft\.?edge/i, 'Microsoft Edge'],
    [/chrome/i, 'Google Chrome'],
    [/firefox/i, 'Firefox'],
  ];
  for (const [pattern, label] of known) if (pattern.test(appId)) return label;
  const base = path.win32.basename(appId.split('!')[0] ?? appId).replace(/\.exe$/i, '');
  const segments = base.split(/[._]/).filter((segment) => segment && !/^\d+$/.test(segment) && segment.length > 1);
  return (segments.at(-1) ?? base).slice(0, 60) || appId.slice(0, 60);
};

/** Tomny's own toasts must never come back in as new notifications. */
export const isOwnApp = (appId: string): boolean => /tomny|tomni|electron\.app/i.test(appId);

export const matchesAllowedApp = (appId: string, apps: readonly string[]): boolean =>
  apps.length === 0 ||
  apps.some((entry) => {
    const needle = entry.trim().toLowerCase();
    return needle.length > 0 && (appId.toLowerCase().includes(needle) || appLabel(appId).toLowerCase() === needle);
  });

const FIRST_SYNC_ITEMS = 5;
const MAX_PER_SYNC = 60;
const FIRST_SYNC_WINDOW_MS = 6 * 60 * 60_000;

export const createOsToastSource = (
  reader: () => OsToastReader | undefined,
  options: { recentlyShown?: (text: string) => boolean } = {}
): NotificationSourceAdapter<OsConnector> => ({
  kind: 'os',
  source: 'os',
  validate: (draft, base) => {
    const apps = Array.isArray(draft.apps)
      ? [...new Set(draft.apps.map((app) => cleanText(app, 200)).filter(Boolean))].slice(0, 50)
      : [];
    return { connector: { ...base, kind: 'os', apps, intervalMinutes: clampInterval(draft.intervalMinutes, 1, 1) } };
  },
  sync: async ({ connector, cursor, now }) => {
    const source = reader();
    if (!source) throw new Error('unsupported');
    const first = cursor?.mark === undefined;
    let after = cursor?.mark ?? 0;
    if (first) {
      const max = await source.maxOrder();
      after = Math.max(0, max - FIRST_SYNC_ITEMS * 4);
    }
    const toasts = await source.read(after, MAX_PER_SYNC);
    const mark = toasts.reduce((highest, toast) => Math.max(highest, toast.order), after);
    const oldest = first ? now() - FIRST_SYNC_WINDOW_MS : 0;
    const relevant = toasts.filter(
      (toast) =>
        !isOwnApp(toast.appId) &&
        matchesAllowedApp(toast.appId, connector.apps) &&
        fileTimeToMs(toast.arrivalTime) >= oldest
    );
    const chosen = first ? relevant.slice(-FIRST_SYNC_ITEMS) : relevant;
    const items = chosen.flatMap((toast) => {
      const [title, ...rest] = parseToastText(toast.payload);
      if (!title || options.recentlyShown?.(title)) return [];
      const app = appLabel(toast.appId);
      const at = fileTimeToMs(toast.arrivalTime);
      return [
        {
          key: `${connector.id}:${toast.order}:${toast.arrivalTime}`,
          title,
          body: rest.join(' · ').slice(0, 600),
          createdAt: at > 0 && at <= now() ? at : undefined,
          account: app,
          rawRef: `os:${toast.order}`,
        },
      ];
    });
    return { items, cursor: { mark } };
  },
});

/** Apps for the picker, most active first. */
export const listOsApps = async (reader: OsToastReader | undefined, now: number): Promise<OsNotificationApp[]> => {
  if (!reader) return [];
  const rows = await reader.apps(msToFileTime(now - 14 * 24 * 60 * 60_000));
  return rows
    .filter((row) => !isOwnApp(row.appId))
    .map((row) => ({
      appId: row.appId.slice(0, 300),
      label: appLabel(row.appId),
      count: row.count,
      lastAt: fileTimeToMs(row.lastArrival),
    }))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, 40);
};

type SqliteRow = Record<string, unknown>;
/** The slice of a better-sqlite3 database the reader uses. */
export type OsSqliteDatabase = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => SqliteRow[];
    get: (...params: unknown[]) => SqliteRow | undefined;
  };
  close: () => void;
};

const numberOf = (value: unknown): number =>
  typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : Number(value ?? 0);

/**
 * Production reader over the Windows notification database, opened read-only
 * for each call and closed right after so Windows keeps full control of it.
 */
export const createWindowsToastReader = (
  openDatabase: (file: string) => OsSqliteDatabase,
  file: string
): OsToastReader => {
  const withDb = async <T>(use: (db: OsSqliteDatabase) => T): Promise<T> => {
    const db = openDatabase(file);
    try {
      return use(db);
    } finally {
      db.close();
    }
  };
  return {
    read: (afterOrder, limit) =>
      withDb((db) =>
        db
          .prepare(
            `SELECT n.[Order] AS ord, n.ArrivalTime AS arrival, n.Payload AS payload, h.PrimaryId AS app
               FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId
              WHERE n.Type = 'toast' AND n.[Order] > ? ORDER BY n.[Order] ASC LIMIT ?`
          )
          .all(afterOrder, limit)
          .map((row) => ({
            order: numberOf(row.ord),
            arrivalTime: numberOf(row.arrival),
            appId: typeof row.app === 'string' ? row.app : '',
            payload: Buffer.isBuffer(row.payload)
              ? row.payload.toString('utf8')
              : typeof row.payload === 'string'
                ? row.payload
                : '',
          }))
      ),
    maxOrder: () => withDb((db) => numberOf(db.prepare('SELECT MAX([Order]) AS ord FROM Notification').get()?.ord)),
    apps: (sinceFileTime) =>
      withDb((db) =>
        db
          .prepare(
            `SELECT h.PrimaryId AS app, COUNT(*) AS count, MAX(n.ArrivalTime) AS last
               FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId
              WHERE n.Type = 'toast' AND n.ArrivalTime >= ? GROUP BY h.PrimaryId`
          )
          .all(sinceFileTime)
          .map((row) => ({
            appId: typeof row.app === 'string' ? row.app : '',
            count: numberOf(row.count),
            lastArrival: numberOf(row.last),
          }))
      ),
  };
};
