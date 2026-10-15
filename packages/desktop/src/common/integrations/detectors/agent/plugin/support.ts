/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers of the `agent-plugins` detector: safe repository paths, bounded JSON and front matter reading, and
 * the single place where connections and open items are produced. Everything read here is data of an untrusted
 * repository; nothing is executed and no value that might be a secret is ever copied into a note.
 */

import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { connectionSchema } from '@/common/packages/adapter/connections';
import { isSafeRelativePath } from '@/common/packages/adapter/primitives';
import type { RepoInventory } from '@/common/integrations/detectors/types';

export type Origin = NonNullable<AdapterConnection['origin']>;
export type JsonRecord = Readonly<Record<string, unknown>>;

/** Mutable accumulator of one detector run, plus read-only views of the inventory. */
export type Context = Readonly<{
  inventory: RepoInventory;
  files: ReadonlySet<string>;
  /** Every ancestor folder of every file (the repository root is the empty string and is not listed). */
  directories: ReadonlySet<string>;
  connections: AdapterConnection[];
  openItems: AdapterOpenItem[];
  reasons: string[];
  claimed: Set<string>;
  /** Skill folders already turned into a connection: a skill's path is its identity, so it is emitted once. */
  skills: Set<string>;
}>;

export const createContext = (inventory: RepoInventory): Context => {
  const directories = new Set<string>();
  for (const file of inventory.files) {
    let slash = file.lastIndexOf('/');
    while (slash > 0) {
      const folder = file.slice(0, slash);
      if (directories.has(folder)) break;
      directories.add(folder);
      slash = folder.lastIndexOf('/');
    }
  }
  return {
    inventory,
    files: new Set(inventory.files),
    directories,
    connections: [],
    openItems: [],
    reasons: [],
    claimed: new Set(),
    skills: new Set(),
  };
};

const MAX_NOTE = 300;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;
// eslint-disable-next-line no-control-regex
const CONTROL_ALL = /[\u0000-\u001f\u007f]/gu;
const SEGMENT = /^[\p{L}\p{N}._@+~=,() -]+$/u;

export const clip = (text: string, max: number = MAX_NOTE): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Text made of untrusted input and safe to show in a note: no control characters, bounded. */
export const plain = (text: string, max = 80): string => clip(text.replace(CONTROL_ALL, ' ').trim(), max);

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Own property only, so `constructor` or `__proto__` of a hostile file never reads an inherited value. */
export const field = (record: JsonRecord, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

export const stringField = (record: JsonRecord, key: string): string | undefined => {
  const value = field(record, key);
  return typeof value === 'string' ? value : undefined;
};

/** A list from a field that may hold one value or an array of values. */
export const listField = (record: JsonRecord, key: string): readonly unknown[] => {
  const value = field(record, key);
  if (value === undefined) return [];
  return Array.isArray(value) ? (value as readonly unknown[]) : [value];
};

/**
 * A repository-relative path written in a manifest, normalized: `/` only, no `..`, no absolute or drive path, no
 * control or unusual characters. The empty string means the plugin folder itself (`.` or `./`). Anything else is
 * `undefined`; a rejected path is never repaired.
 */
export const cleanRelative = (raw: string): string | undefined => {
  if (raw.length === 0 || raw.length > 200) return undefined;
  if (raw.includes('\\') || CONTROL.test(raw) || raw.startsWith('/') || /^[A-Za-z]:/u.test(raw)) return undefined;
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.some((part) => part === '..' || !SEGMENT.test(part) || /[. ]$/u.test(part))) return undefined;
  return parts.join('/');
};

export const joinPath = (base: string, relative: string): string =>
  base === '' ? relative : relative === '' ? base : `${base}/${relative}`;

/** The path of a repository file or folder inside the package (`source/...`), or `undefined` when it would not fit. */
export const packagePathOf = (repositoryPath: string): string | undefined => {
  const candidate = repositoryPath === '' ? 'source' : `source/${repositoryPath}`;
  return candidate.length <= 240 && isSafeRelativePath(candidate) ? candidate : undefined;
};

export const filesUnder = (context: Context, folder: string): string[] =>
  folder === ''
    ? [...context.inventory.files]
    : context.inventory.files.filter((file) => file.startsWith(`${folder}/`));

export const folderExists = (context: Context, folder: string): boolean =>
  folder === '' ? context.inventory.files.length > 0 : context.directories.has(folder);

