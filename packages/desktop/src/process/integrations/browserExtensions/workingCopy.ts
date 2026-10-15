/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Working copy of an extension (docs/platform/repotopackage-design.md sections 12.2 and 12.8).
 *
 * Electron derives the id of an unpacked extension from the manifest `key`, or from the folder path when there is
 * none. A package folder changes with every version, and Web Store manifests carry no `key`, so loading the package
 * folder directly would give a new id (and lose `storage` and granted permissions) on every update. The host loads
 * a copy instead, at `<base>/<packageId>/<connectionId>`, whose only difference from the source is the `key`.
 *
 * - The source is never modified. It is scanned first: regular files only (a symlink or junction anywhere in the
 *   tree is refused), bounded in file count, size and depth.
 * - Key precedence: the connection's `publicKey` (keeps the Web Store id), then the manifest's own `key`, then a
 *   key generated once per package and connection and remembered by the store.
 * - The copy is built in a staging folder next to its destination and swapped in with a rename, so a failure never
 *   leaves a half-written copy at the destination.
 *
 * Main-process module without Electron imports.
 */

/* oxlint-disable no-await-in-loop -- files are copied and scanned one at a time to bound open handles */

import { createHash, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectManifest, type ManifestSummary } from '@process/integrations/browserExtensions/manifest';

export const MANIFEST_FILE = 'manifest.json';
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_EXTENSION_FILES = 5_000;
export const MAX_EXTENSION_BYTES = 100 * 1024 * 1024;
export const MAX_EXTENSION_DEPTH = 16;
/** Files whose content can run in the browser; the approval hash covers every one of them. */
export const MAX_CODE_FILES = 2_000;
export const MAX_CODE_BYTES = 64 * 1024 * 1024;

const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.html',
  '.htm',
  '.xhtml',
  '.svg',
  '.xml',
  '.css',
  '.json',
  '.wasm',
]);
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export class WorkingCopyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkingCopyError';
  }
}

export type SourceFile = Readonly<{ relativePath: string; size: number }>;

export type SourceScan = Readonly<{
  /** Every regular file below the source folder, `/`-separated, sorted. */
  files: readonly SourceFile[];
  /** The subset that can run (scripts, pages, styles, wasm, manifest): what the approval hash must cover. */
  codeFiles: readonly string[];
  totalBytes: number;
}>;

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * Walks `sourceRoot` and refuses anything but plain files and folders. Throws a `WorkingCopyError` with a reason
 * fit for the person to read.
 */
export const scanExtensionSource = async (sourceRoot: string): Promise<SourceScan> => {
  const rootInfo = await lstat(sourceRoot).catch((): undefined => undefined);
  if (!rootInfo || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new WorkingCopyError('Không tìm thấy thư mục tiện ích trong gói.');
  }
  const files: SourceFile[] = [];
  let totalBytes = 0;

  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_EXTENSION_DEPTH) throw new WorkingCopyError('Thư mục tiện ích lồng quá sâu.');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.toSorted((left, right) => (left.name < right.name ? -1 : 1))) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      // Dirent can report a junction as a directory on Windows; lstat is authoritative.
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new WorkingCopyError(`Tiện ích chứa liên kết tượng trưng: ${relativePath}`);
      if (info.isDirectory()) {
        await walk(absolute, relativePath, depth + 1);
      } else if (info.isFile()) {
        files.push({ relativePath, size: info.size });
        totalBytes += info.size;
        if (files.length > MAX_EXTENSION_FILES) throw new WorkingCopyError('Tiện ích có quá nhiều tệp.');
        if (totalBytes > MAX_EXTENSION_BYTES) throw new WorkingCopyError('Tiện ích quá lớn.');
      } else {
        throw new WorkingCopyError(`Tiện ích chứa tệp đặc biệt không được phép: ${relativePath}`);
      }
    }
  };
  await walk(sourceRoot, '', 0);

  const code = files.filter((file) => CODE_EXTENSIONS.has(path.posix.extname(file.relativePath).toLowerCase()));
  if (code.length > MAX_CODE_FILES || code.reduce((sum, file) => sum + file.size, 0) > MAX_CODE_BYTES) {
    throw new WorkingCopyError('Tiện ích có quá nhiều mã để duyệt.');
  }
  if (!files.some((file) => file.relativePath === MANIFEST_FILE)) {
    throw new WorkingCopyError('Thiếu manifest.json ở thư mục gốc của tiện ích.');
  }
  return { files, codeFiles: code.map((file) => file.relativePath), totalBytes };
};

