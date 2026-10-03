import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  PROVIDER_DISCOVERY_NATIVE_CHANNELS,
  type ProviderDiscoveryNativeResult,
} from '@/common/types/platform/electron';
import type { IProvider } from '@/common/config/storage';
import type { AccountSessionService } from '../accountSession/accountSessionService';
import { fetchProviderModelList, type ProviderFetch } from '../../tomnyModelDiscovery';
import type { IProviderStore } from '../../tomnyProviderStore';

const MAX_RESPONSE_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 12_000;

export type ProviderDiscoveryStore = Pick<IProviderStore, 'get'>;

export type ProviderDnsLookup = (hostname: string) => Promise<readonly string[]>;

export type ProviderDiscoveryBridgeOptions = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  accountSession: AccountSessionService;
  providerStore: ProviderDiscoveryStore;
  verifySender(event: IpcMainInvokeEvent): boolean;
  fetchModels?: (provider: IProvider) => Promise<readonly string[]>;
}>;

const resolveAddresses: ProviderDnsLookup = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

const isLoopbackIpv4 = (value: string): boolean => /^127(?:\.\d{1,3}){3}$/u.test(value);
const isPrivateIpv4 = (value: string): boolean => {
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  );
};
const normalizedIpv6 = (value: string): string => value.toLowerCase().replace(/^\[|\]$/gu, '');
const isLoopbackIpv6 = (value: string): boolean => normalizedIpv6(value) === '::1';
const isPrivateIpv6 = (value: string): boolean => {
  const normalized = normalizedIpv6(value);
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('::ffff:')
  );
};
const isIpv4 = (value: string): boolean => /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value);
const isIpv6 = (value: string): boolean => value.includes(':');
const isExplicitLoopback = (hostname: string): boolean => isLoopbackIpv4(hostname) || isLoopbackIpv6(hostname);
const isPublicIp = (value: string): boolean =>
  isIpv4(value) ? !isPrivateIpv4(value) : isIpv6(value) ? !isPrivateIpv6(value) : false;

/**
 * Validates the final candidate URL before socket creation. HTTP is limited to
 * literal loopback; HTTPS may resolve only to public addresses. Redirects are
 * disabled by the pinned request function below, so a validated URL cannot be
 * switched after policy evaluation.
 */
export const assertProviderDiscoveryDestination = async (
  value: string,
  resolve: ProviderDnsLookup = resolveAddresses
): Promise<Readonly<{ url: URL; addresses: readonly string[] }>> => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PROVIDER_DISCOVERY_DESTINATION_REJECTED');
  }
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error('PROVIDER_DISCOVERY_DESTINATION_REJECTED');
  }
  const hostname = normalizedIpv6(url.hostname);
  if (url.protocol === 'http:') {
    if (!isExplicitLoopback(hostname)) throw new Error('PROVIDER_DISCOVERY_DESTINATION_REJECTED');
    return { url, addresses: [hostname] };
  }
  if (
    isExplicitLoopback(hostname) ||
    (isIpv4(hostname) && !isPublicIp(hostname)) ||
    (isIpv6(hostname) && !isPublicIp(hostname))
  ) {
    throw new Error('PROVIDER_DISCOVERY_DESTINATION_REJECTED');
  }
  const addresses = isIpv4(hostname) || isIpv6(hostname) ? [hostname] : await resolve(hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicIp(address))) {
    throw new Error('PROVIDER_DISCOVERY_DESTINATION_REJECTED');
  }
  return { url, addresses };
};

/**
 * Pins the already-validated DNS address into the socket lookup callback.
 * Node's native HTTP clients do not follow redirects, closing both DNS rebinding
 * and redirect escape hatches at the final egress seam.
 */
