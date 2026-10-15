/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aggregateResults } from './engine/aggregate';
import { parseSuperQuery, resolveAliasMap, SCOPE_ALL, type AliasMap } from './engine/aliases';
import { selectProviders, type SuperSearchConfig } from './engine/config';
import { runSearch } from './engine/searchEngine';
import type { AggregatedRow, SearchProvider, SourceState } from './engine/types';

export type SuperSearchMode = 'hub' | 'browser';

export type UseSuperSearchOptions = {
  mode: SuperSearchMode;
  providers: readonly SearchProvider[];
  config: SuperSearchConfig;
  debounceMs?: number;
};

const DEFAULT_DEBOUNCE_MS = 160;

/** Default aliases must be unique; later duplicates get a numeric suffix. */
const defaultAliases = (providers: readonly SearchProvider[]): AliasMap => {
  const taken = new Set<string>();
  const result: Record<string, string> = {};
  for (const { source } of providers) {
    let alias = source.defaultAlias;
    for (let n = 2; taken.has(alias); n += 1) alias = `${source.defaultAlias}${n}`;
    taken.add(alias);
    result[source.id] = alias;
  }
  return result;
};

/** Source id -> alias in effect (user override or default), collision-free. */
export const buildAliasMap = (providers: readonly SearchProvider[], config: SuperSearchConfig): AliasMap =>
  resolveAliasMap(defaultAliases(providers), config.aliases);

/**
 * Query state machine for the Super Search: parses alias prefixes, picks the providers allowed for
 * the scope, debounces, cancels the previous request, and aggregates the per-source results.
 * In `browser` mode an alias prefix selects the engine and is absorbed into the scope.
 */
export const useSuperSearch = ({
  mode,
  providers,
  config,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseSuperSearchOptions) => {
  const aliasMap = useMemo(() => buildAliasMap(providers, config), [providers, config]);
  const initialScope = useCallback((): string => {
    if (mode === 'hub') return SCOPE_ALL;
    return providers.some(({ source }) => source.id === config.browserEngine)
      ? config.browserEngine
      : (providers[0]?.source.id ?? SCOPE_ALL);
  }, [mode, providers, config.browserEngine]);

  const [query, setQueryState] = useState('');
  const [tabScope, setTabScope] = useState<string>(initialScope);
  const [states, setStates] = useState<Record<string, SourceState>>({});
  const [activeIndex, setActiveIndex] = useState(0);

  // A configured browser engine can arrive after the first render (storage load); follow it until the user picks one.
  const userPickedScope = useRef(false);
  useEffect(() => {
    if (mode === 'browser' && !userPickedScope.current) setTabScope(initialScope());
  }, [mode, initialScope]);

  const parsed = useMemo(() => parseSuperQuery(query, aliasMap), [query, aliasMap]);
  const scope = parsed.alias ? parsed.scope : tabScope;
  const selection = useMemo(() => selectProviders(scope, providers, config), [scope, providers, config]);
  const activeProviders = selection.providers;
  const providerKey = activeProviders.map(({ source }) => source.id).join('|');
  const providersRef = useRef(activeProviders);
  providersRef.current = activeProviders;
  const text = parsed.text;

  const setQuery = useCallback(
    (raw: string) => {
      if (mode === 'browser') {
        const next = parseSuperQuery(raw, aliasMap);
        if (next.alias) {
          userPickedScope.current = true;
          setTabScope(next.scope);
          setQueryState(next.text);
          return;
        }
      }
      // After an engine prefix the field starts with the query itself, never a leading space.
      setQueryState(mode === 'browser' ? raw.trimStart() : raw);
    },
    [mode, aliasMap]
  );

  const setScope = useCallback(
    (next: string) => {
      userPickedScope.current = true;
      setTabScope(next);
      setQueryState(parseSuperQuery(query, aliasMap).text);
    },
    [query, aliasMap]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [text, scope]);

  useEffect(() => {
    setStates({});
    if (text.length === 0 || providersRef.current.length === 0) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void runSearch(providersRef.current, text, {
        signal: controller.signal,
        onState: (sourceId, state) => setStates((prev) => ({ ...prev, [sourceId]: state })),
      });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, providerKey, debounceMs]);

  const rows = useMemo<AggregatedRow[]>(
    () =>
      aggregateResults(
        activeProviders.map(({ source }) => {
          const state = states[source.id];
          return { sourceId: source.id, hits: state?.status === 'ok' ? state.hits : [] };
        })
      ),
    [activeProviders, states]
  );

  const moveActive = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      setActiveIndex((prev) => (((Math.min(prev, rows.length - 1) + delta) % rows.length) + rows.length) % rows.length);
    },
    [rows.length]
  );

  const reset = useCallback(() => {
    userPickedScope.current = false;
    setQueryState('');
    setTabScope(initialScope());
  }, [initialScope]);

  return {
    query,
    setQuery,
    scope,
    setScope,
    aliasMap,
    parsed,
    text,
    activeProviders,
    disabledScope: selection.disabled,
    states,
    rows,
    activeIndex: Math.min(activeIndex, Math.max(0, rows.length - 1)),
    setActiveIndex,
    moveActive,
    reset,
  };
};