/** Reads and parses `<directory>/manifest.json` (regular file, bounded, BOM tolerated). */
export const readManifestFile = async (directory: string): Promise<unknown> => {
  const file = path.join(directory, MANIFEST_FILE);
  const info = await lstat(file).catch((): undefined => undefined);
  if (!info || !info.isFile() || info.isSymbolicLink()) throw new WorkingCopyError('Thiếu manifest.json.');
  if (info.size > MAX_MANIFEST_BYTES) throw new WorkingCopyError('manifest.json quá lớn.');
  try {
    return JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')) as unknown;
  } catch (error) {
    throw new WorkingCopyError('manifest.json không phải JSON hợp lệ.', { cause: error });
  }
};

/** Resolves `<root>/<packageId>/<connectionId>` and refuses names that could leave `<root>`. */
export const workingDirectoryFor = (workingRoot: string, packageId: string, connectionId: string): string => {
  if (!SAFE_SEGMENT.test(packageId) || !SAFE_SEGMENT.test(connectionId)) {
    throw new WorkingCopyError('Tên gói hoặc kết nối không hợp lệ.');
  }
  const directory = path.resolve(workingRoot, packageId, connectionId);
  if (!isInside(path.resolve(workingRoot), directory))
    throw new WorkingCopyError('Đường dẫn bản làm việc không hợp lệ.');
  return directory;
};

/** Folder under the working root that keeps each connection's source manifest, one folder per package. */
export const SOURCE_DIRECTORY = '.source';

/**
 * The source manifest of a connection as the extension shipped it, kept at `<root>/.source/<pkg>/<conn>.json`. It is outside
 * the copy because the copy is what is loaded, and it is rewritten for every site access choice (see
 * `applySiteAccessToManifest`), so the copy never narrows its own source.
 */
export const sourceManifestPathFor = (workingRoot: string, packageId: string, connectionId: string): string => {
  workingDirectoryFor(workingRoot, packageId, connectionId); // refuses names that could leave the root
  return path.join(workingRoot, SOURCE_DIRECTORY, packageId, `${connectionId}.json`);
};

const writeJsonAtomic = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The manifest a site access choice is applied to. A copy made before the source was kept has no saved source, so the
 * copy's own manifest (without its key) becomes the source, and is saved once so that later choices start from it.
 */
export const readSourceManifest = async (
  workingRoot: string,
  packageId: string,
  connectionId: string,
  copyManifest: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const file = sourceManifestPathFor(workingRoot, packageId, connectionId);
  const saved = await readFile(file, 'utf8').catch((): undefined => undefined);
  if (saved !== undefined) {
    try {
      const parsed = JSON.parse(saved) as unknown;
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // A damaged saved source is rebuilt from the copy below.
    }
  }
  const { key: _key, ...source } = copyManifest;
  await writeJsonAtomic(file, source);
  return source;
};

