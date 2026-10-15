/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ProviderUnavailableError,
  type SearchAction,
  type SearchHit,
  type SearchProvider,
  type SourceState,
} from './types';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 4000;
const MAX_TITLE_LENGTH = 200;
const MAX_SUBTITLE_LENGTH = 300;

export type RunSearchOptions = {
  /** Aborting stops every provider and silences further state updates (stale query). */
  signal: AbortSignal;
  onState: (sourceId: string, state: SourceState) => void;
  /** Per-provider hit limit. Defaults to 30 so top-percent stays meaningful. */
  limit?: number;
  timeoutMs?: number;
};

/** In-app paths only; protocol-relative and backslash forms are rejected. */
const isSafeRoute = (path: string): boolean => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');

const isSafeUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

export const isSafeAction = (action: SearchAction): boolean => {
  if (action.kind === 'route') return isSafeRoute(action.path);
  if (action.kind === 'url') return isSafeUrl(action.url);
  return action.kind === 'command' && action.command === 'restart-app';
};

/**
 * Provider output is untrusted (connected providers return remote data): the source id is forced
 * to the provider's own, scores are clamped, text is bounded, and only whitelisted actions survive.
 */
export const sanitizeHits = (sourceId: string, hits: readonly SearchHit[], limit: number): SearchHit[] => {
  const clean: SearchHit[] = [];
  for (const hit of hits) {
    if (clean.length >= limit) break;
    const title = typeof hit.title === 'string' ? hit.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
    if (title.length === 0 || typeof hit.id !== 'string' || !isSafeAction(hit.action)) continue;
    clean.push({
      ...hit,
      sourceId,
      title,
      subtitle: typeof hit.subtitle === 'string' ? hit.subtitle.slice(0, MAX_SUBTITLE_LENGTH) : undefined,
      score: Number.isFinite(hit.score) ? Math.min(1, Math.max(0, hit.score)) : 0,
    });
  }
  return clean;
};

type Settled = { done: true; state: SourceState } | { done: false };

const runProvider = async (provider: SearchProvider, query: string, options: RunSearchOptions): Promise<Settled> => {
  const { signal, limit = 30, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS } = options;
  const child = new AbortController();
  const forwardAbort = () => child.abort();
  signal.addEventListener('abort', forwardAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const aborted = new Promise<'aborted'>((resolve) => {
      if (signal.aborted) resolve('aborted');
      signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    const outcome = await Promise.race([provider.search({ query, limit, signal: child.signal }), timeout, aborted]);
    if (outcome === 'aborted') return { done: false };
    if (outcome === 'timeout') {
      child.abort();
      return { done: true, state: { status: 'error', message: 'timeout' } };
    }
    return { done: true, state: { status: 'ok', hits: sanitizeHits(provider.source.id, outcome, limit) } };
  } catch (error) {
    if (signal.aborted) return { done: false };
    // Raw error text can carry tokens or URLs from the provider, so only our own message is shown.
    if (error instanceof ProviderUnavailableError) {
      return { done: true, state: { status: 'unavailable', message: error.message } };
    }
    return { done: true, state: { status: 'error', message: 'failed' } };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forwardAbort);
  }
};

/**
 * Runs every provider in parallel. Each reports `loading`, then its own terminal state; a failing,
 * slow or unavailable provider never affects the others. Nothing is reported after `signal` aborts.
 */
export const runSearch = async (
  providers: readonly SearchProvider[],
  query: string,
  options: RunSearchOptions
): Promise<void> => {
  if (options.signal.aborted) return;
  for (const provider of providers) options.onState(provider.source.id, { status: 'loading' });
  await Promise.all(
    providers.map(async (provider) => {
      const settled = await runProvider(provider, query, options);
      if (settled.done && !options.signal.aborted) options.onState(provider.source.id, settled.state);
    })
  );
};
