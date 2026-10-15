/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The local signing key as the package manager sees it (docs/platform/repotopackage-design.md section 9.1).
 *
 * `/repotopackage` signs with a key kept in `userData/tomny-keys`; `PackageManagerService` verifies `local-built`
 * packages with `localTrustedKeys`. The service is built synchronously and the key can be created later (first
 * packaging), so `trustedKeys` is one live record that is handed to the service once and filled in two steps:
 *
 * 1. at construction, from the public key pinned beside the private key (sync, read-only, creates nothing), so an
 *    already installed local package still verifies at startup;
 * 2. `refresh()` loads or creates the key from the private half (the authority), replaces the record's contents, and
 *    is awaited before a local package is registered.
 *
 * The key store itself (whether the private key is encrypted with the operating system keystore) is resolved only
 * inside `refresh()`, never at construction: the keystore is not reliably available before the app is ready, and a
 * different answer would pick a different key file.
 *
 * Revocation: `revoke()` records the current key id in `revoked-keys.json` (same folder), deletes the key files and
 * creates a new key. A revoked id never enters the record again, even when its public key file is restored. If the
 * revoked list cannot be read, no local key is trusted (fails closed) and `refresh()` rejects.
 *
 * The record only ever holds `local:` key ids, and the service refuses to verify a Store or first-party package with it.
 */

import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadOrCreateSigningIdentity,
  readPinnedPublicKeySync,
} from '@process/extensions/package-manager/repoPackaging';
import {
  removeLocalSigningKeyFiles,
  type LocalKeyStore,
} from '@process/extensions/package-manager/repoPackaging/signingKey';

/** The slice of Electron's `safeStorage` that the key store needs. */
export type KeychainLike = Readonly<{
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (cipher: Buffer) => string;
}>;

/** Where the key pair lives. A plain function of `userData`, so it is known before the keystore is. */
export const localKeyDirectory = (userDataDirectory: string): string => path.join(userDataDirectory, 'tomny-keys');

/** Revoked local key ids, one JSON array, beside the key files. */
export const REVOKED_LOCAL_KEYS_FILE = 'revoked-keys.json';
const LOCAL_KEY_ID = /^local:[0-9a-f]{16}$/;
const MAX_REVOKED_KEYS = 1000;

const UNREADABLE_REVOKED_LIST = 'The revoked local key list cannot be read; local packages are not trusted.';
const REVOKED_KEY_ON_DISK = 'The local signing key is revoked. Revoke it again to create a new key.';

/**
 * Reads the revoked key ids. A missing file means none were revoked. Anything else that is unreadable or malformed
 * throws, so the caller can refuse every local key instead of trusting one that may have been revoked.
 */
export const readRevokedLocalKeyIds = (directory: string): Set<string> => {
  let raw: string;
  try {
    raw = readFileSync(path.join(directory, REVOKED_LOCAL_KEYS_FILE), 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return new Set();
    throw new Error(UNREADABLE_REVOKED_LIST, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(UNREADABLE_REVOKED_LIST);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_REVOKED_KEYS ||
    !parsed.every((id): id is string => typeof id === 'string' && LOCAL_KEY_ID.test(id))
  ) {
    throw new Error(UNREADABLE_REVOKED_LIST);
  }
  return new Set(parsed as string[]);
};

const writeRevokedLocalKeyIds = async (directory: string, ids: ReadonlySet<string>): Promise<void> => {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, REVOKED_LOCAL_KEYS_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify([...ids].toSorted()), { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
};

/**
 * Key store of the machine: `<userData>/tomny-keys`, encrypted with the operating system keystore when it is
 * available and otherwise a file only the current user can read. `/repotopackage` and the package manager use this
 * one function so they can never look at two different keys.
 */
export const createLocalKeyStore = (userDataDirectory: string, keychain: KeychainLike): LocalKeyStore => ({
  directory: localKeyDirectory(userDataDirectory),
  ...(keychain.isEncryptionAvailable()
    ? {
        protect: (plain: Buffer) => keychain.encryptString(plain.toString('utf8')),
        unprotect: (cipher: Buffer) => Buffer.from(keychain.decryptString(cipher), 'utf8'),
      }
    : {}),
});

export type RevokedLocalKey = Readonly<{ revokedKeyId: string; keyId: string; fingerprint: string }>;

export type LocalSigningKeys = Readonly<{
  /** Live record `{ keyId: publicKeyPem }` for `PackageManagerService.localTrustedKeys`. Never written by callers. */
  trustedKeys: Record<string, string>;
  /** Loads (or creates) the key and makes it the only trusted local key. Concurrent calls share one load. */
  refresh: () => Promise<Readonly<{ keyId: string; fingerprint: string }>>;
  /** True for a revoked key id; for every key id when the revoked list cannot be read (fails closed). */
  isRevoked: (keyId: string) => boolean;
  /**
   * Revokes the current local key: its id is recorded as revoked, its key files are deleted, and a new key becomes the
   * only trusted one. Packages signed with the old key are not changed here; the caller must handle them.
   */
  revoke: () => Promise<RevokedLocalKey>;
}>;

export const createLocalSigningKeys = (directory: string, resolveStore: () => LocalKeyStore): LocalSigningKeys => {
  const trustedKeys: Record<string, string> = {};
  // Undefined when the list cannot be read: then nothing is trusted and refresh refuses.
  let revoked: Set<string> | undefined;
  try {
    revoked = readRevokedLocalKeyIds(directory);
  } catch {
    revoked = undefined;
  }
  const pinned = revoked === undefined ? undefined : readPinnedPublicKeySync(directory);
  if (pinned && !revoked?.has(pinned.keyId)) trustedKeys[pinned.keyId] = pinned.publicKeyPem;

  let loading: Promise<Readonly<{ keyId: string; fingerprint: string }>> | undefined;
  const refresh = (): Promise<Readonly<{ keyId: string; fingerprint: string }>> => {
    loading ??= (async () => {
      const known = revoked;
      if (known === undefined) throw new Error(UNREADABLE_REVOKED_LIST);
      const identity = await loadOrCreateSigningIdentity(resolveStore());
      if (known.has(identity.keyId)) throw new Error(REVOKED_KEY_ON_DISK);
      for (const keyId of Object.keys(trustedKeys)) delete trustedKeys[keyId];
      trustedKeys[identity.keyId] = identity.publicKeyPem;
      return { keyId: identity.keyId, fingerprint: identity.fingerprint };
    })().finally(() => {
      loading = undefined;
    });
    return loading;
  };

  const isRevoked = (keyId: string): boolean => revoked === undefined || revoked.has(keyId);

  let revoking: Promise<RevokedLocalKey> | undefined;
  const revoke = (): Promise<RevokedLocalKey> => {
    revoking ??= (async () => {
      // An in-flight load finishes first, so it cannot put the key being revoked back into the record.
      await loading?.catch((): undefined => undefined);
      const known = revoked;
      if (known === undefined) throw new Error(UNREADABLE_REVOKED_LIST);
      const current = await loadOrCreateSigningIdentity(resolveStore());
      // The list is written before anything is deleted: if the deletion fails, the key stays revoked.
      await writeRevokedLocalKeyIds(directory, new Set([...known, current.keyId]));
      known.add(current.keyId);
      delete trustedKeys[current.keyId];
      await removeLocalSigningKeyFiles(directory);
      const next = await refresh();
      return { revokedKeyId: current.keyId, keyId: next.keyId, fingerprint: next.fingerprint };
    })().finally(() => {
      revoking = undefined;
    });
    return revoking;
  };

  return { trustedKeys, refresh, isRevoked, revoke };
};
