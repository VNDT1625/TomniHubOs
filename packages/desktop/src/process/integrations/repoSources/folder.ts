/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Install sources "folder" and ".zip" for a Chrome extension (docs/platform/repotopackage-design.md sections 12.2
 * and 12.6, task T4.7). Every source ends the same way: a staged, validated extension folder is handed to the
 * injected `build` (Main binds it to `buildTomnyPackageFromRepo`) and the resulting archive goes through the injected
 * `install` (Main binds it to `installLocalBuiltArtifact`), so the package is `local-built` and takes the same
 * install, approval and sync path as `/repotopackage`. Nothing is switched on here.
 *
 * Safety properties, none of which is relaxed to make a source pass:
 *
 * - The folder or archive is untrusted. A symlink or junction anywhere is refused; archive names go through the
 *   reader's own checks (`..`, absolute, backslash) and the packager's `isSafeEntryPath`; encrypted entries and
 *   symlink entries are refused; file count, per-file size, total size and depth are capped before anything is
 *   written, and the reader enforces that each entry decompresses to exactly its declared size.
 * - The extension must have a readable `manifest.json` that `inspectManifest` accepts (Manifest V3, or V2 without
 *   a background script, spike S-3).
 * - The built archive must report `verified` and must carry an `extension` connection; otherwise it is discarded
 *   and never installed.
 * - The build and install steps are injected, so every decision runs in unit tests with fakes.
 */

/* oxlint-disable no-await-in-loop -- files are scanned and written one at a time to bound open handles */

import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { adapterFromManifest } from '@/common/packages/adapter';
import { isSafeEntryPath } from '@process/extensions/package-manager/repoPackaging/fileScreen';
import { openZip } from '@process/extensions/package-manager/repoPackaging/streaming/zipReader';
import type {
  RepoPackagingProgress,
  RepoToPackageResult,
} from '@process/extensions/package-manager/repoPackaging/types';
import { inspectManifest, type ManifestSummary } from '@process/integrations/browserExtensions/manifest';
import type { LocalInstallOutcome } from '@process/integrations/connections/wiring/localInstall';

export type ExtensionSourceErrorCode =
  /** A `.crx` failed structure, signature, identity or size checks (design section 12.6). */
  | 'CRX_INVALID'
  /** The content is not a usable Chrome extension (no or bad `manifest.json`, unsupported manifest, bad archive). */
  | 'EXTENSION_INVALID'
  /** A path, symlink, encrypted entry or duplicate name that cannot be stored or extracted safely. */
  | 'ARCHIVE_UNSAFE'
  | 'SOURCE_NOT_FOUND'
  | 'TOO_LARGE'
  /** The package was built but holds no `extension` connection (for example no browser-extension detector ran). */
  | 'NOT_AN_EXTENSION'
  | 'UNVERIFIED_ARCHIVE'
  | 'CANCELLED';

/** Stable failure of the extension install sources; callers branch on `code` and never parse the message. */
export class ExtensionSourceError extends Error {
  readonly code: ExtensionSourceErrorCode;
  constructor(code: ExtensionSourceErrorCode, message: string) {
    super(message);
    this.name = 'ExtensionSourceError';
    this.code = code;
  }
}

export type ExtensionLimits = Readonly<{
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  maxManifestBytes: number;
  /** Size of the `.zip` or `.crx` file itself. */
  maxArchiveBytes: number;
}>;

/** Same ceilings as the extension working copy (`browserExtensions/workingCopy.ts`), with a per-file cap. */
export const DEFAULT_EXTENSION_LIMITS: ExtensionLimits = {
  maxFiles: 5_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxDepth: 16,
  maxManifestBytes: 1024 * 1024,
  maxArchiveBytes: 100 * 1024 * 1024,
};

export const EXTENSION_MANIFEST_FILE = 'manifest.json';
/** Folders the packager drops anyway; they are not scanned or counted. */
const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set(['.git', 'node_modules', '__MACOSX']);
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

export type ExtensionFolderInfo = Readonly<{
  manifest: ManifestSummary;
  fileCount: number;
  totalBytes: number;
}>;

const throwIfCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw new ExtensionSourceError('CANCELLED', 'Đã huỷ cài tiện ích.');
};

/** Parses a manifest text: a leading byte order mark is allowed, anything that is not a JSON object is refused. */
export const parseManifestText = (text: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new ExtensionSourceError('EXTENSION_INVALID', 'manifest.json không phải JSON hợp lệ.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ExtensionSourceError('EXTENSION_INVALID', 'manifest.json không phải một đối tượng JSON.');
  }
  return parsed as Record<string, unknown>;
};

