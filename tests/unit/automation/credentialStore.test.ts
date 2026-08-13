/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the Automation credential vault: round-trip encryption, partial
 * update without double-encrypt, and decrypt-failure tolerance.
 */

import { describe, expect, it } from 'vitest';

import { createHash } from 'node:crypto';

import path from 'node:path';
import { createCredentialStore, type CredentialCrypto, type CredentialFs } from '@/process/automation/credentialStore';

/** In-memory fs adapter for deterministic, disk-free tests. */
const memFs = () => {
  const files = new Map<string, string>();
  const fs: CredentialFs = {
    readFile: (p) =>
      files.has(p)
        ? Promise.resolve(files.get(p) as string)
        : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    writeFile: (p, data) => {
      files.set(p, data);
      return Promise.resolve();
    },
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(undefined),
  };
  return { files, fs };
};

const osCrypto = (available = true): CredentialCrypto => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(`protected:${plain}`, 'utf-8').toString('base64'),
  decrypt: (encoded) => {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    if (!decoded.startsWith('protected:')) throw new Error('not protected');
    return decoded.slice('protected:'.length);
  },
});

const CREDENTIAL_DIR = '/tmp/creds';
const CREDENTIAL_FILE = path.join(CREDENTIAL_DIR, 'automation-credentials.json');

const KEY = Buffer.alloc(32, 7); // deterministic 32-byte test key

const makeStore = () => {
  const { fs } = memFs();
  return createCredentialStore({
    dir: CREDENTIAL_DIR,
    fs,
    encryptionKey: KEY,
    newId: (() => {
      let i = 0;
      return () => `c${++i}`;
    })(),
  });
};

describe('credentialStore', () => {
  it('saves a credential and decrypts the fields back', async () => {
    const store = makeStore();
    const saved = await store.save({ name: 'FB Token', kind: 'token', fields: { accessToken: 'secret-123' } });
    expect(saved.id).toBe('c1');
    // The persisted field must be encrypted (not plain text).
    expect(saved.fields.accessToken).not.toBe('secret-123');
    expect(saved.fields.accessToken.split(':')).toHaveLength(3);

    const decrypted = await store.getDecrypted('c1');
    expect(decrypted).toEqual({ accessToken: 'secret-123' });
  });

  it('lists credentials with fields still encrypted', async () => {
    const store = makeStore();
    await store.save({ name: 'SMTP', kind: 'smtp', fields: { password: 'pw' } });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].fields.password).not.toBe('pw');
  });

  it('does not double-encrypt on partial update', async () => {
    const store = makeStore();
    const first = await store.save({ name: 'S3', kind: 's3', fields: { accessKeyId: 'AKIA', secretAccessKey: 'shh' } });
    // Update only the name; fields omitted should remain decryptable.
    await store.save({ id: first.id, name: 'S3 renamed', kind: 's3' });
    const decrypted = await store.getDecrypted(first.id);
    expect(decrypted).toEqual({ accessKeyId: 'AKIA', secretAccessKey: 'shh' });
  });

  it('removes a credential', async () => {
    const store = makeStore();
    const c = await store.save({ name: 'X', kind: 'generic', fields: { v: '1' } });
    const after = await store.remove(c.id);
    expect(after).toHaveLength(0);
    expect(await store.get(c.id)).toBeUndefined();
  });

  it('migrates legacy path-derived ciphertext to OS-protected fields without losing data', async () => {
    const { files, fs } = memFs();
    const legacy = createCredentialStore({
      dir: CREDENTIAL_DIR,
      fs,
      encryptionKey: createHash('sha256').update(CREDENTIAL_DIR).digest(),
      newId: () => 'legacy',
    });
    await legacy.save({ name: 'Legacy', kind: 'token', fields: { token: 'keep-me' } });
    const before = files.get(CREDENTIAL_FILE);

    const migrated = createCredentialStore({ dir: CREDENTIAL_DIR, fs, crypto: osCrypto() });
    const listed = await migrated.list();

    expect(listed[0].fields.token).toMatch(/^os:v1:/u);
    expect(await migrated.getDecrypted('legacy')).toEqual({ token: 'keep-me' });
    expect(files.get(CREDENTIAL_FILE)).not.toBe(before);
  });

  it('fails closed and preserves legacy data when OS encryption is unavailable', async () => {
    const { files, fs } = memFs();
    const legacy = createCredentialStore({ dir: CREDENTIAL_DIR, fs, encryptionKey: KEY, newId: () => 'legacy' });
    await legacy.save({ name: 'Legacy', kind: 'token', fields: { token: 'keep-me' } });
    const before = files.get(CREDENTIAL_FILE);

    const unavailable = createCredentialStore({ dir: CREDENTIAL_DIR, fs, crypto: osCrypto(false) });
    await expect(unavailable.list()).rejects.toThrow('OS credential encryption is unavailable');
    expect(files.get(CREDENTIAL_FILE)).toBe(before);
  });

  it('encrypts colon-delimited plaintext instead of mistaking it for ciphertext', async () => {
    const { fs } = memFs();
    const store = createCredentialStore({ dir: CREDENTIAL_DIR, fs, crypto: osCrypto(), newId: () => 'url' });
    await store.save({ name: 'Endpoint', kind: 'generic', fields: { endpoint: 'https://example.com:443/path' } });
    expect(await store.getDecrypted('url')).toEqual({ endpoint: 'https://example.com:443/path' });
  });

  it('yields empty string for a field that cannot be decrypted (wrong key)', async () => {
    const { fs } = memFs();
    const store1 = createCredentialStore({
      dir: CREDENTIAL_DIR,
      fs,
      encryptionKey: Buffer.alloc(32, 1),
      newId: () => 'fixed',
    });
    await store1.save({ name: 'X', kind: 'token', fields: { t: 'value' } });
    // A second store with a DIFFERENT key reading the same fs cannot decrypt.
    const store2 = createCredentialStore({ dir: CREDENTIAL_DIR, fs, encryptionKey: Buffer.alloc(32, 2) });
    const decrypted = await store2.getDecrypted('fixed');
    expect(decrypted).toEqual({ t: '' });
  });
});
