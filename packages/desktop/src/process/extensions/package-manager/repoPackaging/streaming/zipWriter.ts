/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Writes a ZIP archive one entry at a time, so memory stays flat however many files the package holds.
 *
 * The layout matches what JSZip produces for the same input (same header fields, no data descriptors):
 * each local header is written first with zero sizes, the entry is deflated straight into the output
 * file, and the header is then patched with the CRC and sizes. The classic format caps an archive at
 * 65 535 entries and 4 GiB; exceeding either is reported as an error instead of silently wrapping.
 */

import { open, type FileHandle } from 'node:fs/promises';
import { type Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeflateRaw } from 'node:zlib';
import { RepoPackagingError } from '../types';
import { crc32Update } from './crc32';

const LOCAL_HEADER_SIGNATURE = 0x04_03_4b_50;
const CENTRAL_HEADER_SIGNATURE = 0x02_01_4b_50;
const END_SIGNATURE = 0x06_05_4b_50;
const UNICODE_PATH_FIELD = 0x70_75;
const UTF8_FLAG = 0x08_00;
const VERSION_NEEDED = 10;
const VERSION_MADE_BY = 0x00_14;
const DEFLATE = 8;
const MAX_ENTRIES = 0xff_ff;
const MAX_FOUR_BYTES = 0xff_ff_ff_ff;
const LOCAL_HEADER_FIXED_BYTES = 30;
const CRC_FIELD_OFFSET = 14;
const CENTRAL_FLUSH_BYTES = 1024 * 1024;

/** One entry to store: its archive path and a way to open its bytes. */
export type ZipInput = Readonly<{
  name: string;
  /** Opens the entry content. It is called once, when the entry is written. */
  open: () => Promise<Readable> | Readable;
}>;

export type ZipWriteOptions = Readonly<{
  /** Modification time stamped on every entry (UTC), which keeps the archive reproducible. */
  date: Date;
  /** Deflate level. */
  level: number;
  signal?: AbortSignal;
}>;

type DosStamp = Readonly<{ time: number; date: number }>;

const dosStamp = (date: Date): DosStamp => ({
  time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
  date: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
});

const cancelled = (): RepoPackagingError => new RepoPackagingError('CANCELLED', 'Đã huỷ đóng gói.');

const tooLarge = (what: string): RepoPackagingError =>
  new RepoPackagingError(
    'PAYLOAD_TOO_LARGE',
    `${what} vượt giới hạn của định dạng ZIP (65 535 tệp hoặc 4 GB). Dùng --path <thư-mục> để chia nhỏ gói.`
  );

type EntryRecord = Readonly<{
  nameBytes: Buffer;
  extra: Buffer;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
}>;

/** Info-ZIP Unicode Path field; JSZip adds it for non-ASCII names, and so do we, to stay interchangeable. */
const unicodePathExtra = (nameBytes: Buffer): Buffer => {
  const payload = Buffer.alloc(5 + nameBytes.length);
  payload.writeUInt8(1, 0);
  payload.writeUInt32LE(crc32Update(0, nameBytes), 1);
  nameBytes.copy(payload, 5);
  const field = Buffer.alloc(4 + payload.length);
  field.writeUInt16LE(UNICODE_PATH_FIELD, 0);
  field.writeUInt16LE(payload.length, 2);
  payload.copy(field, 4);
  return field;
};

