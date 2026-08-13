/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Credential vault for the Automation feature.
 *
 * Stores tokens, passwords, and other secrets encrypted with AES-256-GCM so
 * they can be reused across multiple workflows without being exposed when a
 * template is shared. Each field value is encrypted individually; the
 * credential metadata (id, name, kind, timestamps) is stored in plain text so
 * the list can be displayed without decrypting.
 *
 * Encryption key derivation:
 *   1. Prefer an explicitly injected `encryptionKey` (32-byte Buffer) — used by
 *      tests to keep the key deterministic.
 *   2. Fall back to SHA-256 of the machine-id string obtained from
 *      `app.getPath('userData')` (stable per installation, never leaves the
 *      machine).
 *
 * Persistence: `automation-credentials.json` in the Electron `userData`
 * directory. Writes are atomic (tmp → rename) following the same convention as
 * `automationStore`.
 *
 * Testability: `dir`, `fs`, `now`, `newId`, and `encryptionKey` are all
 * injectable via {@link CredentialStoreOptions}.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single stored credential entry. Field values are kept encrypted on disk. */
export type Credential = {
  /** Stable identifier (UUID). */
  id: string;
  /** Human-readable display name, e.g. "Facebook Page Token". */
  name: string;
  /** Category hint for the UI. */
  kind: 'token' | 'smtp' | 's3' | 'webdav' | 'generic';
  /**
   * Encrypted field values. Keys are plain text (e.g. "accessToken"); values
   * are the AES-256-GCM ciphertext encoded as `<iv_hex>:<authTag_hex>:<ct_hex>`.
   */
  fields: Record<string, string>;
  /** Unix timestamp (ms) when the credential was first created. */
  createdAt: number;
  /** Unix timestamp (ms) of the last update. */
  updatedAt: number;
};

/** Public contract of the credential store. */
export type ICredentialStore = {
  /** Return all stored credentials (fields remain encrypted). */
  list(): Promise<Credential[]>;
  /** Find one credential by id (fields remain encrypted), or `undefined`. */
  get(id: string): Promise<Credential | undefined>;
  /**
   * Upsert a credential. A known `id` replaces the existing entry (preserving
   * `createdAt`, bumping `updatedAt`); a missing/blank `id` inserts a new entry.
   * Plain-text values in `fields` are encrypted before persisting.
   * Returns the persisted credential (fields encrypted).
   */
  save(cred: Partial<Credential> & { name: string; kind: Credential['kind'] }): Promise<Credential>;
  /** Remove a credential by id. Returns the updated list. */
  remove(id: string): Promise<Credential[]>;
  /**
   * Return the decrypted field map for a credential, or `undefined` if the
   * credential does not exist. Individual fields that fail to decrypt yield an
   * empty string rather than throwing.
   */
  getDecrypted(id: string): Promise<Record<string, string> | undefined>;
};

// ---------------------------------------------------------------------------
// DI options
// ---------------------------------------------------------------------------

