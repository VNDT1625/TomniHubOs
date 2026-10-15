/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Site access for content scripts (docs/platform/repotopackage-design.md sections 12.5 and 12.8). Electron injects the
 * `content_scripts` of an unpacked extension by itself, so the Chrome API shim alone cannot keep an extension off a
 * site. This module writes the effective manifest the host loads: the same extension, with the broad match patterns
 * that the person's choice does not allow removed or narrowed.
 *
 * Pure: no file system, no Electron. The source manifest is untrusted input and is only read here.
 *
 * Rules (per site access mode, from `SiteAccessConfig`):
 * - Every valid pattern the extension declared and that is not broad (`https://github.com/*`) stays active in every
 *   mode, as a narrow host permission does in Chrome.
 * - A broad pattern (`<all_urls>`, `*://*\/*`, `*.com`) is removed under `on-click` and `on-site`, and kept as declared
 *   under `all-sites`.
 * - Under `on-click` and `on-site` a broad pattern is replaced by the origins the person allowed (`saved sites` only
 *   under `on-site`, `this run` in both), one exact origin pattern (`https://a.example/*`) each, and only where that
 *   broad pattern covers the whole origin path. A grant never adds a site the manifest does not already cover.
 * - A pattern that is not a valid Chrome match pattern is dropped. A content script whose matches are invalid is
 *   skipped as a whole and reported in the notes.
 * - Nothing here widens a manifest: every output pattern is either declared by it or a whole-origin subset of a
 *   declared broad pattern.
 */

import { isBroadPattern, isWebOrigin, originMatchesPattern, originPattern, type SiteAccessConfig } from './siteAccess';

/** Scheme, host (`*`, `*.` followed by a domain, or a plain domain; no port, no `*` elsewhere), then a path from `/`. */
const MATCH = /^(\*|https?|wss?|ftp|file):\/\/(\*|\*\.[^/*:]+|[^/*:]+)(\/.*)$/u;
/** Entries of `permissions` (MV2) that are host patterns rather than API names. */
const HOST_LIKE = /^(<all_urls>|(\*|https?|file|ftp|wss?):\/\/)/u;
const NOTE_LENGTH = 120;

type ManifestRecord = Record<string, unknown>;

export type SiteAccessManifest = Readonly<{
  /** The manifest to load. Same keys as the source; only the host lists and content scripts change. */
  manifest: ManifestRecord;
  /** Plain-language notes about what was dropped (malformed entries). Empty when nothing was dropped. */
  notes: readonly string[];
}>;

const isRecord = (value: unknown): value is ManifestRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const clip = (value: unknown): string => (typeof value === 'string' ? value.slice(0, NOTE_LENGTH) : 'không phải chuỗi');

/** True for a Chrome match pattern the browser accepts: `<all_urls>` or scheme://host/path with no port. */
export const isValidMatchPattern = (pattern: string): boolean => pattern === '<all_urls>' || MATCH.test(pattern);

/** The path of a valid match pattern (`/*` for `https://a.example/*`). */
const pathOf = (pattern: string): string => {
  const rest = pattern.slice(pattern.indexOf('://') + 3);
  return rest.slice(rest.indexOf('/'));
};

/** True when the pattern grants the whole origin, every path: `<all_urls>` or a host pattern with path `/*`. */
const coversWholeOrigin = (pattern: string): boolean => pattern === '<all_urls>' || pathOf(pattern) === '/*';

/** The origins the person allowed that this view may use: saved sites under `on-site`, and this run's grants. */
const grantedOrigins = (config: SiteAccessConfig): string[] =>
  [...new Set([...(config.mode === 'on-site' ? config.sites : []), ...config.sessionSites])].filter(isWebOrigin);

/**
 * Rewrites one list of match patterns (`host_permissions`, `content_scripts[].matches`, MV2 host `permissions`).
 * Invalid patterns are dropped and noted. Broad ones are dropped when `narrowBroad` is set, and replaced by the granted
 * origins they cover. Narrow ones are kept.
 */
const rewriteMatches = (
  patterns: readonly string[],
  narrowBroad: boolean,
  grants: readonly string[],
  notes: string[]
): string[] => {
  const kept: string[] = [];
  const wholeBroad: string[] = [];
  for (const pattern of patterns) {
    if (!isValidMatchPattern(pattern)) {
      notes.push(`Bỏ qua khuôn mẫu không hợp lệ: ${clip(pattern)}`);
      continue;
    }
    if (!narrowBroad || !isBroadPattern(pattern)) {
      kept.push(pattern);
    } else if (coversWholeOrigin(pattern)) {
      wholeBroad.push(pattern);
    }
  }
  if (narrowBroad) {
    for (const origin of grants) {
      const grant = originPattern(origin);
      if (isValidMatchPattern(grant) && wholeBroad.some((broad) => originMatchesPattern(broad, origin))) {
        kept.push(grant);
      }
    }
  }
  return [...new Set(kept)];
};

/**
 * Returns the manifest to load for `config`. `source` is the manifest as the extension shipped it (without the key the
 * host adds). Pure: the same input always gives the same output.
 */
export const applySiteAccessToManifest = (source: ManifestRecord, config: SiteAccessConfig): SiteAccessManifest => {
  const notes: string[] = [];
  const narrowBroad = config.mode !== 'all-sites';
  const grants = narrowBroad ? grantedOrigins(config) : [];
  const manifest: ManifestRecord = { ...source };

  if (Array.isArray(source.host_permissions)) {
    manifest.host_permissions = rewriteMatches(stringsOf(source.host_permissions), narrowBroad, grants, notes);
  }

  if (source.manifest_version === 2 && Array.isArray(source.permissions)) {
    const entries = stringsOf(source.permissions);
    const api = entries.filter((entry) => !HOST_LIKE.test(entry));
    const hosts = entries.filter((entry) => HOST_LIKE.test(entry));
    manifest.permissions = [...api, ...rewriteMatches(hosts, narrowBroad, grants, notes)];
  }

  if (Array.isArray(source.content_scripts)) {
    const scripts: unknown[] = [];
    for (const script of source.content_scripts) {
      if (!isRecord(script)) {
        notes.push('Bỏ qua content_scripts không phải đối tượng.');
        continue;
      }
      const raw: unknown[] = Array.isArray(script.matches) ? script.matches : [];
      const invalid = raw.find((item) => typeof item !== 'string' || !isValidMatchPattern(item));
      if (raw.length === 0 || invalid !== undefined) {
        notes.push(`Bỏ qua content_scripts có khuôn mẫu không hợp lệ: ${clip(invalid)}`);
        continue;
      }
      const matches = rewriteMatches(stringsOf(raw), narrowBroad, grants, notes);
      if (matches.length === 0) continue; // only broad patterns, none of them allowed: the script stays off
      scripts.push({ ...script, matches });
    }
    manifest.content_scripts = scripts;
  }

  return { manifest, notes };
};

/**
 * The sites an extension declares for the purpose of the person's choice: its host permissions and its content script
 * matches. A manifest with only a broad content script is therefore not mistaken for one with no broad access.
 */
export const declaredSiteAccessOf = (
  summary: Readonly<{ hostPermissions: readonly string[]; contentScriptMatches: readonly string[] }>
): string[] => [...new Set([...summary.hostPermissions, ...summary.contentScriptMatches])];