/** Reads and checks `<root>/manifest.json`: a regular file within the size cap that the manifest rules accept. */
export const readExtensionManifest = async (
  root: string,
  limits: ExtensionLimits = DEFAULT_EXTENSION_LIMITS
): Promise<ManifestSummary> => {
  const file = path.join(root, EXTENSION_MANIFEST_FILE);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(file);
  } catch {
    throw new ExtensionSourceError('EXTENSION_INVALID', 'Không tìm thấy manifest.json ở thư mục gốc của tiện ích.');
  }
  if (!info.isFile()) throw new ExtensionSourceError('ARCHIVE_UNSAFE', 'manifest.json phải là một tệp thường.');
  if (info.size > limits.maxManifestBytes) {
    throw new ExtensionSourceError('TOO_LARGE', 'manifest.json quá lớn.');
  }
  const verdict = inspectManifest(parseManifestText(await readFile(file, 'utf8')));
  if (verdict.ok === false) throw new ExtensionSourceError('EXTENSION_INVALID', verdict.reason);
  return verdict.summary;
};

/**
 * Validates a Chrome-extension folder without modifying it: a real directory, no symlink or junction anywhere,
 * safe names, bounded count, size and depth, and a `manifest.json` the manifest rules accept.
 */
export const inspectExtensionFolder = async (
  folder: string,
  options: Readonly<{ limits?: Partial<ExtensionLimits>; signal?: AbortSignal }> = {}
): Promise<ExtensionFolderInfo> => {
  const limits: ExtensionLimits = { ...DEFAULT_EXTENSION_LIMITS, ...options.limits };
  if (!path.isAbsolute(folder)) {
    throw new ExtensionSourceError('SOURCE_NOT_FOUND', 'Đường dẫn thư mục tiện ích phải là đường dẫn tuyệt đối.');
  }
  const root = path.resolve(folder);
  let rootInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    rootInfo = await lstat(root);
  } catch {
    throw new ExtensionSourceError('SOURCE_NOT_FOUND', 'Không tìm thấy thư mục tiện ích.');
  }
  if (rootInfo.isSymbolicLink()) {
    throw new ExtensionSourceError(
      'ARCHIVE_UNSAFE',
      'Thư mục tiện ích không được là liên kết (symlink hoặc junction).'
    );
  }
  if (!rootInfo.isDirectory()) throw new ExtensionSourceError('SOURCE_NOT_FOUND', 'Nguồn đã chọn không phải thư mục.');

  let fileCount = 0;
  let totalBytes = 0;
  const pending: Array<Readonly<{ absolute: string; relative: string; depth: number }>> = [
    { absolute: root, relative: '', depth: 0 },
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    throwIfCancelled(options.signal);
    const entries = await readdir(next.absolute, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const relative = next.relative === '' ? entry.name : `${next.relative}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Tiện ích chứa liên kết (symlink hoặc junction): ${relative}`);
      }
      if (!isSafeEntryPath(relative)) {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Tên tệp không an toàn trong tiện ích: ${relative}`);
      }
      const absolute = path.join(next.absolute, entry.name);
      if (entry.isDirectory()) {
        if (next.depth + 1 > limits.maxDepth) {
          throw new ExtensionSourceError('ARCHIVE_UNSAFE', 'Tiện ích có thư mục lồng quá sâu.');
        }
        pending.push({ absolute, relative, depth: next.depth + 1 });
        continue;
      }
      if (!entry.isFile()) {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Tiện ích chứa mục không phải tệp thường: ${relative}`);
      }
      const { size } = await lstat(absolute);
      fileCount += 1;
      totalBytes += size;
      if (fileCount > limits.maxFiles) {
        throw new ExtensionSourceError('TOO_LARGE', `Tiện ích có hơn ${limits.maxFiles} tệp.`);
      }
      if (size > limits.maxFileBytes) {
        throw new ExtensionSourceError('TOO_LARGE', `Tệp ${relative} vượt giới hạn kích thước mỗi tệp.`);
      }
      if (totalBytes > limits.maxTotalBytes) {
        throw new ExtensionSourceError('TOO_LARGE', 'Tiện ích vượt giới hạn tổng dung lượng.');
      }
    }
  }
  return { manifest: await readExtensionManifest(root, limits), fileCount, totalBytes };
};

const isZipOpenPathError = (error: unknown): boolean =>
  error instanceof Error && /relative path|absolute path|invalid characters/iu.test(error.message);

/**
 * Where the extension lives inside the archive: the root, or the single top-level folder that holds the manifest
 * (the shape of a GitHub download). Returns the prefix to strip, `''` for the root.
 */
const locateManifestPrefix = (names: readonly string[]): string => {
  if (names.includes(EXTENSION_MANIFEST_FILE)) return '';
  const tops = new Set(names.map((name) => name.split('/')[0] ?? ''));
  const only = tops.size === 1 ? [...tops][0] : undefined;
  if (only !== undefined && only !== '' && names.includes(`${only}/${EXTENSION_MANIFEST_FILE}`)) return `${only}/`;
  throw new ExtensionSourceError('EXTENSION_INVALID', 'Không tìm thấy manifest.json trong tệp nén.');
};

