/** Main-process provider store with OS-encrypted secrets and atomic writes. */
import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import type { CreateProviderRequest, UpdateProviderRequest } from '@/common/types/provider/providerApi';

const PROVIDERS_FILE = 'tomny-providers.json';
type ProviderSecrets = { apiKey: string; bedrockSecretAccessKey?: string; endpoint?: string };
type StoredProvider = Omit<IProvider, 'api_key' | 'bedrock_config'> & {
  bedrock_config?: Omit<NonNullable<IProvider['bedrock_config']>, 'secret_access_key'>;
  encryptedSecrets: string;
  osEncrypted: boolean;
  version?: number;
};

export type ProviderDestinationBinding = Readonly<{
  providerId: string;
  endpoint: string;
  isFullUrl: boolean;
  version: number;
  platform?: string;
}>;

export const canonicalEndpoint = (raw: string): string => {
  const trimmed = raw.trim();
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/u, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return trimmed.replace(/\/+$/u, '');
  }
};

export type ProviderFs = {
  readFile(filePath: string, encoding: 'utf-8'): Promise<string>;
  writeFile(filePath: string, data: string, options: { encoding: 'utf-8'; mode?: number }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(dirPath: string, options: { recursive: true }): Promise<string | undefined>;
};
export type ProviderCrypto = {
  isAvailable(): boolean;
  encrypt(plain: string): string;
  decrypt(base64: string, osEncrypted: boolean): string;
};
export type ProviderStoreOptions = { dir?: string; fs?: ProviderFs; crypto?: ProviderCrypto; newId?: () => string };
export type IProviderStore = {
  list(): Promise<IProvider[]>;
  get(id: string): Promise<IProvider | undefined>;
  create(input: CreateProviderRequest): Promise<IProvider>;
  update(id: string, input: UpdateProviderRequest): Promise<IProvider>;
  remove(id: string): Promise<void>;
  getDestinationBinding?(id: string): Promise<ProviderDestinationBinding | undefined>;
};

/** Returns provider metadata that is safe to expose to the untrusted renderer. */
export const toRendererProviderMetadata = (provider: IProvider): IProvider => ({
  ...provider,
  api_key: '',
  bedrock_config: provider.bedrock_config
    ? {
        ...provider.bedrock_config,
        secret_access_key: undefined,
      }
    : undefined,
});

const defaultFs: ProviderFs = {
  readFile: (filePath, encoding) => fs.promises.readFile(filePath, encoding),
  writeFile: (filePath, data, options) => fs.promises.writeFile(filePath, data, options),
  rename: (oldPath, newPath) => fs.promises.rename(oldPath, newPath),
  mkdir: (dirPath, options) => fs.promises.mkdir(dirPath, options),
};
const defaultCrypto: ProviderCrypto = {
  isAvailable: () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt: (plain) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable.');
    }
    return safeStorage.encryptString(plain).toString('base64');
  },
  decrypt: (base64, osEncrypted) => {
    if (!osEncrypted) {
      return Buffer.from(base64, 'base64').toString('utf8');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable.');
    }
    const bytes = Buffer.from(base64, 'base64');
    return safeStorage.decryptString(bytes);
  },
};
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNotFound = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
const isStoredProvider = (value: unknown): value is StoredProvider =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.platform === 'string' &&
  typeof value.encryptedSecrets === 'string' &&
  typeof value.osEncrypted === 'boolean';
const normalizeCreate = (input: CreateProviderRequest, id: string): IProvider => ({
  id,
  platform: input.platform.trim(),
  name: input.name.trim(),
  base_url: input.base_url.trim(),
  api_key: input.api_key,
  auth_type: input.auth_type ?? 'api-key',
  models: input.models ?? [],
  capabilities: input.capabilities,
  context_limit: input.context_limit,
  model_protocols: input.model_protocols,
  bedrock_config: input.bedrock_config,
  enabled: input.enabled ?? true,
  model_enabled: input.model_enabled,
  model_health: input.model_health,
  is_full_url: input.is_full_url,
});