/** Minimal subset of `fs/promises` used here (injectable for tests). */
export type CredentialFs = {
  readFile(filePath: string, encoding: 'utf-8'): Promise<string>;
  writeFile(filePath: string, data: string, options: { encoding: 'utf-8'; mode?: number }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(dirPath: string, options: { recursive: true }): Promise<string | undefined>;
};

/** OS-backed secret codec. Production uses Electron safeStorage; tests inject a deterministic fake. */
export type CredentialCrypto = {
  isAvailable(): boolean;
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
};

/** Construction options for {@link createCredentialStore}. */
export type CredentialStoreOptions = {
  /** Directory the data file lives in. Defaults to the Electron `userData` dir. */
  dir?: string;
  /** File-system implementation. Injectable for tests; defaults to `fs/promises`. */
  fs?: CredentialFs;
  /** OS-backed secret codec. Defaults to Electron safeStorage. */
  crypto?: CredentialCrypto;
  /** Clock for `createdAt`/`updatedAt`. Defaults to `Date.now`. */
  now?: () => number;
  /** Id generator. Defaults to `crypto.randomUUID`. */
  newId?: () => string;
  /**
   * 32-byte AES-256 key. When provided, skips the machine-id derivation.
   * Intended for tests that need a deterministic key.
   */
  encryptionKey?: Buffer;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Name of the persisted document inside the app data directory. */
const CREDENTIAL_DATA_FILE = 'automation-credentials.json';

/** AES-256-GCM IV length in bytes. */
const IV_BYTES = 12;

/** AES-256-GCM auth-tag length in bytes. */
const AUTH_TAG_BYTES = 16;

const OS_FIELD_PREFIX = 'os:v1:';
const LEGACY_FIELD_PATTERN = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/iu;

// ---------------------------------------------------------------------------
// Default fs adapter
// ---------------------------------------------------------------------------

const defaultFs: CredentialFs = {
  readFile: (filePath, encoding) => fs.promises.readFile(filePath, encoding),
  writeFile: (filePath, data, options) => fs.promises.writeFile(filePath, data, options),
  rename: (oldPath, newPath) => fs.promises.rename(oldPath, newPath),
  mkdir: (dirPath, options) => fs.promises.mkdir(dirPath, options),
};

// ---------------------------------------------------------------------------
const defaultCrypto: CredentialCrypto = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
};

// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte AES-256 key from the machine seed.
 * Uses SHA-256 of the `userData` path as a stable, machine-local secret.
 */
const deriveKey = (dir: string): Buffer => {
  const seed = dir; // stable per installation
  return createHash('sha256').update(seed).digest();
};

// ---------------------------------------------------------------------------
// Encrypt / decrypt helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt a plain-text string with AES-256-GCM.
 * Returns `<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 */
const encryptField = (plaintext: string, key: Buffer): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
};

/**
 * Decrypt a value produced by {@link encryptField}.
 * Returns the plain-text string, or `null` on any failure (wrong key, corrupt
 * data, auth-tag mismatch).
 */
const decryptField = (encoded: string, key: Buffer): string | null => {
  try {
    const parts = encoded.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct).toString('utf-8') + decipher.final('utf-8');
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Defensive normalisation
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const CREDENTIAL_KINDS: readonly Credential['kind'][] = ['token', 'smtp', 's3', 'webdav', 'generic'];
const isCredentialKind = (v: unknown): v is Credential['kind'] =>
  typeof v === 'string' && (CREDENTIAL_KINDS as readonly string[]).includes(v);

/** Coerce an unknown record into a valid {@link Credential}, or `null` to drop it. */
const normaliseCredential = (v: unknown, now: number): Credential | null => {
  if (!isObject(v) || typeof v.name !== 'string' || !isCredentialKind(v.kind)) return null;
  const rawFields = isObject(v.fields) ? v.fields : {};
  const fields: Record<string, string> = {};
  for (const [k, val] of Object.entries(rawFields)) {
    if (typeof val === 'string') fields[k] = val;
  }
  return {
    id: typeof v.id === 'string' && v.id.length > 0 ? v.id : randomUUID(),
    name: v.name,
    kind: v.kind,
    fields,
    createdAt: num(v.createdAt) ?? now,
    updatedAt: num(v.updatedAt) ?? now,
  };
};

/** Coerce an arbitrary parsed JSON value into a valid credential list. */
const normaliseList = (parsed: unknown, now: number): Credential[] => {
  if (!Array.isArray(parsed)) return [];
  return parsed.map((c) => normaliseCredential(c, now)).filter((c): c is Credential => c !== null);
};

const isFileNotFound = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a credential store rooted at the given directory (defaults to
 * `userData`).
 *
 * The store caches the credential list in memory after the first read and
 * persists atomically after each mutation.
 *
 * @param options Dependency-injection overrides (dir, fs, now, newId, encryptionKey).
 */
export const createCredentialStore = (options?: CredentialStoreOptions): ICredentialStore => {
  const nowFn = options?.now ?? Date.now;
  const newId = options?.newId ?? randomUUID;
  const fsImpl = options?.fs ?? defaultFs;
  const cryptoImpl = options?.crypto ?? defaultCrypto;
  const useLegacyEncryption = options?.encryptionKey !== undefined;

  // Resolve the data directory lazily so callers that inject `dir` never
  // trigger a live Electron `app` call.
  const resolveDir = (): string => options?.dir ?? app.getPath('userData');

  // The legacy key remains available only for explicit compatibility mode and
  // one-time migration of path-derived ciphertext.
  let legacyKey: Buffer | undefined = options?.encryptionKey;
  const getLegacyKey = (): Buffer => {
    if (!legacyKey) legacyKey = deriveKey(resolveDir());
    return legacyKey;
  };

  const requireOsEncryption = (): void => {
    if (!cryptoImpl.isAvailable()) throw new Error('OS credential encryption is unavailable');
  };

  const protectField = (plain: string): string => {
    if (useLegacyEncryption) return encryptField(plain, getLegacyKey());
    requireOsEncryption();
    return `${OS_FIELD_PREFIX}${cryptoImpl.encrypt(plain)}`;
  };

  const revealField = (encoded: string): string | null => {
    if (useLegacyEncryption) return decryptField(encoded, getLegacyKey());
    requireOsEncryption();
    if (encoded.startsWith(OS_FIELD_PREFIX)) {
      try {
        return cryptoImpl.decrypt(encoded.slice(OS_FIELD_PREFIX.length));
      } catch {
        return null;
      }
    }
    return decryptField(encoded, getLegacyKey());
  };

  const filePath = (): string => path.join(resolveDir(), CREDENTIAL_DATA_FILE);

  let cache: Credential[] = [];
  let loaded = false;

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  const persist = async (next: Credential[]): Promise<Credential[]> => {
    if (!useLegacyEncryption) requireOsEncryption();
    cache = next;
    const fp = filePath();
    const dir = path.dirname(fp);
    const tmpPath = `${fp}.tmp`;
    await fsImpl.mkdir(dir, { recursive: true });
    await fsImpl.writeFile(tmpPath, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
    await fsImpl.rename(tmpPath, fp);
    return next;
  };

  const migrateFieldsToOsProtection = async (): Promise<void> => {
    let changed = false;
    const migrated = cache.map((credential) => {
      let credentialChanged = false;
      const fields: Record<string, string> = {};
      for (const [key, encoded] of Object.entries(credential.fields)) {
        if (encoded.startsWith(OS_FIELD_PREFIX)) {
          fields[key] = encoded;
          continue;
        }

        const legacyPlain = decryptField(encoded, getLegacyKey());
        if (LEGACY_FIELD_PATTERN.test(encoded) && legacyPlain === null) {
          throw new Error('Legacy credential decryption failed');
        }
        fields[key] = protectField(legacyPlain ?? encoded);
        credentialChanged = true;
      }
      if (!credentialChanged) return credential;
      changed = true;
      return { ...credential, fields };
    });
    if (changed) await persist(migrated);
  };

  const load = async (): Promise<Credential[]> => {
    if (!useLegacyEncryption) requireOsEncryption();
    try {
      const raw = await fsImpl.readFile(filePath(), 'utf-8');
      cache = normaliseList(JSON.parse(raw) as unknown, nowFn());
      if (!useLegacyEncryption) await migrateFieldsToOsProtection();
    } catch (error) {
      if (!isFileNotFound(error) && !useLegacyEncryption) throw error;
      if (!isFileNotFound(error)) {
        console.warn('[CredentialStore] Failed to read automation-credentials.json; using empty list:', error);
      }
      cache = [];
    }
    loaded = true;
    return cache;
  };

  const ensureLoaded = async (): Promise<void> => {
    if (!loaded) await load();
  };

  // -------------------------------------------------------------------------
  // Field encryption helpers
  // -------------------------------------------------------------------------

  /** Encrypt all incoming plaintext values. Existing encrypted fields are merged separately. */
  const encryptFields = (fields: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      result[key] = protectField(value);
    }
    return result;
  };

  /** Decrypt all values. Fields that fail authentication yield an empty string. */
  const decryptFields = (fields: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      result[key] = revealField(value) ?? '';
    }
    return result;
  };

  // -------------------------------------------------------------------------  // Store implementation
  // -------------------------------------------------------------------------

  return {
    async list() {
      await ensureLoaded();
      return cache;
    },

    async get(id) {
      await ensureLoaded();
      return cache.find((c) => c.id === id);
    },

    async save(cred) {
      await ensureLoaded();
      const ts = nowFn();
      const existing = cred.id ? cache.find((c) => c.id === cred.id) : undefined;

      const mergedFields = {
        ...existing?.fields,
        ...encryptFields(cred.fields ?? {}),
      };

      const next: Credential = {
        id: existing?.id ?? (cred.id && cred.id.length > 0 ? cred.id : newId()),
        name: cred.name,
        kind: cred.kind,
        fields: mergedFields,
        createdAt: existing?.createdAt ?? cred.createdAt ?? ts,
        updatedAt: ts,
      };

      const list = existing ? cache.map((c) => (c.id === next.id ? next : c)) : [...cache, next];
      await persist(list);
      return next;
    },

    async remove(id) {
      await ensureLoaded();
      return persist(cache.filter((c) => c.id !== id));
    },

    async getDecrypted(id) {
      await ensureLoaded();
      const cred = cache.find((c) => c.id === id);
      if (!cred) return undefined;
      return decryptFields(cred.fields);
    },
  };
};
