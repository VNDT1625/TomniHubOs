import type { BackupBundle } from './backupExport.js';
import { decryptBackupBundle, type EncryptedBackup } from './backupCrypto.js';

export const restoreEncryptedBackupArtifact = (bytes: Uint8Array, key: Uint8Array): BackupBundle => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new Error('BACKUP_ARTIFACT_INVALID');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('BACKUP_ARTIFACT_INVALID');
  return decryptBackupBundle(value as EncryptedBackup, key);
};
