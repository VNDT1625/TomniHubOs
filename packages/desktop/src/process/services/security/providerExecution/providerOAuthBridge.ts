import { providerOAuthChannels } from '@/common/types/provider/providerOAuthChannels';
import type { ProviderOAuthClient, ProviderOAuthStatus } from './providerOAuthClient';
import type { IProviderStore } from '@process/services/tomnyProviderStore';
import type { AccountSessionService } from '../accountSession/accountSessionService';

export type ProviderOAuthBridgeOptions = Readonly<{
  accountSession: AccountSessionService;
  providerStore: Pick<IProviderStore, 'get'>;
  clients: ReadonlyMap<string, ProviderOAuthClient>;
}>;

type Request = Readonly<{ providerId: string }>;
const validRequest = (value: unknown): value is Request => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record.providerId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.providerId)
  );
};
const errorResult = (error: unknown): { ok: false; error: string } => ({
  ok: false,
  error:
    error instanceof Error && /^[A-Z0-9_]{3,120}$/u.test(error.message) ? error.message : 'PROVIDER_OAUTH_UNAVAILABLE',
});
const statusResult = <T extends ProviderOAuthStatus>(providerId: string, status: T) => ({
  ok: true as const,
  data: { providerId, status },
});

/** Main-only OAuth controls. Token values are intentionally never returned to the renderer. */
export const registerProviderOAuthBridge = (options: ProviderOAuthBridgeOptions): (() => void) => {
  const requireProvider = async (request: Request): Promise<ProviderOAuthClient> => {
    options.accountSession.requireOnlineSession();
    const provider = await options.providerStore.get(request.providerId);
    if (!provider || provider.auth_type !== 'oauth') throw new Error('PROVIDER_OAUTH_UNAVAILABLE');
    const client = options.clients.get(request.providerId);
    if (!client) throw new Error('PROVIDER_OAUTH_UNAVAILABLE');
    return client;
  };
  providerOAuthChannels.begin.provider(
    async (raw: Request): Promise<ProviderOAuthBridgeResult<{ providerId: string; status: 'active' }>> => {
      if (!validRequest(raw)) return { ok: false, error: 'PROVIDER_OAUTH_REQUEST_INVALID' };
      try {
        const client = await requireProvider(raw);
        await client.beginAuthorization();
        return statusResult(raw.providerId, 'active');
      } catch (error) {
        return errorResult(error);
      }
    }
  );
  providerOAuthChannels.status.provider(
    async (raw: Request): Promise<ProviderOAuthBridgeResult<{ providerId: string; status: ProviderOAuthStatus }>> => {
      if (!validRequest(raw)) return { ok: false, error: 'PROVIDER_OAUTH_REQUEST_INVALID' };
      try {
        const client = await requireProvider(raw);
        return statusResult(raw.providerId, await client.status());
      } catch (error) {
        return errorResult(error);
      }
    }
  );
  providerOAuthChannels.disconnect.provider(
    async (raw: Request): Promise<ProviderOAuthBridgeResult<{ providerId: string; remoteRevoked: boolean }>> => {
      if (!validRequest(raw)) return { ok: false, error: 'PROVIDER_OAUTH_REQUEST_INVALID' };
      try {
        const client = await requireProvider(raw);
        const result = await client.disconnect();
        return { ok: true, data: { providerId: raw.providerId, remoteRevoked: result.remoteRevoked } };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
  return () => {
    providerOAuthChannels.begin.provider(undefined);
    providerOAuthChannels.status.provider(undefined);
    providerOAuthChannels.disconnect.provider(undefined);
  };
};

type ProviderOAuthBridgeResult<T> = { ok: true; data: T } | { ok: false; error: string };
