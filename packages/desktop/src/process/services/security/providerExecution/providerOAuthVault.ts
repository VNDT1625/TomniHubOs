import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProviderOAuthTokenSet, ProviderOAuthVault } from './providerOAuthClient';

const FILE_NAME = 'provider-oauth.v1.json';
const MAX_RECORD_BYTES = 512 * 1024;
const MAX_PROVIDERS = 64;

type OAuthRecord = Readonly<{
  providerId: string;
  actorId: string;
  tokens: ProviderOAuthTokenSet;
}>;
type EncryptedDocument = Readonly<{ schemaVersion: 1; ciphertext: string }>;

export type ProviderOAuthVaultCodec = Readonly<{
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}>;

export type ProviderOAuthVaultOptions = Readonly<{
  filePath?: string;
  rootDir?: string;
  actorId: () => string;
  codec?: ProviderOAuthVaultCodec;
}>;

const defaultCodec: ProviderOAuthVaultCodec = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
};

const boundedId = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /\p{Cc}/u.test(trimmed)) throw new Error(`Invalid OAuth ${label}.`);
  return trimmed;
};

const resolvePath = (options: ProviderOAuthVaultOptions): string => {
  if (options.filePath !== undefined && options.rootDir !== undefined) {
    throw new Error('Provider OAuth vault path options are mutually exclusive.');
  }
  const filePath = options.filePath ?? path.join(options.rootDir ?? app.getPath('userData'), FILE_NAME);
  if (!path.isAbsolute(filePath)) throw new Error('Provider OAuth vault path must be absolute.');
  return filePath;
};

const requireProtectedStorage = (codec: ProviderOAuthVaultCodec): void => {
  if (!codec.isAvailable()) throw new Error('Secure credential storage is unavailable.');
};

const isDocument = (value: unknown): value is EncryptedDocument => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.schemaVersion === 1 &&
    typeof record.ciphertext === 'string' &&
    record.ciphertext.length > 0 &&
    record.ciphertext.length <= MAX_RECORD_BYTES
  );
};

const isTokenSet = (value: unknown): value is ProviderOAuthTokenSet => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.providerId === 'string' &&
    typeof record.accessToken === 'string' &&
    record.accessToken.length > 0 &&
    record.accessToken.length <= 16 * 1024 &&
    typeof record.expiresAt === 'number' &&
    Number.isSafeInteger(record.expiresAt) &&
    record.expiresAt > 0 &&
    typeof record.scope === 'string' &&
    record.scope.length <= 2_048 &&
    (record.refreshToken === undefined ||
      (typeof record.refreshToken === 'string' && record.refreshToken.length <= 16 * 1024)) &&
    (record.accountId === undefined || (typeof record.accountId === 'string' && record.accountId.length <= 512))
  );
};

const isRecord = (value: unknown): value is OAuthRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    typeof record.providerId === 'string' &&
    typeof record.actorId === 'string' &&
    isTokenSet(record.tokens) &&
    record.tokens.providerId === record.providerId
  );
};

const parseRecords = (plain: string): OAuthRecord[] => {
  let value: unknown;
  try {
    value = JSON.parse(plain);
  } catch {
    throw new Error('Provider OAuth vault is malformed.');
  }
  if (!Array.isArray(value) || value.length > MAX_PROVIDERS || value.some((item) => !isRecord(item))) {
    throw new Error('Provider OAuth vault format is invalid.');
  }
  return value;
};

/** Main-only, OS-encrypted OAuth token storage bound to the active account. */
export const createProviderOAuthVault = (options: ProviderOAuthVaultOptions): ProviderOAuthVault => {
  const filePath = resolvePath(options);
  const codec = options.codec ?? defaultCodec;
  let mutation = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutation.then(operation, operation);
    mutation = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  };
  const actor = (): string => boundedId(options.actorId(), 'account');

  const read = async (): Promise<OAuthRecord[]> => {
    requireProtectedStorage(codec);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('Provider OAuth vault cannot be read safely.', { cause: error });
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES)
      throw new Error('Provider OAuth vault exceeds its size limit.');
    let document: unknown;
    try {
      document = JSON.parse(raw);
    } catch (error) {
      throw new Error('Provider OAuth vault is malformed.', { cause: error });
    }
    if (!isDocument(document)) throw new Error('Provider OAuth vault format is invalid.');
    try {
      return parseRecords(codec.decrypt(document.ciphertext));
    } catch (error) {
      throw new Error('Provider OAuth vault cannot be decrypted.', { cause: error });
    }
  };

  const write = async (records: OAuthRecord[]): Promise<void> => {
    requireProtectedStorage(codec);
    if (records.length > MAX_PROVIDERS) throw new Error('Provider OAuth vault capacity has been reached.');
    const output = JSON.stringify({ schemaVersion: 1, ciphertext: codec.encrypt(JSON.stringify(records)) });
    if (Buffer.byteLength(output, 'utf8') > MAX_RECORD_BYTES)
      throw new Error('Provider OAuth vault exceeds its size limit.');
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, output, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch((): undefined => undefined);
      throw new Error('Provider OAuth vault cannot be saved safely.', { cause: error });
    }
  };

  return {
    load: async (providerId) => {
      const id = boundedId(providerId, 'provider');
      const currentActor = actor();
      const records = await read();
      return records.find((record) => record.providerId === id && record.actorId === currentActor)?.tokens;
    },
    save: (tokens) =>
      mutate(async () => {
        if (!isTokenSet(tokens)) throw new Error('Provider OAuth token set is invalid.');
        const providerId = boundedId(tokens.providerId, 'provider');
        const currentActor = actor();
        const records = (await read()).filter(
          (record) => !(record.providerId === providerId && record.actorId === currentActor)
        );
        await write([...records, { providerId, actorId: currentActor, tokens }]);
      }),
    remove: (providerId) =>
      mutate(async () => {
        const id = boundedId(providerId, 'provider');
        const currentActor = actor();
        const records = await read();
        const next = records.filter((record) => !(record.providerId === id && record.actorId === currentActor));
        if (next.length === 0) {
          await rm(filePath, { force: true });
          return;
        }
        if (next.length !== records.length) await write(next);
      }),
  };
};
