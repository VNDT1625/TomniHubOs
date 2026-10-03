/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* oxlint-disable no-await-in-loop -- redirects and package extraction are intentionally sequential security boundaries. */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { parsePackageManifest, type PackageManifest } from '../../../common/packages';
import { systemEgressAuthority } from '../../services/security/systemEgressAuthority';
import { PACKAGE_MANIFEST_FILE, packageArtifactManifestsMatch, verifyArtifactSignature } from './artifactSecurity';
import { isVerifiedRemoteStoreArtifactBinding, type VerifiedRemoteStoreArtifactBinding } from './remoteCatalog';

const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 4096;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;
const PACKAGE_DOWNLOAD_TIMEOUT_MS = 60_000;
const SAFE_ARCHIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\:]+$/;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type PublisherTomnyArtifactPrincipal = Readonly<{
  publisherId: string;
  subjectId: string;
  namespace: string;
  activeSigningKey: Readonly<{
    keyId: string;
    algorithm: 'Ed25519';
    publicKeyPem: string;
  }>;
}>;

export type StagedTomnyArchiveReader = (
  input: Readonly<{
    publisherId: string;
    subjectId: string;
    artifactId: string;
  }>
) => Promise<Uint8Array>;

/** Immutable evidence for a validated staged `.tomny` ZIP. */
export type VerifiedTomnyPublisherArtifact = Readonly<{
  manifest: PackageManifest;
  /** Digest of the uploaded ZIP bytes, retained separately from the payload digest. */
  archiveFingerprint: string;
  /** Digest of the unpacked package payload, exactly equal to signed manifest integrity. */
  artifactFingerprint: string;
  inspection: Readonly<{
    hasNativeCode: boolean | 'unknown';
    aiOperations: readonly string[] | 'unknown';
    destinations: readonly string[] | 'unknown';
  }>;
}>;

export type StagedTomnyArtifactVerifier = (
  input: Readonly<{
    principal: PublisherTomnyArtifactPrincipal;
    idempotencyKey: string;
    artifactId: string;
  }>
) => Promise<VerifiedTomnyPublisherArtifact>;

export type PackageDownloadVerification = {
  expectedManifest: PackageManifest;
  trustedKeys: Readonly<Record<string, string>>;
  allowLocalDevelopment?: boolean;
  /** Opaque proof retained from a verified remote Store catalog entry. */
  verifiedRemoteStoreArtifactBinding?: VerifiedRemoteStoreArtifactBinding;
  /** Main-owned local development transport; production downloads remain HTTPS-only. */
  readArtifactBytes?: (url: string) => Promise<Buffer | undefined>;
};

type JsonPackageBundle = {
  format: 'tomni-package-bundle-v1';
  manifest: unknown;
  files: Record<string, string>;
};

type ZipEntryWithMetadata = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: unknown };
};

const normalizedHostname = (hostname: string): string =>
  hostname.toLocaleLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');

const isBlockedIpv4 = (hostname: string): boolean => {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second, third] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
};

const isBlockedIpv6 = (hostname: string): boolean => {
  if (!hostname.includes(':')) return false;
  if (hostname === '::' || hostname === '::1' || hostname.startsWith('::ffff:')) return true;
  const firstHextet = Number.parseInt(hostname.split(':', 1)[0] ?? '', 16);
  return (
    !Number.isFinite(firstHextet) ||
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00 ||
    hostname.startsWith('2001:db8:')
  );
};

const isLocalOrPrivateHost = (hostname: string): boolean => {
  const normalized = normalizedHostname(hostname);
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    isBlockedIpv4(normalized) ||
    isBlockedIpv6(normalized)
  );
};

const validateArtifactUrl = (url: URL, allowLocalDevelopment: boolean): void => {
  if (url.username || url.password) throw new Error('Package artifact URLs cannot contain credentials.');
  const localDevelopmentUrl =
    allowLocalDevelopment &&
    url.protocol === 'http:' &&
    (normalizedHostname(url.hostname) === '127.0.0.1' || normalizedHostname(url.hostname) === 'localhost');
  if (localDevelopmentUrl) return;
  if (url.protocol !== 'https:') throw new Error('Package artifact URLs and redirects must use HTTPS.');
  if (isLocalOrPrivateHost(url.hostname)) {
    throw new Error('Package artifact URLs cannot target local, private, or link-local addresses.');
  }
};

const discardResponseBody = async (response: Response): Promise<void> => {
  await response.body?.cancel().catch((): undefined => undefined);
};

