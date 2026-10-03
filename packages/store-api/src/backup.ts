import { createHash } from 'node:crypto';
export type BackupManifest = Readonly<{
  schemaVersion: 1;
  createdAt: string;
  files: readonly Readonly<{ name: string; sha256: string; bytes: number }>[];
  manifestSha256: string;
}>;
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const validateFileNames = (files: readonly Readonly<{ name: string; bytes: Uint8Array }>[]): void => {
  const names = new Set<string>();
  for (const file of files) {
    if (!/^[A-Za-z0-9._-]+$/.test(file.name) || names.has(file.name)) throw new Error('BACKUP_FILE_NAME_INVALID');
    names.add(file.name);
  }
};
export const createBackupManifest = (
  files: readonly Readonly<{ name: string; bytes: Uint8Array }>[],
  createdAt = new Date().toISOString()
): BackupManifest => {
  validateFileNames(files);
  const entries = files
    .map((file) => ({ name: file.name, sha256: digest(file.bytes), bytes: file.bytes.byteLength }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const canonical = JSON.stringify({ schemaVersion: 1, createdAt, files: entries });
  return { schemaVersion: 1, createdAt, files: entries, manifestSha256: digest(Buffer.from(canonical)) };
};
export const verifyBackupManifest = (
  manifest: BackupManifest,
  files: readonly Readonly<{ name: string; bytes: Uint8Array }>[]
): void => {
  const expected = createBackupManifest(files, manifest.createdAt);
  if (
    expected.manifestSha256 !== manifest.manifestSha256 ||
    JSON.stringify(expected.files) !== JSON.stringify(manifest.files)
  )
    throw new Error('BACKUP_MANIFEST_INVALID');
};
