import { describe, expect, it, vi } from 'vitest';

import { createPackageBackedRepoSecrets } from '@package-apps/ide/process/data/memory/packageBackedRepoSecrets';
import type { PackageSecretInfo, PackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';

const legacy = () => ({
  list: vi.fn(async () => []),
  listCombos: vi.fn(async () => [{ comboId: 'old-combo', comboLabel: 'Old', description: '', keys: [], updatedAt: 1 }]),
  declare: vi.fn(),
  resolveEnvironment: vi.fn(async () => ({ OLD_KEY: 'old-value' }) as Record<string, string>),
  redact: vi.fn((text: string) => text),
});

const own: PackageSecretInfo = {
  handle: 'secret://set-1',
  label: 'Deploy login',
  note: 'Release',
  fields: ['USER', 'TOKEN'],
  origin: 'own',
  updatedAt: 5,
};
const granted: PackageSecretInfo = {
  handle: 'secret://set-2',
  label: 'GitHub token',
  fields: ['GH_TOKEN'],
  origin: 'granted',
  updatedAt: 6,
};

const port = (
  sets: PackageSecretInfo[] = [own, granted]
): PackageSecretPort & { resolve: ReturnType<typeof vi.fn> } => ({
  list: vi.fn(async () => sets),
  store: vi.fn(),
  resolve: vi.fn(async (handle: string) =>
    handle === own.handle ? { USER: 'octocat', TOKEN: 'pkg-token' } : { GH_TOKEN: 'granted-token' }
  ),
  requestAccess: vi.fn(),
});

describe('IDE secrets backed by the package space in the app vault', () => {
  it('lists the package sets as combos beside the older ones, without any value', async () => {
    const combos = await createPackageBackedRepoSecrets(legacy(), port()).listCombos('C:/Repo');

    expect(combos.map((combo) => combo.comboId)).toEqual(['old-combo', 'secret://set-1', 'secret://set-2']);
    expect(combos[1]).toMatchObject({
      comboLabel: 'Deploy login',
      description: 'Release',
      keys: [
        { key: 'USER', alias: 'USER', status: 'set' },
        { key: 'TOKEN', alias: 'TOKEN', status: 'set' },
      ],
    });
    expect(combos[2]?.comboLabel).toMatch(/granted/iu);
    expect(JSON.stringify(combos)).not.toMatch(/pkg-token|granted-token|octocat/u);
  });

  it('injects package sets by handle and older combos through the older store, merged', async () => {
    const old = legacy();
    const packagePort = port();
    const env = await createPackageBackedRepoSecrets(old, packagePort).resolveEnvironment(
      'C:/Repo',
      ['NPM_TOKEN'],
      ['old-combo', 'secret://set-1', 'secret://set-2']
    );

    expect(old.resolveEnvironment).toHaveBeenCalledWith('C:/Repo', ['NPM_TOKEN'], ['old-combo']);
    expect(packagePort.resolve).toHaveBeenCalledWith('secret://set-1', ['USER', 'TOKEN']);
    expect(packagePort.resolve).toHaveBeenCalledWith('secret://set-2', ['GH_TOKEN']);
    expect(env).toEqual({
      OLD_KEY: 'old-value',
      USER: 'octocat',
      TOKEN: 'pkg-token',
      GH_TOKEN: 'granted-token',
    });
  });

  it('does not touch the older store when only package sets are asked for', async () => {
    const old = legacy();
    await createPackageBackedRepoSecrets(old, port()).resolveEnvironment('C:/Repo', [], ['secret://set-1']);
    expect(old.resolveEnvironment).not.toHaveBeenCalled();
  });

  it('refuses a handle the package may not use, and keeps working when the package space is unavailable', async () => {
    await expect(
      createPackageBackedRepoSecrets(legacy(), port([own])).resolveEnvironment('C:/Repo', [], ['secret://set-2'])
    ).rejects.toThrow(/unavailable/iu);

    const broken: PackageSecretPort = {
      ...port(),
      list: async () => {
        throw new Error('vault down with pkg-token');
      },
    };
    const combos = await createPackageBackedRepoSecrets(legacy(), broken).listCombos('C:/Repo');
    expect(combos.map((combo) => combo.comboId)).toEqual(['old-combo']);
  });
});
