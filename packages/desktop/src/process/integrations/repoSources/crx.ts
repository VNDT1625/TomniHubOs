/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Install source ".crx" (docs/platform/repotopackage-design.md sections 12.6 and 12.8 spike S-6, task T4.7).
 *
 * A CRX3 file is `Cr24`, version 3 (uint32 LE), header length (uint32 LE, at most 1 MiB), a protobuf
 * `CrxFileHeader`, then the ZIP payload. The header holds proofs (`sha256_with_rsa` field 2, `sha256_with_ecdsa`
 * field 3; each a public key in SPKI DER and a signature) and `signed_header_data` (field 10000, holding `crx_id`).
 * Rules enforced here, none relaxed to make a file pass:
 *
 * - Every proof present must carry a valid signature over
 *   `"CRX3 SignedData\0" + uint32le(len(signed_header_data)) + signed_header_data + ZIP`. A header may hold several
 *   proofs (the Web Store adds Google's own keys); Chromium requires all of them to verify, so one bad proof
 *   rejects the file.
 * - The extension id comes from the proof whose derived id (first 16 bytes of SHA-256 of its public key, each
 *   nibble mapped to `a`-`p`) equals `crx_id` (and the requested id, when the caller passes one). That proof's
 *   key becomes the `publicKey`. No such proof rejects the file; the other proofs never supply an id.
 * - Every length read from the file is checked against a cap or the bytes left before anything is allocated or
 *   read. The protobuf reader is hand-written for exactly these fields, bounded, and refuses malformed input.
 * - The ZIP payload is written to disk while it is hashed, and nothing is extracted until the signatures verify.
 *   Failures use the code `CRX_INVALID`.
 *
 * `crx3.proto` has no Ed25519 field, so none is parsed: a proof's algorithm is fixed by its field, and its key
 * must be an RSA key (field 2) or a P-256 EC key (field 3). The table below is the only place to extend.
 */

import { createHash, createPublicKey, createVerify, type KeyObject } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  buildAndInstallExtension,
  createStagingDirectory,
  DEFAULT_EXTENSION_LIMITS,
  EXTENSION_MANIFEST_FILE,
  extractZipSafely,
  ExtensionSourceError,
  inspectExtensionFolder,
  installExtensionFromZip,
  parseManifestText,
  removeQuietly,
  type ExtensionInstallDeps,
  type ExtensionInstallOptions,
  type ExtensionInstallResult,
} from './folder';

const MAGIC = Buffer.from('Cr24', 'latin1');
const PREFIX_BYTES = 12;
/** Largest header the format allows (design section 12.6). */
export const MAX_CRX_HEADER_BYTES = 1024 * 1024;
const MAX_PROOFS = 16;
const MAX_PUBLIC_KEY_BYTES = 4096;
const MAX_SIGNATURE_BYTES = 2048;
const MAX_SIGNED_HEADER_BYTES = 4096;
const MAX_FIELDS = 256;
const CRX_ID_BYTES = 16;
const SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\u0000', 'latin1');

const FIELD_RSA_PROOF = 2;
const FIELD_ECDSA_PROOF = 3;
const FIELD_SIGNED_HEADER = 10_000;
const FIELD_PUBLIC_KEY = 1;
const FIELD_SIGNATURE = 2;
const FIELD_CRX_ID = 1;

/** Proof kinds the header may carry, keyed by their protobuf field. The key type is fixed by the field. */
const PROOF_KINDS = new Map<number, Readonly<{ name: 'rsa' | 'ecdsa'; keyType: 'rsa' | 'ec'; curve?: string }>>([
  [FIELD_RSA_PROOF, { name: 'rsa', keyType: 'rsa' }],
  [FIELD_ECDSA_PROOF, { name: 'ecdsa', keyType: 'ec', curve: 'prime256v1' }],
]);

const invalid = (reason: string): ExtensionSourceError =>
  new ExtensionSourceError('CRX_INVALID', `Tệp .crx không hợp lệ: ${reason}`);

type Field = Readonly<{ number: number; wire: number; bytes?: Buffer }>;

