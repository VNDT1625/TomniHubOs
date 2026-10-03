import type { BackupArtifact } from './backupJob.js';

export type BackupObject = Readonly<{ key: string; sha256: string; size: number }>;
export type BackupArtifactStore = Readonly<{
  create: (artifact: BackupArtifact) => Promise<BackupObject>;
}>;

export const createLocalBackupStore = (objects = new Map<string, BackupObject>()): BackupArtifactStore => ({
  create: async (artifact) => {
    if (!/^backups\/[A-Za-z0-9._-]+\.json$/.test(artifact.key)) throw new Error('BACKUP_OBJECT_KEY_INVALID');
    const existing = objects.get(artifact.key);
    if (existing && existing.sha256 !== artifact.sha256) throw new Error('BACKUP_IMMUTABILITY_CONFLICT');
    const value = existing ?? { key: artifact.key, sha256: artifact.sha256, size: artifact.bytes.byteLength };
    objects.set(artifact.key, value);
    return value;
  },
});

export const createGcsBackupStore = (
  config: Readonly<{ bucket: string; accessToken: string; endpoint?: string }>,
  fetchImpl: typeof fetch = fetch
): BackupArtifactStore => {
  if (!config.bucket || !config.accessToken) throw new Error('BACKUP_STORAGE_NOT_CONFIGURED');
  const endpoint = new URL(config.endpoint ?? 'https://storage.googleapis.com');
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'storage.googleapis.com')
    throw new Error('BACKUP_ENDPOINT_INVALID');
  return {
    create: async (artifact) => {
      if (!artifact.key.startsWith('backups/')) throw new Error('BACKUP_OBJECT_KEY_INVALID');
      const response = await fetchImpl(
        `${endpoint.toString().replace(/\/$/u, '')}/upload/storage/v1/b/${encodeURIComponent(config.bucket)}/o?uploadType=media&name=${encodeURIComponent(artifact.key)}&ifGenerationMatch=0`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'content-type': 'application/octet-stream',
            'x-goog-meta-sha256': artifact.sha256,
          },
          body: Buffer.from(artifact.bytes),
        }
      );
      if (response.status === 412) {
        const existing = await fetchImpl(
          `${endpoint.toString().replace(/\/$/u, '')}/storage/v1/b/${encodeURIComponent(config.bucket)}/o/${encodeURIComponent(artifact.key)}`,
          { headers: { Authorization: `Bearer ${config.accessToken}` } }
        );
        if (!existing.ok) throw new Error('BACKUP_IMMUTABILITY_CONFLICT');
        const metadata = (await existing.json()) as { size?: string; metadata?: Record<string, string> };
        if (metadata.metadata?.sha256 !== artifact.sha256) throw new Error('BACKUP_IMMUTABILITY_CONFLICT');
        const size = Number(metadata.size);
        if (!Number.isSafeInteger(size) || size !== artifact.bytes.byteLength)
          throw new Error('BACKUP_IMMUTABILITY_CONFLICT');
        return { key: artifact.key, sha256: artifact.sha256, size };
      }
      if (!response.ok) throw new Error('BACKUP_UPLOAD_FAILED');
      return { key: artifact.key, sha256: artifact.sha256, size: artifact.bytes.byteLength };
    },
  };
};