const fetchArtifact = async (initialUrl: URL, signal: AbortSignal, requiresExactUrl: boolean): Promise<Response> => {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetch(currentUrl, { redirect: 'manual', signal });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    try {
      if (requiresExactUrl) throw new Error('Signed Store artifact redirects are not allowed.');
      if (redirectCount >= MAX_REDIRECTS) throw new Error(`Package download exceeded ${MAX_REDIRECTS} redirects.`);
      const location = response.headers.get('location');
      if (!location) throw new Error(`Package redirect ${response.status} is missing a Location header.`);
      const nextUrl = new URL(location, currentUrl);
      validateArtifactUrl(nextUrl, false);
      currentUrl = nextUrl;
    } finally {
      await discardResponseBody(response);
    }
  }
};

const isExplicitLocalDevelopmentArtifact = (url: URL, allowLocalDevelopment: boolean): boolean =>
  allowLocalDevelopment &&
  url.protocol === 'http:' &&
  (normalizedHostname(url.hostname) === '127.0.0.1' || normalizedHostname(url.hostname) === 'localhost');

const readResponseBounded = async (response: Response): Promise<Buffer> => {
  const declaredSizeHeader = response.headers.get('content-length');
  let declaredSize: number | undefined;
  if (declaredSizeHeader) {
    declaredSize = Number(declaredSizeHeader);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
      await discardResponseBody(response);
      throw new Error('Package artifact has an invalid Content-Length header.');
    }
    if (declaredSize > MAX_PACKAGE_BYTES) {
      await discardResponseBody(response);
      throw new Error('Package artifact exceeds the download size limit.');
    }
  }
  if (!response.body) {
    if (declaredSize !== undefined && declaredSize !== 0) {
      throw new Error('Package artifact Content-Length does not match the received bytes.');
    }
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_PACKAGE_BYTES) {
      await reader.cancel().catch((): undefined => undefined);
      throw new Error('Package artifact exceeds the download size limit.');
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  if (declaredSize !== undefined && receivedBytes !== declaredSize) {
    throw new Error('Package artifact Content-Length does not match the received bytes.');
  }
  return Buffer.concat(chunks, receivedBytes);
};

const normalizedArchivePath = (archivePath: string): string => archivePath.replaceAll('\\', '/');

/** Shared ZIP-path boundary for downloader extraction and Main-only publisher verification. */
const assertSafeArchivePath = (archivePath: string): string => {
  const normalized = normalizedArchivePath(archivePath);
  if (normalized.includes('\0') || !SAFE_ARCHIVE_PATH.test(normalized)) {
    throw new Error(`Unsafe package archive path: ${archivePath}`);
  }
  return normalized;
};

const safeTarget = (destination: string, archivePath: string): string => {
  const normalized = assertSafeArchivePath(archivePath);
  const target = path.resolve(destination, normalized);
  const relative = path.relative(path.resolve(destination), target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Package archive escapes destination.');
  return target;
};

const withoutUtf8Bom = (bytes: Buffer): Buffer => (bytes.subarray(0, 3).equals(UTF8_BOM) ? bytes.subarray(3) : bytes);

const verifyDownloadedManifest = (value: unknown, verification: PackageDownloadVerification): PackageManifest => {
  const manifest = parsePackageManifest(value);
  if (!packageArtifactManifestsMatch(verification.expectedManifest, manifest)) {
    throw new Error(`Artifact manifest does not match the Store catalog for ${verification.expectedManifest.id}.`);
  }
  verifyArtifactSignature(manifest, verification.trustedKeys);
  return manifest;
};

const isBase64Content = (encoded: string): boolean => {
  if (encoded.length % 4 !== 0) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const contentLength = encoded.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = encoded.charCodeAt(index);
    const isAlphabet = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isNumber = code >= 48 && code <= 57;
    if (!isAlphabet && !isNumber && code !== 43 && code !== 47) return false;
  }
  for (let index = contentLength; index < encoded.length; index += 1) {
    if (encoded.charCodeAt(index) !== 61) return false;
  }
  return true;
};

const decodedBase64Size = (encoded: string): number => {
  if (!isBase64Content(encoded)) throw new Error('Package bundle file content must be valid base64.');
  if (encoded.length === 0) return 0;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
};