const readVarint = (buffer: Buffer, offset: number): Readonly<{ value: number; next: number }> => {
  let value = 0;
  let scale = 1;
  for (let index = 0; index < 10; index += 1) {
    const at = offset + index;
    if (at >= buffer.length) throw invalid('trường protobuf bị cắt cụt');
    const byte = buffer[at] ?? 0;
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) throw invalid('số protobuf quá lớn');
      return { value, next: at + 1 };
    }
    scale *= 128;
  }
  throw invalid('số protobuf quá dài');
};

/** Splits one protobuf message into fields. Every length is checked against the bytes left; no copy is made. */
const readFields = (buffer: Buffer): Field[] => {
  const fields: Field[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (fields.length >= MAX_FIELDS) throw invalid('header có quá nhiều trường');
    const tag = readVarint(buffer, offset);
    offset = tag.next;
    const number = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (number === 0) throw invalid('số trường protobuf bằng 0');
    if (wire === 0) {
      offset = readVarint(buffer, offset).next;
      fields.push({ number, wire });
    } else if (wire === 1 || wire === 5) {
      const width = wire === 1 ? 8 : 4;
      if (offset + width > buffer.length) throw invalid('trường protobuf bị cắt cụt');
      offset += width;
      fields.push({ number, wire });
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      if (length.value > buffer.length - length.next) throw invalid('độ dài trường vượt quá header');
      fields.push({ number, wire, bytes: buffer.subarray(length.next, length.next + length.value) });
      offset = length.next + length.value;
    } else {
      throw invalid('kiểu dữ liệu protobuf không được hỗ trợ');
    }
  }
  return fields;
};

export type CrxProof = Readonly<{
  algorithm: 'rsa' | 'ecdsa';
  /** SPKI DER, exactly as stored in the header. */
  publicKey: Buffer;
  signature: Buffer;
}>;

export type CrxHeader = Readonly<{
  proofs: readonly CrxProof[];
  signedHeaderData: Buffer;
  /** The 16 raw bytes of `crx_id`. */
  crxId: Buffer;
}>;

const parseProof = (kindField: number, body: Buffer): CrxProof => {
  const kind = PROOF_KINDS.get(kindField);
  if (kind === undefined) throw invalid('loại bằng chứng không rõ');
  let publicKey: Buffer | undefined;
  let signature: Buffer | undefined;
  for (const field of readFields(body)) {
    if (field.number === FIELD_PUBLIC_KEY && field.wire === 2) {
      if (publicKey !== undefined) throw invalid('bằng chứng có hai khoá công khai');
      publicKey = field.bytes;
    } else if (field.number === FIELD_SIGNATURE && field.wire === 2) {
      if (signature !== undefined) throw invalid('bằng chứng có hai chữ ký');
      signature = field.bytes;
    }
  }
  if (publicKey === undefined || publicKey.length === 0 || publicKey.length > MAX_PUBLIC_KEY_BYTES) {
    throw invalid('khoá công khai thiếu hoặc quá lớn');
  }
  if (signature === undefined || signature.length === 0 || signature.length > MAX_SIGNATURE_BYTES) {
    throw invalid('chữ ký thiếu hoặc quá lớn');
  }
  return { algorithm: kind.name, publicKey, signature };
};

/** Parses the protobuf `CrxFileHeader` (bounded; only the fields above). */
export const parseCrx3Header = (header: Buffer): CrxHeader => {
  if (header.length === 0 || header.length > MAX_CRX_HEADER_BYTES) throw invalid('độ dài header không hợp lệ');
  const proofs: CrxProof[] = [];
  let signedHeaderData: Buffer | undefined;
  for (const field of readFields(header)) {
    if (field.wire !== 2 || field.bytes === undefined) {
      if (field.number === FIELD_SIGNED_HEADER || PROOF_KINDS.has(field.number)) {
        throw invalid('kiểu dữ liệu của trường header sai');
      }
      continue;
    }
    if (PROOF_KINDS.has(field.number)) {
      if (proofs.length >= MAX_PROOFS) throw invalid('quá nhiều bằng chứng chữ ký');
      proofs.push(parseProof(field.number, field.bytes));
    } else if (field.number === FIELD_SIGNED_HEADER) {
      if (signedHeaderData !== undefined) throw invalid('signed_header_data xuất hiện hai lần');
      if (field.bytes.length > MAX_SIGNED_HEADER_BYTES) throw invalid('signed_header_data quá lớn');
      signedHeaderData = field.bytes;
    }
  }
  if (proofs.length === 0) throw invalid('header không có bằng chứng chữ ký');
  if (signedHeaderData === undefined) throw invalid('header thiếu signed_header_data');
  let crxId: Buffer | undefined;
  for (const field of readFields(signedHeaderData)) {
    if (field.number === FIELD_CRX_ID && field.wire === 2) {
      if (crxId !== undefined) throw invalid('crx_id xuất hiện hai lần');
      crxId = field.bytes;
    }
  }
  if (crxId === undefined || crxId.length !== CRX_ID_BYTES) throw invalid('crx_id thiếu hoặc sai độ dài');
  return { proofs, signedHeaderData, crxId };
};

