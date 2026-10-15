import { describe, expect, it } from 'vitest';

import type { SecretDescriptorInput } from '@/process/agentRuntime/secretVault';
import {
  createScopedSecretVault,
  createSecretVault,
  createSessionSecretVault,
  secretVisibleTo,
  type SecretVaultCodec,
  type SecretVaultRepository,
  type StoredSecret,
} from '@/process/agentRuntime/secretVault';

const NOW = 1_720_000_000_000;
const codec: SecretVaultCodec = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: (cipher) => Buffer.from(cipher.replace(/^enc:/u, ''), 'base64').toString('utf8'),
};
const memoryRepository = (): SecretVaultRepository & { records: StoredSecret[] } => {
  const repository = {
    records: [] as StoredSecret[],
    list: async () => structuredClone(repository.records),
    save: async (values: StoredSecret[]) => {
      repository.records = structuredClone(values);
    },
  };
  return repository;
};

const input = (overrides: Partial<SecretDescriptorInput> = {}): SecretDescriptorInput => ({
  label: 'Release login',
  kind: 'credential',
  fields: ['USERNAME', 'PASSWORD'],
  binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
  ...overrides,
});
const payload = { USERNAME: 'octocat', PASSWORD: 'hunter2-secret' };
const resolve = (handle: string, caller?: { sessionId?: string; companyId?: string; packageId?: string }) => ({
  handle,
  fields: ['PASSWORD'],
  surface: 'secret-firewall',
  purpose: 'opaque-use',
  ...(caller ? { caller } : {}),
});

describe('app-scoped sets', () => {
  it('stay usable by every caller, with or without an identity', async () => {
    const vault = createSecretVault(
      memoryRepository(),
      codec,
      () => 'secret://app',
      () => NOW
    );
    const descriptor = await vault.put(input(), payload);

    expect(descriptor.scope).toBeUndefined();
    await expect(vault.resolve(resolve('secret://app'))).resolves.toEqual({ PASSWORD: 'hunter2-secret' });
    await expect(vault.resolve(resolve('secret://app', { sessionId: 's1' }))).resolves.toEqual({
      PASSWORD: 'hunter2-secret',
    });
  });
});

describe('company-scoped sets', () => {
  it('resolve only for the company that owns them', async () => {
    const vault = createSecretVault(
      memoryRepository(),
      codec,
      () => 'secret://company',
      () => NOW
    );
    await vault.put(input({ scope: { kind: 'company', companyId: 'acme' } }), payload);

    await expect(vault.resolve(resolve('secret://company', { companyId: 'acme' }))).resolves.toEqual({
      PASSWORD: 'hunter2-secret',
    });
    await expect(vault.resolve(resolve('secret://company', { companyId: 'other' }))).rejects.toThrow(/scope/iu);
    await expect(vault.resolve(resolve('secret://company', { sessionId: 's1' }))).rejects.toThrow(/scope/iu);
    await expect(vault.resolve(resolve('secret://company'))).rejects.toThrow(/scope/iu);
  });

  it('refuse a malformed company id', async () => {
    const vault = createSecretVault(memoryRepository(), codec);
    await expect(vault.put(input({ scope: { kind: 'company', companyId: ' ' } }), payload)).rejects.toThrow();
  });
});