const extractJsonBundle = async (
  bytes: Buffer,
  destination: string,
  verification: PackageDownloadVerification
): Promise<boolean> => {
  const jsonBytes = withoutUtf8Bom(bytes);
  if (jsonBytes.subarray(0, 1).toString('utf8') !== '{') return false;
  let bundle: JsonPackageBundle;
  try {
    bundle = JSON.parse(jsonBytes.toString('utf8')) as JsonPackageBundle;
  } catch {
    return false;
  }
  if (bundle.format !== 'tomni-package-bundle-v1' || !bundle.files || typeof bundle.files !== 'object') {
    return false;
  }

  const manifest = verifyDownloadedManifest(bundle.manifest, verification);
  const entries = Object.entries(bundle.files);
  if (entries.length > MAX_ARCHIVE_FILES) throw new Error(`Package exceeds the ${MAX_ARCHIVE_FILES} file limit.`);
  let declaredPayloadBytes = 0;
  for (const [archivePath, encoded] of entries) {
    if (archivePath.replaceAll('\\', '/') === PACKAGE_MANIFEST_FILE) {
      throw new Error(`Package bundle cannot include the reserved ${PACKAGE_MANIFEST_FILE} payload path.`);
    }
    safeTarget(destination, archivePath);
    if (typeof encoded !== 'string') throw new Error('Package bundle file content must be base64.');
    declaredPayloadBytes += decodedBase64Size(encoded);
    if (declaredPayloadBytes > MAX_PACKAGE_BYTES) throw new Error('Extracted package exceeds the size limit.');
  }
  if (declaredPayloadBytes !== manifest.artifact?.sizeBytes) {
    throw new Error(`Package payload size does not match the signed manifest for ${manifest.id}.`);
  }

  await mkdir(destination, { recursive: true });
  let extractedBytes = 0;
  for (const [archivePath, encoded] of entries) {
    const content = Buffer.from(encoded, 'base64');
    extractedBytes += content.byteLength;
    if (extractedBytes > MAX_PACKAGE_BYTES) throw new Error('Extracted package exceeds the size limit.');
    const target = safeTarget(destination, archivePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { mode: 0o600 });
  }
  await writeFile(path.join(destination, PACKAGE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  return true;
};

const zipEntryUncompressedSize = (entry: JSZip.JSZipObject): number => {
  const size = (entry as ZipEntryWithMetadata)._data?.uncompressedSize;
  if (!Number.isSafeInteger(size) || (size as number) < 0) {
    throw new Error(`Package ZIP entry has invalid uncompressed size metadata: ${entry.name}`);
  }
  return size as number;
};

type ZipPayloadEntry = Readonly<{
  relativePath: string;
  entry: JSZip.JSZipObject;
  uncompressedSize: number;
}>;

type ParsedTomnyZip = Readonly<{
  manifest: PackageManifest;
  payloadEntries: readonly ZipPayloadEntry[];
  declaredPayloadBytes: number;
}>;

/**
 * Parses only the archive structure and root manifest. Payload bytes stay compressed until the
 * manifest signature and publisher authority have been accepted by the caller.
 */
const parseTomnyZip = async (bytes: Uint8Array): Promise<ParsedTomnyZip> => {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PACKAGE_BYTES) {
    throw new Error('Package ZIP exceeds the size limit.');
  }
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  const entries = Object.entries(archive.files);
  if (entries.length > MAX_ARCHIVE_FILES) throw new Error(`Package exceeds the ${MAX_ARCHIVE_FILES} file limit.`);

  const paths = new Set<string>();
  const payloadEntries: ZipPayloadEntry[] = [];
  let declaredPayloadBytes = 0;
  let manifestEntry: JSZip.JSZipObject | undefined;
  for (const [archivePath, entry] of entries) {
    const relativePath = assertSafeArchivePath(entry.unsafeOriginalName ?? archivePath);
    if (paths.has(relativePath)) throw new Error(`Package ZIP contains duplicate path: ${relativePath}.`);
    paths.add(relativePath);
    if (entry.dir) {
      if (relativePath === PACKAGE_MANIFEST_FILE) throw new Error('Package manifest must be a regular file.');
      continue;
    }
    const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new Error('Package archives cannot contain symbolic links.');
    const uncompressedSize = zipEntryUncompressedSize(entry);
    if (uncompressedSize > MAX_PACKAGE_BYTES) throw new Error('Package ZIP entry exceeds the size limit.');
    if (relativePath === PACKAGE_MANIFEST_FILE) {
      if (manifestEntry) throw new Error(`Package ZIP contains duplicate ${PACKAGE_MANIFEST_FILE} entries.`);
      if (uncompressedSize > MAX_MANIFEST_BYTES) throw new Error('Package manifest exceeds the size limit.');
      manifestEntry = entry;
      continue;
    }
    declaredPayloadBytes += uncompressedSize;
    if (declaredPayloadBytes > MAX_PACKAGE_BYTES) throw new Error('Extracted package exceeds the size limit.');
    payloadEntries.push({ relativePath, entry, uncompressedSize });
  }
  if (!manifestEntry) throw new Error(`Package ZIP does not contain ${PACKAGE_MANIFEST_FILE}.`);

  const manifestBytes = await manifestEntry.async('nodebuffer');
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('Package manifest exceeds the size limit.');
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(withoutUtf8Bom(manifestBytes).toString('utf8')) as unknown;
  } catch {
    throw new Error('Package ZIP manifest is not valid JSON.');
  }
  return { manifest: parsePackageManifest(manifestValue), payloadEntries, declaredPayloadBytes };
};

