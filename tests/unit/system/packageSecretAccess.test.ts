import { describe, expect, it } from 'vitest';

import {
  createSecretVault,
  type SecretDescriptorInput,
  type SecretVaultCodec,
  type SecretVaultRepository,
  type StoredSecret,
} from '@/process/agentRuntime/secretVault';
import {
  createPackageSecretAccess,
  type PackageSecretGrant,
} from '@/process/resources/packageSecrets/packageSecretAccess';

const NOW = 1_720_000_000_000;
const codec: SecretVaultCodec = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: (cipher) => Buffer.from(cipher.replace(/^enc:/u, ''), 'base64').toString('utf8'),
};

const input = (overrides: Partial<SecretDescriptorInput> = {}): SecretDescriptorInput => ({
  label: 'GitHub token',
  kind: 'token',
  fields: ['TOKEN'],
  binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
  ...overrides,
});
const use = (handle: string) => ({
  handle,
  fields: ['TOKEN'],
  surface: 'secret-firewall',
  purpose: 'opaque-use',
});

const build = () => {
  let records: StoredSecret[] = [];
  const repository: SecretVaultRepository = {
    list: async () => structuredClone(records),
    save: async (values) => {
      records = structuredClone(values);
    },
  };
  let counter = 0;
  const vault = createSecretVault(
    repository,
    codec,
    () => `secret://set-${(counter += 1)}`,
    () => NOW
  );
  let grants: PackageSecretGrant[] = [];
  let ids = 0;
  const access = createPackageSecretAccess({
    vault,
    repository: {
      list: async () => structuredClone(grants),
      save: async (values) => {
        grants = structuredClone(values);
      },
    },
    now: () => NOW,
    createId: () => `req-${(ids += 1)}`,
  });
  return { vault, access, grants: () => grants };
};

describe("a Package App's own secret space", () => {
  it('resolves its own sets and refuses other packages, sessions and companies', async () => {
    const { vault, access } = build();
    const own = await vault.put(input({ scope: { kind: 'package', packageId: 'com.a' } }), { TOKEN: 'a-secret' });
    const theirs = await vault.put(input({ scope: { kind: 'package', packageId: 'com.b' } }), { TOKEN: 'b-secret' });
    const session = await vault.put(input({ scope: { kind: 'company', companyId: 'acme' } }), { TOKEN: 'c-secret' });

    await expect(access.resolve('com.a', use(own.handle))).resolves.toEqual({ TOKEN: 'a-secret' });
    await expect(access.resolve('com.a', use(theirs.handle))).rejects.toThrow(/not allowed/iu);
    await expect(access.resolve('com.a', use(session.handle))).rejects.toThrow(/not allowed/iu);
    await expect(access.resolve('com.a', use('secret://missing'))).rejects.toThrow(/not allowed/iu);
  });
});

