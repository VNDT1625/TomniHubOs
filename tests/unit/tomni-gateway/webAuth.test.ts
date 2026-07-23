import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TomniWebAuth } from '@process/tomnigateway/webAuth';

const directories: string[] = [];

const authFixture = async (): Promise<{ auth: TomniWebAuth; directory: string }> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-web-auth-'));
  directories.push(directory);
  return { auth: new TomniWebAuth(directory), directory };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('TomniWebAuth', () => {
  it('persists only a salted password hash and verifies revocable sessions', async () => {
    const { auth, directory } = await authFixture();
    expect(await auth.status()).toEqual({ needs_setup: true, username: 'admin' });

    const password = await auth.resetPassword();
    expect((await auth.status()).needs_setup).toBe(false);
    const stored = await readFile(path.join(directory, 'tomni-core', 'web-auth.json'), 'utf8');
    expect(stored).not.toContain(password);
    expect(stored).toContain('passwordHash');
    expect(stored).toContain('passwordSalt');

    const login = await auth.login('client-a', 'admin', password, false);
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    expect(await auth.verify(login.token)).toEqual({ id: 'tomni-admin', username: 'admin' });
    auth.logout(login.token);
    expect(await auth.verify(login.token)).toBeUndefined();
  });

  it('locks an identifier after five invalid attempts', async () => {
    const { auth } = await authFixture();
    await auth.resetPassword();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await auth.login('client-b', 'admin', 'wrong-password', false)).toEqual({ ok: false, status: 401 });
    }
    expect(await auth.login('client-b', 'admin', 'wrong-password', false)).toEqual(
      expect.objectContaining({ ok: false, status: 429 })
    );
  });

  it('rotates the signing secret and invalidates sessions when credentials change', async () => {
    const { auth } = await authFixture();
    const password = await auth.resetPassword();
    const login = await auth.login('client-c', 'admin', password, true);
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    await auth.changeUsername('owner');
    expect(await auth.verify(login.token)).toBeUndefined();
    expect((await auth.status()).username).toBe('owner');
  });
});
