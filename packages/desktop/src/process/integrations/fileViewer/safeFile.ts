/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* oxlint-disable no-await-in-loop -- bytes are read sequentially into one bounded buffer. */

import type { Stats } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { HubFileErrorCode } from '@/common/integrations/library/libraryContracts';

/** Failure of a file-viewer operation, carrying only a stable code (never a path). */
export class HubFileError extends Error {
  constructor(readonly code: HubFileErrorCode) {
    super(code);
    this.name = 'HubFileError';
  }
}

const MAX_PATH_LENGTH = 2048;

const hasControlCharacter = (value: string): boolean => [...value].some((character) => character.charCodeAt(0) < 32);

/** Absolute, local, plain path: no UNC (network access), no `..` segment, no alternate data stream. */
export function assertAbsoluteLocalPath(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    hasControlCharacter(value) ||
    !path.isAbsolute(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('//') ||
    value.split(/[\\/]/).includes('..') ||
    // A colon is only legal in the drive prefix; any other one names an NTFS alternate data stream.
    value.slice(path.parse(value).root.length).includes(':')
  ) {
    throw new HubFileError('DENIED');
  }
}

const sameLocation = (left: string, right: string): boolean =>
  process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

const hasCode = (error: unknown, ...codes: string[]): boolean =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' && codes.includes(error.code);

/** Maps a filesystem failure to a stable code. */
export const toFileError = (error: unknown): HubFileError => {
  if (error instanceof HubFileError) return error;
  if (hasCode(error, 'ENOENT', 'ENOTDIR')) return new HubFileError('NOT_FOUND');
  if (hasCode(error, 'EACCES', 'EPERM', 'ELOOP')) return new HubFileError('DENIED');
  return new HubFileError('IO_ERROR');
};

export type OpenedFile = Readonly<{ handle: FileHandle; info: Stats; path: string; name: string }>;

/**
 * Opens one regular file for reading, or refuses.
 *
 * The file must be a regular file (not a link, directory or device) and its path must already be canonical, so no
 * ancestor can be a link either: a link planted after the file was approved changes `realpath` and is refused. The
 * identity of the opened handle must match the identity that was checked, which closes the swap between check and
 * open. The caller closes the handle.
 */
export const openRegularFile = async (candidate: unknown): Promise<OpenedFile> => {
  try {
    assertAbsoluteLocalPath(candidate);
    const target = path.normalize(candidate);
    const before = await lstat(target);
    if (before.isSymbolicLink() || !before.isFile()) throw new HubFileError('DENIED');
    if (!sameLocation(await realpath(target), target)) throw new HubFileError('DENIED');
    const handle = await open(target, 'r');
    try {
      const after = await handle.stat();
      if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) throw new HubFileError('DENIED');
      return { handle, info: after, path: target, name: path.basename(target) };
    } catch (error) {
      await handle.close().catch((): undefined => undefined);
      throw error;
    }
  } catch (error) {
    throw toFileError(error);
  }
};

/** Reads at most `limit` bytes from the start of an opened file. */
export const readPrefix = async (handle: FileHandle, limit: number): Promise<Buffer> => {
  const buffer = Buffer.allocUnsafe(limit);
  let filled = 0;
  while (filled < limit) {
    const { bytesRead } = await handle.read(buffer, filled, limit - filled, filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
};

/**
 * Resolves a path the person picked in a native dialog to the canonical path the Library stores. Links and junctions
 * are resolved once, here, with the person's consent; from then on the canonical path must stay link-free.
 */
export const canonicalizePickedFile = async (picked: unknown): Promise<string> => {
  try {
    assertAbsoluteLocalPath(picked);
    const canonical = await realpath(picked);
    const file = await openRegularFile(canonical);
    await file.handle.close();
    return file.path;
  } catch (error) {
    throw toFileError(error);
  }
};
