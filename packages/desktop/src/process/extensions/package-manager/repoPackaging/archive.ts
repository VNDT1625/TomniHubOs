/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds, writes, and re-verifies the signed `.tomny` archive.
 *
 * The integrity hash must match what the installer recomputes from the extracted files, so the
 * ordering here is the installer's ordering (plain code-unit comparison), not a locale-aware one.
 *
 * The default writer streams: the integrity is hashed file by file, then each file is deflated straight
 * into a temporary archive on disk, and verification decompresses entries one at a time. The in-memory
 * writer (`writeArchive`, JSZip) is the legacy path behind `streamingPackager: false`.
 */

import { createHash, sign } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import { packageSignaturePayload, parsePackageManifest, type PackageManifest } from '../../../../common/packages';
import { PACKAGE_MANIFEST_FILE, verifyArtifactSignature } from '../artifactSecurity';
import { isSafeEntryPath, type PayloadFile } from './fileScreen';
import { crc32Update } from './streaming/crc32';
import { formatBytes } from './streaming/diskSpace';
import {
  bufferEntry,
  compareCodeUnits,
  computeStreamingIntegrity,
  openPayloadEntry,
  sortPayloadEntries,
  type PayloadEntry,
} from './streaming/payload';
import { openZip, type OpenedZip } from './streaming/zipReader';
import { writeZipArchive } from './streaming/zipWriter';
import type { SigningIdentity } from './signingKey';
import { RepoPackagingError } from './types';

const ZIP_DATE = new Date('2000-01-01T00:00:00Z');
const DEFLATE_LEVEL = 6;
const MAX_MANIFEST_BYTES = 256 * 1024;

export { compareCodeUnits };

/** Legacy in-memory integrity; the streaming path uses `computeStreamingIntegrity` and yields the same digest. */
export const computePayloadIntegrity = (
  payload: ReadonlyArray<Readonly<{ relativePath: string; content: Buffer }>>
): { integrity: string; sizeBytes: number } => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const file of payload.toSorted((left, right) => compareCodeUnits(left.relativePath, right.relativePath))) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
    sizeBytes += file.content.byteLength;
  }
  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};

