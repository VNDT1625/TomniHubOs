import { describe, expect, it } from 'vitest';
import {
  aggregateResults,
  allocateQuotas,
  SUPER_SEARCH_TOTAL,
} from '@/renderer/components/layout/SuperSearch/engine/aggregate';
import type { SearchHit } from '@/renderer/components/layout/SuperSearch/engine/types';

const hit = (sourceId: string, n: number, score = 1 - n / 1000): SearchHit => ({
  id: `${sourceId}-${n}`,
  sourceId,
  title: `${sourceId} ${n}`,
  score,
  action: { kind: 'route', path: `/${sourceId}/${n}` },
});
const hits = (sourceId: string, count: number): SearchHit[] =>
  Array.from({ length: count }, (_, i) => hit(sourceId, i));

describe('allocateQuotas', () => {
  it('gives 10 each with 3 abundant sources', () => {
    expect(allocateQuotas({ a: 99, b: 99, c: 99 })).toEqual({ a: 10, b: 10, c: 10 });
  });

  it('gives 3 each with 10 abundant sources', () => {
    const counts = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}`, 50]));
    const quotas = allocateQuotas(counts);
    expect(Object.values(quotas)).toEqual(Array(10).fill(3));
  });

  it('spreads the remainder to the first sources when 30 does not divide evenly', () => {
    const counts = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`s${i}`, 50]));
    const quotas = allocateQuotas(counts);
    expect(Object.values(quotas)).toEqual([5, 5, 4, 4, 4, 4, 4]);
    expect(Object.values(quotas).reduce((a, b) => a + b, 0)).toBe(SUPER_SEARCH_TOTAL);
  });

  it('redistributes slots a short source cannot use', () => {
    expect(allocateQuotas({ a: 2, b: 50, c: 50 })).toEqual({ a: 2, b: 14, c: 14 });
    expect(allocateQuotas({ a: 0, b: 50, c: 50 })).toEqual({ a: 0, b: 15, c: 15 });
  });

  it('never allocates more than the hits available', () => {
    expect(allocateQuotas({ a: 3, b: 4 })).toEqual({ a: 3, b: 4 });
    expect(allocateQuotas({})).toEqual({});
  });

  it('honours a custom total', () => {
    expect(allocateQuotas({ a: 99, b: 99 }, 10)).toEqual({ a: 5, b: 5 });
  });
});

describe('aggregateResults', () => {
  it('caps the total at 30 and keeps source order', () => {
    const rows = aggregateResults([
      { sourceId: 'local', hits: hits('local', 40) },
      { sourceId: 'web', hits: hits('web', 40) },
      { sourceId: 'x', hits: hits('x', 40) },
    ]);
    expect(rows).toHaveLength(30);
    expect(rows.filter((r) => r.hit.sourceId === 'local')).toHaveLength(10);
    expect(rows.map((r) => r.hit.sourceId).filter((s, i, a) => a.indexOf(s) === i)).toEqual(['local', 'web', 'x']);
  });

  it('sorts a source by score and labels rank and top percent', () => {
    const rows = aggregateResults([
      {
        sourceId: 'local',
        hits: [hit('local', 1, 0.2), hit('local', 2, 0.9), hit('local', 3, 0.5), hit('local', 4, 0.1)],
      },
    ]);
    expect(rows.map((r) => r.hit.id)).toEqual(['local-2', 'local-3', 'local-1', 'local-4']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.topPercent)).toEqual([25, 50, 75, 100]);
    expect(rows.every((r) => r.sourceHitCount === 4)).toBe(true);
  });

  it('measures top percent against everything the source returned, not just what is shown', () => {
    const rows = aggregateResults(
      Array.from({ length: 10 }, (_, i) => ({ sourceId: `s${i}`, hits: hits(`s${i}`, 20) }))
    );
    const first = rows.find((r) => r.hit.sourceId === 's0' && r.rank === 1);
    expect(first?.topPercent).toBe(5);
    expect(rows.filter((r) => r.hit.sourceId === 's0')).toHaveLength(3);
  });

  it('lets a single-source scope use the whole budget', () => {
    expect(aggregateResults([{ sourceId: 'web', hits: hits('web', 45) }])).toHaveLength(30);
  });

  it('drops duplicate hit ids inside a source', () => {
    const rows = aggregateResults([{ sourceId: 'a', hits: [hit('a', 1), hit('a', 1), hit('a', 2)] }]);
    expect(rows).toHaveLength(2);
  });
});