describe("access to the person's general app keys", () => {
  it('is refused until the person approves a request, then limited to that one set', async () => {
    const { vault, access } = build();
    const github = await vault.put(input(), { TOKEN: 'ghp-secret' });
    const other = await vault.put(input({ label: 'Other' }), { TOKEN: 'other-secret' });

    await expect(access.resolve('com.a', use(github.handle))).rejects.toThrow(/not allowed/iu);

    const requested = await access.requestAccess('com.a', { handle: github.handle, reason: ' Push the release ' });
    expect(requested).toEqual({ requestId: 'req-1', status: 'pending' });
    // Asking grants nothing.
    await expect(access.resolve('com.a', use(github.handle))).rejects.toThrow(/not allowed/iu);

    const overview = await access.overview('com.a');
    expect(overview.pending).toEqual([
      expect.objectContaining({
        id: 'req-1',
        handle: github.handle,
        label: 'GitHub token',
        reason: 'Push the release',
      }),
    ]);
    expect(overview.available.map((item) => item.handle).toSorted()).toEqual([github.handle, other.handle].toSorted());
    expect(JSON.stringify(overview)).not.toMatch(/ghp-secret|other-secret/u);

    expect(await access.approve('com.a', 'req-1')).toBe(true);
    await expect(access.resolve('com.a', use(github.handle))).resolves.toEqual({ TOKEN: 'ghp-secret' });
    await expect(access.resolve('com.a', use(other.handle))).rejects.toThrow(/not allowed/iu);
    await expect(access.resolve('com.b', use(github.handle))).rejects.toThrow(/not allowed/iu);
    expect((await access.overview('com.a')).pending).toEqual([]);
    expect(await access.requestAccess('com.a', { handle: github.handle, reason: 'again' })).toEqual({
      status: 'already-granted',
    });
  });

  it('can be denied, granted directly by the person, and revoked', async () => {
    const { vault, access } = build();
    const github = await vault.put(input(), { TOKEN: 'ghp-secret' });

    await access.requestAccess('com.a', { handle: github.handle, reason: 'Need it' });
    expect(access.deny('com.a', 'req-1')).toBe(true);
    expect(access.deny('com.a', 'req-1')).toBe(false);
    expect(await access.approve('com.a', 'req-1')).toBe(false);

    expect(await access.grant('com.a', github.handle)).toBe(true);
    await expect(access.resolve('com.a', use(github.handle))).resolves.toEqual({ TOKEN: 'ghp-secret' });
    expect(await access.revoke('com.a', github.handle)).toBe(true);
    expect(await access.revoke('com.a', github.handle)).toBe(false);
    await expect(access.resolve('com.a', use(github.handle))).rejects.toThrow(/not allowed/iu);
  });

  it('cannot be requested for sets that are not app sets or do not exist', async () => {
    const { vault, access } = build();
    const session = await vault.put(input({ scope: { kind: 'company', companyId: 'acme' } }), { TOKEN: 'c' });
    const packaged = await vault.put(input({ scope: { kind: 'package', packageId: 'com.b' } }), { TOKEN: 'b' });

    for (const handle of [session.handle, packaged.handle, 'secret://missing']) {
      await expect(access.requestAccess('com.a', { handle, reason: 'Please' })).rejects.toThrow(/not allowed/iu);
      expect(await access.grant('com.a', handle)).toBe(false);
    }
    await expect(access.requestAccess('com.a', { handle: session.handle, reason: ' ' })).rejects.toThrow();
  });

  it('offers only sets a package can actually use, which means ones usable as a process variable', async () => {
    const { vault, access } = build();
    const terminalOnly = await vault.put(
      input({ label: 'Terminal only', binding: { surfaces: ['terminal'], purposes: ['terminal-input'] } }),
      { TOKEN: 'terminal-secret' }
    );
    const usable = await vault.put(input({ label: 'Usable' }), { TOKEN: 'usable-secret' });

    expect((await access.overview('com.a')).available.map((item) => item.handle)).toEqual([usable.handle]);
    await expect(access.requestAccess('com.a', { handle: terminalOnly.handle, reason: 'Please' })).rejects.toThrow();
    expect(await access.grant('com.a', terminalOnly.handle)).toBe(false);
  });

  it('drops grants of sets that no longer exist when a new grant is made', async () => {
    const { vault, access, grants } = build();
    const gone = await vault.put(input({ label: 'Gone' }), { TOKEN: 'gone-secret' });
    const kept = await vault.put(input({ label: 'Kept' }), { TOKEN: 'kept-secret' });
    await access.grant('com.a', gone.handle);
    await vault.remove(gone.handle);

    await access.grant('com.a', kept.handle);
    expect(grants().map((grant) => grant.handle)).toEqual([kept.handle]);
  });

  it('stops working when the app set is revoked or removed, and is forgotten with the package', async () => {
    const { vault, access, grants } = build();
    const github = await vault.put(input(), { TOKEN: 'ghp-secret' });
    await access.grant('com.a', github.handle);
    await access.grant('com.b', github.handle);
    await access.requestAccess('com.a', { handle: github.handle, reason: 'again' });

    expect(await vault.remove(github.handle)).toBe(true);
    await expect(access.resolve('com.a', use(github.handle))).rejects.toThrow(/not allowed/iu);
    expect((await access.overview('com.a')).granted).toEqual([]);

    expect(await access.forgetPackage('com.a')).toBe(1);
    expect(grants().map((grant) => grant.packageId)).toEqual(['com.b']);
    expect((await access.overview('com.a')).pending).toEqual([]);
  });
});