export const createPinnedProviderDiscoveryFetch =
  (resolve: ProviderDnsLookup = resolveAddresses): ProviderFetch =>
  async (input, init): Promise<Response> => {
    const inputUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const destination = await assertProviderDiscoveryDestination(inputUrl, resolve);
    const { url, addresses } = destination;
    const address = addresses[0];
    if (!address) throw new Error('PROVIDER_DISCOVERY_DESTINATION_REJECTED');
    const transport = url.protocol === 'https:' ? https : http;
    const headers = new Headers(init?.headers);
    return new Promise<Response>((resolveResponse, reject) => {
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? 'GET',
          headers: Object.fromEntries(headers.entries()),
          lookup: (_hostname, _options, callback) => callback(null, address, isIpv6(address) ? 6 : 4),
          timeout: REQUEST_TIMEOUT_MS,
        },
        (response) => {
          const expectedLength = Number(response.headers['content-length']);
          if (Number.isFinite(expectedLength) && expectedLength > MAX_RESPONSE_BYTES) {
            response.destroy();
            reject(new Error('PROVIDER_DISCOVERY_RESPONSE_TOO_LARGE'));
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          response.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > MAX_RESPONSE_BYTES) {
              response.destroy(new Error('PROVIDER_DISCOVERY_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          response.once('error', () => reject(new Error('PROVIDER_DISCOVERY_NETWORK_FAILED')));
          response.once('end', () => {
            const responseHeaders = new Headers();
            for (const [name, rawValue] of Object.entries(response.headers)) {
              if (rawValue !== undefined)
                responseHeaders.set(name, Array.isArray(rawValue) ? rawValue.join(', ') : rawValue);
            }
            resolveResponse(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 502,
                statusText: response.statusMessage,
                headers: responseHeaders,
              })
            );
          });
        }
      );
      request.once('timeout', () => request.destroy(new Error('PROVIDER_DISCOVERY_TIMEOUT')));
      request.once('error', () => reject(new Error('PROVIDER_DISCOVERY_NETWORK_FAILED')));
      if (init?.signal) {
        const abort = (): void => {
          request.destroy(new Error('PROVIDER_DISCOVERY_TIMEOUT'));
        };
        if (init.signal.aborted) abort();
        else init.signal.addEventListener('abort', abort, { once: true });
      }
      request.end();
    });
  };

const parseRequest = (value: unknown): Readonly<{ providerId: string }> | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || Object.keys(record)[0] !== 'providerId') return undefined;
    return typeof record.providerId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.providerId)
      ? { providerId: record.providerId }
      : undefined;
  } catch {
    return undefined;
  }
};

const unauthorized = (trusted: boolean): ProviderDiscoveryNativeResult =>
  trusted
    ? { ok: false, code: 'PROVIDER_DISCOVERY_ACCOUNT_REQUIRED' }
    : { ok: false, code: 'PROVIDER_DISCOVERY_SENDER_UNTRUSTED' };

/**
 * Typed account-bound discovery. Renderer supplies only an opaque saved-provider
 * identifier; Main resolves the encrypted credential and owns every egress byte.
 */
export const registerProviderDiscoveryBridge = (options: ProviderDiscoveryBridgeOptions): (() => void) => {
  const fetchModels =
    options.fetchModels ??
    (async (provider: IProvider): Promise<readonly string[]> =>
      (await fetchProviderModelList(provider, createPinnedProviderDiscoveryFetch())).models.map((model) =>
        typeof model === 'string' ? model : model.id
      ));
  options.ipcMain.handle(
    PROVIDER_DISCOVERY_NATIVE_CHANNELS.fetchModels,
    async (event, raw: unknown): Promise<ProviderDiscoveryNativeResult> => {
      const trusted = options.verifySender(event);
      if (!trusted) return unauthorized(false);
      try {
        options.accountSession.requireOnlineSession();
      } catch {
        return unauthorized(true);
      }
      const request = parseRequest(raw);
      if (!request) return { ok: false, code: 'PROVIDER_DISCOVERY_REQUEST_INVALID' };
      try {
        const provider = await options.providerStore.get(request.providerId);
        if (!provider) return { ok: false, code: 'PROVIDER_DISCOVERY_PROVIDER_UNAVAILABLE' };
        const models = await fetchModels(provider);
        return { ok: true, models: [...models].filter((model) => typeof model === 'string' && model.length <= 2_048) };
      } catch {
        return { ok: false, code: 'PROVIDER_DISCOVERY_EGRESS_FAILED' };
      }
    }
  );
  return () => options.ipcMain.removeHandler(PROVIDER_DISCOVERY_NATIVE_CHANNELS.fetchModels);
};
