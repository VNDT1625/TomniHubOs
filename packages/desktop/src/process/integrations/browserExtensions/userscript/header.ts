/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads the `// ==UserScript==` block of a userscript (docs/platform/repotopackage-design.md section 12.4).
 *
 * Pure and linear: no regular expression here can backtrack on hostile input, the scanned prefix is bounded, and a
 * value is refused rather than shortened when it is too long (a shortened `@match` or `@exclude` would match more
 * than the author wrote). A key that appears twice keeps its first value for single-value keys and collects every
 * value for list keys. Keys the converter does not know are ignored.
 */

import {
  failure,
  USERSCRIPT_LIMITS,
  type UserscriptFailure,
} from '@process/integrations/browserExtensions/userscript/types';

export type UserscriptResource = Readonly<{ name: string; url: string }>;

export type UserscriptHeader = Readonly<{
  name?: string;
  namespace?: string;
  version?: string;
  description?: string;
  icon?: string;
  runAt?: string;
  matches: readonly string[];
  includes: readonly string[];
  excludes: readonly string[];
  excludeMatches: readonly string[];
  grants: readonly string[];
  requires: readonly string[];
  resources: readonly UserscriptResource[];
  connects: readonly string[];
  noframes: boolean;
  /** The header block as written, line endings normalized to `\n`; shown to scripts as `GM_info.scriptMetaStr`. */
  block: string;
}>;

export type HeaderResult = Readonly<{ ok: true; header: UserscriptHeader }> | UserscriptFailure;

const SINGLE_KEYS: ReadonlySet<string> = new Set([
  'name',
  'namespace',
  'version',
  'description',
  'icon',
  'iconurl',
  'defaulticon',
  'run-at',
]);
const LIST_KEYS: ReadonlySet<string> = new Set([
  'match',
  'include',
  'exclude',
  'exclude-match',
  'grant',
  'require',
  'resource',
  'connect',
]);
const KEY = /^@([A-Za-z][A-Za-z0-9_:-]*)/;
// oxlint-disable-next-line no-control-regex -- control characters are exactly what is removed
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const isMarker = (line: string, marker: string): boolean => {
  const trimmed = line.trim();
  return trimmed.startsWith('//') && trimmed.slice(2).trim() === marker;
};

/** Parses the header. Returns a failure with a reason fit for the approval, never throws. */
export const parseUserscriptHeader = (source: string): HeaderResult => {
  if (typeof source !== 'string' || source.length === 0) {
    return failure('no-header', 'Tệp userscript trống hoặc không đọc được.');
  }
  if (source.length > USERSCRIPT_LIMITS.MAX_SOURCE_CHARS) {
    return failure('too-large', 'Userscript quá lớn để chuyển thành tiện ích.');
  }
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = text.slice(0, USERSCRIPT_LIMITS.HEADER_SCAN_CHARS).split(/\r\n|\r|\n/);
  const start = lines.findIndex((line) => isMarker(line, '==UserScript=='));
  if (start === -1) return failure('no-header', 'Không thấy khối // ==UserScript== ở đầu tệp.');
  let end = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isMarker(lines[index] ?? '', '==/UserScript==')) {
      end = index;
      break;
    }
  }
  if (end === -1) return failure('bad-header', 'Khối // ==UserScript== thiếu dòng // ==/UserScript== kết thúc.');
  if (end - start - 1 > USERSCRIPT_LIMITS.MAX_HEADER_LINES) {
    return failure('bad-header', 'Khối chú thích userscript có quá nhiều dòng.');
  }

  const single = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let noframes = false;
  for (let index = start + 1; index < end; index += 1) {
    const raw = lines[index] ?? '';
    if (raw.length > USERSCRIPT_LIMITS.MAX_LINE_CHARS) {
      return failure('bad-header', 'Khối chú thích userscript có dòng quá dài.');
    }
    const trimmed = raw.trim();
    if (!trimmed.startsWith('//')) continue;
    const rest = trimmed.slice(2).trimStart();
    const keyMatch = KEY.exec(rest);
    if (keyMatch === null) continue;
    const afterKey = rest.slice(keyMatch[0].length);
    if (afterKey !== '' && !/^\s/.test(afterKey)) continue;
    const key = (keyMatch[1] ?? '').toLowerCase();
    const value = afterKey.replace(CONTROL, '').trim();
    if (key === 'noframes') {
      noframes = true;
    } else if (SINGLE_KEYS.has(key)) {
      if (value !== '' && !single.has(key)) single.set(key, value);
    } else if (LIST_KEYS.has(key) && value !== '') {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, list);
    }
  }

  const list = (key: string, limit: number): readonly string[] | undefined => {
    const values = lists.get(key) ?? [];
    return values.length > limit ? undefined : values;
  };
  const matches = list('match', USERSCRIPT_LIMITS.MAX_MATCHES);
  const includes = list('include', USERSCRIPT_LIMITS.MAX_MATCHES);
  const excludes = list('exclude', USERSCRIPT_LIMITS.MAX_EXCLUDES);
  const excludeMatches = list('exclude-match', USERSCRIPT_LIMITS.MAX_EXCLUDES);
  const connects = list('connect', USERSCRIPT_LIMITS.MAX_CONNECTS);
  const requires = list('require', USERSCRIPT_LIMITS.MAX_REQUIRES);
  const grantLines = list('grant', USERSCRIPT_LIMITS.MAX_GRANTS);
  const resourceLines = list('resource', USERSCRIPT_LIMITS.MAX_RESOURCES);
  if (
    matches === undefined ||
    includes === undefined ||
    excludes === undefined ||
    excludeMatches === undefined ||
    connects === undefined ||
    requires === undefined ||
    grantLines === undefined ||
    resourceLines === undefined
  ) {
    return failure('too-many', 'Khối chú thích userscript có quá nhiều dòng cùng loại.');
  }

  const grants = [...new Set(grantLines.flatMap((line) => line.split(/\s+/).filter((item) => item !== '')))];
  if (grants.length > USERSCRIPT_LIMITS.MAX_GRANTS) {
    return failure('too-many', 'Khối chú thích userscript có quá nhiều @grant.');
  }
  const resources: UserscriptResource[] = [];
  for (const line of resourceLines) {
    const space = line.search(/\s/);
    const resourceUrl = space === -1 ? '' : line.slice(space).trim();
    if (space <= 0 || resourceUrl === '') {
      return failure('bad-header', 'Dòng @resource phải có dạng "tên đường-dẫn".', {
        directive: '@resource',
        value: line,
      });
    }
    resources.push({ name: line.slice(0, space), url: resourceUrl });
  }

  const name = single.get('name');
  const namespace = single.get('namespace');
  const version = single.get('version');
  const description = single.get('description');
  const runAt = single.get('run-at');
  const icon = single.get('icon') ?? single.get('iconurl') ?? single.get('defaulticon');
  return {
    ok: true,
    header: {
      ...(name === undefined ? {} : { name }),
      ...(namespace === undefined ? {} : { namespace }),
      ...(version === undefined ? {} : { version }),
      ...(description === undefined ? {} : { description }),
      ...(icon === undefined ? {} : { icon }),
      ...(runAt === undefined ? {} : { runAt }),
      matches: [...new Set(matches)],
      includes: [...new Set(includes)],
      excludes: [...new Set(excludes)],
      excludeMatches: [...new Set(excludeMatches)],
      grants,
      requires: [...new Set(requires)],
      resources,
      connects: [...new Set(connects)],
      noframes,
      block: lines.slice(start, end + 1).join('\n'),
    },
  };
};