/** Maps 16 raw id bytes to the 32-letter extension id: each nibble becomes `a`-`p`. */
export const crxIdToExtensionId = (bytes: Buffer): string => {
  let id = '';
  for (const byte of bytes) id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f));
  return id;
};

/** Extension id of a public key (SPKI DER): the first 16 bytes of its SHA-256, mapped to `a`-`p`. */
export const deriveExtensionId = (publicKey: Buffer): string =>
  crxIdToExtensionId(createHash('sha256').update(publicKey).digest().subarray(0, CRX_ID_BYTES));

const EXTENSION_ID = /^[a-p]{32}$/u;
export const isExtensionId = (value: string): boolean => EXTENSION_ID.test(value);

/** Checks the 12-byte prefix against the file size and returns where the header and the ZIP payload start. */
export const parseCrx3Prefix = (
  prefix: Buffer,
  fileSize: number
): Readonly<{ headerLength: number; zipOffset: number }> => {
  if (prefix.length < PREFIX_BYTES) throw invalid('tệp quá ngắn (bị cắt cụt)');
  if (!prefix.subarray(0, 4).equals(MAGIC)) throw invalid('không phải tệp CRX (thiếu dấu Cr24)');
  const version = prefix.readUInt32LE(4);
  if (version !== 3) throw invalid(`phiên bản CRX ${version} không được hỗ trợ (chỉ nhận CRX3)`);
  const headerLength = prefix.readUInt32LE(8);
  if (headerLength === 0 || headerLength > MAX_CRX_HEADER_BYTES) throw invalid('độ dài header vượt giới hạn');
  const zipOffset = PREFIX_BYTES + headerLength;
  if (zipOffset >= fileSize) throw invalid('tệp bị cắt cụt (không có dữ liệu ZIP)');
  return { headerLength, zipOffset };
};

export type Crx3Verified = Readonly<{
  /** The extension id: derived from the matching proof's key, equal to `crx_id` and to the requested id. */
  extensionId: string;
  /** SPKI DER of the matching proof, base64: the value for the manifest `key` and the connection `publicKey`. */
  publicKey: string;
  proofCount: number;
}>;

export type Crx3Verifier = Readonly<{
  /** Feeds the next bytes of the ZIP payload, in order. */
  update: (chunk: Uint8Array) => void;
  /** Verifies every signature and returns the identity. Throws `CRX_INVALID` when any check fails. */
  finish: () => Crx3Verified;
}>;

type PreparedProof = Readonly<{
  proof: CrxProof;
  key: KeyObject;
  verifier: ReturnType<typeof createVerify>;
}>;

const loadKey = (proof: CrxProof): KeyObject => {
  const kind = [...PROOF_KINDS.values()].find((candidate) => candidate.name === proof.algorithm);
  let key: KeyObject;
  try {
    key = createPublicKey({ key: proof.publicKey, format: 'der', type: 'spki' });
    // The key must be stored canonically: the id is hashed from these exact bytes.
    if (!key.export({ type: 'spki', format: 'der' }).equals(proof.publicKey)) throw new Error('not canonical');
  } catch {
    throw invalid('khoá công khai trong bằng chứng không đọc được');
  }
  if (kind === undefined || key.asymmetricKeyType !== kind.keyType) {
    throw invalid('loại khoá không khớp loại bằng chứng');
  }
  if (kind.curve !== undefined && key.asymmetricKeyDetails?.namedCurve !== kind.curve) {
    throw invalid('đường cong ECDSA không được hỗ trợ');
  }
  return key;
};

/**
 * Starts verification from a parsed header. Fails at once when no proof matches the id the file declares (and the
 * requested id, if any); the signatures are checked in {@link Crx3Verifier.finish} after the payload was fed.
 */
