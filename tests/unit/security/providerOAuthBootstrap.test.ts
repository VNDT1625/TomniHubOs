import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/tmp/tomny') },
  shell: { openExternal: vi.fn() },
}));

import {
  createConfiguredProviderOAuthClients,
  OPENAI_PROVIDER_ID,
} from '@process/services/security/providerExecution/providerOAuthBootstrap';

describe('configured provider OAuth bootstrap', () => {
  const originalClientId = process.env.TOMNY_OPENAI_OAUTH_CLIENT_ID;

  afterEach(() => {
    if (originalClientId === undefined) delete process.env.TOMNY_OPENAI_OAUTH_CLIENT_ID;
    else process.env.TOMNY_OPENAI_OAUTH_CLIENT_ID = originalClientId;
  });

  it('does not register an OAuth client without a Tomny-owned client ID', () => {
    delete process.env.TOMNY_OPENAI_OAUTH_CLIENT_ID;
    expect(createConfiguredProviderOAuthClients({ requireOnlineSession: vi.fn() } as never)).toEqual(new Map());
  });

  it('registers only the configured provider identity when a client ID is supplied', () => {
    process.env.TOMNY_OPENAI_OAUTH_CLIENT_ID = 'tomny-client-id';
    const clients = createConfiguredProviderOAuthClients({ requireOnlineSession: vi.fn() } as never);
    expect([...clients.keys()]).toEqual([OPENAI_PROVIDER_ID]);
  });
});
