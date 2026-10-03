import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => 'unused' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  },
}));

import {
  createProviderStore,
  toRendererProviderMetadata,
  type ProviderCrypto,
  type ProviderFs,
} from '../../../packages/desktop/src/process/services/tomnyProviderStore';

describe('Tomny provider store', () => {
  let files: Map<string, string>;
  let fs: ProviderFs;
  const crypto: ProviderCrypto = {
    isAvailable: () => true,
    encrypt: (plain) => Buffer.from(`encrypted:${plain}`, 'utf8').toString('base64'),
    decrypt: (value) =>
      Buffer.from(value, 'base64')
        .toString('utf8')
        .replace(/^encrypted:/u, ''),
  };

  beforeEach(() => {
    files = new Map();
    fs = {
      readFile: async (filePath) => {
        const value = files.get(filePath);
        if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return value;
      },
      writeFile: async (filePath, data) => {
        files.set(filePath, data);
      },
      rename: async (oldPath, newPath) => {
        const value = files.get(oldPath);
        if (value === undefined) throw new Error('missing temp file');
        files.set(newPath, value);
        files.delete(oldPath);
      },
      mkdir: async () => undefined,
    };
  });

  it('gracefully handles single provider object file layout', async () => {
    const singleObj = {
      id: 'provider-1',
      platform: 'openai',
      name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      models: ['gpt-5.6'],
      enabled: true,
      encryptedSecrets: crypto.encrypt(
        JSON.stringify({ apiKey: 'sk-secret-value', endpoint: 'https://api.openai.com/v1' })
      ),
      osEncrypted: false,
    };
    files.set(path.join('test-data', 'tomny-providers.json'), JSON.stringify(singleObj));
    const store = createProviderStore({ dir: 'test-data', fs, crypto });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('provider-1');
  });

  it('encrypts provider secrets at rest and returns them to Main consumers', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await store.create({
      platform: 'openai',
      name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-secret-value',
      models: ['gpt-5.6'],
    });

    const persisted = [...files.values()][0] ?? '';
    expect(persisted).not.toContain('sk-secret-value');
    expect(await store.get('provider-1')).toMatchObject({
      api_key: 'sk-secret-value',
      models: ['gpt-5.6'],
      enabled: true,
      auth_type: 'api-key',
    });
  });

  it('exposes only a revisioned canonical destination binding to Main authorities', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await store.create({
      platform: 'openai',
      name: 'OpenAI',
      base_url: 'https://EXAMPLE.test:443/v1/',
      api_key: 'sk-secret-value',
      is_full_url: false,
    });

    await expect(store.getDestinationBinding?.('provider-1')).resolves.toEqual({
      providerId: 'provider-1',
      endpoint: 'https://example.test/v1',
      isFullUrl: false,
      version: 1,

      platform: 'openai',
    });
    await store.update('provider-1', { enabled: false });
    await expect(store.getDestinationBinding?.('provider-1')).resolves.toMatchObject({ version: 2 });
  });

  it('fails closed before persisting credentials when secure storage is unavailable', async () => {
    const unavailableCrypto: ProviderCrypto = {
      isAvailable: () => false,
      encrypt: crypto.encrypt,
      decrypt: crypto.decrypt,
    };
    const store = createProviderStore({ dir: 'test-data', fs, crypto: unavailableCrypto, newId: () => 'provider-1' });

    await expect(
      store.create({
        platform: 'openai',
        name: 'OpenAI',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-secret-value',
      })
    ).rejects.toThrow('Secure credential storage is unavailable');

    expect(files.size).toBe(0);
  });

  it('removes provider secret material from renderer metadata', () => {
    expect(
      toRendererProviderMetadata({
        id: 'provider-1',
        platform: 'bedrock',
        name: 'Bedrock',
        base_url: 'https://bedrock.example.test',
        api_key: 'secret-api-key',
        models: ['model-a'],
        bedrock_config: {
          auth_method: 'accessKey',
          region: 'ap-southeast-1',
          access_key_id: 'access-key-id',
          secret_access_key: 'secret-access-key',
        },
      })
    ).toMatchObject({
      api_key: '',
      bedrock_config: {
        access_key_id: 'access-key-id',
        secret_access_key: undefined,
      },
    });
  });

  it('persists OAuth transport metadata without persisting a bearer token', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-oauth' });
    await store.create({
      platform: 'openai',
      name: 'OAuth provider',
      base_url: 'https://api.example.test/v1',
      api_key: '',
      auth_type: 'oauth',
      models: ['model-oauth'],
    });
    expect(await store.get('provider-oauth')).toMatchObject({ auth_type: 'oauth', api_key: '' });
    expect([...files.values()][0] ?? '').not.toContain('bearer-token');
  });

  it('updates and removes providers without changing their identity', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await store.create({
      platform: 'openai',
      name: 'Primary',
      base_url: 'https://example.test/v1',
      api_key: 'key',
      models: ['model-a'],
    });
    const updated = await store.update('provider-1', { name: 'Updated', models: ['model-b'] });
    expect(updated).toMatchObject({ id: 'provider-1', name: 'Updated', models: ['model-b'], api_key: 'key' });
    await store.remove('provider-1');
    expect(await store.list()).toEqual([]);
  });

  it('treats a blank API key in a metadata update as keep-existing', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await store.create({
      platform: 'openai',
      name: 'Primary',
      base_url: 'https://example.test/v1',
      api_key: 'keep-me',
      models: ['model-a'],
    });
    const filePath = path.join('test-data', 'tomny-providers.json');
    const before = JSON.parse(files.get(filePath) ?? '[]') as Array<{ encryptedSecrets: string }>;

    await store.update('provider-1', { name: 'Renamed', api_key: '' });

    const after = JSON.parse(files.get(filePath) ?? '[]') as Array<{ encryptedSecrets: string }>;
    expect(after[0]?.encryptedSecrets).toBe(before[0]?.encryptedSecrets);
    await expect(store.get('provider-1')).resolves.toMatchObject({ name: 'Renamed', api_key: 'keep-me' });
  });

  it('retains credentials for a canonical-equivalent endpoint metadata update', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await store.create({
      platform: 'openai',
      name: 'Primary',
      base_url: 'https://EXAMPLE.test:443/v1/',
      api_key: 'keep-me',
    });
    const filePath = path.join('test-data', 'tomny-providers.json');
    const before = JSON.parse(files.get(filePath) ?? '[]') as Array<{ encryptedSecrets: string }>;

    await store.update('provider-1', { base_url: ' https://example.test/v1 ', name: 'Renamed', api_key: '' });

    const after = JSON.parse(files.get(filePath) ?? '[]') as Array<{ encryptedSecrets: string }>;
    expect(after[0]?.encryptedSecrets).toBe(before[0]?.encryptedSecrets);
    await expect(store.get('provider-1')).resolves.toMatchObject({
      name: 'Renamed',
      base_url: 'https://example.test/v1',
      api_key: 'keep-me',
    });
  });

  it('does not preserve an API key when the provider endpoint changes without a rotation', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await store.create({
      platform: 'openai',
      name: 'Primary',
      base_url: 'https://example.test/v1',
      api_key: 'old-key',
    });
    const filePath = path.join('test-data', 'tomny-providers.json');
    const before = files.get(filePath);

    await expect(
      store.update('provider-1', { base_url: 'https://other.example.test/v1', api_key: '' })
    ).rejects.toThrow('Provider endpoint changed. Enter new credentials to rotate them before saving.');

    expect(files.get(filePath)).toBe(before);
    await expect(store.get('provider-1')).resolves.toMatchObject({
      base_url: 'https://example.test/v1',
      api_key: 'old-key',
    });
  });

  it('re-encrypts explicitly rotated credentials at a new endpoint across restart', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await store.create({
      platform: 'openai',
      name: 'Primary',
      base_url: 'https://example.test/v1',
      api_key: 'old-key',
    });
    const filePath = path.join('test-data', 'tomny-providers.json');
    const before = JSON.parse(files.get(filePath) ?? '[]') as Array<{ encryptedSecrets: string }>;

    await store.update('provider-1', { base_url: 'https://other.example.test/v1', api_key: 'rotated-key' });

    const after = JSON.parse(files.get(filePath) ?? '[]') as Array<{ encryptedSecrets: string }>;
    expect(after[0]?.encryptedSecrets).not.toBe(before[0]?.encryptedSecrets);
    const reopened = createProviderStore({ dir: 'test-data', fs, crypto });
    await expect(reopened.get('provider-1')).resolves.toMatchObject({
      base_url: 'https://other.example.test/v1',
      api_key: 'rotated-key',
    });
  });

  it('fails closed for a legacy persisted secret without an endpoint binding until credentials rotate', async () => {
    const store = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await store.create({
      platform: 'openai',
      name: 'Primary',
      base_url: 'https://example.test/v1',
      api_key: 'legacy-key',
    });
    const filePath = path.join('test-data', 'tomny-providers.json');
    const persisted = JSON.parse(files.get(filePath) ?? '[]') as Array<{ encryptedSecrets: string }>;
    const legacySecrets = JSON.parse(
      Buffer.from(persisted[0]?.encryptedSecrets ?? '', 'base64')
        .toString('utf8')
        .replace(/^encrypted:/u, '')
    ) as { apiKey: string; endpoint?: string };
    delete legacySecrets.endpoint;
    persisted[0]!.encryptedSecrets = Buffer.from(`encrypted:${JSON.stringify(legacySecrets)}`, 'utf8').toString(
      'base64'
    );
    files.set(filePath, `${JSON.stringify(persisted)}\n`);

    const reopened = createProviderStore({ dir: 'test-data', fs, crypto });
    await expect(reopened.get('provider-1')).resolves.toMatchObject({ api_key: '' });
    await expect(reopened.update('provider-1', { name: 'Must not persist' })).rejects.toThrow(
      'Update aborted to prevent credential loss'
    );
    await expect(reopened.update('provider-1', { api_key: 'rotated-key' })).resolves.toMatchObject({
      api_key: 'rotated-key',
    });
    const migrated = createProviderStore({ dir: 'test-data', fs, crypto });
    await expect(migrated.get('provider-1')).resolves.toMatchObject({ api_key: 'rotated-key' });
  });

  it('aborts an update instead of overwriting credentials when decryption fails', async () => {
    const initialStore = createProviderStore({ dir: 'test-data', fs, crypto, newId: () => 'provider-1' });
    await initialStore.create({
      platform: 'openai',
      name: 'Primary',
      base_url: 'https://example.test/v1',
      api_key: 'keep-me',
      models: ['model-a'],
    });
    const filePath = path.join('test-data', 'tomny-providers.json');
    const before = files.get(filePath);
    const brokenCrypto: ProviderCrypto = {
      isAvailable: () => true,
      encrypt: crypto.encrypt,
      decrypt: () => {
        throw new Error('keychain unavailable');
      },
    };
    const reopened = createProviderStore({ dir: 'test-data', fs, crypto: brokenCrypto });

    await expect(reopened.update('provider-1', { name: 'Must not persist' })).rejects.toThrow(
      'Update aborted to prevent credential loss'
    );
    expect(files.get(filePath)).toBe(before);
  });

  it('rejects a malformed provider catalog instead of treating it as an empty store', async () => {
    files.set(path.join('test-data', 'tomny-providers.json'), '{not-json');
    const store = createProviderStore({ dir: 'test-data', fs, crypto });

    await expect(store.list()).rejects.toThrow('Provider catalog could not be read safely');
    expect(files.get(path.join('test-data', 'tomny-providers.json'))).toBe('{not-json');
  });
});