export type ReportExtra = Readonly<{
  /** Repository-relative file or folder the item is about. */
  path?: string;
  connection?: string;
  name?: string;
  required?: boolean;
}>;

/** Adds an open item. `note` must already be free of values that could be secrets. */
export const report = (
  context: Context,
  kind: AdapterOpenItem['kind'],
  note: string,
  extra: ReportExtra = {}
): void => {
  const path = extra.path === undefined ? undefined : packagePathOf(extra.path);
  context.openItems.push({
    kind,
    note: clip(note),
    ...(extra.connection === undefined ? {} : { connection: extra.connection }),
    ...(path === undefined ? {} : { path }),
    ...(extra.name === undefined ? {} : { name: extra.name }),
    ...(extra.required === undefined ? {} : { required: extra.required }),
  });
};

/**
 * Adds a connection after the strict writer schema accepts it. A candidate that fails is reported by field name only
 * (never by value) so that a malformed or hostile declaration cannot put its content into a note.
 */
export const addConnection = (context: Context, candidate: unknown, where: string): AdapterConnection | undefined => {
  const parsed = connectionSchema.safeParse(candidate);
  if (parsed.success) {
    context.connections.push(parsed.data);
    return parsed.data;
  }
  const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')).filter((name) => name !== ''))];
  report(
    context,
    'unrecognized',
    `Kết nối không khớp lược đồ${fields.length > 0 ? ` (${fields.slice(0, 3).join(', ')})` : ''}`,
    {
      path: where,
    }
  );
  return undefined;
};

export type JsonLoad =
  | Readonly<{ state: 'ok'; value: unknown }>
  | Readonly<{ state: 'missing' | 'unreadable' | 'invalid' }>;

/**
 * Reads a JSON declaration file from the inventory and claims it. A file that is in the tree but has no text (too
 * large, or over the read budget) or is not valid JSON is reported as `unrecognized` with its path.
 */
export const loadJson = (context: Context, file: string): JsonLoad => {
  if (!context.files.has(file)) return { state: 'missing' };
  context.claimed.add(file);
  let text: string | undefined;
  try {
    text = context.inventory.text(file);
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    report(context, 'unrecognized', 'Tệp khai báo không đọc được (quá lớn hoặc vượt ngân sách đọc)', { path: file });
    return { state: 'unreadable' };
  }
  try {
    return { state: 'ok', value: JSON.parse(text.replace(/^﻿/u, '')) as unknown };
  } catch {
    report(context, 'unrecognized', 'Tệp JSON hỏng, không phân tích được', { path: file });
    return { state: 'invalid' };
  }
};

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---/u;

/** Single-line `key: value` pairs of a Markdown front matter, read from the first 8 KB only. Keys are lowercase. */
export const frontmatterOf = (text: string | undefined): ReadonlyMap<string, string> => {
  const values = new Map<string, string>();
  const block = text === undefined ? undefined : FRONTMATTER.exec(text.slice(0, 8192))?.[1];
  if (block === undefined) return values;
  for (const line of block.split(/\r?\n/u)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/u.exec(line);
    const key = match?.[1]?.toLowerCase();
    const value = match?.[2]?.trim().replace(/^(["'])(.*)\1$/u, '$2');
    if (key !== undefined && value !== undefined && value !== '' && !values.has(key)) values.set(key, value);
  }
  return values;
};

/** A connection id from a free name: lowercase letters, digits, `.`, `_`, `-`; empty when nothing usable is left. */
export const toId = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '')
    .slice(0, 64)
    .replace(/-+$/u, '');

/** `base`, or `base-2`, `base-3`... when `used` already has it. The result is remembered in `used`. */
export const uniqueId = (used: Set<string>, base: string): string => {
  let id = base;
  for (let counter = 2; used.has(id); counter += 1) id = `${base.slice(0, 64 - String(counter).length - 1)}-${counter}`;
  used.add(id);
  return id;
};

/** Text for a display title: no control characters, 1 to 120 characters. */
export const titleOf = (raw: string, fallback: string): string => plain(raw, 120) || fallback;

/** What the detectors below need to know about the plugin currently being read. */
export type RootScope = Readonly<{
  /** Repository-relative plugin folder; the empty string is the repository root. */
  root: string;
  /** `source/<root>`. */
  plugin: string;
  origin: Origin;
  /** Ids already used inside this plugin, per kind of connection. */
  used: Readonly<Record<'mcp' | 'command' | 'agent' | 'cli', Set<string>>>;
  hookIndex: { next: number };
}>;
