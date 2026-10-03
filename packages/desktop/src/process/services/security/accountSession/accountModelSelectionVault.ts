import { app } from 'electron';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { AccountSessionError } from './types';
import { defaultAccountSessionVaultCodec, type AccountSessionVaultCodec } from './accountSessionVault';

const FILE_PREFIX = 'hub-model-selection.';
const FILE_SUFFIX = '.v1.json';
const MAX_DOCUMENT_BYTES = 32 * 1024;

export type AccountHubModelSelection = Readonly<{
  schemaVersion: 1;
  accountId: string;
  targetId: string;
  modelKey: string;
  updatedAt: string;
}>;

export type AccountModelSelectionVault = Readonly<{
  load(accountId: string): Promise<AccountHubModelSelection | undefined>;
  save(selection: AccountHubModelSelection): Promise<void>;
  clear(accountId: string): Promise<void>;
}>;

export type AccountModelSelectionVaultOptions = Readonly<{
  rootDir?: string;
  codec?: AccountSessionVaultCodec;
}>;

const isBoundedIdentifier = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/\p{Cc}/u.test(value);

const assertSelection: (value: unknown) => asserts value is AccountHubModelSelection = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Hub model selection is invalid.');
  }
  const record = value as Record<string, unknown>;
  const expected = ['schemaVersion', 'accountId', 'targetId', 'modelKey', 'updatedAt'];
  if (
    Object.keys(record).length !== expected.length ||
    Object.keys(record).some((key) => !expected.includes(key)) ||
    record.schemaVersion !== 1 ||
    !isBoundedIdentifier(record.accountId) ||
    !isBoundedIdentifier(record.targetId) ||
    !isBoundedIdentifier(record.modelKey, 2_048) ||
    !isBoundedIdentifier(record.updatedAt, 64) ||
    !Number.isFinite(Date.parse(record.updatedAt as string))
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Hub model selection fields are invalid.');
  }
};

const selectionFileName = (accountId: string): string => {
  if (!isBoundedIdentifier(accountId)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Hub model selection account is invalid.');
  }
  return `${FILE_PREFIX}${createHash('sha256').update(accountId, 'utf8').digest('hex')}${FILE_SUFFIX}`;
};

const resolveRoot = (options: AccountModelSelectionVaultOptions): string => {
  const root = options.rootDir ?? path.join(app.getPath('userData'), 'account-model-selections');
  if (!path.isAbsolute(root)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Hub model selection root must be absolute.');
  }
  return root;
};

/**
 * Account-bound model selections are encrypted even though they are not
 * credentials. A selection is metadata about an account's provider usage and
 * must not survive an account mismatch or bypass OS protected storage.
 */
export const createAccountModelSelectionVault = (
  options: AccountModelSelectionVaultOptions = {}
): AccountModelSelectionVault => {
  const root = resolveRoot(options);
  const load = async (accountId: string): Promise<AccountHubModelSelection | undefined> => {
    let raw: string;
    const filePath = path.join(root, selectionFileName(accountId));
    const codec = options.codec ?? defaultAccountSessionVaultCodec;
    if (!codec.isAvailable()) {
      throw new AccountSessionError(
        'ACCOUNT_SESSION_PROTECTED_STORAGE_UNAVAILABLE',
        'Protected storage is unavailable.'
      );
    }
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_UNAVAILABLE', 'Hub model selection cannot be read.', {
        cause: error,
      });
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Hub model selection exceeds its size limit.');
    }
    // The generic account-session vault validates its own record schema, so it
    // cannot read this separate document. Keep encrypted document parsing local.
    let document: unknown;
    try {
      document = JSON.parse(raw);
    } catch (error) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Hub model selection is malformed.', {
        cause: error,
      });
    }
    if (
      document === null ||
      typeof document !== 'object' ||
      Array.isArray(document) ||
      Object.keys(document).length !== 2 ||
      (document as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      !isBoundedIdentifier((document as { ciphertext?: unknown }).ciphertext, MAX_DOCUMENT_BYTES)
    ) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Hub model selection format is invalid.');
    }
    let selection: AccountHubModelSelection;
    try {
      const value: unknown = JSON.parse(codec.decrypt((document as { ciphertext: string }).ciphertext));
      assertSelection(value);
      selection = value;
    } catch (error) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_CORRUPT', 'Hub model selection cannot be decrypted.', {
        cause: error,
      });
    }
    return selection.accountId === accountId ? selection : undefined;
  };

  const save = async (selection: AccountHubModelSelection): Promise<void> => {
    assertSelection(selection);
    const codec = options.codec ?? defaultAccountSessionVaultCodec;
    if (!codec.isAvailable()) {
      throw new AccountSessionError(
        'ACCOUNT_SESSION_PROTECTED_STORAGE_UNAVAILABLE',
        'Protected storage is unavailable.'
      );
    }
    const filePath = path.join(root, selectionFileName(selection.accountId));
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    const output = JSON.stringify({ schemaVersion: 1, ciphertext: codec.encrypt(JSON.stringify(selection)) });
    if (Buffer.byteLength(output, 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Hub model selection exceeds its size limit.');
    }
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, output, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch((): undefined => undefined);
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_UNAVAILABLE', 'Hub model selection cannot be saved.', {
        cause: error,
      });
    }
  };

  const clear = async (accountId: string): Promise<void> => {
    try {
      await rm(path.join(root, selectionFileName(accountId)), { force: true });
    } catch (error) {
      throw new AccountSessionError('ACCOUNT_SESSION_STORAGE_UNAVAILABLE', 'Hub model selection cannot be cleared.', {
        cause: error,
      });
    }
  };

  return { load, save, clear };
};
