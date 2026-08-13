import { describe, expect, it } from 'vitest';
import {
  appProviderEnvironment,
  appProviderModels,
  tomnyModelArgs,
} from '../../../packages/desktop/src/process/experimentalCore/adapters/tomnyCoreAdapter';

describe('Tomny app provider catalog', () => {
  it('uses enabled models from app settings and does not expose secrets as CLI arguments', () => {
    const models = appProviderModels([
      {
        id: 'provider:one',
        platform: 'openai',
        name: 'App API',
        base_url: 'https://example.test/v1',
        api_key: 'secret',
        models: ['gpt-5.6', 'disabled'],
        model_enabled: { disabled: false },
        enabled: true,
      },
    ]);
    expect(models).toEqual([
      expect.objectContaining({
        modelId: 'gpt-5.6',
        label: 'gpt-5.6 (App API)',
        providerId: 'provider:one',
        isDefault: true,
      }),
    ]);
    expect(tomnyModelArgs(models[0]?.key)).toEqual([]);
  });

  it('passes an app-provider child only OS execution primitives and its selected credential', async () => {
    const environment = await appProviderEnvironment(
      'app-provider:provider%3Aone:gpt-5.6',
      {
        list: async () => [],
        get: async () => ({
          id: 'provider:one',
          platform: 'openai',
          name: 'App API',
          base_url: 'https://example.test/v1',
          api_key: 'selected-provider-secret\nunused-rotation-key',
          models: ['gpt-5.6'],
        }),
      },
      {
        PATH: 'C:\\Windows\\System32',
        SystemRoot: 'C:\\Windows',
        HTTP_PROXY: 'http://proxy.invalid:8080',
        AWS_SECRET_ACCESS_KEY: 'unrelated-cloud-secret',
        TOMNI_INTERNAL_TOKEN: 'unrelated-app-secret',
      }
    );

    expect(environment).toMatchObject({
      PATH: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
      PROVIDER: 'openai',
      MODEL: 'gpt-5.6',
      API_KEY: 'selected-provider-secret',
      BASE_URL: 'https://example.test/v1',
    });
    expect(environment).not.toHaveProperty('HTTP_PROXY');
    expect(environment).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(environment).not.toHaveProperty('TOMNI_INTERNAL_TOKEN');
  });
});
