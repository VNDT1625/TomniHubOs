import type { AccountSessionService } from './security/accountSession/accountSessionService';
import { createStoreApiClient, type StoreApiClient, type StoreApiClientOptions } from './storeApiClient';

/** Deployment-owned Store API endpoint; absent configuration keeps the client disabled. */
export const readStoreApiBaseUrl = (
  environment: Readonly<Record<string, string | undefined>> = process.env
): string | undefined => {
  const value = environment.TOMNI_STORE_API_URL?.trim();
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    throw new Error('STORE_API_BASE_URL_INVALID');
  return url.toString();
};

/** Binds Store requests to the verified Main-owned account session. */
export const createSessionStoreApiClient = (
  accountSession: AccountSessionService,
  options: Omit<StoreApiClientOptions, 'accessToken'>
): StoreApiClient =>
  createStoreApiClient({
    ...options,
    accessToken: async () => accountSession.requireOnlineSession().accessToken,
  });
