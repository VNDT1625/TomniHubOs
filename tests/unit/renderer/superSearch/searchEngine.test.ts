import { describe, expect, it } from 'vitest';
import { runSearch, sanitizeHits } from '@/renderer/components/layout/SuperSearch/engine/searchEngine';
import {
  ProviderUnavailableError,
  type SearchHit,
  type SearchProvider,
  type SourceState,
} from '@/renderer/components/layout/SuperSearch/engine/types';

const source = (id: string) => ({
  id,
  kind: 'local' as const,
  label: id,
  defaultAlias: id,
  includeInAllByDefault: true,
});
const hit = (sourceId: string, n: number): SearchHit => ({
  id: `${sourceId}-${n}`,
  sourceId,
  title: `${sourceId} ${n}`,
  score: 0.5,
  action: { kind: 'route', path: `/${sourceId}` },
});
const provider = (id: string, search: SearchProvider['search']): SearchProvider => ({ source: source(id), search });

const collect = () => {
  const events: Array<[string, SourceState]> = [];
  return { events, onState: (id: string, state: SourceState) => events.push([id, state]) };
};
const last = (events: Array<[string, SourceState]>, id: string) => events.filter(([key]) => key === id).at(-1)?.[1];

describe('runSearch', () => {
  it('reports loading and then the hits of every provider', async () => {
    const { events, onState } = collect();
    await runSearch(
      [provider('a', async () => [hit('a', 1)]), provider('b', async () => [hit('b', 1), hit('b', 2)])],
      'q',
      {
        signal: new AbortController().signal,
        onState,
      }
    );
    expect(events.filter(([, s]) => s.status === 'loading').map(([id]) => id)).toEqual(['a', 'b']);
    expect(last(events, 'a')).toMatchObject({ status: 'ok' });
    expect((last(events, 'b') as { hits: SearchHit[] }).hits).toHaveLength(2);
  });

  it('keeps other sources working when one throws', async () => {
    const { events, onState } = collect();
    await runSearch(
      [
        provider('bad', async () => {
          throw new Error('token=sk-secret-123 leaked');
        }),
        provider('good', async () => [hit('good', 1)]),
      ],
      'q',
      { signal: new AbortController().signal, onState }
    );
    expect(last(events, 'good')).toMatchObject({ status: 'ok' });
    const bad = last(events, 'bad');
    expect(bad).toEqual({ status: 'error', message: 'failed' });
  });

  it('marks a provider that cannot run as unavailable', async () => {
    const { events, onState } = collect();
    await runSearch(
      [
        provider('conn', async () => {
          throw new ProviderUnavailableError('needs bridge');
        }),
      ],
      'q',
      { signal: new AbortController().signal, onState }
    );
    expect(last(events, 'conn')).toEqual({ status: 'unavailable', message: 'needs bridge' });
  });

  it('times out a provider that never answers without blocking the rest', async () => {
    const { events, onState } = collect();
    await runSearch(
      [provider('slow', () => new Promise<SearchHit[]>(() => {})), provider('fast', async () => [hit('fast', 1)])],
      'q',
      { signal: new AbortController().signal, onState, timeoutMs: 20 }
    );
    expect(last(events, 'slow')).toEqual({ status: 'error', message: 'timeout' });
    expect(last(events, 'fast')).toMatchObject({ status: 'ok' });
  });

  it('aborts providers and stays silent once the caller aborts (stale request)', async () => {
    const { events, onState } = collect();
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const running = runSearch(
      [
        provider(
          'a',
          ({ signal }) =>
            new Promise<SearchHit[]>((resolve) => {
              providerSignal = signal;
              setTimeout(() => resolve([hit('a', 1)]), 30);
            })
        ),
      ],
      'q',
      { signal: controller.signal, onState }
    );
    controller.abort();
    await running;
    expect(providerSignal?.aborted).toBe(true);
    expect(events.filter(([, s]) => s.status !== 'loading')).toEqual([]);
  });

  it('does not call providers for an aborted signal', async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    await runSearch(
      [
        provider('a', async () => {
          calls += 1;
          return [];
        }),
      ],
      'q',
      { signal: controller.signal, onState: () => {} }
    );
    expect(calls).toBe(0);
  });
});

describe('sanitizeHits', () => {
  it('forces the source id, clamps scores and enforces the limit', () => {
    const hits = sanitizeHits(
      'real',
      [
        { ...hit('spoofed', 1), score: 7 },
        { ...hit('spoofed', 2), score: -3 },
        { ...hit('spoofed', 3), score: Number.NaN },
      ],
      2
    );
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.sourceId === 'real')).toBe(true);
    expect(hits.map((h) => h.score)).toEqual([1, 0]);
  });

  it('drops hits with unsafe actions', () => {
    const base = hit('a', 1);
    const hits = sanitizeHits(
      'a',
      [
        { ...base, id: 'js', action: { kind: 'url', url: 'javascript:alert(1)' } },
        { ...base, id: 'file', action: { kind: 'url', url: 'file:///C:/secrets' } },
        { ...base, id: 'proto', action: { kind: 'route', path: '//evil.example' } },
        { ...base, id: 'ok-url', action: { kind: 'url', url: 'https://example.com/a?b=1' } },
        { ...base, id: 'ok-route', action: { kind: 'route', path: '/settings/display' } },
      ],
      10
    );
    expect(hits.map((h) => h.id)).toEqual(['ok-url', 'ok-route']);
  });

  it('truncates oversized titles and drops hits without a title', () => {
    const hits = sanitizeHits(
      'a',
      [
        { ...hit('a', 1), title: 'x'.repeat(500) },
        { ...hit('a', 2), title: '  ' },
      ],
      10
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].title.length).toBeLessThanOrEqual(200);
  });
});
