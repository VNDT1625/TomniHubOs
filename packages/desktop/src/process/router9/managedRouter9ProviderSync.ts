/**
 * Synchronize Tomny's internal provider record with the managed model gateway.
 * The app uses its own client key; external CLI keys are never reused here.
 */
import { TOMNI_GATEWAY_APP_CLIENT_NAME, TOMNI_GATEWAY_PROVIDER_ID } from '@/common/router9';
import type { IProviderStore } from '@process/services/tomnyProviderStore';
import type { ManagedRouter9Service, ManagedRouter9Status } from './managedRouter9';

export type ManagedRouter9ProviderSync = {
  providerId: string;
  models: string[];
};

type GatewayProviderSource = Pick<ManagedRouter9Service, 'start' | 'ensureClient' | 'listModels'>;
type AutoStartGatewayProviderSource = GatewayProviderSource & Pick<ManagedRouter9Service, 'startIfEnabled'>;

export const syncManagedRouter9Provider = async (
  managed: GatewayProviderSource,
  store: IProviderStore
): Promise<ManagedRouter9ProviderSync> => {
  const status = await managed.start();
  const client = await managed.ensureClient(TOMNI_GATEWAY_APP_CLIENT_NAME);
  if (!client.key) throw new Error('Tomny model-gateway client key is unavailable.');

  const models = (await managed.listModels(client.key)).map((item) => item.id).filter(Boolean);
  const provider = {
    id: TOMNI_GATEWAY_PROVIDER_ID,
    platform: 'new-api',
    name: 'Tomny Model Gateway',
    base_url: status.baseUrl,
    api_key: client.key,
    models,
    model_protocols: Object.fromEntries(models.map((model) => [model, 'openai'])),
    enabled: true,
  };
  const current = await store.get(TOMNI_GATEWAY_PROVIDER_ID);

  if (current) {
    const { id: _id, ...update } = provider;
    await store.update(TOMNI_GATEWAY_PROVIDER_ID, update);
  } else {
    await store.create(provider);
  }
  return { providerId: TOMNI_GATEWAY_PROVIDER_ID, models };
};

/** Start a persisted managed gateway and synchronize Tomny's private client when it becomes ready. */
export const autoStartAndSyncManagedRouter9Provider = async (
  managed: AutoStartGatewayProviderSource,
  store: IProviderStore
): Promise<{ status: ManagedRouter9Status; sync?: ManagedRouter9ProviderSync }> => {
  const status = await managed.startIfEnabled();
  if (!status.autoStart || (status.state !== 'running' && status.state !== 'external')) return { status };
  return { status, sync: await syncManagedRouter9Provider(managed, store) };
};
