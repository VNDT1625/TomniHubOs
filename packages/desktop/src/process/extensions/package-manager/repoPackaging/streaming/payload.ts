/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The package payload as a list of entries that are read on demand. A file-backed entry is only a path
 * and a size, so the whole payload is never held in memory; a buffer-backed entry is a small generated
 * file such as `adapter/adapter.json`.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { RepoPackagingError } from '../types';

const READ_CHUNK_BYTES = 256 * 1024;

export type FilePayloadEntry = Readonly<{ relativePath: string; size: number; absolutePath: string }>;
export type BufferPayloadEntry = Readonly<{ relativePath: string; size: number; content: Buffer }>;
export type PayloadEntry = FilePayloadEntry | BufferPayloadEntry;

/** The installer's ordering. `localeCompare` differs for mixed-case names and would break integrity. */
export const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export const sortPayloadEntries = (entries: readonly PayloadEntry[]): PayloadEntry[] =>
  entries.toSorted((left, right) => compareCodeUnits(left.relativePath, right.relativePath));

export const bufferEntry = (relativePath: string, content: Buffer): BufferPayloadEntry => ({
  relativePath,
  size: content.byteLength,
  content,
});

const changedDuringPackaging = (relativePath: string): RepoPackagingError =>
  new RepoPackagingError('SOURCE_INVALID', `Tệp ${relativePath} đã thay đổi trong lúc đóng gói. Hãy chạy lại.`);

/**
 * Opens an entry for reading. A file that has turned into a link or vanished since it was screened is
 * refused, so the screening of symbolic links cannot be dodged between the screen and the write.
 */
export const openPayloadEntry = async (entry: PayloadEntry): Promise<Readable> => {
  if ('content' in entry) return Readable.from([entry.content]);
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(entry.absolutePath);
  } catch {
    throw changedDuringPackaging(entry.relativePath);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) throw changedDuringPackaging(entry.relativePath);
  return createReadStream(entry.absolutePath, { highWaterMark: READ_CHUNK_BYTES });
};

/** Reads one whole entry. Only for the few small files the pipeline must inspect; never for the payload. */
export const readPayloadEntry = (entry: PayloadEntry): Promise<Buffer> =>
  'content' in entry ? Promise.resolve(entry.content) : readFile(entry.absolutePath);

/**
 * Integrity exactly as the installer recomputes it: SHA-256 over `path NUL content NUL` for each file in
 * code-unit order. The content is hashed as a stream, one file at a time.
 */
export const computeStreamingIntegrity = async (
  entries: readonly PayloadEntry[],
  signal: AbortSignal | undefined
): Promise<{ integrity: string; sizeBytes: number }> => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const entry of sortPayloadEntries(entries)) {
    if (signal?.aborted) throw new RepoPackagingError('CANCELLED', 'Đã huỷ đóng gói.');
    hash.update(entry.relativePath);
    hash.update('\0');
    // oxlint-disable-next-line no-await-in-loop -- one file at a time keeps memory flat.
    const stream = await openPayloadEntry(entry);
    // oxlint-disable-next-line no-await-in-loop
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      hash.update(bytes);
      sizeBytes += bytes.byteLength;
    }
    hash.update('\0');
  }
  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};
