import { afterEach, describe, expect, it } from 'vitest';

import {
  createSecretVault,
  type SecretVaultCodec,
  type SecretVaultRepository,
  type StoredSecret,
} from '@/process/agentRuntime/secretVault';
import { createPackageSecretAccess } from '@/process/resources/packageSecrets/packageSecretAccess';
import {
  MAX_OWN_SETS,
  configurePackageSecretPorts,
  getPackageSecretPort,
} from '@/process/resources/packageSecrets/packageSecretPort';

const codec: SecretVaultCodec = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: (cipher) => Buffer.from(cipher.replace(/^enc:/u, ''), 'base64').toString('utf8'),
};

const wire = () => {
  let records: StoredSecret[] = [];
  const repository: SecretVaultRepository = {
    list: async () => structuredClone(records),
    save: async (values) => {
      records = structuredClone(values);
    },
  };
  let counter = 0;
  const vault = createSecretVault(repository, codec, () => `secret://set-${(counter += 1)}`);
  let grants: Array<{ packageId: string; handle: string; grantedAt: number }> = [];
  const access = createPackageSecretAccess({
    vault,
    repository: {
      list: async () => structuredClone(grants),
      save: async (values) => {
        grants = structuredClone(values);
      },
    },
    createId: () => 'req-1',
  });
  configurePackageSecretPorts({ vault, access });
  return { vault, access };
};

afterEach(() => configurePackageSecretPorts(undefined));

describe("a Package App's secret port", () => {
  it("keeps a package's keys in its own space, readable by that package only", async () => {
    wire();
    const ide = getPackageSecretPort('com.tomni.ide');
    const other = getPackageSecretPort('com.tomni.other');
    const { handle } = await ide.store({ label: 'Deploy login', values: { USER: 'octocat', TOKEN: 'pkg-token' } });

    expect(await ide.list()).toEqual([
      expect.objectContaining({ handle, label: 'Deploy login', fields: ['USER', 'TOKEN'], origin: 'own' }),
    ]);
    expect(JSON.stringify(await ide.list())).not.toMatch(/pkg-token|octocat/u);
    await expect(ide.resolve(handle, ['TOKEN'])).resolves.toEqual({ TOKEN: 'pkg-token' });
    expect(await other.list()).toEqual([]);
    await expect(other.resolve(handle, ['TOKEN'])).rejects.toThrow();
  });

  it('sees a general app key only after the person grants it', async () => {
    const { vault, access } = wire();
    const general = await vault.put(
      {
        label: 'GitHub token',
        kind: 'token',
        fields: ['GH_TOKEN'],
        binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
      },
      { GH_TOKEN: 'ghp-general' }
    );
    const ide = getPackageSecretPort('com.tomni.ide');

    expect(await ide.list()).toEqual([]);
    expect(await ide.requestAccess(general.handle, 'Push the release')).toEqual({
      requestId: 'req-1',
      status: 'pending',
    });
    expect(await ide.list()).toEqual([]);
    await expect(ide.resolve(general.handle, ['GH_TOKEN'])).rejects.toThrow();

    await access.approve('com.tomni.ide', 'req-1');
    expect(await ide.list()).toEqual([expect.objectContaining({ handle: general.handle, origin: 'granted' })]);
    await expect(ide.resolve(general.handle, ['GH_TOKEN'])).resolves.toEqual({ GH_TOKEN: 'ghp-general' });
  });

  it('keeps a package from filling the shared vault', async () => {
    wire();
    const ide = getPackageSecretPort('com.tomni.ide');
    for (let index = 0; index < MAX_OWN_SETS; index += 1) {
      await ide.store({ label: `Set ${index}`, values: { A: 'b' } });
    }
    await expect(ide.store({ label: 'One too many', values: { A: 'b' } })).rejects.toThrow(/limit/iu);
    await expect(
      getPackageSecretPort('com.tomni.other').store({ label: 'Fine', values: { A: 'b' } })
    ).resolves.toBeTruthy();
  });

  it('fails closed when Main has not wired it', async () => {
    const ide = getPackageSecretPort('com.tomni.ide');
    expect(await ide.list()).toEqual([]);
    await expect(ide.store({ label: 'x', values: { A: 'b' } })).rejects.toThrow(/unavailable/iu);
    await expect(ide.resolve('secret://x', ['A'])).rejects.toThrow(/unavailable/iu);
    await expect(ide.requestAccess('secret://x', 'why')).rejects.toThrow(/unavailable/iu);
  });
});
