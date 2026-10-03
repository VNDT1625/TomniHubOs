import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { verifyBackupManifest, type BackupManifest } from './backup.js';
import type { BackupBundle } from './backupExport.js';

export type EncryptedBackup = Readonly<{
  algorithm: 'aes-256-gcm';
  keyId: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
  plaintextSha256: string;
}>;

export const encryptBackupBundle = (bundle: BackupBundle, key: Uint8Array, keyId: string): EncryptedBackup => {
  if (key.byteLength !== 32 || !keyId.trim()) throw new Error('BACKUP_KEY_INVALID');
  const plaintext = Buffer.from(
    JSON.stringify({
      manifest: bundle.manifest,
      files: bundle.files.map((file) => ({ name: file.name, bytes: Buffer.from(file.bytes).toString('base64') })),
    })
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    keyId,
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    plaintextSha256: createHash('sha256').update(plaintext).digest('hex'),
  };
};

export const decryptBackupBundle = (encrypted: EncryptedBackup, key: Uint8Array): BackupBundle => {
  if (encrypted.algorithm !== 'aes-256-gcm' || key.byteLength !== 32) throw new Error('BACKUP_KEY_INVALID');
  const nonce = Buffer.from(encrypted.nonce, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]);
  if (createHash('sha256').update(plaintext).digest('hex') !== encrypted.plaintextSha256)
    throw new Error('BACKUP_PLAINTEXT_HASH_MISMATCH');
  const value = JSON.parse(plaintext.toString('utf8')) as {
    manifest: BackupManifest;
    files: readonly { name: string; bytes: string }[];
  };
  const files = value.files.map((file) => ({ name: file.name, bytes: Buffer.from(file.bytes, 'base64') }));
  verifyBackupManifest(value.manifest, files);
  return { manifest: value.manifest, files };
};