describe('session-scoped sets', () => {
  it('are refused by the permanent vault so they can never reach disk', async () => {
    const repository = memoryRepository();
    const vault = createSecretVault(repository, codec);
    await expect(vault.put(input({ scope: { kind: 'session', sessionId: 's1' } }), payload)).rejects.toThrow(
      /session/iu
    );
    expect(repository.records).toEqual([]);
  });

  it('live in a RAM vault that resolves only for the owning session', async () => {
    const vault = createSessionSecretVault({ now: () => NOW });
    const descriptor = await vault.put(input({ scope: { kind: 'session', sessionId: 's1' } }), payload);

    expect(descriptor.handle).toMatch(/^secret:\/\/session\//u);
    expect(descriptor.scope).toEqual({ kind: 'session', sessionId: 's1' });
    await expect(vault.resolve(resolve(descriptor.handle, { sessionId: 's1' }))).resolves.toEqual({
      PASSWORD: 'hunter2-secret',
    });
    await expect(vault.resolve(resolve(descriptor.handle, { sessionId: 's2' }))).rejects.toThrow(/scope/iu);
    await expect(vault.resolve(resolve(descriptor.handle))).rejects.toThrow(/scope/iu);
  });

  it('only accept session scope, and never keep the plain value in a listing', async () => {
    const vault = createSessionSecretVault({ now: () => NOW });
    await expect(vault.put(input(), payload)).rejects.toThrow(/session/iu);
    await vault.put(input({ scope: { kind: 'session', sessionId: 's1' } }), payload);
    expect(JSON.stringify(await vault.list())).not.toContain('hunter2-secret');
  });

  it('are wiped for one session without touching another', async () => {
    const vault = createSessionSecretVault({ now: () => NOW });
    const first = await vault.put(input({ scope: { kind: 'session', sessionId: 's1' } }), payload);
    const second = await vault.put(input({ scope: { kind: 'session', sessionId: 's2' } }), payload);

    expect(await vault.removeSession('s1')).toBe(1);
    await expect(vault.resolve(resolve(first.handle, { sessionId: 's1' }))).rejects.toThrow();
    await expect(vault.resolve(resolve(second.handle, { sessionId: 's2' }))).resolves.toEqual({
      PASSWORD: 'hunter2-secret',
    });
  });
});

describe('package-scoped sets', () => {
  const build = () => {
    const repository = memoryRepository();
    let counter = 0;
    const persistent = createSecretVault(
      repository,
      codec,
      () => `secret://pkg-${(counter += 1)}`,
      () => NOW
    );
    return { repository, vault: createScopedSecretVault(persistent, createSessionSecretVault({ now: () => NOW })) };
  };

  it('are stored permanently and resolve only for the package that owns them', async () => {
    const { repository, vault } = build();
    const created = await vault.put(input({ scope: { kind: 'package', packageId: 'com.tomni.ide' } }), payload);

    expect(repository.records).toHaveLength(1);
    expect(created.scope).toEqual({ kind: 'package', packageId: 'com.tomni.ide' });
    await expect(vault.resolve(resolve(created.handle, { packageId: 'com.tomni.ide' }))).resolves.toEqual({
      PASSWORD: 'hunter2-secret',
    });
    await expect(vault.resolve(resolve(created.handle, { packageId: 'com.tomni.other' }))).rejects.toThrow(/scope/iu);
    await expect(vault.resolve(resolve(created.handle, { sessionId: 's1', companyId: 'acme' }))).rejects.toThrow(
      /scope/iu
    );
    await expect(vault.resolve(resolve(created.handle))).rejects.toThrow(/scope/iu);
  });

  it('refuse a malformed package id and never live in the RAM session store', async () => {
    const { vault } = build();
    await expect(vault.put(input({ scope: { kind: 'package', packageId: '../escape' } }), payload)).rejects.toThrow(
      /identifier/iu
    );
    await expect(
      createSessionSecretVault({ now: () => NOW }).put(
        input({ scope: { kind: 'package', packageId: 'com.tomni.ide' } }),
        payload
      )
    ).rejects.toThrow(/session/iu);
  });

  it('are removed for one package without touching app sets or another package', async () => {
    const { vault } = build();
    const app = await vault.put(input({ label: 'App' }), payload);
    await vault.put(input({ label: 'Ide one', scope: { kind: 'package', packageId: 'com.tomni.ide' } }), payload);
    await vault.put(input({ label: 'Ide two', scope: { kind: 'package', packageId: 'com.tomni.ide' } }), payload);
    const other = await vault.put(
      input({ label: 'Other', scope: { kind: 'package', packageId: 'com.tomni.other' } }),
      payload
    );

    expect(await vault.removePackage('com.tomni.ide')).toBe(2);
    expect(await vault.removePackage('com.tomni.ide')).toBe(0);
    expect((await vault.list()).map((item) => item.handle).toSorted()).toEqual([app.handle, other.handle].toSorted());
  });
});

describe('scope is fixed once a set exists', () => {
  it('refuses to turn a package, company or session set into an app key by re-saving it', async () => {
    const repository = memoryRepository();
    const vault = createSecretVault(
      repository,
      codec,
      () => 'secret://fixed',
      () => NOW
    );
    const created = await vault.put(input({ scope: { kind: 'package', packageId: 'com.tomni.ide' } }), payload);

    await expect(vault.replace(created.handle, input(), payload)).rejects.toThrow(/cannot change scope/iu);
    await expect(
      vault.replace(created.handle, input({ scope: { kind: 'package', packageId: 'com.tomni.other' } }), payload)
    ).rejects.toThrow(/cannot change scope/iu);
    await expect(
      vault.replace(
        created.handle,
        input({ label: 'Renamed', scope: { kind: 'package', packageId: 'com.tomni.ide' } }),
        payload
      )
    ).resolves.toMatchObject({ label: 'Renamed', scope: { kind: 'package', packageId: 'com.tomni.ide' } });
  });

  it('ignores a stored record whose scope is malformed instead of treating it as visible to everyone', async () => {
    const { createFileSecretRepository } = await import('@/process/agentRuntime/secretVault');
    const good = {
      handle: 'secret://good',
      label: 'x',
      kind: 'credential',
      fields: ['A'],
      binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
      createdAt: 1,
      updatedAt: 1,
      encryptedPayload: 'enc:e30=',
    };
    const files = new Map<string, string>([
      [
        'vault.json',
        JSON.stringify([
          good,
          { ...good, handle: 'secret://no-id', scope: { kind: 'package' } },
          { ...good, handle: 'secret://odd', scope: { kind: 'galaxy' } },
          { ...good, handle: 'secret://pkg', scope: { kind: 'package', packageId: 'com.tomni.ide' } },
        ]),
      ],
    ]);
    const repository = createFileSecretRepository('vault.json', {
      readFile: async (file: string) => files.get(file) ?? '',
      writeFile: async () => undefined,
      rename: async () => undefined,
      mkdir: async () => undefined,
    } as never);
    expect((await repository.list()).map((item) => item.handle)).toEqual(['secret://good', 'secret://pkg']);
  });
});

describe('scoped composite vault', () => {
  const build = () => {
    const repository = memoryRepository();
    const persistent = createSecretVault(
      repository,
      codec,
      () => 'secret://permanent',
      () => NOW
    );
    const session = createSessionSecretVault({ now: () => NOW });
    return { repository, vault: createScopedSecretVault(persistent, session) };
  };

  it('routes a write by scope and resolves by handle across both stores', async () => {
    const { repository, vault } = build();
    const permanent = await vault.put(input(), payload);
    const temporary = await vault.put(input({ label: 'Temp', scope: { kind: 'session', sessionId: 's1' } }), payload);

    expect(repository.records).toHaveLength(1);
    expect(permanent.handle).toBe('secret://permanent');
    expect(temporary.handle).toMatch(/^secret:\/\/session\//u);
    await expect(vault.resolve(resolve(permanent.handle))).resolves.toMatchObject({ PASSWORD: 'hunter2-secret' });
    await expect(vault.resolve(resolve(temporary.handle, { sessionId: 's1' }))).resolves.toMatchObject({
      PASSWORD: 'hunter2-secret',
    });
    expect((await vault.list()).map((item) => item.label).toSorted()).toEqual(['Release login', 'Temp']);
  });

  it('removes a set from whichever store holds it and forgets a whole session', async () => {
    const { repository, vault } = build();
    const permanent = await vault.put(input(), payload);
    const temporary = await vault.put(input({ scope: { kind: 'session', sessionId: 's1' } }), payload);

    expect(await vault.remove(temporary.handle)).toBe(true);
    expect(await vault.remove(temporary.handle)).toBe(false);
    expect(await vault.remove(permanent.handle)).toBe(true);
    expect(repository.records).toEqual([]);

    await vault.put(input({ scope: { kind: 'session', sessionId: 's9' } }), payload);
    expect(await vault.removeSession('s9')).toBe(1);
  });
});

describe('secretVisibleTo', () => {
  const descriptor = (scope?: SecretDescriptorInput['scope']) => ({
    handle: 'secret://x',
    ...input(scope ? { scope } : {}),
    createdAt: NOW,
    updatedAt: NOW,
  });

  it('shows app sets to everyone and scoped sets only to their owner', () => {
    expect(secretVisibleTo(descriptor(), {})).toBe(true);
    expect(secretVisibleTo(descriptor({ kind: 'session', sessionId: 's1' }), { sessionId: 's1' })).toBe(true);
    expect(secretVisibleTo(descriptor({ kind: 'session', sessionId: 's1' }), { sessionId: 's2' })).toBe(false);
    expect(secretVisibleTo(descriptor({ kind: 'company', companyId: 'acme' }), { companyId: 'acme' })).toBe(true);
    expect(secretVisibleTo(descriptor({ kind: 'company', companyId: 'acme' }), {})).toBe(false);
    expect(
      secretVisibleTo(descriptor({ kind: 'package', packageId: 'com.tomni.ide' }), { packageId: 'com.tomni.ide' })
    ).toBe(true);
    expect(secretVisibleTo(descriptor({ kind: 'package', packageId: 'com.tomni.ide' }), { sessionId: 's1' })).toBe(
      false
    );
    expect(secretVisibleTo(descriptor({ kind: 'package', packageId: 'com.tomni.ide' }), undefined)).toBe(false);
  });
});