const localHeader = (
  record: Pick<EntryRecord, 'nameBytes' | 'extra' | 'flags' | 'crc32' | 'compressedSize' | 'uncompressedSize'>,
  stamp: DosStamp
): Buffer => {
  const header = Buffer.alloc(LOCAL_HEADER_FIXED_BYTES + record.nameBytes.length + record.extra.length);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(record.flags, 6);
  header.writeUInt16LE(DEFLATE, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(record.crc32, CRC_FIELD_OFFSET);
  header.writeUInt32LE(record.compressedSize, 18);
  header.writeUInt32LE(record.uncompressedSize, 22);
  header.writeUInt16LE(record.nameBytes.length, 26);
  header.writeUInt16LE(record.extra.length, 28);
  record.nameBytes.copy(header, LOCAL_HEADER_FIXED_BYTES);
  record.extra.copy(header, LOCAL_HEADER_FIXED_BYTES + record.nameBytes.length);
  return header;
};

const centralRecord = (record: EntryRecord, stamp: DosStamp): Buffer => {
  const local = localHeader(record, stamp);
  const fixed = 46;
  const buffer = Buffer.alloc(fixed + record.nameBytes.length + record.extra.length);
  buffer.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  buffer.writeUInt16LE(VERSION_MADE_BY, 4);
  // Version needed .. extra length are laid out exactly as in the local header.
  local.copy(buffer, 6, 4, LOCAL_HEADER_FIXED_BYTES);
  // Comment length, disk number, internal and external attributes stay zero.
  buffer.writeUInt32LE(record.offset, 42);
  record.nameBytes.copy(buffer, fixed);
  record.extra.copy(buffer, fixed + record.nameBytes.length);
  return buffer;
};

const writeAt = async (handle: FileHandle, data: Buffer, position: number): Promise<void> => {
  let written = 0;
  while (written < data.length) {
    // A positional write may be partial; it must finish before the next one so the order is preserved.
    // oxlint-disable-next-line no-await-in-loop
    const { bytesWritten } = await handle.write(data, written, data.length - written, position + written);
    written += bytesWritten;
  }
};

/**
 * Writes `inputs` in the given order to `targetPath` and returns the archive size. The caller owns the
 * file afterwards, including removing it when this rejects.
 */
export const writeZipArchive = async (
  targetPath: string,
  inputs: readonly ZipInput[],
  options: ZipWriteOptions
): Promise<{ bytes: number }> => {
  if (inputs.length > MAX_ENTRIES) throw tooLarge(`Gói có ${inputs.length} tệp,`);
  const stamp = dosStamp(options.date);
  const handle = await open(targetPath, 'w');
  try {
    let position = 0;
    const centralChunks: Buffer[] = [];
    for (const input of inputs) {
      if (options.signal?.aborted) throw cancelled();
      const nameBytes = Buffer.from(input.name, 'utf8');
      const nonAscii = nameBytes.length !== input.name.length;
      const base = {
        nameBytes,
        extra: nonAscii ? unicodePathExtra(nameBytes) : Buffer.alloc(0),
        flags: nonAscii ? UTF8_FLAG : 0,
      };
      const offset = position;
      const placeholder = localHeader({ ...base, crc32: 0, compressedSize: 0, uncompressedSize: 0 }, stamp);
      // oxlint-disable-next-line no-await-in-loop -- entries are written one after another by design.
      await writeAt(handle, placeholder, position);
      position += placeholder.length;

      let crc32 = 0;
      let uncompressedSize = 0;
      let compressedSize = 0;
      // oxlint-disable-next-line no-await-in-loop
      const source = await input.open();
      const sink = new Writable({
        write(chunk: Buffer, _encoding, callback): void {
          writeAt(handle, chunk, position).then(
            () => {
              position += chunk.length;
              compressedSize += chunk.length;
              callback();
            },
            (error: Error) => callback(error)
          );
        },
      });
      try {
        // oxlint-disable-next-line no-await-in-loop
        await pipeline(
          source,
          async function* measure(chunks: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
            for await (const chunk of chunks) {
              crc32 = crc32Update(crc32, chunk);
              uncompressedSize += chunk.length;
              yield chunk;
            }
          },
          createDeflateRaw({ level: options.level }),
          sink,
          options.signal === undefined ? {} : { signal: options.signal }
        );
      } catch (error) {
        if (options.signal?.aborted) throw cancelled();
        throw error;
      }
      if (uncompressedSize > MAX_FOUR_BYTES || position > MAX_FOUR_BYTES) throw tooLarge('Gói');

      const record: EntryRecord = { ...base, crc32, compressedSize, uncompressedSize, offset };
      const patch = Buffer.alloc(12);
      patch.writeUInt32LE(crc32, 0);
      patch.writeUInt32LE(compressedSize, 4);
      patch.writeUInt32LE(uncompressedSize, 8);
      // oxlint-disable-next-line no-await-in-loop
      await writeAt(handle, patch, offset + CRC_FIELD_OFFSET);
      centralChunks.push(centralRecord(record, stamp));
    }

    const centralOffset = position;
    let centralSize = 0;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const block = Buffer.concat(pending);
      await writeAt(handle, block, position);
      position += block.length;
      centralSize += block.length;
      pending = [];
      pendingBytes = 0;
    };
    for (const chunk of centralChunks) {
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= CENTRAL_FLUSH_BYTES) {
        // oxlint-disable-next-line no-await-in-loop
        await flush();
      }
    }
    await flush();
    if (position > MAX_FOUR_BYTES) throw tooLarge('Gói');

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_SIGNATURE, 0);
    end.writeUInt16LE(inputs.length, 8);
    end.writeUInt16LE(inputs.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    await writeAt(handle, end, position);
    position += end.length;
    await handle.sync();
    return { bytes: position };
  } finally {
    await handle.close();
  }
};