export const createCrx3Verifier = (header: Buffer, options: Readonly<{ expectedId?: string }> = {}): Crx3Verifier => {
  const parsed = parseCrx3Header(header);
  const declaredId = crxIdToExtensionId(parsed.crxId);
  if (options.expectedId !== undefined && options.expectedId !== declaredId) {
    throw invalid('mã tiện ích trong tệp khác mã yêu cầu');
  }
  const signedPrefix = Buffer.alloc(4);
  signedPrefix.writeUInt32LE(parsed.signedHeaderData.length);
  const prepared: PreparedProof[] = parsed.proofs.map((proof) => {
    const verifier = createVerify('sha256');
    verifier.update(SIGNED_DATA_PREFIX);
    verifier.update(signedPrefix);
    verifier.update(parsed.signedHeaderData);
    return { proof, key: loadKey(proof), verifier };
  });
  // S-6: only the proof whose derived id is the declared id supplies the key; the rest are Google's keys.
  const matching = prepared.find((entry) => deriveExtensionId(entry.proof.publicKey) === declaredId);
  if (matching === undefined) throw invalid('không có bằng chứng nào khớp mã tiện ích');
  let finished = false;
  return {
    update: (chunk) => {
      if (finished) throw invalid('đã kết thúc kiểm tra');
      for (const entry of prepared) entry.verifier.update(chunk);
    },
    finish: () => {
      if (finished) throw invalid('đã kết thúc kiểm tra');
      finished = true;
      for (const entry of prepared) {
        let ok = false;
        try {
          ok = entry.verifier.verify(entry.key, entry.proof.signature);
        } catch {
          ok = false;
        }
        if (!ok) throw invalid('chữ ký không đúng');
      }
      return {
        extensionId: declaredId,
        publicKey: matching.proof.publicKey.toString('base64'),
        proofCount: prepared.length,
      };
    },
  };
};

/** Verifies a whole CRX3 held in memory (small files and tests). Returns the identity and the ZIP bytes. */
export const verifyCrx3Buffer = (
  file: Buffer,
  options: Readonly<{ expectedId?: string }> = {}
): Crx3Verified & Readonly<{ zip: Buffer }> => {
  const { headerLength, zipOffset } = parseCrx3Prefix(file.subarray(0, PREFIX_BYTES), file.length);
  const verifier = createCrx3Verifier(file.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength), options);
  const zip = file.subarray(zipOffset);
  verifier.update(zip);
  return { ...verifier.finish(), zip };
};

/**
 * Verifies a `.crx` file and writes its ZIP payload to `zipPath` (created exclusively). The payload is hashed while
 * it is copied, so what was verified is exactly what was written; on any failure the copy is removed.
 */
export const extractCrx3Payload = async (
  crxPath: string,
  zipPath: string,
  options: Readonly<{ expectedId?: string; maxZipBytes?: number }> = {}
): Promise<Crx3Verified> => {
  const maxZipBytes = options.maxZipBytes ?? DEFAULT_EXTENSION_LIMITS.maxArchiveBytes;
  let size: number;
  let verifier: Crx3Verifier;
  let zipOffset: number;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    size = (await stat(crxPath)).size;
    handle = await open(crxPath, 'r');
    const prefix = Buffer.alloc(PREFIX_BYTES);
    const read = await handle.read(prefix, 0, PREFIX_BYTES, 0);
    const parsed = parseCrx3Prefix(prefix.subarray(0, read.bytesRead), size);
    zipOffset = parsed.zipOffset;
    if (size - zipOffset > maxZipBytes)
      throw new ExtensionSourceError('TOO_LARGE', 'Tệp .crx vượt giới hạn kích thước.');
    // The length was checked against the file size above, so this allocation is at most 1 MiB.
    const header = Buffer.alloc(parsed.headerLength);
    const headerRead = await handle.read(header, 0, parsed.headerLength, PREFIX_BYTES);
    if (headerRead.bytesRead !== parsed.headerLength) throw invalid('header bị cắt cụt');
    verifier = createCrx3Verifier(header, options);
  } catch (error) {
    if (error instanceof ExtensionSourceError) throw error;
    throw new ExtensionSourceError('SOURCE_NOT_FOUND', 'Không đọc được tệp .crx.');
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
  let total = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxZipBytes) {
        callback(new ExtensionSourceError('TOO_LARGE', 'Tệp .crx vượt giới hạn kích thước.'));
        return;
      }
      verifier.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(crxPath, { start: zipOffset }), meter, createWriteStream(zipPath, { flags: 'wx' }));
    if (total === 0) throw invalid('tệp bị cắt cụt (không có dữ liệu ZIP)');
    return verifier.finish();
  } catch (error) {
    await rm(zipPath, { force: true }).catch((): undefined => undefined);
    if (error instanceof ExtensionSourceError) throw error;
    throw new ExtensionSourceError('SOURCE_NOT_FOUND', 'Không đọc được tệp .crx.');
  }
};

