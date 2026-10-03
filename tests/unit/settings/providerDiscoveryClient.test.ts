import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkSavedProviderModelHealth,
  fetchSavedProviderModelList,
  PROVIDER_DISCOVERY_UNAVAILABLE,
  PROVIDER_MODEL_UNAVAILABLE,
} from '@/renderer/hooks/agent/useModeModeList';

describe('saved provider model discovery client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends only the saved provider ID to the native discovery bridge', async () => {
    const fetchModels = vi.fn().mockResolvedValue({ ok: true, models: ['gpt-5.6', 'gpt-5.5'] });
    vi.stubGlobal('window', { electronAPI: { providerDiscovery: { fetchModels } } });

    await expect(fetchSavedProviderModelList('provider-123')).resolves.toEqual({
      models: [
        { label: 'gpt-5.6', value: 'gpt-5.6' },
        { label: 'gpt-5.5', value: 'gpt-5.5' },
      ],
    });
    expect(fetchModels).toHaveBeenCalledOnce();
    expect(fetchModels).toHaveBeenCalledWith({ providerId: 'provider-123' });
  });

  it('maps every native denial and transport error to one opaque renderer failure', async () => {
    const fetchModels = vi.fn();
    vi.stubGlobal('window', { electronAPI: { providerDiscovery: { fetchModels } } });

    const denialChecks = [
      'PROVIDER_DISCOVERY_SENDER_UNTRUSTED',
      'PROVIDER_DISCOVERY_ACCOUNT_REQUIRED',
      'PROVIDER_DISCOVERY_EGRESS_FAILED',
    ].map((code) => {
      fetchModels.mockResolvedValueOnce({ ok: false, code });
      return expect(fetchSavedProviderModelList('provider-123')).rejects.toThrow(PROVIDER_DISCOVERY_UNAVAILABLE);
    });
    await Promise.all(denialChecks);

    fetchModels.mockRejectedValueOnce(new Error('credential abc123 at https://private.example.test'));
    await expect(fetchSavedProviderModelList('provider-123')).rejects.toThrow(PROVIDER_DISCOVERY_UNAVAILABLE);
  });

  it('derives model health from the typed result without including the model in the IPC payload', async () => {
    const fetchModels = vi.fn().mockResolvedValue({ ok: true, models: ['gpt-5.6'] });
    vi.stubGlobal('window', { electronAPI: { providerDiscovery: { fetchModels } } });

    await expect(checkSavedProviderModelHealth('provider-123', 'gpt-5.6')).resolves.toEqual({ healthy: true });
    await expect(checkSavedProviderModelHealth('provider-123', 'gpt-5.5')).resolves.toEqual({
      healthy: false,
      code: PROVIDER_MODEL_UNAVAILABLE,
    });
    expect(fetchModels).toHaveBeenNthCalledWith(1, { providerId: 'provider-123' });
    expect(fetchModels).toHaveBeenNthCalledWith(2, { providerId: 'provider-123' });
  });

  it('maps native health failure to a stable opaque health result', async () => {
    const fetchModels = vi.fn().mockRejectedValue(new Error('stored-secret at https://private.example.test'));
    vi.stubGlobal('window', { electronAPI: { providerDiscovery: { fetchModels } } });

    const result = await checkSavedProviderModelHealth('provider-123', 'gpt-5.6');
    expect(result).toEqual({
      healthy: false,
      code: PROVIDER_DISCOVERY_UNAVAILABLE,
    });
    expect(JSON.stringify(result)).not.toContain('stored-secret');
  });
});
