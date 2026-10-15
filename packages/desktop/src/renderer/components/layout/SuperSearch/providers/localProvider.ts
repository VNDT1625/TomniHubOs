/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SearchAction, SearchHit, SearchIconKey, SearchProvider } from '../engine/types';

/** One searchable in-app item. Built from already-localised text, so matching is language-neutral. */
export type LocalEntry = {
  id: string;
  title: string;
  subtitle?: string;
  /** Match against the subtitle too. Off for generic labels such as "Settings" that every entry shares. */
  subtitleSearchable?: boolean;
  /** Extra match terms (synonyms, English and Vietnamese names); never displayed. */
  keywords: string;
  icon: SearchIconKey;
  action: SearchAction;
};

/** Lowercase, strip diacritics (including Vietnamese đ) so `cai dat` finds `Cài đặt`. */
export const normaliseText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();

type MatchFields = { title: string; subtitle?: string; keywords: string };

const tokenScore = (token: string, title: string, keywords: string, subtitle: string): number => {
  if (title.startsWith(token)) return 1;
  if (title.split(/[\s\-_/&.]+/).some((word) => word.startsWith(token))) return 0.9;
  if (title.includes(token)) return 0.75;
  if (keywords.includes(token)) return 0.55;
  if (subtitle.includes(token)) return 0.4;
  return 0;
};

/** 0 when any query word is missing; otherwise the mean of each word's best field match (0..1). */
export const matchScore = (query: string, fields: MatchFields): number => {
  const tokens = normaliseText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const title = normaliseText(fields.title);
  const keywords = normaliseText(fields.keywords);
  const subtitle = normaliseText(fields.subtitle ?? '');
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(token, title, keywords, subtitle);
    if (score === 0) return 0;
    total += score;
  }
  return total / tokens.length;
};

/** The in-app source: conversations, settings, pages, apps and actions. Pure in-memory matching. */
export const createLocalProvider = (label: string, getEntries: () => readonly LocalEntry[]): SearchProvider => ({
  source: { id: 'local', kind: 'local', label, defaultAlias: 'l', includeInAllByDefault: true },
  search: async ({ query, limit }) => {
    const hits: SearchHit[] = [];
    for (const entry of getEntries()) {
      const score = matchScore(query, {
        title: entry.title,
        keywords: entry.keywords,
        subtitle: entry.subtitleSearchable ? entry.subtitle : undefined,
      });
      if (score > 0) {
        hits.push({
          id: entry.id,
          sourceId: 'local',
          title: entry.title,
          subtitle: entry.subtitle,
          score,
          icon: entry.icon,
          action: entry.action,
        });
      }
    }
    return hits.toSorted((a, b) => b.score - a.score).slice(0, limit);
  },
});
