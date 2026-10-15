/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local Ed25519 signing identity for packages built from a repository.
 *
 * The key is created once, kept in a private directory, and reused, so every package carries the
 * same key id and the signature can be checked later with the public half. Installing through the
 * Store still requires a key the Store has enrolled; this local key only proves the package was not
 * altered after it was built on this machine.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RepoPackagingError } from './types';

export type SigningIdentity = Readonly<{
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
  /** SHA-256 of the public key, as lowercase hex. */
  fingerprint: string;
}>;

const KEY_FILE = 'repo-packager-ed25519.pem';
const PUBLIC_KEY_FILE = 'repo-packager-ed25519.pub.pem';
const MAX_KEY_ID_LENGTH = 128;
/**
 * Key ids of this machine's own packager. The `local:` prefix is what the package manager requires of a local key,
 * so a Store or first-party key id (which never contains it) cannot collide with one.
 */
const LOCAL_KEY_ID_PREFIX = 'local:';

const invalidKey = (message: string): RepoPackagingError => new RepoPackagingError('SIGNING_KEY_INVALID', message);

export const fingerprintOf = (publicKeyPem: string): string =>
  createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex');

const localKeyIdOf = (fingerprint: string): string => `${LOCAL_KEY_ID_PREFIX}${fingerprint.slice(0, 16)}`;

/**
 * Reads the public half pinned beside the private key, without creating anything and without touching the private
 * key. Returns undefined when no key was created yet or the file is not an Ed25519 public key. Used at startup, where
 * the package manager is built synchronously; `loadOrCreateSigningIdentity` stays the authority and is awaited
 * before a local package is registered.
 */
export const readPinnedPublicKeySync = (
  directory: string
): Readonly<{ keyId: string; publicKeyPem: string }> | undefined => {
  try {
    const publicKeyPem = readFileSync(path.join(directory, PUBLIC_KEY_FILE), 'utf8');
    if (createPublicKey(publicKeyPem).asymmetricKeyType !== 'ed25519') return undefined;
    return { keyId: localKeyIdOf(fingerprintOf(publicKeyPem)), publicKeyPem };
  } catch {
    return undefined;
  }
};

/** Builds an identity from a PKCS#8 Ed25519 private key; the public key is always derived from it. */
export const identityFromPrivateKey = (privateKeyPem: string, keyId: string): SigningIdentity => {
  if (keyId.trim() === '' || keyId.length > MAX_KEY_ID_LENGTH) throw invalidKey('Mã khoá ký không hợp lệ.');
  let privateKey: ReturnType<typeof createPrivateKey>;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch {
    throw invalidKey('Khoá ký không đọc được. Cần khoá riêng Ed25519 dạng PEM.');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw invalidKey('Khoá ký phải là Ed25519.');
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, privateKeyPem, publicKeyPem, fingerprint: fingerprintOf(publicKeyPem) };
};

export type LocalKeyStore = Readonly<{
  directory: string;
  /** Encrypts the private key before it is written (for example with the operating system keystore). */
  protect?: (plain: Buffer) => Buffer;
  unprotect?: (cipher: Buffer) => Buffer;
}>;

const isMissing = (error: unknown): boolean => (error as { code?: string }).code === 'ENOENT';
const alreadyExists = (error: unknown): boolean => (error as { code?: string }).code === 'EEXIST';

const readStoredKey = async (store: LocalKeyStore, file: string): Promise<string | undefined> => {
  let stored: Buffer;
  try {
    stored = await readFile(file);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (store.protect === undefined) return stored.toString('utf8');
  if (store.unprotect === undefined) throw invalidKey('Khoá ký được mã hoá nhưng không có cách giải mã.');
  try {
    return store.unprotect(stored).toString('utf8');
  } catch {
    throw invalidKey('Không giải mã được khoá ký đã lưu.');
  }
};

/** Returns the persistent identity, creating and storing it on first use. */
export const loadOrCreateSigningIdentity = async (store: LocalKeyStore): Promise<SigningIdentity> => {
  const file = path.join(store.directory, store.protect === undefined ? KEY_FILE : `${KEY_FILE}.enc`);
  await mkdir(store.directory, { recursive: true });

  const toIdentity = (privateKeyPem: string): SigningIdentity => {
    const probe = identityFromPrivateKey(privateKeyPem, 'probe');
    return { ...probe, keyId: localKeyIdOf(probe.fingerprint) };
  };

  const existing = await readStoredKey(store, file);
  if (existing !== undefined) return toIdentity(existing);

  const generated = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const payload =
    store.protect === undefined ? Buffer.from(generated, 'utf8') : store.protect(Buffer.from(generated, 'utf8'));
  try {
    // `wx` makes creation exclusive, so two processes cannot end up with different keys.
    await writeFile(file, payload, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!alreadyExists(error)) throw error;
    const winner = await readStoredKey(store, file);
    if (winner === undefined) throw invalidKey('Không đọc được khoá ký vừa được tạo.');
    return toIdentity(winner);
  }
  await chmod(file, 0o600).catch((): undefined => undefined);

  const identity = toIdentity(generated);
  await writeFile(path.join(store.directory, PUBLIC_KEY_FILE), identity.publicKeyPem, 'utf8').catch(
    (): undefined => undefined
  );
  return identity;
};

/**
 * Deletes the stored key pair (private key in either form, and the pinned public key). Used when the key is revoked:
 * the next `loadOrCreateSigningIdentity` then creates a new pair. Missing files are not an error.
 */
export const removeLocalSigningKeyFiles = async (directory: string): Promise<void> => {
  await Promise.all(
    [KEY_FILE, `${KEY_FILE}.enc`, PUBLIC_KEY_FILE].map((name) => rm(path.join(directory, name), { force: true }))
  );
};
