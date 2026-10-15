/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Userscripts of the `browser-ext` detector (design sections 7.3 and 12.4). A `*.user.js` file with a
 * `==UserScript==` header becomes an `extension` connection of format `userscript`. The script is never run or
 * rewritten here; only the header (the first 8 KB the inventory keeps) is read.
 *
 * `@require` and `@resource` that point to the network are not fetched: the connection records them as
 * `unsupported` and an open item says why. v1 accepts them only when the file is in the repository.
 */

import { sourcePath } from '../agent/mcpShared';
import { normalizeRepoPath } from '../inventory';
import { USERSCRIPT_GRANTS } from './chromeApiSupport';
import {
  addConnection,
  capList,
  isAllHosts,
  report,
  reportUnrecognized,
  titleOf,
  uniqueId,
  type Context,
} from './support';

type Header = ReadonlyMap<string, readonly string[]>;
type HeaderResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'unterminated' }>
  | Readonly<{ kind: 'ok'; header: Header }>;

const START = /^\s*\/\/\s*==UserScript==\s*$/u;
const END = /^\s*\/\/\s*==\/UserScript==\s*$/u;
const DIRECTIVE = /^\s*\/\/\s*@([A-Za-z][\w-]*)(:[\w-]+)?(?:\s+(.*?))?\s*$/u;
const GRANT = /^[A-Za-z_][\w.]{0,98}$/u;
const HOST = /^(?:\*\.)?[a-z0-9][a-z0-9.-]{0,250}$/iu;
const URL_SCHEME = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/u;
const USERSCRIPT_FILE = /\.user\.js$/iu;
const MAX_VALUE = 500;

const parseHeader = (text: string): HeaderResult => {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => START.test(line));
  if (start < 0) return { kind: 'none' };
  const header = new Map<string, string[]>();
  for (const line of lines.slice(start + 1)) {
    if (END.test(line)) return { kind: 'ok', header };
    const match = DIRECTIVE.exec(line);
    // `@name:ja` style localized variants are display text only.
    if (match === null || match[2] !== undefined) continue;
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[3] ?? '').trim();
    if (value.length > MAX_VALUE) continue;
    header.set(key, [...(header.get(key) ?? []), value]);
  }
  return { kind: 'unterminated' };
};

const unique = (values: readonly string[]): string[] => [...new Set(values.filter((value) => value !== ''))];

/** The host a network URL points to, or `undefined` when the text is not a URL. */
const hostOf = (value: string): string | undefined => {
  try {
    const host = new URL(value.startsWith('//') ? `https:${value}` : value).host;
    return host === '' ? undefined : host;
  } catch {
    return undefined;
  }
};

/** `@connect` value to a host permission pattern, or `undefined` for `self` and anything that is not a host. */
const connectPattern = (value: string): string | undefined => {
  const host = value.toLowerCase();
  if (host === '*') return '<all_urls>';
  if (host === 'self' || !HOST.test(host)) return undefined;
  return `*://${host}/*`;
};

const dirOf = (file: string): string => file.slice(0, Math.max(0, file.lastIndexOf('/')));

/** True when `reference` is a file of the repository, resolved against the folder of the script. */
const isRepoFile = (context: Context, file: string, reference: string): boolean => {
  if (URL_SCHEME.test(reference)) return false;
  const dir = dirOf(file);
  const resolved = normalizeRepoPath(dir === '' ? reference : `${dir}/${reference}`);
  return resolved !== undefined && context.inventory.files.includes(resolved);
};

/** `@require` and `@resource` entries the host cannot accept, as `unsupported` strings (network, or not in repo). */
const externalDependencies = (context: Context, file: string, header: Header): string[] => {
  const references = [
    ...(header.get('require') ?? []).map((value) => ['@require', value] as const),
    ...(header.get('resource') ?? []).map((value) => ['@resource', value.split(/\s+/u).at(-1) ?? ''] as const),
  ];
  const refused: string[] = [];
  for (const [directive, reference] of references) {
    if (reference === '' || isRepoFile(context, file, reference)) continue;
    const host = URL_SCHEME.test(reference) ? hostOf(reference) : undefined;
    refused.push(host === undefined ? `${directive} (không có trong repo)` : `${directive} ${host}`.slice(0, 100));
  }
  return unique(refused);
};

