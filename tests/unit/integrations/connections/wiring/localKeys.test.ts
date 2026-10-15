import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalSigningKeys, REVOKED_LOCAL_KEYS_FILE } from '@process/integrations/connections/wiring/localKeys';

const PUBLIC_KEY_FILE = 'repo-packager-ed25519.pub.pem';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-local-keys-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const open = () => createLocalSigningKeys(directory, () => ({ directory }));

describe('revoking the local signing key', () => {
  it('records the old key as revoked, creates a new one, and trusts only the new one', async () => {
    const keys = open();
    const first = await keys.refresh();

    const result = await keys.revoke();

    expect(result.revokedKeyId).toBe(first.keyId);
    expect(result.keyId).not.toBe(first.keyId);
    expect(Object.keys(keys.trustedKeys)).toEqual([result.keyId]);
    expect(JSON.parse(await readFile(path.join(directory, REVOKED_LOCAL_KEYS_FILE), 'utf8'))).toEqual([first.keyId]);
  });

  it('never trusts a revoked key again, even when its public key file is restored', async () => {
    const keys = open();
    const first = await keys.refresh();
    const oldPublicKey = await readFile(path.join(directory, PUBLIC_KEY_FILE), 'utf8');
    await keys.revoke();
    await writeFile(path.join(directory, PUBLIC_KEY_FILE), oldPublicKey, 'utf8');

    const reopened = open();

    expect(reopened.trustedKeys).not.toHaveProperty(first.keyId);
    expect(Object.keys(reopened.trustedKeys)).toEqual([]);
    const current = await reopened.refresh();
    expect(current.keyId).not.toBe(first.keyId);
    expect(Object.keys(reopened.trustedKeys)).toEqual([current.keyId]);
  });

  it('refuses a revoked key that is still on disk, and only trusts local key ids', async () => {
    const keys = open();
    const first = await keys.refresh();
    await writeFile(path.join(directory, REVOKED_LOCAL_KEYS_FILE), JSON.stringify([first.keyId]), 'utf8');

    const reopened = open();
    await expect(reopened.refresh()).rejects.toThrow('revoked');
    expect(reopened.trustedKeys).toEqual({});
    expect(Object.keys(keys.trustedKeys).every((id) => id.startsWith('local:'))).toBe(true);
  });
});

describe('an unreadable revoked list fails closed', () => {
  it.each([
    ['malformed JSON', 'not json'],
    ['an entry that is not a local key id', JSON.stringify(['com.tomni.core'])],
    ['a list that is not an array', JSON.stringify({ revoked: [] })],
  ])('trusts nothing and refuses to load a key with %s', async (_label, content) => {
    const keys = open();
    await keys.refresh();
    await writeFile(path.join(directory, REVOKED_LOCAL_KEYS_FILE), content, 'utf8');

    const failing = open();

    expect(failing.trustedKeys).toEqual({});
    await expect(failing.refresh()).rejects.toThrow('cannot be read');
  });
});
