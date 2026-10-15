/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { senderIdentity } from './redaction';

/**
 * Learned sender reputation. Opening a notification from a sender raises it;
 * removing one unopened lowers it. The score only nudges rule-based levels by
 * one step and never grants P0 on its own.
 */
export type ReputationEntry = { score: number; opened: number; dismissed: number; lastAt: number };

export type ReputationBook = Record<string, ReputationEntry>;

export type ReputationSignal = 'opened' | 'dismissed';

export const MAX_REPUTATION_ENTRIES = 500;
const MIN_SCORE = -10;
const MAX_SCORE = 10;
/** Score at which a sender moves one level. */
export const REPUTATION_STEP = 3;

/** Book key for a sender, or for the source when the item has no sender. */
export const reputationKey = (sender: string | undefined, connectorId: string | undefined): string | undefined => {
  const identity = senderIdentity(sender);
  if (identity) return `sender:${identity}`;
  return connectorId ? `source:${connectorId}` : undefined;
};

export const reputationScore = (book: ReputationBook, key: string | undefined): number =>
  key ? (book[key]?.score ?? 0) : 0;

/** Records one signal in place and keeps the book bounded (least recently used entries go first). */
export const recordReputation = (book: ReputationBook, key: string, signal: ReputationSignal, now: number): void => {
  const entry = book[key] ?? { score: 0, opened: 0, dismissed: 0, lastAt: now };
  if (signal === 'opened') {
    entry.opened += 1;
    entry.score = Math.min(MAX_SCORE, entry.score + 1);
  } else {
    entry.dismissed += 1;
    entry.score = Math.max(MIN_SCORE, entry.score - 1);
  }
  entry.lastAt = now;
  book[key] = entry;
  const keys = Object.keys(book);
  if (keys.length <= MAX_REPUTATION_ENTRIES) return;
  const oldest = keys
    .toSorted((left, right) => (book[left]?.lastAt ?? 0) - (book[right]?.lastAt ?? 0))
    .slice(0, keys.length - MAX_REPUTATION_ENTRIES);
  for (const stale of oldest) delete book[stale];
};

/** Drops malformed entries read from disk. */
export const normalizeReputation = (raw: unknown): ReputationBook => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const book: ReputationBook = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_REPUTATION_ENTRIES)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const number = (field: string) =>
      typeof entry[field] === 'number' && Number.isFinite(entry[field]) ? (entry[field] as number) : 0;
    book[key.slice(0, 220)] = {
      score: Math.min(MAX_SCORE, Math.max(MIN_SCORE, number('score'))),
      opened: number('opened'),
      dismissed: number('dismissed'),
      lastAt: number('lastAt'),
    };
  }
  return book;
};