/** Create the independent provider store used by both Settings and Tomny CLI. */
export const createProviderStore = (options: ProviderStoreOptions = {}): IProviderStore => {
  const fsImpl = options.fs ?? defaultFs;
  const crypto = options.crypto ?? defaultCrypto;
  const newId = options.newId ?? randomUUID;
  const dir = options.dir ?? app.getPath('userData');
  const filePath = path.join(dir, PROVIDERS_FILE);
  let cache: StoredProvider[] = [];
  let loaded = false;
  let mutationQueue = Promise.resolve();

  const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = mutationQueue;
    let release = (): void => undefined;
    mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const decodeSecrets = (stored: StoredProvider): ProviderSecrets => {
    const value = JSON.parse(crypto.decrypt(stored.encryptedSecrets, stored.osEncrypted)) as unknown;
    if (!isObject(value) || typeof value.apiKey !== 'string') {
      throw new Error(`Provider credentials are invalid for ${stored.id}.`);
    }
    const endpoint = typeof value.endpoint === 'string' ? value.endpoint : undefined;
    return {
      apiKey: value.apiKey,
      bedrockSecretAccessKey:
        typeof value.bedrockSecretAccessKey === 'string' ? value.bedrockSecretAccessKey : undefined,
      endpoint,
    };
  };

  const providerFromStored = (stored: StoredProvider, secrets: ProviderSecrets): IProvider => {
    const bedrock_config = stored.bedrock_config
      ? { ...stored.bedrock_config, secret_access_key: secrets.bedrockSecretAccessKey }
      : undefined;
    const { encryptedSecrets: _encryptedSecrets, osEncrypted: _osEncrypted, version: _version, ...provider } = stored;
    return { ...provider, api_key: secrets.apiKey, bedrock_config };
  };

  const decode = (stored: StoredProvider): IProvider => {
    try {
      const secrets = decodeSecrets(stored);
      if (!secrets.endpoint || secrets.endpoint !== canonicalEndpoint(stored.base_url)) {
        return providerFromStored(stored, { apiKey: '', endpoint: secrets.endpoint });
      }
      return providerFromStored(stored, secrets);
    } catch (error) {
      console.warn(`[ProviderStore] credentials for ${stored.id} could not be decrypted:`, error);
      return providerFromStored(stored, { apiKey: '' });
    }
  };

  const metadataFor = (provider: IProvider): Omit<StoredProvider, 'encryptedSecrets' | 'osEncrypted' | 'version'> => {
    const bedrock_config = provider.bedrock_config
      ? {
          auth_method: provider.bedrock_config.auth_method,
          region: provider.bedrock_config.region,
          access_key_id: provider.bedrock_config.access_key_id,
          profile: provider.bedrock_config.profile,
        }
      : undefined;
    const { api_key: _apiKey, bedrock_config: _bedrockConfig, ...metadata } = provider;
    return { ...metadata, bedrock_config };
  };

  const encode = (provider: IProvider, version = 1): StoredProvider => {
    if (!crypto.isAvailable()) {
      throw new Error('Secure credential storage is unavailable.');
    }
    const secrets: ProviderSecrets = {
      apiKey: provider.api_key,
      bedrockSecretAccessKey: provider.bedrock_config?.secret_access_key,
      endpoint: canonicalEndpoint(provider.base_url),
    };
    return {
      ...metadataFor(provider),
      version,
      encryptedSecrets: crypto.encrypt(JSON.stringify(secrets)),
      osEncrypted: true,
    };
  };

  const ensureLoaded = async (): Promise<void> => {
    if (loaded) return;
    try {
      const parsed = JSON.parse(await fsImpl.readFile(filePath, 'utf-8')) as unknown;
      const rawList = Array.isArray(parsed) ? parsed : isStoredProvider(parsed) ? [parsed] : null;
      if (!rawList || rawList.some((value) => !isStoredProvider(value))) {
        throw new Error('Provider catalog has an invalid shape.');
      }
      cache = rawList;
      loaded = true;
    } catch (error) {
      if (isNotFound(error)) {
        cache = [];
        loaded = true;
        return;
      }
      console.warn('[ProviderStore] read failed; preserving the existing file:', error);
      throw new Error('Provider catalog could not be read safely. No provider changes were applied.', { cause: error });
    }
  };

  const persist = async (next: StoredProvider[]): Promise<void> => {
    const tempPath = `${filePath}.tmp`;
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    await fsImpl.rename(tempPath, filePath);
    cache = next;
  };

  return {
    async list() {
      await ensureLoaded();
      return cache.map(decode);
    },
    async get(id) {
      await ensureLoaded();
      const found = cache.find((provider) => provider.id === id);
      return found ? decode(found) : undefined;
    },
    async getDestinationBinding(id) {
      await ensureLoaded();
      const found = cache.find((provider) => provider.id === id);
      if (!found) return undefined;
      return {
        providerId: found.id,
        endpoint: canonicalEndpoint(found.base_url),
        isFullUrl: Boolean(found.is_full_url),
        version: found.version ?? 1,
        platform: found.platform,
      };
    },
    create(input) {
      return exclusive(async () => {
        await ensureLoaded();
        const id = input.id?.trim() || newId();
        if (cache.some((provider) => provider.id === id)) throw new Error(`Provider already exists: ${id}`);
        const provider = normalizeCreate(input, id);
        await persist([...cache, encode(provider, 1)]);
        return provider;
      });
    },
    update(id, input) {
      return exclusive(async () => {
        await ensureLoaded();
        const index = cache.findIndex((provider) => provider.id === id);
        if (index < 0) throw new Error(`Provider not found: ${id}`);
        const stored = cache[index];

        let existingSecrets: ProviderSecrets;
        try {
          existingSecrets = decodeSecrets(stored);
        } catch (error) {
          const replacementApiKey = input.api_key?.trim();
          const replacementBedrockSecret = input.bedrock_config?.secret_access_key?.trim();
          const nextPlatform = input.platform?.trim() ?? stored.platform;
          const nextBedrockAuth = input.bedrock_config?.auth_method ?? stored.bedrock_config?.auth_method;
          const requiresApiKey = nextPlatform !== 'bedrock';
          const requiresBedrockSecret = nextPlatform === 'bedrock' && nextBedrockAuth === 'accessKey';
          if ((requiresApiKey && !replacementApiKey) || (requiresBedrockSecret && !replacementBedrockSecret)) {
            throw new Error(
              'Existing provider credentials could not be decrypted. Update aborted to prevent credential loss; re-enter the credentials explicitly.',
              { cause: error }
            );
          }
          existingSecrets = {
            apiKey: replacementApiKey ?? '',
            bedrockSecretAccessKey: replacementBedrockSecret,
          };
        }

        const endpointChanged =
          input.base_url !== undefined && canonicalEndpoint(input.base_url) !== canonicalEndpoint(stored.base_url);
        if (endpointChanged && !input.api_key?.trim()) {
          throw new Error('Provider endpoint changed. Enter new credentials to rotate them before saving.');
        }

        if (
          (!existingSecrets.endpoint || existingSecrets.endpoint !== canonicalEndpoint(stored.base_url)) &&
          !input.api_key?.trim()
        ) {
          throw new Error(
            'Existing provider credentials could not be decrypted. Update aborted to prevent credential loss; re-enter the credentials explicitly.'
          );
        }

        const current = providerFromStored(stored, existingSecrets);
        const suppliedApiKey = input.api_key?.trim() || undefined;
        const suppliedBedrockSecret = input.bedrock_config?.secret_access_key?.trim() || undefined;
        const nextBedrockConfig = input.bedrock_config
          ? {
              ...current.bedrock_config,
              ...input.bedrock_config,
              secret_access_key: suppliedBedrockSecret ?? current.bedrock_config?.secret_access_key,
            }
          : current.bedrock_config;
        const provider: IProvider = {
          ...current,
          ...input,
          id,
          platform: input.platform?.trim() ?? current.platform,
          name: input.name?.trim() ?? current.name,
          base_url: input.base_url?.trim() ?? current.base_url,
          api_key: suppliedApiKey ?? current.api_key,
          bedrock_config: nextBedrockConfig,
        };

        const nextVersion = (stored.version ?? 1) + 1;
        const secretsChanged =
          suppliedApiKey !== undefined ||
          suppliedBedrockSecret !== undefined ||
          input.bedrock_config?.auth_method !== undefined ||
          endpointChanged;
        const nextStored: StoredProvider = secretsChanged
          ? encode(provider, nextVersion)
          : {
              ...metadataFor(provider),
              version: nextVersion,
              encryptedSecrets: stored.encryptedSecrets,
              osEncrypted: stored.osEncrypted,
            };
        const next = [...cache];
        next[index] = nextStored;
        await persist(next);
        return provider;
      });
    },
    remove(id) {
      return exclusive(async () => {
        await ensureLoaded();
        await persist(cache.filter((provider) => provider.id !== id));
      });
    },
  };
};
