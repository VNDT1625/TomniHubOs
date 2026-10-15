/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads a ZIP archive from disk entry by entry. Only the central directory is kept in memory; every
 * entry is decompressed as a stream, so verifying a large package does not load it.
 */

import { open, type Entry, type ZipFile } from 'yauzl';
import type { Readable } from 'node:stream';

export type ZipEntryInfo = Readonly<{
  name: string;
  crc32: number;
  uncompressedSize: number;
  isDirectory: boolean;
  /** The reader's own handle, only meaningful to {@link OpenedZip.read}. */
  raw: Entry;
}>;

export type OpenedZip = Readonly<{
  entries: readonly ZipEntryInfo[];
  /** Starts decompressing one entry. Consume the stream to its end before opening the next. */
  read: (entry: ZipEntryInfo) => Promise<Readable>;
  close: () => void;
}>;

/**
 * Opens `archivePath` and lists its entries. Names with `..`, a leading slash, a drive letter or a
 * backslash are rejected by the reader itself, so a caller never sees an escaping path.
 */
export const openZip = (archivePath: string): Promise<OpenedZip> =>
  new Promise<OpenedZip>((resolve, reject) => {
    open(
      archivePath,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
      (openError, zipFile: ZipFile | undefined) => {
        if (openError || !zipFile) {
          reject(openError ?? new Error('Không mở được gói.'));
          return;
        }
        const entries: ZipEntryInfo[] = [];
        zipFile.on('error', (error: Error) => {
          zipFile.close();
          reject(error);
        });
        zipFile.on('entry', (entry: Entry) => {
          entries.push({
            name: entry.fileName,
            crc32: entry.crc32,
            uncompressedSize: entry.uncompressedSize,
            isDirectory: entry.fileName.endsWith('/'),
            raw: entry,
          });
          zipFile.readEntry();
        });
        zipFile.on('end', () =>
          resolve({
            entries,
            read: (info) =>
              new Promise<Readable>((resolveStream, rejectStream) => {
                zipFile.openReadStream(info.raw, (streamError, stream) => {
                  if (streamError || !stream) rejectStream(streamError ?? new Error('Không đọc được tệp trong gói.'));
                  else resolveStream(stream);
                });
              }),
            close: () => zipFile.close(),
          })
        );
        zipFile.readEntry();
      }
    );
  });
