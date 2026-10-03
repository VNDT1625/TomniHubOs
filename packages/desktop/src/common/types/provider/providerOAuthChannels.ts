import { bridge } from '@office-ai/platform';

export type ProviderOAuthStatus = 'missing' | 'active' | 'expired' | 'revoked';
export type ProviderOAuthBridgeResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type ProviderOAuthRequest = Readonly<{ providerId: string }>;

export const PROVIDER_OAUTH_CHANNELS = {
  begin: 'tomny-provider-oauth.begin',
  status: 'tomny-provider-oauth.status',
  disconnect: 'tomny-provider-oauth.disconnect',
} as const;

export const providerOAuthChannels = {
  begin: bridge.buildProvider<
    ProviderOAuthBridgeResult<{ providerId: string; status: 'active' }>,
    ProviderOAuthRequest
  >(PROVIDER_OAUTH_CHANNELS.begin),
  status: bridge.buildProvider<
    ProviderOAuthBridgeResult<{ providerId: string; status: ProviderOAuthStatus }>,
    ProviderOAuthRequest
  >(PROVIDER_OAUTH_CHANNELS.status),
  disconnect: bridge.buildProvider<
    ProviderOAuthBridgeResult<{ providerId: string; remoteRevoked: boolean }>,
    ProviderOAuthRequest
  >(PROVIDER_OAUTH_CHANNELS.disconnect),
};
