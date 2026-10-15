/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { isValidAlias, SCOPE_ALL } from './aliases';
import type { SearchProvider, SearchSource } from './types';

/**
 * Per-viewer Super Search preferences (aliases, source switches, last browser engine). Stored in
 * localStorage as a convenience only: it can be empty or blocked, and defaults are always safe.
 */
/** A user-defined site search: `urlTemplate` holds `{q}` where the encoded query goes. */
export type CustomSource = { id: string; label: string; alias: string; urlTemplate: string };

export type SuperSearchConfig = {
  /** Sources the user added from a link, e.g. https://www.google.com/maps/search/{q}. */
  custom: CustomSource[];
  /** Source id -> custom alias. */
  aliases: Record<string, string>;
  /** Source id -> explicit on/off. Absent = the source default (connected sources default off). */
  enabled: Record<string, boolean>;
  /** Source id -> joins the `All` scope. Absent = the source default. */
  inAll: Record<string, boolean>;
  /** Engine the header uses while the Browser app is open. */
  browserEngine: string;
};

export const DEFAULT_CONFIG: SuperSearchConfig = {
  custom: [],
  aliases: {},
  enabled: {},
  inAll: {},
  browserEngine: 'google',
};

const STORAGE_KEY = 'tomny:super-search:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const booleanMap = (value: unknown): Record<string, boolean> =>
  Object.fromEntries(
    Object.entries(asRecord(value)).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
  );

const MAX_CUSTOM_SOURCES = 20;

/** A template is usable only if it is an http(s) URL with a `{q}` placeholder. */
export const isValidUrlTemplate = (template: string): boolean => {
  if (!template.includes('{q}')) return false;
  try {
    const { protocol } = new URL(template.replaceAll('{q}', 'x'));
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

const parseCustom = (value: unknown): CustomSource[] => {
  if (!Array.isArray(value)) return [];
  const result: CustomSource[] = [];
  for (const item of value.slice(0, MAX_CUSTOM_SOURCES)) {
    const record = asRecord(item);
    const { id, label, alias, urlTemplate } = record;
    if (typeof id !== 'string' || !/^custom-[a-z0-9]{1,16}$/.test(id)) continue;
    if (typeof label !== 'string' || label.trim().length === 0 || label.length > 40) continue;
    if (typeof alias !== 'string' || !isValidAlias(alias)) continue;
    if (typeof urlTemplate !== 'string' || !isValidUrlTemplate(urlTemplate)) continue;
    result.push({ id, label: label.trim(), alias, urlTemplate });
  }
  return result;
};

/** Validates untrusted stored data; every malformed field falls back to its default. */
export const parseConfig = (raw: unknown): SuperSearchConfig => {
  const record = asRecord(raw);
  const aliases: Record<string, string> = {};
  for (const [id, value] of Object.entries(asRecord(record.aliases))) {
    if (typeof value !== 'string') continue;
    const alias = value.trim().toLowerCase();
    if (isValidAlias(alias)) aliases[id] = alias;
  }
  const engine = record.browserEngine;
  return {
    custom: parseCustom(record.custom),
    aliases,
    enabled: booleanMap(record.enabled),
    inAll: booleanMap(record.inAll),
    browserEngine:
      typeof engine === 'string' && /^[a-z0-9_-]{1,24}$/.test(engine) ? engine : DEFAULT_CONFIG.browserEngine,
  };
};

const defaultStorage = (): StorageLike | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export const loadConfig = (storage: StorageLike | undefined = defaultStorage()): SuperSearchConfig => {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return text ? parseConfig(JSON.parse(text) as unknown) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
};

export const saveConfig = (config: SuperSearchConfig, storage: StorageLike | undefined = defaultStorage()): void => {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage may be blocked (private window); the in-memory config still applies.
  }
};

/** Connected sources reach third-party services, so they stay off until the user switches them on. */
export const isSourceEnabled = (source: SearchSource, config: SuperSearchConfig): boolean =>
  config.enabled[source.id] ?? source.kind !== 'connected';

export const isInAll = (source: SearchSource, config: SuperSearchConfig): boolean =>
  config.inAll[source.id] ?? source.includeInAllByDefault;

/**
 * Providers a query in `scope` may call. `disabled` is true when the scope names a source the user
 * switched off, so the UI can explain it instead of silently showing nothing. A disabled source is
 * never queried.
 */
export const selectProviders = (
  scope: string,
  providers: readonly SearchProvider[],
  config: SuperSearchConfig
): { providers: SearchProvider[]; disabled: boolean } => {
  if (scope === SCOPE_ALL) {
    return {
      providers: providers.filter(({ source }) => isSourceEnabled(source, config) && isInAll(source, config)),
      disabled: false,
    };
  }
  const target = providers.find(({ source }) => source.id === scope);
  if (!target) return { providers: [], disabled: false };
  return isSourceEnabled(target.source, config)
    ? { providers: [target], disabled: false }
    : { providers: [], disabled: true };
};
