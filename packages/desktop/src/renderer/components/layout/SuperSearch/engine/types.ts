/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Super Search contracts. A source is searched by exactly one provider; the
 * renderer executes a hit's `action` itself, so providers return inert data
 * (never closures) and cannot trigger navigation or commands on their own.
 */

/** What activating a hit does. Data only, so every action can be validated and tested. */
export type SearchAction =
  | { kind: 'route'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'command'; command: 'restart-app' };

export type SearchIconKey = 'chat' | 'app' | 'setting' | 'page' | 'action' | 'web' | 'site' | 'connected';

/** One result row produced by a provider. `score` is in 0..1, higher is better. */
export type SearchHit = {
  id: string;
  sourceId: string;
  title: string;
  subtitle?: string;
  score: number;
  action: SearchAction;
  icon?: SearchIconKey;
};

/** `local` = in-app content, `web` = address-bar style suggestions, `site` = one named website/engine, `connected` = a bound capability. */
export type SearchSourceKind = 'local' | 'web' | 'site' | 'connected';

export type SearchSource = {
  id: string;
  kind: SearchSourceKind;
  /** Display name, already localised by the factory that built the provider. */
  label: string;
  /** Alias used when the user has not configured one. */
  defaultAlias: string;
  /** Whether the source takes part in the `All` scope unless the user changes it. */
  includeInAllByDefault: boolean;
};

export type SearchContext = {
  /** Trimmed text without any alias prefix. Never empty. */
  query: string;
  /** Upper bound on hits the provider should return. */
  limit: number;
  /** Aborted when the query changes or the panel closes; providers must stop work. */
  signal: AbortSignal;
};

export type SearchProvider = {
  source: SearchSource;
  search: (context: SearchContext) => Promise<SearchHit[]>;
};

/** Thrown by a provider that is configured but cannot run (for example a missing execution bridge). */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** Per-source state shown in the panel. One failing source never affects the others. */
export type SourceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; hits: SearchHit[] }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string };

/** A hit plus its position inside its own source. */
export type AggregatedRow = {
  hit: SearchHit;
  /** 1-based position among everything the source returned. */
  rank: number;
  sourceHitCount: number;
  /** ceil(rank / sourceHitCount * 100): 1 = best, 100 = last. */
  topPercent: number;
};
