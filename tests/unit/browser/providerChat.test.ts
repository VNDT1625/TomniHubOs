import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProviderChat } from '@process/browser/providerChat';
import type { ProviderExecutionBroker } from '@process/services/security/providerExecution/providerExecutionBroker';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser provider chat', () => {
  it('delegates a Browser turn to the Main-owned execution broker without direct fetch access', async () => {
    const execute = vi.fn(async () => ({
      content: 'brokered browser completion',
      evidenceRef: 'provider-egress:opaque',
    }));
    const directFetch = vi.fn();
    vi.stubGlobal('fetch', directFetch);
    const chat = createProviderChat({ execute } as unknown as ProviderExecutionBroker);

    await expect(
      chat({ model: 'browser-model', messages: [{ role: 'user', content: 'browser instruction' }] })
    ).resolves.toBe('brokered browser completion');

    expect(execute).toHaveBeenCalledWith({
      model: 'browser-model',
      messages: [{ role: 'user', content: 'browser instruction' }],
      signal: undefined,
    });
    expect(directFetch).not.toHaveBeenCalled();
  });
});
