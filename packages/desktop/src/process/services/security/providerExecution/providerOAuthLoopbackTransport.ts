import { createServer, type Server } from 'node:http';

import type { ProviderOAuthCallback, ProviderOAuthTransport } from './providerOAuthClient';

const DEFAULT_TIMEOUT_MS = 180_000;

const isLoopback = (hostname: string): boolean =>
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';

/** Main-owned loopback callback transport used by desktop OAuth flows. */
export const createProviderOAuthLoopbackTransport = (
  openExternal: (url: string) => Promise<void>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): ProviderOAuthTransport => {
  let activeServer: Server | undefined;

  const waitForCallback = async ({
    redirectUri,
    state,
  }: Readonly<{ redirectUri: string; state: string }>): Promise<ProviderOAuthCallback> => {
    const redirect = new URL(redirectUri);
    if (
      redirect.protocol !== 'http:' ||
      !isLoopback(redirect.hostname) ||
      !redirect.port ||
      redirect.username ||
      redirect.password ||
      redirect.hash
    ) {
      throw new Error('PROVIDER_OAUTH_INVALID_DESCRIPTOR');
    }
    if (activeServer) throw new Error('PROVIDER_OAUTH_CALLBACK_BUSY');

    let server: Server | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCallback: ((reason: Error) => void) | undefined;
    const callback = new Promise<ProviderOAuthCallback>((resolve, reject) => {
      rejectCallback = reject;
      server = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', redirect.origin);
        if (requestUrl.pathname !== redirect.pathname) {
          response.writeHead(404).end('Not found.');
          return;
        }
        if (requestUrl.searchParams.get('state') !== state) {
          response.writeHead(400).end('Invalid OAuth state.');
          reject(new Error('PROVIDER_OAUTH_CALLBACK_INVALID'));
          return;
        }
        const error = requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code');
        if (error || !code) {
          response.writeHead(400).end('Authorization failed.');
          reject(new Error(error ?? 'PROVIDER_OAUTH_CALLBACK_INVALID'));
          return;
        }
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Authorization complete. You can return to Tomny.');
        resolve({ code, state });
      });
      server.once('error', reject);
    });

    activeServer = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server?.listen(Number(redirect.port), redirect.hostname, resolve);
        server?.once('error', reject);
      });
      timer = setTimeout(() => {
        rejectCallback?.(new Error('PROVIDER_OAUTH_TIMEOUT'));
        server?.close();
      }, timeoutMs);
      return await callback;
    } finally {
      if (timer) clearTimeout(timer);
      server?.close();
      activeServer = undefined;
    }
  };

  return {
    openExternal,
    waitForCallback,
    authorizeEgress: (endpoint) => {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'https:') throw new Error('PROVIDER_OAUTH_EGRESS_DENIED');
    },
  };
};