const belongsToNamespace = (packageId: string, namespace: string): boolean =>
  packageId === namespace || packageId.startsWith(`${namespace}.`);

const archiveFingerprint = (bytes: Uint8Array): string => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;

/**
 * Creates the Main-only verifier for staged third-party `.tomny` ZIPs. The caller supplies bytes
 * only through an owner-bound staging reader; renderer paths, URLs, and manifest/key input are
 * intentionally not accepted here.
 */
export const createStagedTomnyArtifactVerifier =
  (readStagedArchive: StagedTomnyArchiveReader): StagedTomnyArtifactVerifier =>
  async ({ principal, artifactId }): Promise<VerifiedTomnyPublisherArtifact> => {
    const bytes = await readStagedArchive({
      publisherId: principal.publisherId,
      subjectId: principal.subjectId,
      artifactId,
    });
    if (!(bytes instanceof Uint8Array)) throw new Error('Staged package archive is invalid.');
    const archiveBytes = Uint8Array.from(bytes);
    const parsed = await parseTomnyZip(archiveBytes);
    const { manifest } = parsed;
    if (manifest.publisherId !== principal.publisherId || !belongsToNamespace(manifest.id, principal.namespace)) {
      throw new Error('Staged package manifest is outside the authenticated publisher namespace.');
    }
    if (manifest.artifact?.signature.keyId !== principal.activeSigningKey.keyId) {
      throw new Error('Staged package is not signed by the active publisher key.');
    }
    verifyArtifactSignature(manifest, { [principal.activeSigningKey.keyId]: principal.activeSigningKey.publicKeyPem });
    if (manifest.artifact.sizeBytes !== parsed.declaredPayloadBytes) {
      throw new Error(`Package payload size does not match the signed manifest for ${manifest.id}.`);
    }

    const payloadHash = createHash('sha256');
    let extractedBytes = 0;
    for (const payload of [...parsed.payloadEntries].toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    )) {
      const content = await payload.entry.async('nodebuffer');
      if (content.byteLength !== payload.uncompressedSize)
        throw new Error('Package ZIP entry size does not match metadata.');
      extractedBytes += content.byteLength;
      if (extractedBytes > MAX_PACKAGE_BYTES) throw new Error('Extracted package exceeds the size limit.');
      payloadHash.update(payload.relativePath);
      payloadHash.update('\0');
      payloadHash.update(content);
      payloadHash.update('\0');
    }
    if (extractedBytes !== parsed.declaredPayloadBytes)
      throw new Error('Package payload size does not match archive metadata.');
    const artifactFingerprint = `sha256-${payloadHash.digest('hex')}`;
    if (manifest.artifact.integrity !== artifactFingerprint) {
      throw new Error(`Package payload integrity does not match the signed manifest for ${manifest.id}.`);
    }
    return Object.freeze({
      manifest,
      archiveFingerprint: archiveFingerprint(archiveBytes),
      artifactFingerprint,
      // A content-aware analyzer is a separate review worker. Unknowns deliberately force review.
      inspection: Object.freeze({ hasNativeCode: 'unknown', aiOperations: 'unknown', destinations: 'unknown' }),
    });
  };

