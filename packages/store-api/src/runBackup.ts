import { createStoreDatabase } from './db.js';
import { readStoreApiConfig } from './config.js';
import { createCriticalBackup } from './backupJob.js';
import { createGcsBackupStore, createLocalBackupStore } from './backupStore.js';

const decodeKey = (value: string): Uint8Array => {
  const key = Buffer.from(value, 'base64');
  if (key.byteLength !== 32) throw new Error('BACKUP_KEY_INVALID');
  return key;
};

export const runCriticalBackup = async (
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<Readonly<{ key: string; sha256: string }>> => {
  const config = readStoreApiConfig(env);
  const keyValue = env.BACKUP_ENCRYPTION_KEY_B64;
  const keyId = env.BACKUP_ENCRYPTION_KEY_ID;
  if (!keyValue || !keyId) throw new Error('BACKUP_KEY_NOT_CONFIGURED');
  const database = createStoreDatabase(config.databaseUrl, {
    max: config.dbPoolMax,
    idleTimeoutMillis: config.dbIdleTimeoutMs,
    connectionTimeoutMillis: config.dbConnectionTimeoutMs,
  });
  try {
    const artifact = await createCriticalBackup(database.pool, { key: decodeKey(keyValue), keyId });
    if (config.nodeEnv === 'production') {
      const bucket = env.BACKUP_GCS_BUCKET;
      const token = env.BACKUP_GCS_ACCESS_TOKEN;
      if (!bucket || !token) throw new Error('BACKUP_STORAGE_NOT_CONFIGURED');
      const stored = await createGcsBackupStore({ bucket, accessToken: token }).create(artifact);
      return { key: stored.key, sha256: stored.sha256 };
    }
    const stored = await createLocalBackupStore().create(artifact);
    return { key: stored.key, sha256: stored.sha256 };
  } finally {
    await database.close();
  }
};

if (import.meta.main) console.log(JSON.stringify(await runCriticalBackup()));
