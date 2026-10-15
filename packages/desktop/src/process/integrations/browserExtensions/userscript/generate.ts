/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns a userscript into the file set of a Manifest V3 extension (docs/platform/repotopackage-design.md section
 * 12.4, task T4.4). The result is consumed like any extension folder: `stageGeneratedExtension` writes it, then the
 * working copy (`prepareWorkingCopy`) pins the key and the host loads it. The original script is never modified.
 *
 * Pure and deterministic: the same input gives byte-identical files (no clock, no randomness, no environment), and
 * all sizes are capped. The script is never evaluated; the caller reads local `@require` files itself (bounded) and
 * passes their text in `localFiles`.
 *
 * Decisions:
 * - World. With no supported `GM_*` function (`@grant none` or none declared) the script runs unchanged in the page
 *   world (`MAIN`), as such scripts expect page access. With any supported grant it runs in the isolated world
 *   inside the runtime wrapper (gmRuntime.ts); `unsafeWindow` is therefore not provided.
 * - Network `@require` and `@resource` are refused (`network-require`): v1 never downloads code for a script. A local
 *   `@require` (a path inside the package, no `..`) is inlined; a local `@resource` is ignored with a note.
 * - Permissions are the minimum the grants need: `storage` for the value functions, `clipboardWrite` for
 *   `GM_setClipboard`, and `host_permissions` only for `@connect` hosts when `GM_xmlhttpRequest` is granted.
 */

import { inspectManifest, type ManifestSummary } from '@process/integrations/browserExtensions/manifest';
import {
  resolveConnects,
  resolveGrants,
  needsStorage,
  type SupportedGrant,
} from '@process/integrations/browserExtensions/userscript/gmGrants';
import { buildGmBackground } from '@process/integrations/browserExtensions/userscript/gmBackground';
import { buildGmContentScript } from '@process/integrations/browserExtensions/userscript/gmRuntime';
import {
  parseUserscriptHeader,
  type UserscriptHeader,
} from '@process/integrations/browserExtensions/userscript/header';
import { convertPageFilters } from '@process/integrations/browserExtensions/userscript/matchConversion';
import {
  failure,
  USERSCRIPT_LIMITS,
  type GeneratedFile,
  type UserscriptFailure,
  type UserscriptNote,
} from '@process/integrations/browserExtensions/userscript/types';

export const USERSCRIPT_CONTENT_FILE = 'userscript.js';
export const USERSCRIPT_BACKGROUND_FILE = 'gm-background.js';
const MANIFEST_FILE = 'manifest.json';
const MAX_REQUIRE_PATH = 300;
const REQUIRE_SEGMENT = /^[A-Za-z0-9._@+-]+$/;
const DEFAULT_VERSION = '0.0.1';

export type UserscriptExtensionInput = Readonly<{
  /** The text of the `.user.js` file. */
  source: string;
  /**
   * Text of local `@require` files, keyed by the normalized path that {@link planLocalRequires} returned. A Map, so a
   * hostile key such as `__proto__` is just a key.
   */
  localFiles?: ReadonlyMap<string, string>;
}>;

export type UserscriptWorld = 'MAIN' | 'ISOLATED';

export type GeneratedUserscriptExtension = Readonly<{
  ok: true;
  /** `manifest.json` first-class: the parsed object that was serialized into `files`. */
  manifest: Readonly<Record<string, unknown>>;
  /** Every file of the extension, sorted by path, including `manifest.json`. */
  files: readonly GeneratedFile[];
  world: UserscriptWorld;
  /** The `GM_*` functions that will be provided. */
  grants: readonly SupportedGrant[];
  /** What was not carried over; the approval and the connection's `unsupported` list show these. */
  notes: readonly UserscriptNote[];
  /** What `inspectManifest` reads from the generated manifest (the same view the approval uses). */
  summary: ManifestSummary;
}>;

export type UserscriptExtensionResult = GeneratedUserscriptExtension | UserscriptFailure;

const NETWORK_URL = /^(?:https?|ftp):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const isNetworkReference = (value: string): boolean => NETWORK_URL.test(value) || value.startsWith('//');