/**
 * Extracts a `.zip` into `destination` (created if needed) after checking the whole central directory: names,
 * symlink and encrypted entries, duplicate names (case-insensitive), counts and sizes. Only regular files are
 * written, each created exclusively below the destination. Returns the number of files and bytes written.
 */
export const extractZipSafely = async (
  zipPath: string,
  destination: string,
  options: Readonly<{ limits?: Partial<ExtensionLimits>; signal?: AbortSignal }> = {}
): Promise<Readonly<{ fileCount: number; totalBytes: number }>> => {
  const limits: ExtensionLimits = { ...DEFAULT_EXTENSION_LIMITS, ...options.limits };
  try {
    if ((await stat(zipPath)).size > limits.maxArchiveBytes) {
      throw new ExtensionSourceError('TOO_LARGE', 'Tệp nén vượt giới hạn kích thước.');
    }
  } catch (error) {
    if (error instanceof ExtensionSourceError) throw error;
    throw new ExtensionSourceError('SOURCE_NOT_FOUND', 'Không đọc được tệp nén.');
  }
  let zip: Awaited<ReturnType<typeof openZip>>;
  try {
    zip = await openZip(zipPath);
  } catch (error) {
    throw isZipOpenPathError(error)
      ? new ExtensionSourceError('ARCHIVE_UNSAFE', 'Tệp nén chứa đường dẫn không an toàn.')
      : new ExtensionSourceError('EXTENSION_INVALID', 'Không mở được tệp nén (không phải zip hợp lệ).');
  }
  try {
    const candidates = zip.entries.filter(
      (entry) => !IGNORED_DIRECTORIES.has(entry.name.split('/')[0] ?? '') && !entry.name.endsWith('/.DS_Store')
    );
    const files = candidates.filter((entry) => !entry.isDirectory);
    if (files.length > limits.maxFiles) throw new ExtensionSourceError('TOO_LARGE', 'Tệp nén có quá nhiều tệp.');
    const prefix = locateManifestPrefix(files.map((entry) => entry.name));
    const root = path.resolve(destination);
    await mkdir(root, { recursive: true });
    const seen = new Set<string>();
    let totalBytes = 0;
    const plan = files.map((entry) => {
      const attributes = entry.raw.externalFileAttributes >>> 16;
      if ((attributes & S_IFMT) === S_IFLNK) {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Tệp nén chứa symlink: ${entry.name}`);
      }
      if (entry.raw.isEncrypted()) {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Tệp nén chứa mục bị mã hoá: ${entry.name}`);
      }
      if (!entry.name.startsWith(prefix)) {
        throw new ExtensionSourceError('EXTENSION_INVALID', 'Tệp nén có tệp nằm ngoài thư mục tiện ích.');
      }
      const relative = entry.name.slice(prefix.length);
      if (!isSafeEntryPath(relative)) {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Tên tệp không an toàn trong tệp nén: ${entry.name}`);
      }
      if (relative.split('/').length > limits.maxDepth) {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', 'Tệp nén có thư mục lồng quá sâu.');
      }
      const folded = relative.toLowerCase();
      if (seen.has(folded)) throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Tệp nén trùng tên: ${entry.name}`);
      seen.add(folded);
      if (entry.uncompressedSize > limits.maxFileBytes) {
        throw new ExtensionSourceError('TOO_LARGE', `Tệp ${entry.name} vượt giới hạn kích thước mỗi tệp.`);
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > limits.maxTotalBytes) {
        throw new ExtensionSourceError('TOO_LARGE', 'Tệp nén vượt giới hạn tổng dung lượng khi giải nén.');
      }
      const target = path.resolve(root, ...relative.split('/'));
      const inside = path.relative(root, target);
      if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Đường dẫn rời khỏi thư mục tiện ích: ${entry.name}`);
      }
      return { entry, target };
    });
    for (const { entry, target } of plan) {
      throwIfCancelled(options.signal);
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await pipeline(await zip.read(entry), createWriteStream(target, { flags: 'wx' }));
      } catch {
        throw new ExtensionSourceError('ARCHIVE_UNSAFE', `Không giải nén an toàn được: ${entry.name}`);
      }
    }
    return { fileCount: plan.length, totalBytes };
  } finally {
    zip.close();
  }
};

/** What the injected build is asked to do: package the staged extension folder (a path Main created). */
export type ExtensionBuildRequest = Readonly<{
  source: string;
  /** The staged folder is outside any workspace by design; the caller is Main, not the renderer. */
  allowLocalOutsideWorkspace: true;
  signal?: AbortSignal;
  onProgress?: (event: RepoPackagingProgress) => void;
}>;

export type ExtensionInstallDeps = Readonly<{
  build: (request: ExtensionBuildRequest) => Promise<RepoToPackageResult>;
  /** Registers the archive as `local-built`, installs it and syncs the connections (`installLocalBuiltArtifact`). */
  install: (artifactPath: string) => Promise<LocalInstallOutcome>;
  /** Removes the archive after install or refusal. */
  discardArtifact?: (artifactPath: string) => Promise<void>;
  /** Parent of the staging directory; defaults to the operating system's temp directory. */
  temporaryRoot?: string;
  limits?: Partial<ExtensionLimits>;
}>;

export type ExtensionInstallOptions = Readonly<{
  signal?: AbortSignal;
  onProgress?: (event: RepoPackagingProgress) => void;
}>;

export type ExtensionInstallResult = Readonly<{
  from: 'folder' | 'zip' | 'crx';
  /** Chrome extension id, known only when a verified `.crx` proved the key. */
  extensionId?: string;
  extensionName: string;
  extensionVersion: string;
  install: LocalInstallOutcome;
}>;

/** Makes a private staging directory; the caller removes it. */
export const createStagingDirectory = (deps: Pick<ExtensionInstallDeps, 'temporaryRoot'>): Promise<string> =>
  mkdtemp(path.join(deps.temporaryRoot ?? tmpdir(), 'tomny-ext-'));

export const removeQuietly = (target: string): Promise<void> =>
  rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch((): undefined => undefined);

/**
 * Builds the staged folder into a `local-built` archive and installs it. The archive must be `verified` and hold an
 * `extension` connection; `expectedPublicKey` (a verified `.crx`) must agree with any key the connection records.
 */
export const buildAndInstallExtension = async (
  deps: ExtensionInstallDeps,
  folder: string,
  options: ExtensionInstallOptions,
  expectedPublicKey?: string
): Promise<LocalInstallOutcome> => {
  throwIfCancelled(options.signal);
  const result = await deps.build({
    source: folder,
    allowLocalOutsideWorkspace: true,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  });
  try {
    if (result.verified !== true) {
      throw new ExtensionSourceError('UNVERIFIED_ARCHIVE', 'Gói tiện ích chưa qua bước kiểm tra chữ ký và toàn vẹn.');
    }
    const connections = (result.adapter ?? adapterFromManifest(result.manifest)).connections;
    let extensionCount = 0;
    for (const connection of connections) {
      if (connection.kind !== 'extension') continue;
      extensionCount += 1;
      if (expectedPublicKey !== undefined && connection.publicKey !== undefined) {
        if (connection.publicKey !== expectedPublicKey) {
          throw new ExtensionSourceError(
            'CRX_INVALID',
            'Khoá công khai của gói không khớp khoá đã xác minh trong tệp .crx.'
          );
        }
      }
    }
    if (extensionCount === 0) {
      throw new ExtensionSourceError('NOT_AN_EXTENSION', 'Gói đã dựng không có kết nối tiện ích trình duyệt.');
    }
    throwIfCancelled(options.signal);
    return await deps.install(result.artifactPath);
  } finally {
    try {
      await deps.discardArtifact?.(result.artifactPath);
    } catch {
      // A leftover archive in Main's output directory is harmless and is never installed.
    }
  }
};

/** Installs an unpacked Chrome-extension folder chosen through Main's folder dialog. The folder is not modified. */
export const installExtensionFromFolder = async (
  deps: ExtensionInstallDeps,
  folder: string,
  options: ExtensionInstallOptions = {}
): Promise<ExtensionInstallResult> => {
  const info = await inspectExtensionFolder(folder, { limits: deps.limits, signal: options.signal });
  const install = await buildAndInstallExtension(deps, path.resolve(folder), options);
  return { from: 'folder', extensionName: info.manifest.name, extensionVersion: info.manifest.version, install };
};

/** Installs an extension from a `.zip` file: safe extraction into a private staging folder, then as a folder. */
export const installExtensionFromZip = async (
  deps: ExtensionInstallDeps,
  zipPath: string,
  options: ExtensionInstallOptions = {}
): Promise<ExtensionInstallResult> => {
  const staging = await createStagingDirectory(deps);
  try {
    const folder = path.join(staging, 'extension');
    await extractZipSafely(zipPath, folder, { limits: deps.limits, signal: options.signal });
    const info = await inspectExtensionFolder(folder, { limits: deps.limits, signal: options.signal });
    const install = await buildAndInstallExtension(deps, folder, options);
    return { from: 'zip', extensionName: info.manifest.name, extensionVersion: info.manifest.version, install };
  } finally {
    await removeQuietly(staging);
  }
};
