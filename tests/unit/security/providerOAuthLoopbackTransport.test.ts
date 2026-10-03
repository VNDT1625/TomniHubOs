import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createProviderOAuthLoopbackTransport } from '@process/services/security/providerExecution/providerOAuthLoopbackTransport';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        })
    )
  );
});

const freePort = async (): Promise<number> => {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

const callbackRequest = (url: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: 'GET' }, (response) => {
      response.resume();
      response.once('end', () => resolve());
    });
    request.once('error', reject);
    request.end();
  });

describe('provider OAuth loopback transport', () => {
  it('rejects direct waiting without an authorization opener', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const transport = createProviderOAuthLoopbackTransport(async () => undefined, 10);
    await expect(transport.waitForCallback({ redirectUri, state: 'state-1' })).rejects.toMatchObject({
      message: 'PROVIDER_OAUTH_TIMEOUT',
    });
  });

  it('accepts the exact loopback callback and returns the authorization code', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const transport = createProviderOAuthLoopbackTransport(async () => undefined, 1_000);
    const pending = transport.waitForCallback({ redirectUri, state: 'state-1' });
    void pending.catch(() => undefined);
    await callbackRequest(`${redirectUri}?code=code-1&state=state-1`);
    await expect(pending).resolves.toEqual({ code: 'code-1', state: 'state-1' });
  });

  it('rejects an invalid state and cleans up the listener', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const transport = createProviderOAuthLoopbackTransport(async () => undefined, 1_000);
    const pending = transport.waitForCallback({ redirectUri, state: 'state-1' });
    void pending.catch(() => undefined);
    await callbackRequest(`${redirectUri}?code=code-1&state=wrong-state`);
    await expect(pending).rejects.toMatchObject({ message: 'PROVIDER_OAUTH_CALLBACK_INVALID' });

    const next = transport.waitForCallback({ redirectUri, state: 'state-2' });
    await expect(next).rejects.toMatchObject({ message: 'PROVIDER_OAUTH_TIMEOUT' });
  });

  it('ignores a wrong callback path, then times out and denies non-HTTPS egress', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const transport = createProviderOAuthLoopbackTransport(async () => undefined, 15);
    const pending = transport.waitForCallback({ redirectUri, state: 'state-1' });
    void pending.catch(() => undefined);
    await expect(callbackRequest(`http://127.0.0.1:${port}/wrong?code=x&state=state-1`)).resolves.toBeUndefined();
    await expect(pending).rejects.toMatchObject({ message: 'PROVIDER_OAUTH_TIMEOUT' });
    expect(() => transport.authorizeEgress?.('http://provider.example/oauth')).toThrow('PROVIDER_OAUTH_EGRESS_DENIED');
  });
});