/** Normalizes a local `@require` path, or returns undefined when it could leave the package folder. */
const normalizeLocalPath = (value: string): string | undefined => {
  if (value.length > MAX_REQUIRE_PATH || ANY_SCHEME.test(value)) return undefined;
  if (/[\\?#]/.test(value) || value.startsWith('/')) return undefined;
  const parts: string[] = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' || !REQUIRE_SEGMENT.test(segment)) return undefined;
    parts.push(segment);
  }
  return parts.length === 0 ? undefined : parts.join('/');
};

export type LocalRequirePlan = Readonly<{ ok: true; paths: readonly string[] }> | UserscriptFailure;

/**
 * Checks every `@require` and `@resource` of a parsed header and returns the local files the caller must read, in
 * order. A network reference is refused with `network-require`; so is anything that is not a plain relative path.
 */
export const planLocalRequires = (header: UserscriptHeader): LocalRequirePlan => {
  for (const resource of header.resources) {
    if (isNetworkReference(resource.url)) {
      return failure(
        'network-require',
        'Userscript tải @resource từ mạng. Tomny không tải mã hay tài nguyên từ mạng cho userscript ở bản v1.',
        { directive: '@resource', value: resource.url }
      );
    }
  }
  const paths: string[] = [];
  for (const value of header.requires) {
    if (isNetworkReference(value)) {
      return failure(
        'network-require',
        'Userscript tải @require từ mạng. Tomny không tải thư viện từ mạng ở bản v1; chỉ nhận tệp nằm trong gói.',
        { directive: '@require', value }
      );
    }
    const normalized = normalizeLocalPath(value);
    if (normalized === undefined) {
      return failure('bad-require', '@require phải là đường dẫn tương đối nằm trong gói, không có "..".', {
        directive: '@require',
        value,
      });
    }
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  return { ok: true, paths };
};

const cleanText = (value: string | undefined, limit: number): string =>
  (value ?? '')
    // oxlint-disable-next-line no-control-regex -- control characters are exactly what is removed
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

/** Chrome accepts one to four integers from 0 to 65535. `raw` is kept as `version_name` when it differs. */
const chromeVersion = (raw: string | undefined): string => {
  const match = /^\d{1,5}(?:\.\d{1,5}){0,3}/.exec(raw ?? '');
  if (match === null) return DEFAULT_VERSION;
  const parts = match[0].split('.').map(Number);
  return parts.some((part) => part > 65_535) ? DEFAULT_VERSION : parts.join('.');
};

const RUN_AT: ReadonlyMap<string, string> = new Map([
  ['document-start', 'document_start'],
  ['document-end', 'document_end'],
  ['document-idle', 'document_idle'],
]);

const requireFileName = (index: number, path: string): string => {
  const base = (path.split('/').pop() ?? 'lib').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  return `require/${String(index + 1).padStart(2, '0')}-${base.endsWith('.js') ? base : `${base}.js`}`;
};

const byPath = (left: GeneratedFile, right: GeneratedFile): number =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;

/** Converts a userscript to a generated MV3 extension. Never throws and never evaluates the script. */
export const generateUserscriptExtension = (input: UserscriptExtensionInput): UserscriptExtensionResult => {
  const parsed = parseUserscriptHeader(input.source);
  if (parsed.ok === false) return parsed;
  const { header } = parsed;

  const filters = convertPageFilters(header);
  if (filters.ok === false) return filters;
  const requirePlan = planLocalRequires(header);
  if (requirePlan.ok === false) return requirePlan;

  const requireTexts: string[] = [];
  let requireChars = 0;
  for (const path of requirePlan.paths) {
    const text = input.localFiles?.get(path);
    if (text === undefined) {
      return failure('missing-require', 'Không tìm thấy tệp @require trong gói.', {
        directive: '@require',
        value: path,
      });
    }
    requireChars += text.length;
    if (requireChars > USERSCRIPT_LIMITS.MAX_REQUIRE_CHARS) {
      return failure('too-large', 'Các tệp @require trong gói quá lớn.', { directive: '@require' });
    }
    requireTexts.push(text);
  }

  const notes: UserscriptNote[] = [...filters.plan.notes];
  const grantPlan = resolveGrants(header.grants);
  notes.push(...grantPlan.notes);
  const connectPlan = resolveConnects(header.connects);
  notes.push(...connectPlan.notes);

  let granted: readonly SupportedGrant[] = grantPlan.granted;
  if (granted.includes('GM_xmlhttpRequest') && connectPlan.hosts.length === 0) {
    granted = granted.filter((grant) => grant !== 'GM_xmlhttpRequest');
    notes.push({
      code: 'xhr-needs-connect',
      message: 'GM_xmlhttpRequest cần ít nhất một @connect hợp lệ; hàm này không được cung cấp.',
    });
  }
  const useXhr = granted.includes('GM_xmlhttpRequest');

  if (header.runAt !== undefined && !RUN_AT.has(header.runAt)) {
    notes.push({
      code: 'run-at-unsupported',
      message: `@run-at ${header.runAt.slice(0, 50)} chưa được hỗ trợ; dùng document-idle.`,
    });
  }
  for (const resource of header.resources) {
    notes.push({
      code: 'resource-ignored',
      message: `@resource ${resource.name.slice(0, 50)} bị bỏ qua (chưa có GM_getResourceText).`,
    });
  }
  if (header.icon !== undefined) {
    notes.push({ code: 'icon-ignored', message: '@icon không được dùng làm biểu tượng tiện ích.' });
  }

  const world: UserscriptWorld = granted.length > 0 ? 'ISOLATED' : 'MAIN';
  const files: GeneratedFile[] = [];
  const scriptFiles: string[] = [];
  if (world === 'MAIN') {
    requirePlan.paths.forEach((path, index) => {
      const name = requireFileName(index, path);
      files.push({ path: name, content: requireTexts[index] ?? '' });
      scriptFiles.push(name);
    });
    files.push({ path: USERSCRIPT_CONTENT_FILE, content: input.source });
  } else {
    const name = cleanText(header.name, 200) || 'Userscript';
    const info = {
      scriptHandler: 'Tomny',
      version: '1',
      script: {
        name,
        namespace: cleanText(header.namespace, 200),
        version: cleanText(header.version, 64),
        description: cleanText(header.description, 500),
        matches: filters.plan.matches,
        excludes: [...filters.plan.excludeMatches, ...filters.plan.excludeGlobs],
        runAt: header.runAt !== undefined && RUN_AT.has(header.runAt) ? header.runAt : 'document-idle',
        grant: granted,
        noframes: header.noframes,
      },
      scriptMetaStr: header.block,
    };
    files.push({
      path: USERSCRIPT_CONTENT_FILE,
      content: buildGmContentScript({ info, granted, requires: requireTexts, source: input.source }),
    });
  }
  scriptFiles.push(USERSCRIPT_CONTENT_FILE);
  if (useXhr) files.push({ path: USERSCRIPT_BACKGROUND_FILE, content: buildGmBackground(connectPlan.hosts) });

  const permissions = [
    ...(needsStorage(granted) ? ['storage'] : []),
    ...(granted.includes('GM_setClipboard') ? ['clipboardWrite'] : []),
  ];
  const version = chromeVersion(header.version);
  const versionName = cleanText(header.version, 64);
  const description = cleanText(header.description, 132);
  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: cleanText(header.name, 75) || 'Userscript',
    version,
    ...(versionName !== '' && versionName !== version ? { version_name: versionName } : {}),
    ...(description === '' ? {} : { description }),
    content_scripts: [
      {
        matches: filters.plan.matches,
        ...(filters.plan.excludeMatches.length === 0 ? {} : { exclude_matches: filters.plan.excludeMatches }),
        ...(filters.plan.excludeGlobs.length === 0 ? {} : { exclude_globs: filters.plan.excludeGlobs }),
        js: scriptFiles,
        run_at: RUN_AT.get(header.runAt ?? '') ?? 'document_idle',
        all_frames: !header.noframes,
        world,
      },
    ],
    ...(permissions.length === 0 ? {} : { permissions }),
    ...(useXhr ? { host_permissions: connectPlan.hostPermissions } : {}),
    ...(useXhr ? { background: { service_worker: USERSCRIPT_BACKGROUND_FILE } } : {}),
  };

  const verdict = inspectManifest(manifest);
  if (verdict.ok === false) return failure('invalid-manifest', verdict.reason);
  files.push({ path: MANIFEST_FILE, content: `${JSON.stringify(manifest, null, 2)}\n` });
  files.sort(byPath);
  if (files.reduce((sum, file) => sum + file.content.length, 0) > USERSCRIPT_LIMITS.MAX_OUTPUT_CHARS) {
    return failure('too-large', 'Tiện ích sinh ra từ userscript quá lớn.');
  }
  return { ok: true, manifest, files, world, grants: granted, notes, summary: verdict.summary };
};
