/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AggregatedRow, SearchHit } from './types';

/** Results shown in the centre panel across all sources. */
export const SUPER_SEARCH_TOTAL = 30;

/**
 * Splits `total` slots across sources: everyone starts from floor(total / sources); slots a
 * source cannot fill (fewer hits than its share) go to the sources that still have hits, and a
 * non-divisible remainder goes one by one to the earliest sources. Never exceeds a source's hits.
 */
export const allocateQuotas = (
  counts: Readonly<Record<string, number>>,
  total: number = SUPER_SEARCH_TOTAL
): Record<string, number> => {
  const ids = Object.keys(counts);
  const available = Object.fromEntries(ids.map((id) => [id, Math.max(0, Math.floor(counts[id] || 0))]));
  const allocated: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  let remaining = Math.max(0, Math.floor(total));
  while (remaining > 0) {
    const eligible = ids.filter((id) => allocated[id] < available[id]);
    if (eligible.length === 0) break;
    const share = Math.floor(remaining / eligible.length);
    if (share === 0) {
      for (const id of eligible) {
        if (remaining === 0) break;
        allocated[id] += 1;
        remaining -= 1;
      }
      break;
    }
    for (const id of eligible) {
      const grant = Math.min(share, available[id] - allocated[id]);
      allocated[id] += grant;
      remaining -= grant;
    }
  }
  return allocated;
};

export type SourceHits = { sourceId: string; hits: SearchHit[] };

/**
 * Builds the centre list: per source, hits are de-duplicated and ordered by score, then cut to
 * that source's quota. Rows stay grouped in the order the sources were given.
 */
export const aggregateResults = (
  groups: readonly SourceHits[],
  total: number = SUPER_SEARCH_TOTAL
): AggregatedRow[] => {
  const ranked = groups.map(({ sourceId, hits }) => {
    const seen = new Set<string>();
    const unique = hits.filter((hit) => !seen.has(hit.id) && seen.add(hit.id));
    // Array#toSorted is stable, so equal scores keep the provider's own order.
    return { sourceId, hits: unique.toSorted((a, b) => b.score - a.score) };
  });
  const quotas = allocateQuotas(Object.fromEntries(ranked.map((group) => [group.sourceId, group.hits.length])), total);
  return ranked.flatMap(({ sourceId, hits }) =>
    hits.slice(0, quotas[sourceId] ?? 0).map((hit, index) => ({
      hit,
      rank: index + 1,
      sourceHitCount: hits.length,
      topPercent: Math.ceil(((index + 1) / hits.length) * 100),
    }))
  );
};