/** Adds the artifact block (integrity, size, signature) to a manifest and validates the result. */
export const signManifestWithIntegrity = (
  manifest: PackageManifest,
  digest: Readonly<{ integrity: string; sizeBytes: number }>,
  identity: SigningIdentity
): PackageManifest => {
  const { integrity, sizeBytes } = digest;
  const unsigned: PackageManifest = {
    ...manifest,
    artifact: { integrity, sizeBytes, signature: { algorithm: 'ed25519', keyId: identity.keyId, value: '' } },
  };
  const value = sign(null, Buffer.from(packageSignaturePayload(unsigned)), identity.privateKeyPem).toString('base64');
  const signed: PackageManifest = {
    ...unsigned,
    artifact: { ...unsigned.artifact!, signature: { algorithm: 'ed25519', keyId: identity.keyId, value } },
  };
  try {
    return parsePackageManifest(signed);
  } catch (error) {
    // The manifest schema (and the installer) still cap the package at 200 MB even though the packager no
    // longer does; say so plainly instead of showing a schema dump.
    const issues = (error as { issues?: ReadonlyArray<{ path?: readonly unknown[] }> }).issues;
    if (issues?.some((issue) => issue.path?.join('.') === 'artifact.sizeBytes') === true) {
      throw new RepoPackagingError(
        'PAYLOAD_TOO_LARGE',
        `Nội dung gói (${formatBytes(sizeBytes)}) vượt giới hạn mà định dạng gói hiện cho phép. Dùng --path <thư-mục> để chỉ đóng gói phần cần thiết.`,
        { sizeBytes }
      );
    }
    throw new RepoPackagingError(
      'MANIFEST_INVALID',
      `Manifest tạo ra không hợp lệ: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/** Legacy form of {@link signManifestWithIntegrity} for a payload that is already in memory. */
export const signManifest = (
  manifest: PackageManifest,
  payload: readonly PayloadFile[],
  identity: SigningIdentity
): PackageManifest => signManifestWithIntegrity(manifest, computePayloadIntegrity(payload), identity);

export const artifactFileName = (manifest: PackageManifest): string => `${manifest.id}-${manifest.version}.tomny`;

/** Runs `produce` against a temporary file and renames it into place, so a crash never leaves a half-written package. */
const writeThroughTemporaryFile = async (
  manifest: PackageManifest,
  outputDirectory: string,
  produce: (temporaryPath: string) => Promise<number>
): Promise<{ artifactPath: string; bytes: number }> => {
  await mkdir(outputDirectory, { recursive: true });
  const artifactPath = path.join(outputDirectory, artifactFileName(manifest));
  const temporaryPath = `${artifactPath}.${process.pid}.tmp`;
  try {
    const bytes = await produce(temporaryPath);
    await rename(temporaryPath, artifactPath);
    return { artifactPath, bytes };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch((): undefined => undefined);
    throw error;
  }
};

const manifestText = (manifest: PackageManifest): string => `${JSON.stringify(manifest, null, 2)}\n`;

/**
 * Streams the archive to disk: the manifest first, then every payload file in code-unit order. Memory use
 * does not depend on the package size.
 */
export const writeArchiveStreaming = (
  manifest: PackageManifest,
  entries: readonly PayloadEntry[],
  outputDirectory: string,
  signal: AbortSignal | undefined
): Promise<{ artifactPath: string; bytes: number }> =>
  writeThroughTemporaryFile(manifest, outputDirectory, async (temporaryPath) => {
    const manifestEntry = bufferEntry(PACKAGE_MANIFEST_FILE, Buffer.from(manifestText(manifest), 'utf8'));
    const inputs = [manifestEntry, ...sortPayloadEntries(entries)].map((entry) => ({
      name: entry.relativePath,
      open: (): Promise<Readable> => openPayloadEntry(entry),
    }));
    const { bytes } = await writeZipArchive(temporaryPath, inputs, {
      date: ZIP_DATE,
      level: DEFLATE_LEVEL,
      ...(signal === undefined ? {} : { signal }),
    });
    return bytes;
  });

/** Legacy writer: builds the whole archive in memory with JSZip. */
export const writeArchive = async (
  manifest: PackageManifest,
  payload: readonly PayloadFile[],
  outputDirectory: string
): Promise<{ artifactPath: string; bytes: number }> => {
  const archive = new JSZip();
  archive.file(PACKAGE_MANIFEST_FILE, manifestText(manifest), { date: ZIP_DATE });
  for (const file of payload.toSorted((left, right) => compareCodeUnits(left.relativePath, right.relativePath))) {
    archive.file(file.relativePath, file.content, { date: ZIP_DATE });
  }
  const buffer = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: DEFLATE_LEVEL },
  });
  return writeThroughTemporaryFile(manifest, outputDirectory, async (temporaryPath) => {
    await writeFile(temporaryPath, buffer);
    return buffer.byteLength;
  });
};

const verifyFailed = (message: string): RepoPackagingError => new RepoPackagingError('VERIFY_FAILED', message);

type StreamSummary = Readonly<{ crc32: number; bytes: number }>;

/**
 * Feeds a stream to `onChunk` and returns its CRC-32 and length; stops early past `limit` bytes. It uses
 * stream events rather than `for await`: the zip reader replaces `destroy` on its streams, and an async
 * iterator then waits forever for a `close` event that never comes.
 */
const consume = (
  stream: Readable,
  onChunk: (chunk: Buffer) => void,
  limit = Number.POSITIVE_INFINITY
): Promise<StreamSummary> =>
  new Promise<StreamSummary>((resolve, reject) => {
    let crc32 = 0;
    let bytes = 0;
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > limit) {
        stream.removeAllListeners('data');
        stream.destroy();
        reject(verifyFailed('Một tệp trong gói lớn hơn kích thước đã khai báo.'));
        return;
      }
      crc32 = crc32Update(crc32, chunk);
      onChunk(chunk);
    });
    stream.once('end', () => resolve({ crc32, bytes }));
    stream.once('error', reject);
  });

const readManifest = async (zip: OpenedZip): Promise<PackageManifest> => {
  const entry = zip.entries.find((candidate) => candidate.name === PACKAGE_MANIFEST_FILE);
  if (entry === undefined) throw verifyFailed('Gói không có tệp manifest.');
  if (entry.uncompressedSize > MAX_MANIFEST_BYTES) throw verifyFailed('Manifest trong gói quá lớn.');
  const parts: Buffer[] = [];
  const summary = await consume(await zip.read(entry), (chunk) => parts.push(chunk), MAX_MANIFEST_BYTES);
  if (summary.crc32 !== entry.crc32) throw verifyFailed('Manifest trong gói bị hỏng.');
  try {
    return parsePackageManifest(JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown);
  } catch {
    throw verifyFailed('Manifest trong gói không hợp lệ.');
  }
};

/**
 * Re-reads the written archive and checks everything the installer will check: the manifest parses,
 * the signature verifies with the public key, every entry path is safe, and the integrity and size
 * recomputed from the stored files match the manifest. Entries are decompressed one at a time, so memory
 * stays flat for a large package. Throws on any mismatch.
 */
export const verifyWrittenArchive = async (
  artifactPath: string,
  expected: PackageManifest,
  identity: SigningIdentity
): Promise<void> => {
  let zip: OpenedZip;
  try {
    zip = await openZip(artifactPath);
  } catch (error) {
    throw verifyFailed(`Không đọc lại được gói vừa ghi: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const manifest = await readManifest(zip);
    if (
      packageSignaturePayload(manifest) !== packageSignaturePayload(expected) ||
      manifest.artifact?.signature.value !== expected.artifact?.signature.value
    ) {
      throw verifyFailed('Manifest trong gói khác với manifest đã ký.');
    }
    try {
      verifyArtifactSignature(manifest, { [identity.keyId]: identity.publicKeyPem });
    } catch (error) {
      throw verifyFailed(error instanceof Error ? error.message : 'Chữ ký không hợp lệ.');
    }

    const stored = zip.entries
      .filter((entry) => !entry.isDirectory && entry.name !== PACKAGE_MANIFEST_FILE)
      .toSorted((left, right) => compareCodeUnits(left.name, right.name));
    const hash = createHash('sha256');
    let sizeBytes = 0;
    let previous: string | undefined;
    for (const entry of stored) {
      if (!isSafeEntryPath(entry.name)) throw verifyFailed(`Đường dẫn không an toàn trong gói: ${entry.name}`);
      if (entry.name === previous) throw verifyFailed(`Gói có hai tệp trùng tên: ${entry.name}`);
      previous = entry.name;
      hash.update(entry.name);
      hash.update('\0');
      // oxlint-disable-next-line no-await-in-loop -- entries are decompressed one at a time to bound memory.
      const summary = await consume(await zip.read(entry), (chunk) => hash.update(chunk), entry.uncompressedSize);
      if (summary.crc32 !== entry.crc32 || summary.bytes !== entry.uncompressedSize) {
        throw verifyFailed(`Tệp trong gói bị hỏng: ${entry.name}`);
      }
      hash.update('\0');
      sizeBytes += summary.bytes;
    }
    const integrity = `sha256-${hash.digest('hex')}`;
    if (integrity !== manifest.artifact?.integrity || sizeBytes !== manifest.artifact.sizeBytes) {
      throw verifyFailed('Toàn vẹn của gói không khớp với manifest.');
    }
  } catch (error) {
    if (error instanceof RepoPackagingError) throw error;
    throw verifyFailed(`Không đọc lại được gói vừa ghi: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    zip.close();
  }
};

export { computeStreamingIntegrity };
