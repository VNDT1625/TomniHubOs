/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The toolbar icon of an extension, as a `data:` URL (docs/platform/repotopackage-design.md section 12.5). Read by Main
 * from the extension's own working copy only:
 * - the path comes from the manifest (`action.default_icon`, else `icons`, the largest size of each);
 * - the path must be relative, without `..`, drive letters or backslashes, and its real location (after symlinks)
 *   must stay inside the extension folder;
 * - the file must be a raster image (png, jpeg, webp, gif), at most {@link EXTENSION_ICON_MAX_BYTES} bytes, and its
 *   first bytes must match that type. SVG is refused: it can carry script.
 * Any failure gives `undefined`, and the strip shows the first letter instead.
 */

import { realpath, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readManifestFile } from '@process/integrations/browserExtensions/workingCopy';

export const EXTENSION_ICON_MAX_BYTES = 64 * 1024;

type IconType = Readonly<{ mime: string; matches: (bytes: Buffer) => boolean }>;

const ICON_TYPES: Readonly<Record<string, IconType>> = {
  png: {
    mime: 'image/png',
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  jpg: { mime: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { mime: 'image/gif', matches: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  webp: {
    mime: 'image/webp',
    matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
};

/** A relative path inside the extension folder: plain segments only, no `..`, no absolute or drive-letter forms. */
export const isConfinedIconPath = (value: unknown): value is string => {
  if (typeof value !== 'string' || value === '' || value.length > 300) return false;
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
};

const largestBySize = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([size, file]) => /^\d{1,4}$/u.test(size) && typeof file === 'string')
    .toSorted(([left], [right]) => Number(right) - Number(left));
  const first = entries[0];
  return first === undefined ? undefined : (first[1] as string);
};

/** The icon path the manifest declares, toolbar icon first; undefined when it declares none. */
export const iconPathOf = (manifest: unknown): string | undefined => {
  if (typeof manifest !== 'object' || manifest === null) return undefined;
  const record = manifest as Record<string, unknown>;
  const action =
    typeof record.action === 'object' && record.action !== null ? (record.action as Record<string, unknown>) : {};
  return largestBySize(action.default_icon) ?? largestBySize(record.icons);
};

/**
 * Reads the icon of the extension folder as a `data:` URL, or undefined. Never throws: the file names and bytes come
 * from an extension, so every failure is a plain "no icon".
 */
export const readExtensionIconDataUrl = async (directory: string): Promise<string | undefined> => {
  try {
    const relative = iconPathOf(await readManifestFile(directory));
    if (!isConfinedIconPath(relative)) return undefined;
    const extension = path.posix.extname(relative).slice(1).toLowerCase();
    const type = ICON_TYPES[extension];
    if (type === undefined) return undefined;
    const root = await realpath(directory);
    const target = await realpath(path.join(root, ...relative.split('/')));
    const inside = path.relative(root, target);
    if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return undefined;
    const info = await stat(target);
    if (!info.isFile() || info.size > EXTENSION_ICON_MAX_BYTES) return undefined;
    const bytes = await readFile(target);
    if (!type.matches(bytes)) return undefined;
    return `data:${type.mime};base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
};
