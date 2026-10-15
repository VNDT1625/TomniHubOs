import { useEffect, useSyncExternalStore } from 'react';
import type {
  RealtimeCity,
  RealtimeMarketRange,
  RealtimeHuggingFaceKind,
  RealtimeEntry,
  RealtimeReadResult,
  RealtimeSource,
} from '@/common/types/platform/realtimeContent';

export type RealtimeState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: readonly RealtimeEntry[];
  updatedAt?: string;
  error?: string;
}>;
const INITIAL: RealtimeState = { status: 'idle', items: [] };
const TTL = 300_000;
type CacheEntry = {
  state: RealtimeState;
  listeners: Set<() => void>;
  inflight?: Promise<void>;
  nextRefresh: number;
};
const records = new Map<string, CacheEntry>();
const keyFor = (
  source: RealtimeSource,
  city?: RealtimeCity,
  range?: RealtimeMarketRange,
  kind?: RealtimeHuggingFaceKind
): string => `${source}:${city ?? ''}:${range ?? ''}:${kind ?? ''}`;
const entryFor = (key: string): CacheEntry => {
  let entry = records.get(key);
  if (!entry) {
    entry = { state: INITIAL, listeners: new Set(), nextRefresh: 0 };
    records.set(key, entry);
  }
  return entry;
};
const emit = (entry: CacheEntry, state: RealtimeState): void => {
  entry.state = state;
  entry.listeners.forEach((notify) => notify());
};
const failCode = (result: RealtimeReadResult): string => ('code' in result ? result.code : '');
export const refreshRealtime = (
  source: RealtimeSource,
  city?: RealtimeCity,
  force = false,
  range?: RealtimeMarketRange,
  kind?: RealtimeHuggingFaceKind
): Promise<void> => {
  const entry = entryFor(keyFor(source, city, range, kind));
  if (entry.inflight) return entry.inflight;
  if (!force && entry.nextRefresh > Date.now()) return Promise.resolve();
  emit(entry, { ...entry.state, status: entry.state.items.length > 0 ? 'ready' : 'loading', error: undefined });
  const request = window.electronAPI?.realtimeContent?.read;
  const job = (async () => {
    let result: RealtimeReadResult;
    try {
      result = request
        ? await request({
            source,
            ...(city ? { city } : {}),
            ...(range ? { range } : {}),
            ...(force ? { force: true } : {}),
            ...(kind ? { kind } : {}),
          })
        : { ok: false, code: 'UNAVAILABLE' };
    } catch {
      result = { ok: false, code: 'OFFLINE' };
    }
    entry.nextRefresh = Date.now() + (result.ok ? TTL : 60_000);
    if (result.ok) {
      emit(entry, { status: 'ready', items: result.items, updatedAt: result.updatedAt });
    } else {
      emit(entry, {
        status: 'error',
        items: entry.state.items,
        updatedAt: entry.state.updatedAt,
        error: failCode(result),
      });
    }
  })();
  entry.inflight = job;
  void job.finally(() => {
    entry.inflight = undefined;
  });
  return job;
};
/** One shared renderer cache per source: rail widgets and centre views see the same verified Main response. */
export const useRealtimeSource = (
  source: RealtimeSource,
  city?: RealtimeCity,
  range?: RealtimeMarketRange,
  kind?: RealtimeHuggingFaceKind
): RealtimeState => {
  const key = keyFor(source, city, range, kind);
  const state = useSyncExternalStore(
    (notify) => {
      const entry = entryFor(key);
      entry.listeners.add(notify);
      return () => {
        entry.listeners.delete(notify);
      };
    },
    () => entryFor(key).state,
    () => INITIAL
  );
  useEffect(() => {
    void refreshRealtime(source, city, false, range, kind);
    const interval = window.setInterval(() => {
      void refreshRealtime(source, city, false, range, kind);
    }, TTL);
    return () => window.clearInterval(interval);
  }, [source, city, range, kind]);
  return state;
};
