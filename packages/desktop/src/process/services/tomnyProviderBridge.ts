/** Main-only provider catalog backed by the independent Tomny provider store. */
import type { IProvider } from '@/common/config/storage';
import { providerChannels } from '@/common/types/provider/providerChannels';

import { createProviderStore, toRendererProviderMetadata, type IProviderStore } from './tomnyProviderStore';
import { fetchProviderModelList, detectProviderProtocol } from './tomnyModelDiscovery';
import { readLegacyCatalog } from './database/legacyCatalogReader';
import { discoverLegacyDatabasePaths } from './database/runLegacyDatabaseMigrations';
import { ProcessConfig } from '@process/utils/initStorage';

let sharedStore: IProviderStore | undefined;
let migrationPromise: Promise<void> | undefined;

const migrateLegacyProvidersOnce = (store: IProviderStore): Promise<void> => {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    if ((await store.list()).length > 0) return;
    try {
      const databasePaths = discoverLegacyDatabasePaths();
      if (databasePaths.length === 0) return;
      const legacyProviders = (
        await Promise.race([
          readLegacyCatalog({
            databasePaths,
            readConfig: (key) => (ProcessConfig as unknown as { get(name: string): Promise<unknown> }).get(key),
          }),
          new Promise<Awaited<ReturnType<typeof readLegacyCatalog>>>((resolve) =>
            setTimeout(() => resolve({ providers: [], assistants: [], agents: [] }), 1200)
          ),
        ])
      ).providers;
      for (const provider of legacyProviders) {
        try {
          // Atomic file persistence is intentionally serialized during one-time migration.
          // eslint-disable-next-line no-await-in-loop
          await store.create(provider);
        } catch (error) {
          console.warn('[ProviderBridge] skipped a legacy provider during one-time migration:', error);
        }
      }
      if (legacyProviders.length > 0) {
        console.info(`[ProviderBridge] migrated ${legacyProviders.length} provider(s) into the Tomny store.`);
      }
    } catch {
      // A fresh installation has no legacy backend. The independent store remains usable.
    }
  })();
  return migrationPromise;
};
export const getProviderStore = (): IProviderStore => {
  if (!sharedStore) sharedStore = createProviderStore();
  return sharedStore;
};

export const getReadyProviderStore = async (): Promise<IProviderStore> => {
  const store = getProviderStore();
  await migrateLegacyProvidersOnce(store);
  return store;
};

/** Read the Main-only provider catalog after the one-time compatibility import. */
export const listReadyProviders = async (): Promise<IProvider[]> => (await getReadyProviderStore()).list();

export const resetProviderBridgeForTests = (): void => {
  sharedStore = undefined;
  migrationPromise = undefined;
};

export type RegisterProviderBridgeOptions = {
  providerStore?: IProviderStore | (() => Promise<IProviderStore>);
};

/**
 * Connects renderer provider channels (ipcBridge.mode) to the Main-owned provider store.
 * Strictly guarantees that raw secrets and API keys are redacted before crossing the bridge.
 */
export const registerProviderBridge = (options: RegisterProviderBridgeOptions = {}): (() => void) => {
  const resolveStore = async (): Promise<IProviderStore> => {
    if (typeof options.providerStore === 'function') {
      return options.providerStore();
    }
    return options.providerStore ?? getReadyProviderStore();
  };

  providerChannels.listProviders.provider(async () => {
    try {
      const store = await resolveStore();
      const providers = await store.list();
      return providers.map(toRendererProviderMetadata);
    } catch (error) {
      console.error('[ProviderBridge] listProviders failed:', error);
      return [];
    }
  });

  providerChannels.createProvider.provider(async (input) => {
    const store = await resolveStore();
    const created = await store.create(input);
    return toRendererProviderMetadata(created);
  });

  providerChannels.updateProvider.provider(async ({ id, ...input }) => {
    const store = await resolveStore();
    const updated = await store.update(id, input);
    return toRendererProviderMetadata(updated);
  });

  providerChannels.deleteProvider.provider(async ({ id }) => {
    const store = await resolveStore();
    await store.remove(id);
  });

  providerChannels.fetchProviderModels.provider(async ({ id }) => {
    try {
      const store = await resolveStore();
      const provider = await store.get(id);
      return { models: provider?.models ?? [] };
    } catch (error) {
      console.warn('[ProviderBridge] fetchProviderModels failed:', error);
      return { models: [] };
    }
  });

  providerChannels.fetchModelList.provider(async (request) => {
    try {
      return await fetchProviderModelList(request);
    } catch (error) {
      console.warn('[ProviderBridge] fetchModelList failed:', error);
      return { models: [] };
    }
  });

  providerChannels.detectProtocol.provider(async (request) => {
    try {
      return await detectProviderProtocol(request);
    } catch (error) {
      console.error('[ProviderBridge] detectProtocol error:', error);
      return {
        success: false,
        protocol: 'unknown',
        confidence: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return () => {
    // Unregistration hook if needed
  };
};