const readScript = (context: Context, file: string, header: Header): void => {
  const first = (key: string): string | undefined => header.get(key)?.[0];
  const includes = header.get('include') ?? [];
  const regexIncludes = includes.filter((value) => value.startsWith('/') && value.length > 1);
  const [matches, matchesCut] = capList(
    unique([...(header.get('match') ?? []), ...includes.filter((value) => !regexIncludes.includes(value))])
  );
  if (matches.length === 0) {
    reportUnrecognized(
      context,
      file,
      'Userscript không có @match hay @include nào dùng được: không biết chạy trên trang nào.'
    );
    return;
  }
  const grants = unique((header.get('grant') ?? []).filter((grant) => grant !== 'none' && GRANT.test(grant)));
  const [permissions, grantsCut] = capList(grants);
  const [hostPermissions] = capList(
    unique(
      (header.get('connect') ?? []).map(connectPattern).filter((pattern): pattern is string => pattern !== undefined)
    )
  );
  const unsupported = unique([
    ...grants.filter((grant) => !USERSCRIPT_GRANTS.has(grant)),
    ...(regexIncludes.length > 0 ? ['@include (biểu thức chính quy)'] : []),
    ...(first('run-at') === 'context-menu' ? ['@run-at context-menu'] : []),
    ...externalDependencies(context, file, header),
  ]);
  const [unsupportedKept] = capList(unsupported);

  const fileName = file.slice(file.lastIndexOf('/') + 1).replace(USERSCRIPT_FILE, '');
  const title = titleOf(first('name'), fileName);
  const version = first('version');
  const id = uniqueId(context, [fileName, file.replace(USERSCRIPT_FILE, '').replaceAll('/', '-'), 'userscript']);
  const connection = addConnection(
    context,
    {
      kind: 'extension',
      id,
      title,
      format: 'userscript',
      root: sourcePath(file),
      ...(version !== undefined && version.length > 0 && version.length <= 64 ? { version } : {}),
      permissions,
      hostPermissions,
      matches,
      unsupported: unsupportedKept,
      origin: 'userscript',
    },
    file
  );
  if (connection === undefined) return;

  context.reasons.push(
    `Userscript "${title}" (${file}): ${matches.length} mẫu @match, ${permissions.length} @grant, ${unsupportedKept.length} mục chưa hỗ trợ`
  );
  if (unsupportedKept.length > 0) {
    report(context, {
      kind: 'needs-runtime',
      connection: id,
      path: sourcePath(file),
      note: `Userscript "${title}" dùng thứ Hub chưa hỗ trợ ở v1, nên không chạy đủ: ${unsupportedKept.join(', ')}. @require và @resource tới mạng không được tải.`,
    });
  }
  if (matchesCut || grantsCut) {
    reportUnrecognized(context, file, 'Userscript có quá nhiều @match hoặc @grant; chỉ giữ 100 mục đầu.');
  }
  if ([...matches, ...hostPermissions].some(isAllHosts)) {
    report(context, {
      kind: 'needs-consent',
      connection: id,
      path: sourcePath(file),
      note: `Userscript "${title}" chạy trên mọi trang hoặc gọi tới mọi host (@match, @include hoặc @connect *); cần người dùng đồng ý riêng trước khi bật.`,
    });
  }
};

/** Reads every `*.user.js` with a header. A file without the header is not a userscript and is left alone. */
export const detectUserscripts = (context: Context): void => {
  for (const file of context.inventory.files) {
    if (!USERSCRIPT_FILE.test(file)) continue;
    const text = context.inventory.text(file);
    if (text === undefined) continue;
    const parsed = parseHeader(text);
    if (parsed.kind === 'none') continue;
    context.claimed.add(file);
    if (parsed.kind === 'unterminated') {
      reportUnrecognized(context, file, 'Header ==UserScript== không đóng trong 8 KB đầu của tệp.');
      continue;
    }
    readScript(context, file, parsed.header);
  }
};
