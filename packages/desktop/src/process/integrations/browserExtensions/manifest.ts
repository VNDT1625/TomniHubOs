/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads what a browser extension's `manifest.json` asks for (docs/platform/repotopackage-design.md sections 12.2
 * and 12.8). Pure: no file system, no Electron. The manifest is untrusted input, so every field is checked and
 * bounded before it is used or shown to the person who approves the extension.
 */

/** Reason shown when an extension needs Manifest V3 (spike S-3: Electron 37 never runs MV2 background scripts). */
export const MV3_REQUIRED_REASON =
  'Tiện ích này cần bản Manifest V3: bản Manifest V2 có tập lệnh nền (background) không chạy được trên Tomny.';

export type ManifestSummary = Readonly<{
  manifestVersion: 2 | 3;
  name: string;
  version: string;
  hasBackground: boolean;
  permissions: readonly string[];
  hostPermissions: readonly string[];
  optionalPermissions: readonly string[];
  optionalHostPermissions: readonly string[];
  contentScriptMatches: readonly string[];
  /** The manifest's own `key` (SPKI, base64) when it has one. */
  key?: string;
}>;

export type ManifestVerdict =
  | Readonly<{ ok: true; summary: ManifestSummary }>
  | Readonly<{ ok: false; reason: string }>;

const MAX_LIST = 200;
const MAX_ITEM = 500;
const HOST_PATTERN = /^(?:<all_urls>|(?:\*|https?|file|ftp|wss?):\/\/)/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item !== '' && item.length <= MAX_ITEM)
        .slice(0, MAX_LIST)
    : [];

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 200) : fallback;

/** Splits MV2 `permissions` (which mix API names and match patterns) into the two lists MV3 has. */
const splitLegacyPermissions = (entries: readonly string[]): { api: string[]; hosts: string[] } => ({
  api: entries.filter((entry) => !HOST_PATTERN.test(entry)),
  hosts: entries.filter((entry) => HOST_PATTERN.test(entry)),
});

/** Checks a parsed manifest and summarizes what it asks for. MV2 with a background is refused, nothing else is. */
export const inspectManifest = (raw: unknown): ManifestVerdict => {
  if (!isRecord(raw)) return { ok: false, reason: 'manifest.json không phải một đối tượng JSON hợp lệ.' };
  const version = raw.manifest_version;
  if (version !== 2 && version !== 3) {
    return { ok: false, reason: 'manifest.json thiếu manifest_version hợp lệ (cần 3, hoặc 2 không có tập lệnh nền).' };
  }
  const background = raw.background;
  const hasBackground =
    isRecord(background) &&
    (typeof background.service_worker === 'string' ||
      stringList(background.scripts).length > 0 ||
      typeof background.page === 'string');
  if (version === 2 && hasBackground) return { ok: false, reason: MV3_REQUIRED_REASON };

  const requested = stringList(raw.permissions);
  const optional = stringList(raw.optional_permissions);
  const legacy = version === 2 ? splitLegacyPermissions(requested) : undefined;
  const legacyOptional = version === 2 ? splitLegacyPermissions(optional) : undefined;
  const contentScripts = Array.isArray(raw.content_scripts) ? raw.content_scripts : [];
  const matches = contentScripts.flatMap((script) => (isRecord(script) ? stringList(script.matches) : []));
  const key = typeof raw.key === 'string' && raw.key.trim() !== '' ? raw.key.trim() : undefined;

  return {
    ok: true,
    summary: {
      manifestVersion: version,
      name: text(raw.name, 'Tiện ích không tên'),
      version: text(raw.version, '0'),
      hasBackground,
      permissions: legacy ? legacy.api : requested,
      hostPermissions: legacy ? legacy.hosts : stringList(raw.host_permissions),
      optionalPermissions: legacyOptional ? legacyOptional.api : optional,
      optionalHostPermissions: legacyOptional ? legacyOptional.hosts : stringList(raw.optional_host_permissions),
      contentScriptMatches: [...new Set(matches)].slice(0, MAX_LIST),
      ...(key === undefined ? {} : { key }),
    },
  };
};