const extractZipBundle = async (
  bytes: Buffer,
  destination: string,
  verification: PackageDownloadVerification
): Promise<void> => {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  const entries = Object.entries(archive.files);
  if (entries.length > MAX_ARCHIVE_FILES) throw new Error(`Package exceeds the ${MAX_ARCHIVE_FILES} file limit.`);

  let declaredPayloadBytes = 0;
  let manifestEntry: JSZip.JSZipObject | undefined;
  for (const [archivePath, entry] of entries) {
    const originalPath = entry.unsafeOriginalName ?? archivePath;
    safeTarget(destination, originalPath);
    if (entry.dir) continue;
    const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new Error('Package archives cannot contain symbolic links.');
    const uncompressedSize = zipEntryUncompressedSize(entry);
    if (uncompressedSize > MAX_PACKAGE_BYTES) throw new Error('Package ZIP entry exceeds the size limit.');
    if (archivePath.replaceAll('\\', '/') === PACKAGE_MANIFEST_FILE) {
      if (manifestEntry) throw new Error(`Package ZIP contains duplicate ${PACKAGE_MANIFEST_FILE} entries.`);
      if (uncompressedSize > MAX_MANIFEST_BYTES) throw new Error('Package manifest exceeds the size limit.');
      manifestEntry = entry;
    } else {
      declaredPayloadBytes += uncompressedSize;
      if (declaredPayloadBytes > MAX_PACKAGE_BYTES) throw new Error('Extracted package exceeds the size limit.');
    }
  }
  if (!manifestEntry) throw new Error(`Package ZIP does not contain ${PACKAGE_MANIFEST_FILE}.`);

  const manifestBytes = await manifestEntry.async('nodebuffer');
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('Package manifest exceeds the size limit.');
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(withoutUtf8Bom(manifestBytes).toString('utf8')) as unknown;
  } catch {
    throw new Error('Package ZIP manifest is not valid JSON.');
  }
  const manifest = verifyDownloadedManifest(manifestValue, verification);
  if (declaredPayloadBytes !== manifest.artifact?.sizeBytes) {
    throw new Error(`Package payload size does not match the signed manifest for ${manifest.id}.`);
  }

  await mkdir(destination, { recursive: true });
  let extractedBytes = 0;
  for (const [archivePath, entry] of entries) {
    if (entry.dir || archivePath.replaceAll('\\', '/') === PACKAGE_MANIFEST_FILE) continue;
    const content = await entry.async('nodebuffer');
    extractedBytes += content.byteLength;
    if (extractedBytes > MAX_PACKAGE_BYTES) throw new Error('Extracted package exceeds the size limit.');
    const target = safeTarget(destination, entry.unsafeOriginalName ?? archivePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { mode: 0o600 });
  }
  await writeFile(path.join(destination, PACKAGE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
};

export const downloadPackageArtifact = async (
  url: string,
  destination: string,
  verification: PackageDownloadVerification
): Promise<void> => {
  const expectedManifest = parsePackageManifest(verification.expectedManifest);
  verifyArtifactSignature(expectedManifest, verification.trustedKeys);
  if ((expectedManifest.artifact?.sizeBytes ?? 0) > MAX_PACKAGE_BYTES) {
    throw new Error('Signed package payload exceeds the size limit.');
  }
  const verifiedDownload = { ...verification, expectedManifest };
  const parsed = new URL(url);
  validateArtifactUrl(parsed, verification.allowLocalDevelopment === true);
  const artifactBinding = verification.verifiedRemoteStoreArtifactBinding;
  const hasVerifiedArtifactBinding = isVerifiedRemoteStoreArtifactBinding(artifactBinding);
  if (hasVerifiedArtifactBinding) {
    const egress = systemEgressAuthority.authorize({
      egressClass: 'signed-store-artifact',
      destination: parsed.toString(),
      verifiedStoreArtifactUrl: artifactBinding.artifactUrl,
    });
    if (egress.decision !== 'allow') {
      throw new Error(`Signed Store artifact egress denied: ${egress.code}.`);
    }
  } else if (!isExplicitLocalDevelopmentArtifact(parsed, verification.allowLocalDevelopment === true)) {
    throw new Error('Package artifact download lacks verified signed Store catalog authority.');
  }

  if (
    verification.readArtifactBytes &&
    isExplicitLocalDevelopmentArtifact(parsed, verification.allowLocalDevelopment === true)
  ) {
    const bytes = await verification.readArtifactBytes(parsed.toString());
    if (!bytes) throw new Error('Package artifact is unavailable in local development transport.');
    if (await extractJsonBundle(bytes, destination, verifiedDownload)) return;
    await extractZipBundle(bytes, destination, verifiedDownload);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Package download timed out.')),
    PACKAGE_DOWNLOAD_TIMEOUT_MS
  );
  timeout.unref?.();
  try {
    const response = await fetchArtifact(parsed, controller.signal, hasVerifiedArtifactBinding);
    if (!response.ok) {
      await discardResponseBody(response);
      throw new Error(`Package download failed with HTTP ${response.status}.`);
    }
    const bytes = await readResponseBounded(response);
    if (await extractJsonBundle(bytes, destination, verifiedDownload)) return;
    await extractZipBundle(bytes, destination, verifiedDownload);
  } finally {
    clearTimeout(timeout);
  }
};
