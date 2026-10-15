import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type SuperSearchConfig } from '@/renderer/components/layout/SuperSearch/engine/config';
import { useSuperSearch } from '@/renderer/components/layout/SuperSearch/useSuperSearch';
import type { SearchHit, SearchProvider, SearchSource } from '@/renderer/components/layout/SuperSearch/engine/types';

const hit = (sourceId: string, text: string, n: number): SearchHit => ({
  id: `${sourceId}:${text}:${n}`,
  sourceId,
  title: `${sourceId} ${text} ${n}`,
  score: 1 - n / 100,
  action: { kind: 'route', path: `/${sourceId}` },
});

type Call = { sourceId: string; query: string; aborted: () => boolean };

const makeProvider = (
  id: string,
  calls: Call[],
  options: {
    kind?: SearchSource['kind'];
    alias?: string;
    inAll?: boolean;
    count?: number;
    delayMs?: number;
    fail?: boolean;
  } = {}
): SearchProvider => ({
  source: {
    id,
    kind: options.kind ?? 'local',
    label: id,
    defaultAlias: options.alias ?? id,
    includeInAllByDefault: options.inAll ?? true,
  },
  search: ({ query, signal }) =>
    new Promise((resolve, reject) => {
      calls.push({ sourceId: id, query, aborted: () => signal.aborted });
      setTimeout(() => {
        if (options.fail) reject(new Error('boom'));
        else resolve(Array.from({ length: options.count ?? 2 }, (_, i) => hit(id, query, i)));
      }, options.delayMs ?? 0);
    }),
});

const setup = (
  providers: SearchProvider[],
  config: SuperSearchConfig = DEFAULT_CONFIG,
  mode: 'hub' | 'browser' = 'hub'
) => renderHook(() => useSuperSearch({ mode, providers, config, debounceMs: 5 }));

describe('useSuperSearch', () => {
  it('does nothing for an empty query and searches all sources otherwise', async () => {
    const calls: Call[] = [];
    const { result } = setup([makeProvider('local', calls), makeProvider('web', calls)]);
    expect(result.current.rows).toEqual([]);
    expect(calls).toEqual([]);
    act(() => result.current.setQuery('hello'));
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(calls.map((c) => c.sourceId).toSorted()).toEqual(['local', 'web']);
    expect(result.current.rows[0].rank).toBe(1);
  });

  it('routes `alias: text` to that source only, with the prefix removed', async () => {
    const calls: Call[] = [];
    const { result } = setup([
      makeProvider('local', calls),
      makeProvider('facebook', calls, { alias: 'fb', inAll: false }),
    ]);
    act(() => result.current.setQuery('fb: abc'));
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0));
    expect(result.current.scope).toBe('facebook');
    expect(calls).toEqual([expect.objectContaining({ sourceId: 'facebook', query: 'abc' })]);
  });

  it('uses the configured alias instead of the default', async () => {
    const calls: Call[] = [];
    const config = { ...DEFAULT_CONFIG, aliases: { facebook: 'face' } };
    const { result } = setup([makeProvider('facebook', calls, { alias: 'fb', inAll: false })], config);
    act(() => result.current.setQuery('face: abc'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(result.current.scope).toBe('facebook');
  });

  it('switches scope from a tab click and keeps the text', async () => {
    const calls: Call[] = [];
    const { result } = setup([
      makeProvider('local', calls),
      makeProvider('web', calls),
      makeProvider('facebook', calls, { alias: 'fb', inAll: false }),
    ]);
    act(() => result.current.setQuery('fb: abc'));
    act(() => result.current.setScope('web'));
    expect(result.current.scope).toBe('web');
    expect(result.current.query).toBe('abc');
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0));
    expect(new Set(result.current.rows.map((r) => r.hit.sourceId))).toEqual(new Set(['web']));
  });

  it('keeps showing healthy sources when one fails', async () => {
    const calls: Call[] = [];
    const { result } = setup([makeProvider('bad', calls, { fail: true }), makeProvider('good', calls)]);
    act(() => result.current.setQuery('x'));
    await waitFor(() => expect(result.current.states.bad?.status).toBe('error'));
    await waitFor(() => expect(result.current.states.good?.status).toBe('ok'));
    expect(result.current.rows.map((r) => r.hit.sourceId)).toEqual(['good', 'good']);
  });

  it('cancels the stale request when the query changes', async () => {
    const calls: Call[] = [];
    const { result } = setup([makeProvider('slow', calls, { delayMs: 60 })]);
    act(() => result.current.setQuery('first'));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => result.current.setQuery('second'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].aborted()).toBe(true);
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0));
    expect(result.current.rows.every((r) => r.hit.title.includes('second'))).toBe(true);
  });

  it('never calls a disabled source and flags the scope as disabled', async () => {
    const calls: Call[] = [];
    const provider = makeProvider('mcp:1', calls, { kind: 'connected', alias: 'notion' });
    const { result } = setup([provider]);
    act(() => result.current.setQuery('notion: roadmap'));
    await waitFor(() => expect(result.current.disabledScope).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);
  });

  it('wraps keyboard selection around the result list', async () => {
    const calls: Call[] = [];
    const { result } = setup([makeProvider('local', calls)]);
    act(() => result.current.setQuery('x'));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.moveActive(-1));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.moveActive(1));
    expect(result.current.activeIndex).toBe(0);
  });

  it('browser mode drops the space typed after an engine prefix', async () => {
    const calls: Call[] = [];
    const providers = [makeProvider('yahoo', calls, { kind: 'site', alias: 'y', count: 1 })];
    const { result } = setup(providers, DEFAULT_CONFIG, 'browser');
    act(() => result.current.setQuery('yahoo :'));
    act(() => result.current.setQuery(' abc'));
    expect(result.current.query).toBe('abc');
  });

  it('browser mode defaults to the configured engine and turns `yahoo : q` into an engine switch', async () => {
    const calls: Call[] = [];
    const providers = [
      makeProvider('google', calls, { kind: 'site', alias: 'g', count: 1 }),
      makeProvider('yahoo', calls, { kind: 'site', alias: 'y', count: 1 }),
    ];
    const { result } = setup(providers, { ...DEFAULT_CONFIG, browserEngine: 'google' }, 'browser');
    expect(result.current.scope).toBe('google');
    act(() => result.current.setQuery('yahoo : abcxyz'));
    expect(result.current.scope).toBe('yahoo');
    expect(result.current.query).toBe('abcxyz');
    await waitFor(() => expect(calls.some((c) => c.sourceId === 'yahoo' && c.query === 'abcxyz')).toBe(true));
    expect(calls.every((c) => c.sourceId === 'yahoo')).toBe(true);
  });
});
