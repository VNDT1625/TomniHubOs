/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * State and helpers shared by the parts of the `browser-ext` detector. Everything read from a repository is
 * untrusted: text is bounded and stripped of control characters before it reaches a note, a title or an id.
 */

import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { connectionSchema } from '@/common/packages/adapter/connections';
import { quoteForNote, toConnectionId, unrecognizedItem } from '../agent/mcpShared';
import type { RepoInventory } from '../types';

/** Most entries kept in one list of an extension connection (the adapter schema's own bound). */
export const MAX_LIST = 100;
const MAX_NOTE = 300;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export type Context = {
  readonly inventory: RepoInventory;
  readonly connections: AdapterConnection[];
  readonly openItems: AdapterOpenItem[];
  readonly reasons: string[];
  readonly claimed: Set<string>;
  readonly ids: Set<string>;
};

export const createContext = (inventory: RepoInventory): Context => ({
  inventory,
  connections: [],
  openItems: [],
  reasons: [],
  claimed: new Set(),
  ids: new Set(),
});

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A one-line open item note, bounded to what the adapter schema accepts. */
export const note = (text: string): string => text.slice(0, MAX_NOTE);

export const report = (context: Context, item: AdapterOpenItem): void => {
  context.openItems.push({ ...item, note: note(item.note) });
};

export const reportUnrecognized = (context: Context, file: string, text: string): void => {
  context.openItems.push(unrecognizedItem(file, text));
};

/** Strings of an untrusted array: trimmed, one line, 1..`max` characters, no duplicates. Other values are dropped. */
export const stringList = (value: unknown, max = 100): string[] => {
  if (!Array.isArray(value)) return [];
  const found = new Set<string>();
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') continue;
    const text = entry.trim();
    if (text.length > 0 && text.length <= max && !CONTROL_CHARACTERS.test(text)) found.add(text);
  }
  return [...found];
};

/** Keeps at most `MAX_LIST` entries; the second value says whether some were cut. */
export const capList = (values: readonly string[]): readonly [string[], boolean] => [
  values.slice(0, MAX_LIST),
  values.length > MAX_LIST,
];

/** A display title from untrusted text, at most 120 characters. */
export const titleOf = (text: string | undefined, fallback: string): string => {
  const clean = quoteForNote(text ?? '', 117);
  return clean === '' ? fallback.slice(0, 120) : clean;
};

/** True for a match or host pattern that covers every site: `<all_urls>`, a scheme wildcard with a wildcard host, or `*`. */
export const isAllHosts = (pattern: string): boolean =>
  /^(?:<all_urls>|\*|(?:\*|https?|wss?|ftp|file):\/\/\*(?:\/\*)?)$/u.test(pattern);

/**
 * A connection id nobody in this run has used. The first candidate that makes a valid id and is free wins; when all
 * are taken, `-2`, `-3`... is appended to the first valid one.
 */
export const uniqueId = (context: Context, candidates: readonly string[]): string => {
  const bases = candidates.map(toConnectionId).filter((id): id is string => id !== undefined);
  const free = bases.find((id) => !context.ids.has(id));
  if (free !== undefined) {
    context.ids.add(free);
    return free;
  }
  const base = (bases[0] ?? 'extension').slice(0, 56);
  for (let counter = 2; ; counter += 1) {
    const id = `${base}-${counter}`;
    if (!context.ids.has(id)) {
      context.ids.add(id);
      return id;
    }
  }
};

/** Checks a candidate with the strict adapter schema; a connection the writer would refuse becomes an open item. */
export const addConnection = (context: Context, candidate: unknown, file: string): AdapterConnection | undefined => {
  const parsed = connectionSchema.safeParse(candidate);
  if (parsed.success) {
    context.connections.push(parsed.data);
    return parsed.data;
  }
  const reason = quoteForNote(parsed.error.issues[0]?.message ?? 'invalid', 100);
  reportUnrecognized(context, file, `Kết nối extension không hợp lệ sau khi chuẩn hóa (${reason}).`);
  return undefined;
};
