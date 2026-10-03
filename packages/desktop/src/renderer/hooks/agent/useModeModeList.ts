import useSWR from 'swr';

type ModelOption = Readonly<{ label: string; value: string }>;

export type ProviderModelList = Readonly<{ models: readonly ModelOption[] }>;

/** Stable renderer-facing failure; native error detail must not reach UI state. */
export const PROVIDER_DISCOVERY_UNAVAILABLE = 'provider-discovery-unavailable';
export const PROVIDER_MODEL_UNAVAILABLE = 'provider-model-unavailable';

const unavailable = (): Error => new Error(PROVIDER_DISCOVERY_UNAVAILABLE);

/**
 * Fetch models for an already-saved provider. The renderer provides only its
 * opaque provider ID; Main resolves any credential and controls network egress.
 */
export const fetchSavedProviderModelList = async (providerId: string): Promise<ProviderModelList> => {
  const providerDiscovery = typeof window === 'undefined' ? undefined : window.electronAPI?.providerDiscovery;
  if (!providerDiscovery) throw unavailable();

  try {
    const result = await providerDiscovery.fetchModels({ providerId });
    if (!result.ok) throw unavailable();

    return {
      models: result.models.map((model) => ({ label: model, value: model })),
    };
  } catch {
    throw unavailable();
  }
};

/**
 * Health is derived only from the native saved-provider discovery result. The
 * checked model remains renderer-local so the preload payload stays provider-ID only.
 */
export const checkSavedProviderModelHealth = async (
  providerId: string,
  model: string
): Promise<
  Readonly<{ healthy: boolean; code?: typeof PROVIDER_DISCOVERY_UNAVAILABLE | typeof PROVIDER_MODEL_UNAVAILABLE }>
> => {
  try {
    const { models } = await fetchSavedProviderModelList(providerId);
    return models.some(({ value }) => value === model)
      ? { healthy: true }
      : { healthy: false, code: PROVIDER_MODEL_UNAVAILABLE };
  } catch {
    return { healthy: false, code: PROVIDER_DISCOVERY_UNAVAILABLE };
  }
};

/**
 * Model discovery is intentionally unavailable while a provider is being
 * created: it has no durable ID and no Main-owned secret yet.
 */
const useModeModeList = (providerId?: string) => {
  return useSWR(providerId ? ['provider-discovery.fetch-models', providerId] : null, () =>
    fetchSavedProviderModelList(providerId!)
  );
};

export default useModeModeList;
