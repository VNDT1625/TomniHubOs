import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { exportCriticalStoreState, type BackupBundle } from './backupExport.js';
import { encryptBackupBundle, type EncryptedBackup } from './backupCrypto.js';

export type BackupArtifact = Readonly<{
  key: string;
  bytes: Uint8Array;
  sha256: string;
  encrypted: EncryptedBackup;
  sourceManifestSha256: string;
}>;

export type BackupRunnerOptions = Readonly<{
  key: Uint8Array;
  keyId: string;
  now?: () => Date;
}>;

export const createCriticalBackup = async (
  pool: Pool,
  options: BackupRunnerOptions,
  exportBundle: (pool: Pool) => Promise<BackupBundle> = exportCriticalStoreState
): Promise<BackupArtifact> => {
  const bundle = await exportBundle(pool);
  const encrypted = encryptBackupBundle(bundle, options.key, options.keyId);
  const bytes = Buffer.from(JSON.stringify(encrypted));
  const createdAt = (options.now ?? (() => new Date()))().toISOString().replace(/[:.]/gu, '-');
  return {
    key: 'backups/' + createdAt + '-' + bundle.manifest.manifestSha256 + '.json',
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    encrypted,
    sourceManifestSha256: bundle.manifest.manifestSha256,
  };
};
