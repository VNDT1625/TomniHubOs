import { describe, expect, it, vi } from 'vitest';
import {
  detectProviderProtocol,
  fetchProviderModelList,
  PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED,
} from '../../../packages/desktop/src/process/services/tomnyModelDiscovery';

const credentialAndEndpointTraps = () => {
  const request = { platform: 'openai', models: ['gpt-5.6', ' gpt-5.5 ', 'gpt-5.6', ''] } as Record<string, unknown>;
  Object.defineProperties(request, {
    api_key: {
      get: () => {
        throw new Error('credential must not be read');
      },
    },
    base_url: {
      get: () => {
        throw new Error('endpoint must not be read');
      },
    },
  });
  return request;
};

describe('Tomny model discovery containment', () => {
  it('returns only already configured models without reading a credential or endpoint or calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await fetchProviderModelList(credentialAndEndpointTraps() as never, fetchImpl);

    expect(result.models).toEqual(['gpt-5.6', 'gpt-5.5']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed before credential, endpoint, or network use when no configured models exist', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const request = { platform: 'openai' } as Record<string, unknown>;
    Object.defineProperties(request, {
      api_key: {
        get: () => {
          throw new Error('credential must not be read');
        },
      },
      base_url: {
        get: () => {
          throw new Error('endpoint must not be read');
        },
      },
    });

    await expect(fetchProviderModelList(request as never, fetchImpl)).rejects.toThrow(
      PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps an explicit protocol as display-only metadata and refuses remote verification', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const request = { preferredProtocol: 'gemini' } as Record<string, unknown>;
    Object.defineProperties(request, {
      api_key: {
        get: () => {
          throw new Error('credential must not be read');
        },
      },
      base_url: {
        get: () => {
          throw new Error('endpoint must not be read');
        },
      },
    });

    await expect(detectProviderProtocol(request as never, fetchImpl)).resolves.toMatchObject({
      success: false,
      protocol: 'gemini',
      confidence: 0,
      error: PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
