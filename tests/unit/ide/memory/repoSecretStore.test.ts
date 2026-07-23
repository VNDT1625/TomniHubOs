import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepoSecretStore, type RepoSecretCrypto, type RepoSecretFs } from '@/process/ide/memory/repoSecretStore';

const memoryFs = (initial: Record<string, string> = {}): RepoSecretFs => {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    readFile: async (filePath) => {
      const value = files.get(filePath);
      if (value === undefined) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return value;
    },
    writeFile: async (filePath, data) => void files.set(filePath, data),
    rename: async (from, to) => {
      const value = files.get(from);
      if (value !== undefined) files.set(to, value);
      files.delete(from);
    },
    mkdir: async () => undefined,
  };
};

const crypto = (): RepoSecretCrypto => ({
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(`sealed:${value}`).toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').toString('utf-8').slice('sealed:'.length),
});

describe('RepoSecretStore', () => {
  it('returns metadata only while resolving values only for selected child environments', async () => {
    const store = createRepoSecretStore({ dir: 'C:/vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });
    await store.save('C:/Repo', 'PAYMENTS_API_KEY', 'Payments sandbox', 'secret-value-123');

    expect(await store.list('c:/repo')).toEqual([
      { alias: 'PAYMENTS_API_KEY', description: 'Payments sandbox', status: 'set', updatedAt: 1 },
    ]);
    expect(JSON.stringify(await store.list('c:/repo'))).not.toContain('secret-value-123');
    await expect(store.reveal('C:/repo', 'payments_api_key')).resolves.toBe('secret-value-123');
    expect(await store.resolveEnvironment('C:/repo', ['payments_api_key'])).toEqual({
      PAYMENTS_API_KEY: 'secret-value-123',
    });
    expect(store.redact('token=secret-value-123', { PAYMENTS_API_KEY: 'secret-value-123' })).toBe('token=[REDACTED]');
  });

  it('lists metadata-only repository scopes so workspace switches do not look like data loss', async () => {
    let timestamp = 0;
    const store = createRepoSecretStore({
      dir: 'C:/vault',
      fs: memoryFs(),
      crypto: crypto(),
      now: () => ++timestamp,
    });
    await store.save('C:/Repo-A', 'FIRST_TOKEN', 'First workspace', 'first-value');
    await store.save('C:/Repo-B', 'SECOND_TOKEN', 'Second workspace', 'second-value');
    await store.saveCombo('C:/Repo-B', {
      comboId: 'account',
      comboLabel: 'Account',
      description: 'Second workspace account',
      keys: [{ key: 'USERNAME', value: 'octocat' }],
    });

    const scopes = await store.listScopes();

    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toMatchObject({ secretCount: 2, comboCount: 1 });
    expect(scopes[1]).toMatchObject({ secretCount: 1, comboCount: 0 });
    expect(JSON.stringify(scopes)).not.toContain('first-value');
    expect(JSON.stringify(scopes)).not.toContain('second-value');
    expect(JSON.stringify(scopes)).not.toContain('octocat');
  });

  it('lets an agent declare metadata without creating a readable value', async () => {
    const store = createRepoSecretStore({ dir: 'C:/vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });
    await store.declare('C:/Repo', 'NEW_API_KEY', 'Needed for deploy');

    expect(await store.list('C:/repo')).toEqual([
      { alias: 'NEW_API_KEY', description: 'Needed for deploy', status: 'needs_value', updatedAt: 1 },
    ]);
    await expect(store.resolveEnvironment('C:/repo', ['NEW_API_KEY'])).rejects.toThrow('has no stored value');
    await expect(store.reveal('C:/repo', 'NEW_API_KEY')).rejects.toThrow('has no stored value');
  });

  it('normalizes a friendly alias to a safe environment-variable name', async () => {
    const store = createRepoSecretStore({ dir: 'C:/vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });
    await store.save('C:/Repo', '9router api-key', 'Provider credential', 'secret-value-123');

    expect(await store.list('C:/repo')).toEqual([
      { alias: 'SECRET_9ROUTER_API_KEY', description: 'Provider credential', status: 'set', updatedAt: 1 },
    ]);
    await expect(store.reveal('C:/repo', '9router api-key')).resolves.toBe('secret-value-123');
  });

  it('expands explicit secret markers only for the requested repository', async () => {
    const store = createRepoSecretStore({ dir: 'C:/vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });
    await store.save('C:/Repo-A', 'TEST', 'Test fixture', 'actual-value');
    await store.save('C:/Repo-B', 'TEST', 'Other fixture', 'other-value');

    await expect(store.renderMarkers('C:/Repo-A', 'test is {{secret:test}}.')).resolves.toEqual({
      text: 'test is actual-value.',
      resolvedAliases: ['TEST'],
    });
    await expect(store.renderMarkers('C:/Repo-B', 'test is {{secret:TEST}}.')).resolves.toEqual({
      text: 'test is other-value.',
      resolvedAliases: ['TEST'],
    });
  });

  it('does not change malformed or non-secret text', async () => {
    const store = createRepoSecretStore({ dir: 'C:/vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });

    await expect(store.renderMarkers('C:/Repo', 'Keep {{secret:bad-key}} unchanged.')).resolves.toEqual({
      text: 'Keep {{secret:bad-key}} unchanged.',
      resolvedAliases: [],
    });
  });

  it('migrates aliases created by the previous nested combo metadata', async () => {
    const vaultPath = path.join('C:/vault', 'ide-repo-secret-context.json');
    const repository = path.resolve('C:/Repo').toLowerCase();
    const fs = memoryFs({
      [vaultPath]: JSON.stringify([
        {
          repository,
          alias: 'GITHUB_ACCOUNT_USERNAME',
          description: 'Release credentials',
          combo: { id: 'github-account', label: 'GitHub account' },
          status: 'set',
          updatedAt: 1,
          encryptedValue: crypto().encrypt('octocat'),
          osEncrypted: true,
        },
      ]),
    });
    const store = createRepoSecretStore({ dir: 'C:/vault', fs, crypto: crypto(), now: () => 1 });

    const combos = await store.listCombos('C:/Repo');

    expect(combos[0]?.comboId).toBe('github-account');
    expect(combos[0]?.keys).toEqual([
      { key: 'USERNAME', alias: 'GITHUB_ACCOUNT_USERNAME', status: 'set', updatedAt: 1 },
    ]);
  });

  it('builds Main-process recovery candidates for every decryptable standalone and Combo value', async () => {
    const vaultPath = path.join('C:/vault', 'ide-repo-secret-context.json');
    const repository = path.resolve('C:/Repo').toLowerCase();
    const codec = crypto();
    const store = createRepoSecretStore({
      dir: 'C:/vault',
      fs: memoryFs({
        [vaultPath]: JSON.stringify({
          version: 2,
          entries: [
            {
              repository,
              alias: 'DEPLOY_TOKEN',
              description: 'Deploy token',
              updatedAt: 1,
              encryptedValue: codec.encrypt('deploy-value'),
              osEncrypted: true,
            },
            {
              repository,
              alias: 'GITHUB_USERNAME',
              description: 'GitHub account',
              comboId: 'github',
              comboKey: 'USERNAME',
              updatedAt: 1,
              encryptedValue: codec.encrypt('octocat'),
              osEncrypted: true,
            },
            {
              repository,
              alias: 'GITHUB_TOKEN',
              description: 'GitHub account',
              comboId: 'github',
              comboKey: 'TOKEN',
              updatedAt: 1,
              encryptedValue: codec.encrypt('github-token'),
              osEncrypted: true,
            },
            {
              repository,
              alias: 'BROKEN_TOKEN',
              description: 'Unreadable legacy value',
              updatedAt: 1,
              encryptedValue: Buffer.from('bad').toString('base64'),
              osEncrypted: true,
            },
          ],
          combos: [
            {
              repository,
              comboId: 'github',
              comboLabel: 'GitHub',
              description: 'GitHub account',
              keys: ['USERNAME', 'TOKEN'],
              updatedAt: 1,
            },
          ],
        }),
      }),
      crypto: codec,
      now: () => 1,
    });

    const snapshot = await store.listCoreRecoveryCandidates();

    expect(snapshot.status).toBe('available');
    expect(snapshot.skipped).toBe(1);
    expect(snapshot.candidates).toHaveLength(2);
    expect(snapshot.candidates.map((item) => item.input.fields)).toEqual([['USERNAME', 'TOKEN'], ['DEPLOY_TOKEN']]);
    expect(snapshot.candidates[0]?.payload).toEqual({ USERNAME: 'octocat', TOKEN: 'github-token' });
    expect(snapshot.candidates[1]?.payload).toEqual({ DEPLOY_TOKEN: 'deploy-value' });
  });

  it('distinguishes a missing legacy vault from a corrupt vault without rewriting either source', async () => {
    const missing = createRepoSecretStore({ dir: 'C:/missing', fs: memoryFs(), crypto: crypto() });
    await expect(missing.listCoreRecoveryCandidates()).resolves.toEqual({
      status: 'missing',
      candidates: [],
      skipped: 0,
    });

    const vaultPath = path.join('C:/corrupt', 'ide-repo-secret-context.json');
    const corrupt = createRepoSecretStore({
      dir: 'C:/corrupt',
      fs: memoryFs({ [vaultPath]: '{not-json' }),
      crypto: crypto(),
    });
    await expect(corrupt.listCoreRecoveryCandidates()).rejects.toThrow(
      'Repository Secret Context could not be read safely.'
    );
  });

  it('marks a newly persisted legacy vault as available for same-process recovery', async () => {
    const store = createRepoSecretStore({ dir: 'C:/new-vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });

    await expect(store.listCoreRecoveryCandidates()).resolves.toMatchObject({ status: 'missing' });
    await store.save('C:/Repo', 'API_TOKEN', 'API token', 'saved-value');

    await expect(store.listCoreRecoveryCandidates()).resolves.toMatchObject({
      status: 'available',
      candidates: [{ payload: { API_TOKEN: 'saved-value' } }],
    });
  });

  it('stores a Combo as one metadata entity with a complete key list', async () => {
    const store = createRepoSecretStore({ dir: 'C:/vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });
    await store.saveCombo('C:/Repo', {
      comboId: 'github-account',
      comboLabel: 'GitHub account',
      description: 'Release automation credentials',
      keys: [
        { key: 'USERNAME', value: 'octocat' },
        { key: 'PASSWORD', value: 'token-123' },
      ],
    });

    expect(await store.listCombos('C:/Repo')).toEqual([
      {
        comboId: 'github-account',
        comboLabel: 'GitHub account',
        description: 'Release automation credentials',
        keys: [
          { key: 'USERNAME', alias: 'GITHUB_ACCOUNT_USERNAME', status: 'set', updatedAt: 1 },
          { key: 'PASSWORD', alias: 'GITHUB_ACCOUNT_PASSWORD', status: 'set', updatedAt: 1 },
        ],
        updatedAt: 1,
      },
    ]);
    expect(await store.resolveEnvironment('C:/Repo', [], ['github-account'])).toEqual({
      GITHUB_ACCOUNT_USERNAME: 'octocat',
      GITHUB_ACCOUNT_PASSWORD: 'token-123',
    });
    expect(JSON.stringify(await store.listCombos('C:/Repo'))).not.toContain('token-123');
  });

  it('updates a Combo atomically while preserving unchanged values and aliases', async () => {
    const store = createRepoSecretStore({ dir: 'C:/vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });
    await store.saveCombo('C:/Repo', {
      comboId: 'github-account',
      comboLabel: 'GitHub account',
      description: 'Release automation credentials',
      keys: [
        { key: 'USERNAME', value: 'octocat' },
        { key: 'PASSWORD', value: 'old-token' },
      ],
    });
    await store.saveCombo('C:/Repo', {
      comboId: 'github-account',
      comboLabel: 'GitHub production',
      description: 'Production release credentials',
      keys: [{ key: 'USERNAME' }, { key: 'TOKEN', value: 'new-token' }],
    });

    await expect(store.reveal('C:/Repo', 'GITHUB_ACCOUNT_USERNAME')).resolves.toBe('octocat');
    await expect(store.reveal('C:/Repo', 'GITHUB_ACCOUNT_PASSWORD')).rejects.toThrow('has no stored value');
    await expect(store.resolveEnvironment('C:/Repo', [], ['github-account'])).resolves.toEqual({
      GITHUB_ACCOUNT_USERNAME: 'octocat',
      GITHUB_PRODUCTION_TOKEN: 'new-token',
    });
  });

  it('removes every key when deleting a Combo', async () => {
    const store = createRepoSecretStore({ dir: 'C:/vault', fs: memoryFs(), crypto: crypto(), now: () => 1 });
    await store.saveCombo('C:/Repo', {
      comboId: 'deploy',
      comboLabel: 'Deploy',
      description: 'Deployment credentials',
      keys: [{ key: 'TOKEN', value: 'deploy-token' }],
    });

    await store.removeCombo('C:/Repo', 'deploy');

    await expect(store.listCombos('C:/Repo')).resolves.toEqual([]);
    await expect(store.reveal('C:/Repo', 'DEPLOY_TOKEN')).rejects.toThrow('has no stored value');
  });

  it('does not expose unpersisted Combo metadata when the atomic rename fails', async () => {
    const baseFs = memoryFs();
    let failRename = true;
    const fs: RepoSecretFs = {
      ...baseFs,
      rename: async (from, to) => {
        if (failRename) throw new Error('rename failed');
        await baseFs.rename(from, to);
      },
    };
    const store = createRepoSecretStore({ dir: 'C:/vault', fs, crypto: crypto(), now: () => 1 });

    await expect(
      store.saveCombo('C:/Repo', {
        comboId: 'deploy',
        comboLabel: 'Deploy',
        description: 'Deployment credentials',
        keys: [{ key: 'TOKEN', value: 'deploy-token' }],
      })
    ).rejects.toThrow('rename failed');
    await expect(store.listCombos('C:/Repo')).resolves.toEqual([]);

    failRename = false;
    await expect(
      store.saveCombo('C:/Repo', {
        comboId: 'deploy',
        comboLabel: 'Deploy',
        description: 'Deployment credentials',
        keys: [{ key: 'TOKEN', value: 'deploy-token' }],
      })
    ).resolves.toMatchObject({ comboId: 'deploy' });
  });

  it('serializes concurrent mutations so both repository secrets are preserved', async () => {
    const baseFs = memoryFs();
    let releaseFirstRename = (): void => undefined;
    let markFirstRenameStarted = (): void => undefined;
    const firstRenameStarted = new Promise<void>((resolve) => {
      markFirstRenameStarted = resolve;
    });
    const firstRenameGate = new Promise<void>((resolve) => {
      releaseFirstRename = resolve;
    });
    let renameCount = 0;
    const fs: RepoSecretFs = {
      ...baseFs,
      rename: async (from, to) => {
        renameCount += 1;
        if (renameCount === 1) {
          markFirstRenameStarted();
          await firstRenameGate;
        }
        await baseFs.rename(from, to);
      },
    };
    const store = createRepoSecretStore({ dir: 'C:/vault', fs, crypto: crypto(), now: () => 1 });

    const first = store.save('C:/Repo', 'FIRST_TOKEN', 'First credential', 'first');
    await firstRenameStarted;
    const second = store.save('C:/Repo', 'SECOND_TOKEN', 'Second credential', 'second');
    releaseFirstRename();
    await Promise.all([first, second]);

    expect((await store.list('C:/Repo')).map(({ alias }) => alias)).toEqual(['FIRST_TOKEN', 'SECOND_TOKEN']);
  });
});
