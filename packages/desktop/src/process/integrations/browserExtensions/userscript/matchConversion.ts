/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns userscript page filters into the fields of a Manifest V3 content script (docs/platform/repotopackage-design.md
 * section 12.4).
 *
 * The one rule: a filter may be made narrower than the author wrote, never wider.
 * - `@match` and `@include` select pages. One that cannot be converted exactly is dropped (the script then runs on
 *   fewer pages) and reported as a note.
 * - `@exclude` and `@exclude-match` remove pages. One that cannot be converted would make the script run where its
 *   author said it must not, so the whole script is refused instead.
 *
 * Only `http`, `https` and `*` schemes are accepted: a content script cannot run on other schemes in the Browser
 * profile. Pure; reuses the match pattern parser of the `chrome.*` shim.
 */

import { ALL_URLS, parseMatchPattern } from '@process/integrations/browserExtensions/api/matchPattern';
import type { UserscriptHeader } from '@process/integrations/browserExtensions/userscript/header';
import {
  failure,
  type UserscriptFailure,
  type UserscriptNote,
} from '@process/integrations/browserExtensions/userscript/types';

export type MatchPlan = Readonly<{
  matches: readonly string[];
  excludeMatches: readonly string[];
  /** Chrome `exclude_globs` (`*` and `?`): the userscript `@exclude` glob syntax, unchanged. */
  excludeGlobs: readonly string[];
  notes: readonly UserscriptNote[];
}>;

export type MatchResult = Readonly<{ ok: true; plan: MatchPlan }> | UserscriptFailure;

const CONTENT_SCHEMES: ReadonlySet<string> = new Set(['*', 'http', 'https']);

const isContentPattern = (pattern: string): boolean => {
  if (pattern === ALL_URLS) return true;
  const parsed = parseMatchPattern(pattern);
  return parsed !== undefined && CONTENT_SCHEMES.has(parsed.scheme);
};

const looksLikeRegex = (value: string): boolean => value.length > 2 && value.startsWith('/') && value.endsWith('/');

/** `*`-only host forms a match pattern can say: a whole `*`, or a leading `*.`; no `?`. */
const convertibleHost = (host: string): boolean => {
  if (host === '' || host.includes('?')) return false;
  const stars = host.split('*').length - 1;
  return stars === 0 || host === '*' || (stars === 1 && host.startsWith('*.'));
};

/** Converts a userscript `@include` glob to a match pattern, or returns undefined when that is not exact. */
export const includeToMatchPattern = (glob: string): string | undefined => {
  if (glob === '*') return ALL_URLS;
  if (looksLikeRegex(glob)) return undefined;
  const split = /^(\*|https?|http\*):\/\/([^/]*)(\/.*)?$/i.exec(glob);
  if (split === null) return undefined;
  const rawScheme = (split[1] ?? '').toLowerCase();
  const scheme = rawScheme === 'http*' ? '*' : rawScheme;
  const host = (split[2] ?? '').toLowerCase();
  const path = split[3] ?? '/';
  if (!convertibleHost(host) || path.includes('?')) return undefined;
  const candidate = `${scheme}://${host}${path}`;
  return isContentPattern(candidate) ? candidate : undefined;
};

const unique = (values: readonly string[]): string[] => [...new Set(values)];

export const convertPageFilters = (header: UserscriptHeader): MatchResult => {
  const notes: UserscriptNote[] = [];
  const matches: string[] = [];
  for (const pattern of header.matches) {
    if (isContentPattern(pattern)) {
      matches.push(pattern);
    } else {
      notes.push({ code: 'match-dropped', message: `@match không dùng được trên Tomny và bị bỏ qua: ${pattern}` });
    }
  }
  for (const glob of header.includes) {
    const converted = includeToMatchPattern(glob);
    if (converted === undefined) {
      notes.push({
        code: 'match-dropped',
        message: `@include không chuyển được sang mẫu @match chính xác nên bị bỏ qua: ${glob}`,
      });
    } else {
      matches.push(converted);
    }
  }
  const finalMatches = unique(matches);
  if (finalMatches.length === 0) {
    return failure(
      'no-match',
      'Userscript không có @match hoặc @include nào dùng được nên sẽ không chạy trên trang nào.'
    );
  }

  const excludeMatches: string[] = [];
  for (const pattern of header.excludeMatches) {
    if (!isContentPattern(pattern)) {
      return failure(
        'unsupported-exclude',
        'Có @exclude-match không đọc được; từ chối để script không chạy rộng hơn.',
        {
          directive: '@exclude-match',
          value: pattern,
        }
      );
    }
    excludeMatches.push(pattern);
  }
  const excludeGlobs: string[] = [];
  for (const glob of header.excludes) {
    if (looksLikeRegex(glob)) {
      return failure(
        'unsupported-exclude',
        'Có @exclude dạng biểu thức chính quy; từ chối để script không chạy rộng hơn.',
        {
          directive: '@exclude',
          value: glob,
        }
      );
    }
    excludeGlobs.push(glob);
  }

  if (finalMatches.includes(ALL_URLS) || finalMatches.some((pattern) => pattern.startsWith('*://*/'))) {
    notes.push({ code: 'broad-match', message: 'Userscript chạy trên mọi trang web.' });
  }
  return {
    ok: true,
    plan: { matches: finalMatches, excludeMatches: unique(excludeMatches), excludeGlobs: unique(excludeGlobs), notes },
  };
};
