import { app, safeStorage } from 'electron';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AccountSessionError, assertAuthenticatedAccountSession, type AuthenticatedAccountSession } from './types';

const FILE_NAME = 'account-session.v1.json';
const MAX_RECORD_BYTES = 256 * 1024;

export type AccountSessionVaultCodec = Readonly<{
  isAvailable(): boolean;
  encrypt(plainText: string): string;
  decrypt(cipherText: string): string;
}>;

export type AccountSessionVaultOptions = Readonly<{
  rootDir?: string;
  filePath?: string;
  codec?: AccountSessionVaultCodec;
}>;

export type AccountSessionVault = Readonly<{
  load(): Promise<AuthenticatedAccountSession | undefined>;
  save(session: AuthenticatedAccountSession): Promise<void>;
  clear(): Promise<void>;
}>;

type EncryptedDocument = Readonly<{ schemaVersion: 1; ciphertext: string }>;

/** Shared OS protected-storage codec for secret-free account-bound metadata. */
export const defaultAccountSessionVaultCodec: AccountSessionVaultCodec = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plainText) => safeStorage.encryptString(plainText).toString('base64'),
  decrypt: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, 'base64')),
};

const isEncryptedDocument = (value: unknown): value is EncryptedDocument => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.schemaVersion === 1 &&
    typeof record.ciphertext === 'string' &&
    record.ciphertext.length > 0 &&
    record.ciphertext.length <= MAX_RECORD_BYTES
  );
};

const resolvePath = (options: AccountSessionVaultOptions): string => {
  if (options.filePath !== undefined && options.rootDir !== undefined) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Account vault path options are mutually exclusive.');
  }
  const filePath = options.filePath ?? path.join(options.rootDir ?? app.getPath('userData'), FILE_NAME);
  if (!path.isAbsolute(filePath)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Account vault path must be absolute.');
  }
  return filePath;
};

const requireProtectedStorage = (codec: AccountSessionVaultCodec): void => {
  if (!codec.isAvailable()) {
    throw new AccountSessionError(
      'ACCOUNT_SESSION_PROTECTED_STORAGE_UNAVAILABLE',
      'OS protected storage is unavailable; account sessions cannot be persisted.'
    );
  }
};

/**
 * Encrypted durable storage for desktop OIDC session material. There is no
 * plaintext or base64 fallback: unavailable OS protection fails closed.
 */
export const createAccountSessionVault = (options: AccountSessionVaultOptions = {}): AccountSessionVault => {
  const filePath = resolvePath(options);
  const codec = options.codec ?? defaultAccountSessionVaultCodec;

  const load = async (): Promise<AuthenticatedAccountSession | undefined> => {
    requireProtectedStorage(codec);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_UNAVAILABLE', 'Account vault cannot be read.', {
        cause: error,
      });
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Account vault exceeds its size limit.');
    }
    let document: unknown;
    try {
      document = JSON.parse(raw);
    } catch (error) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Account vault is malformed.', { cause: error });
    }
    if (!isEncryptedDocument(document)) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Account vault format is invalid.');
    }
    let value: unknown;
    try {
      value = JSON.parse(codec.decrypt(document.ciphertext));
    } catch (error) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Account vault cannot be decrypted.', {
        cause: error,
      });
    }
    try {
      assertAuthenticatedAccountSession(value);
      return value;
    } catch (error) {
      if (error instanceof AccountSessionError) {
        throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Account vault contents are invalid.', {
          cause: error,
        });
      }
      throw error;
    }
  };

  const save = async (session: AuthenticatedAccountSession): Promise<void> => {
    requireProtectedStorage(codec);
    assertAuthenticatedAccountSession(session);
    const serialized = JSON.stringify(session);
    const document: EncryptedDocument = { schemaVersion: 1, ciphertext: codec.encrypt(serialized) };
    const output = JSON.stringify(document);
    if (Buffer.byteLength(output, 'utf8') > MAX_RECORD_BYTES) {
      throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Account session exceeds its size limit.');
    }
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, output, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch((): undefined => undefined);
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_UNAVAILABLE', 'Account vault cannot be saved.', {
        cause: error,
      });
    }
  };

  const clear = async (): Promise<void> => {
    try {
      await rm(filePath, { force: true });
    } catch (error) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_UNAVAILABLE', 'Account vault cannot be cleared.', {
        cause: error,
      });
    }
  };

  return { load, save, clear };
};