const compactBase64 = (value: string): string => value.replace(/\s+/gu, '');

/**
 * Returns the manifest text with `key` set to the proven public key, so the extension keeps its id wherever it is
 * loaded from. A manifest that already carries a different key is refused: the signature vouches for one identity.
 */
export const injectManifestKey = (manifestText: string, publicKeyBase64: string): string => {
  const manifest = parseManifestText(manifestText);
  const existing = manifest.key;
  if (existing !== undefined) {
    if (typeof existing !== 'string' || compactBase64(existing) !== publicKeyBase64) {
      throw invalid('khoá trong manifest.json khác khoá đã ký của tệp .crx');
    }
    return manifestText;
  }
  return `${JSON.stringify({ ...manifest, key: publicKeyBase64 }, null, 2)}\n`;
};

/**
 * Installs a `.crx`: verify the CRX3 first, extract the payload safely, put the proven `key` into the staged
 * manifest, then build and install it as every other source does. The extension id is kept.
 */
export const installExtensionFromCrx = async (
  deps: ExtensionInstallDeps,
  crxPath: string,
  options: ExtensionInstallOptions & Readonly<{ expectedId?: string }> = {}
): Promise<ExtensionInstallResult> => {
  const staging = await createStagingDirectory(deps);
  try {
    const zipPath = path.join(staging, 'payload.zip');
    const verified = await extractCrx3Payload(crxPath, zipPath, {
      ...(options.expectedId === undefined ? {} : { expectedId: options.expectedId }),
      ...(deps.limits?.maxArchiveBytes === undefined ? {} : { maxZipBytes: deps.limits.maxArchiveBytes }),
    });
    const folder = path.join(staging, 'extension');
    await extractZipSafely(zipPath, folder, { limits: deps.limits, signal: options.signal });
    await rm(zipPath, { force: true });
    const manifestFile = path.join(folder, EXTENSION_MANIFEST_FILE);
    const original = await readFile(manifestFile, 'utf8');
    // Writes the staged copy only; the user's `.crx` is never modified.
    await writeFile(manifestFile, injectManifestKey(original, verified.publicKey), 'utf8');
    const info = await inspectExtensionFolder(folder, { limits: deps.limits, signal: options.signal });
    const install = await buildAndInstallExtension(deps, folder, options, verified.publicKey);
    return {
      from: 'crx',
      extensionId: verified.extensionId,
      extensionName: info.manifest.name,
      extensionVersion: info.manifest.version,
      install,
    };
  } finally {
    await removeQuietly(staging);
  }
};

const readMagic = async (filePath: string): Promise<Buffer> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, 'r');
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    return head.subarray(0, bytesRead);
  } catch {
    throw new ExtensionSourceError('SOURCE_NOT_FOUND', 'Không đọc được tệp đã chọn.');
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

/**
 * Installs a file the user picked in Main's file dialog. The content decides the path, never the name alone:
 * `Cr24` goes through the signature checks, and a `.crx` name whose content is a bare ZIP is refused (otherwise a
 * rename would skip them). Any other file is treated as a `.zip` and fails there when it is not one.
 */
export const installExtensionFromFile = async (
  deps: ExtensionInstallDeps,
  filePath: string,
  options: ExtensionInstallOptions & Readonly<{ expectedId?: string }> = {}
): Promise<ExtensionInstallResult> => {
  const magic = await readMagic(filePath);
  if (magic.equals(MAGIC)) return installExtensionFromCrx(deps, filePath, options);
  if (path.extname(filePath).toLowerCase() === '.crx') throw invalid('không phải tệp CRX (thiếu dấu Cr24)');
  return installExtensionFromZip(deps, filePath, options);
};
