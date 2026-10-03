import { createHash } from 'node:crypto';
export type StagedArtifact = Readonly<{
  digest: string;
  sizeBytes: number;
  objectKey: string;
  packageId: string;
  version: string;
  manifestDigest: string;
}>;
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const validatePackageArchive = (bytes: Uint8Array, requireArchive = false): void => {
  const isZip =
    bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!isZip) {
    if (requireArchive) throw new Error('ARCHIVE_REQUIRED');
    return;
  }
  let offset = 0;
  let entries = 0;
  let declaredBytes = 0;
  while (
    offset + 30 <= bytes.byteLength &&
    bytes[offset] === 0x50 &&
    bytes[offset + 1] === 0x4b &&
    bytes[offset + 2] === 0x03 &&
    bytes[offset + 3] === 0x04
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const flags = view.getUint16(6, true);
    const compressed = view.getUint32(18, true);
    const uncompressed = view.getUint32(22, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    if (
      (flags & 0x08) !== 0 ||
      nameLength === 0 ||
      offset + 30 + nameLength + extraLength + compressed > bytes.byteLength
    )
      throw new Error('ARCHIVE_UNSAFE');
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength)).replaceAll('\\', '/');
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes(':'))
      throw new Error('ARCHIVE_PATH_TRAVERSAL');
    entries += 1;
    declaredBytes += uncompressed;
    if (entries > 10_000 || declaredBytes > 500 * 1024 * 1024) throw new Error('ARCHIVE_LIMIT_EXCEEDED');
    offset += 30 + nameLength + extraLength + compressed;
  }
  if (entries === 0) throw new Error('ARCHIVE_INVALID');
};
export const stagePackageArtifact = (
  input: Readonly<{ bytes: Uint8Array; packageId: string; version: string; manifestDigest: string; maxBytes?: number }>
): StagedArtifact => {
  const max = input.maxBytes ?? 50 * 1024 * 1024;
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > max) throw new Error('ARTIFACT_SIZE_INVALID');
  validatePackageArchive(input.bytes, false);
  if (!input.packageId.trim() || !input.version.trim() || !/^sha256-[a-f0-9]{64}$/.test(input.manifestDigest))
    throw new Error('ARTIFACT_METADATA_INVALID');
  const digestValue = digest(input.bytes);
  return {
    digest: `sha256-${digestValue}`,
    sizeBytes: input.bytes.byteLength,
    objectKey: `sha256/${digestValue}`,
    packageId: input.packageId,
    version: input.version,
    manifestDigest: input.manifestDigest,
  };
};
