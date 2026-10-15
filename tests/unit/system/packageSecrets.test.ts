import { describe, expect, it, vi } from 'vitest';

import type { SecretDescriptor } from '@/process/agentRuntime/contextTypes';
import {
  createSecretVault,
  stableSecretRecoveryHandle,
  type SecretRecoverySnapshot,
  type SecretVaultCodec,
  type SecretVaultRepository,
  type StoredSecret,
} from '@/process/agentRuntime/secretVault';
import { countPendingLegacySecrets, importLegacySecrets } from '@/process/resources/sessionSecrets/legacyImport';
import { packageIdOfSurface } from '@/process/resources/sessionSecrets/packageOfSurface';
import { wirePackageSecretCleanup } from '@/process/resources/sessionSecrets/packageSecretCleanup';

const codec: SecretVaultCodec = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: (cipher) => Buffer.from(cipher.replace(/^enc:/u, ''), 'base64').toString('utf8'),
};
const memoryVault = () => {
  let records: StoredSecret[] = [];
  const repository: SecretVaultRepository = {
    list: async () => structuredClone(records),
    save: async (values) => {
      records = structuredClone(values);
    },
  };
  return createSecretVault(
    repository,
    codec,
    () => `secret://live-${records.length + 1}`,
    () => 1_720_000_000_000
  );
};

const snapshot = (): SecretRecoverySnapshot => ({
  status: 'available',
  skipped: 0,
  candidates: [
    {
      sourceId: 'repo-secret-context\0c:/work/app\0combo\0deploy',
      input: {
        label: 'Deploy login (app)',
        note: 'Release job',
        kind: 'credential',
        fields: ['USER', 'TOKEN'],
        binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
      },
      payload: { USER: 'octocat', TOKEN: 'legacy-token-value' },
    },
    {
      sourceId: 'repo-secret-context\0c:/work/app\0alias\0NPM_TOKEN',
      input: {
        label: 'NPM_TOKEN (app)',
        kind: 'token',
        fields: ['NPM_TOKEN'],
        binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
      },
      payload: { NPM_TOKEN: 'npm-legacy-value' },
    },
  ],
});

describe("importing a package's older keys into its own scope", () => {
  it('copies each record into the package scope, once, without exposing a value', async () => {
    const vault = memoryVault();
    const load = async () => snapshot();

    expect(await countPendingLegacySecrets(vault, 'com.tomni.ide', load)).toBe(2);
    const first = await importLegacySecrets(vault, 'com.tomni.ide', load);
    expect(first).toMatchObject({ status: 'complete', imported: 2, existing: 0, failed: 0 });

    const listed = await vault.list();
    expect(listed).toHaveLength(2);
    for (const item of listed) expect(item.scope).toEqual({ kind: 'package', packageId: 'com.tomni.ide' });
    expect(JSON.stringify(listed)).not.toMatch(/legacy-token-value|npm-legacy-value|octocat/u);

    const deploy = listed.find((item) => item.label.startsWith('Deploy'))!;
    await expect(
      vault.resolve({
        handle: deploy.handle,
        fields: ['TOKEN'],
        surface: 'secret-firewall',
        purpose: 'opaque-use',
        caller: { packageId: 'com.tomni.ide' },
      })
    ).resolves.toEqual({ TOKEN: 'legacy-token-value' });
    await expect(
      vault.resolve({
        handle: deploy.handle,
        fields: ['TOKEN'],
        surface: 'secret-firewall',
        purpose: 'opaque-use',
        caller: { packageId: 'com.tomni.other' },
      })
    ).rejects.toThrow(/scope/iu);

    expect(await countPendingLegacySecrets(vault, 'com.tomni.ide', load)).toBe(0);
    const second = await importLegacySecrets(vault, 'com.tomni.ide', load);
    expect(second).toMatchObject({ imported: 0, existing: 2 });
    expect(await vault.list()).toHaveLength(2);
  });

  it('keeps the same record from two packages apart', async () => {
    const vault = memoryVault();
    const load = async () => snapshot();
    await importLegacySecrets(vault, 'com.tomni.ide', load);
    await importLegacySecrets(vault, 'com.tomni.other', load);

    expect(await vault.list()).toHaveLength(4);
    expect(stableSecretRecoveryHandle('a')).not.toBe(stableSecretRecoveryHandle('b'));
  });

  it('reports a missing or unreadable source as counts only', async () => {
    const vault = memoryVault();
    await expect(
      importLegacySecrets(vault, 'com.tomni.ide', async () => ({ status: 'missing', candidates: [], skipped: 0 }))
    ).resolves.toMatchObject({ status: 'missing', imported: 0 });
    const failed = await importLegacySecrets(vault, 'com.tomni.ide', async () => {
      throw new Error('disk exploded with legacy-token-value');
    });
    expect(failed).toEqual({ status: 'unavailable', imported: 0, existing: 0, skipped: 0, failed: 0 });
  });
});

describe('packageIdOfSurface', () => {
  it('maps package surfaces and the IDE front to their package, and nothing else', () => {
    expect(packageIdOfSurface({ id: 'com.acme.thing', source: { kind: 'package', id: 'com.acme.thing' } })).toBe(
      'com.acme.thing'
    );
    expect(packageIdOfSurface({ id: 'ide', source: { kind: 'builtin', id: 'tomny-core' } })).toBe('com.tomni.ide');
    expect(packageIdOfSurface({ id: 'chat', source: { kind: 'builtin', id: 'tomny-core' } })).toBeUndefined();
    expect(packageIdOfSurface({ id: 'ide', source: { kind: 'user' } })).toBeUndefined();
    expect(packageIdOfSurface(undefined)).toBeUndefined();
  });
});

describe('wirePackageSecretCleanup', () => {
  const build = (initial: string[]) => {
    let notify: () => void = () => undefined;
    let installed: Set<string> | Error = new Set(initial);
    const removePackage = vi.fn(async () => 1);
    const forget = vi.fn(async () => 1);
    wirePackageSecretCleanup({
      vault: { removePackage },
      onChanged: (listener) => {
        notify = listener;
        return () => undefined;
      },
      installedPackageIds: async () => {
        if (installed instanceof Error) throw installed;
        return installed;
      },
      also: { forget },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const change = async (next: string[] | Error) => {
      installed = next instanceof Error ? next : new Set(next);
      notify();
      await settle();
    };
    return { removePackage, forget, change, settle };
  };

  it('removes the sets and grants of a package it saw installed and now sees gone, and only that one', async () => {
    const { removePackage, forget, change, settle } = build(['com.a', 'com.b']);
    await settle();
    await change(['com.b']);
    expect(removePackage.mock.calls).toEqual([['com.a']]);
    expect(forget.mock.calls).toEqual([['com.a']]);
  });

  it('never touches a package it has not seen installed, such as one that was never installed here', async () => {
    const { removePackage, change, settle } = build(['com.b']);
    await settle();
    // com.never has sets in the vault but is not installed here, so a later change must leave them alone.
    await change(['com.b']);
    await change([]);
    expect(removePackage.mock.calls).toEqual([['com.b']]);
  });

  it('keeps everything when the package store cannot be read, and recovers on the next change', async () => {
    const { removePackage, change, settle } = build(['com.a']);
    await settle();
    await change(new Error('package store unavailable'));
    expect(removePackage).not.toHaveBeenCalled();
    await change([]);
    expect(removePackage.mock.calls).toEqual([['com.a']]);
  });
});