/** Writes the manifest the copy loads. Only the host calls it, for a copy it has just verified. */
export const writeCopyManifest = async (directory: string, manifest: Record<string, unknown>): Promise<void> => {
  await writeFile(path.join(directory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

/** Validates a base64 SPKI key and returns the id Chromium (and Electron) derive from it: a-p, 32 letters. */
export const extensionIdFromKey = (key: string): string => {
  const trimmed = key.trim();
  if (!BASE64.test(trimmed)) throw new WorkingCopyError('Khóa công khai của tiện ích không hợp lệ.');
  const der = Buffer.from(trimmed, 'base64');
  try {
    createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (error) {
    throw new WorkingCopyError('Khóa công khai của tiện ích không hợp lệ.', { cause: error });
  }
  const digest = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...digest].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
};

/** A fresh RSA public key (SPKI, base64). The private half is discarded: only the id matters. */
export const generateExtensionKey = (): string =>
  generateKeyPairSync('rsa', { modulusLength: 2048 })
    .publicKey.export({ type: 'spki', format: 'der' })
    .toString('base64');

export type PrepareWorkingCopyInput = Readonly<{
  /** Absolute folder inside the extracted package that holds `manifest.json`. */
  sourceRoot: string;
  workingRoot: string;
  packageId: string;
  connectionId: string;
  /** From the connection (`publicKey`); wins over the manifest. */
  publicKey?: string;
  /** Called only when neither the connection nor the manifest has a key. Must return the same key every time. */
  generateKey: () => Promise<string>;
}>;

export type PreparedWorkingCopy = Readonly<{
  directory: string;
  extensionId: string;
  key: string;
  summary: ManifestSummary;
}>;

const copyTree = async (source: string, target: string, files: readonly SourceFile[], skip: string): Promise<void> => {
  const made = new Set<string>();
  for (const file of files) {
    if (file.relativePath === skip) continue;
    const destination = path.join(target, ...file.relativePath.split('/'));
    const folder = path.dirname(destination);
    if (!made.has(folder)) {
      await mkdir(folder, { recursive: true });
      made.add(folder);
    }
    // COPYFILE_EXCL: never write through something that appeared at the destination.
    await copyFile(path.join(source, ...file.relativePath.split('/')), destination, constants.COPYFILE_EXCL);
  }
};

/**
 * Builds the working copy of one extension. Idempotent: running it again replaces the copy with a fresh one that has
 * the same `key` and so the same id. Callers must unload the extension first (a loaded extension holds its files).
 */
export const prepareWorkingCopy = async (input: PrepareWorkingCopyInput): Promise<PreparedWorkingCopy> => {
  const destination = workingDirectoryFor(input.workingRoot, input.packageId, input.connectionId);
  const sourceReal = await realpath(input.sourceRoot).catch((): undefined => undefined);
  if (sourceReal === undefined) throw new WorkingCopyError('Không tìm thấy thư mục tiện ích trong gói.');
  const scan = await scanExtensionSource(sourceReal);
  const manifest = await readManifestFile(sourceReal);
  const verdict = inspectManifest(manifest);
  if (verdict.ok === false) throw new WorkingCopyError(verdict.reason);

  const key = input.publicKey ?? verdict.summary.key ?? (await input.generateKey());
  const extensionId = extensionIdFromKey(key);

  const staging = `${destination}.staging-${randomUUID()}`;
  try {
    await mkdir(staging, { recursive: true });
    await copyTree(sourceReal, staging, scan.files, MANIFEST_FILE);
    const withKey = { ...(manifest as Record<string, unknown>), key };
    await writeFile(path.join(staging, MANIFEST_FILE), `${JSON.stringify(withKey, null, 2)}\n`, 'utf8');
    // What will be loaded must be what was approved: re-read the copy's manifest before swapping it in.
    await verifyWorkingCopy(staging, extensionId);

    const retired = `${destination}.old-${randomUUID()}`;
    const hadPrevious = await rename(destination, retired).then(
      () => true,
      (error: unknown) => {
        if ((error as { code?: string }).code === 'ENOENT') return false;
        throw error;
      }
    );
    try {
      await rename(staging, destination);
    } catch (error) {
      if (hadPrevious) await rename(retired, destination).catch((): undefined => undefined);
      throw error;
    }
    if (hadPrevious) await rm(retired, { recursive: true, force: true }).catch((): undefined => undefined);
    await writeJsonAtomic(sourceManifestPathFor(input.workingRoot, input.packageId, input.connectionId), manifest);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch((): undefined => undefined);
    if (error instanceof WorkingCopyError) throw error;
    throw new WorkingCopyError(`Không tạo được bản làm việc của tiện ích: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return { directory: destination, extensionId, key, summary: verdict.summary };
};

/**
 * Checks a working copy right before it is loaded: Manifest V3 rules, and a `key` that gives the expected id. The
 * copy is under `userData`, but a damaged or edited one must not be loaded under a different id.
 */
export const verifyWorkingCopy = async (directory: string, expectedId: string): Promise<ManifestSummary> => {
  const verdict = inspectManifest(await readManifestFile(directory));
  if (verdict.ok === false) throw new WorkingCopyError(verdict.reason);
  if (verdict.summary.key === undefined || extensionIdFromKey(verdict.summary.key) !== expectedId) {
    throw new WorkingCopyError('Bản làm việc của tiện ích không còn khớp với mã đã lưu.');
  }
  return verdict.summary;
};

/** Removes a working copy folder. Missing is fine. */
export const removeWorkingCopy = async (
  workingRoot: string,
  packageId: string,
  connectionId: string
): Promise<void> => {
  await rm(workingDirectoryFor(workingRoot, packageId, connectionId), { recursive: true, force: true });
  const saved = sourceManifestPathFor(workingRoot, packageId, connectionId);
  await rm(saved, { force: true });
  await rmdir(path.dirname(saved)).catch((): undefined => undefined); // only if no other connection of the package is left
};
