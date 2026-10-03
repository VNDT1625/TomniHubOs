import type { ProviderDestinationBinding } from '@process/services/tomnyProviderStore';
import {
  assertProviderDiscoveryDestination,
  type ProviderDnsLookup,
} from '@process/services/security/providerDiscovery/providerDiscoveryBridge';

export class ProviderDestinationAuthorityError extends Error {
  public constructor() {
    super('Provider destination authority denied the request.');
    this.name = 'ProviderDestinationAuthorityError';
  }
}

export type ProviderDestinationAuthorityOptions = Readonly<{
  /** Main-owned session identity; callers cannot supply an account identity. */
  actorId: () => string;
  providerStore: Readonly<{
    getDestinationBinding?(id: string): Promise<ProviderDestinationBinding | undefined>;
  }>;
  dnsLookup?: ProviderDnsLookup;
  now?: () => number;
  evidenceTtlMs?: number;
}>;

/** Opaque-to-renderer evidence for one account-owned saved provider destination. */
export type ProviderDestinationAdmission = Readonly<{
  accountId: string;
  providerId: string;
  destination: string;
  hostname: string;
  version: number;
  expiresAt: number;
}>;

const authorityKey = (accountId: string, providerId: string): string => `${accountId}\u0000${providerId}`;

const resolveChatDestination = (binding: ProviderDestinationBinding): string => {
  if (binding.isFullUrl) return binding.endpoint;
  const base = binding.endpoint.replace(/\/+$/u, '');
  const platform = binding.platform?.toLowerCase();
  if (platform === 'anthropic') return `${base}/v1/messages`;
  if (platform === 'gemini' || platform === 'gemini-vertex-ai') return `${base}/v1beta/models`;
  return `${base}/chat/completions`;
};

const requireActor = (actorId: () => string): string => {
  const resolved = actorId().trim();
  if (!resolved) throw new ProviderDestinationAuthorityError();
  return resolved;
};

/**
 * Admits only a saved, versioned provider endpoint for the live Main account.
 * A mutable renderer host is never an input. Legacy store entries lacking a
 * destination revision remain denied until explicitly saved again.
 */
export const createProviderDestinationAuthority = (options: ProviderDestinationAuthorityOptions) => {
  const revoked = new Set<string>();
  const active = new Map<string, ProviderDestinationAdmission>();
  const accountOwners = new Map<string, string>();
  const now = options.now ?? Date.now;
  const evidenceTtlMs = options.evidenceTtlMs ?? 60_000;
  if (!Number.isSafeInteger(evidenceTtlMs) || evidenceTtlMs < 1) {
    throw new Error('Provider destination evidence TTL must be a positive integer.');
  }

  const isActive = (admission: ProviderDestinationAdmission): boolean => {
    const key = authorityKey(admission.accountId, admission.providerId);
    const current = active.get(key);
    return (
      !revoked.has(key) &&
      current !== undefined &&
      current.destination === admission.destination &&
      current.hostname === admission.hostname &&
      current.version === admission.version &&
      current.expiresAt === admission.expiresAt &&
      current.expiresAt > now()
    );
  };

  const readBinding = async (providerId: string): Promise<ProviderDestinationBinding> => {
    const binding = await options.providerStore.getDestinationBinding?.(providerId);
    if (
      !binding ||
      binding.providerId !== providerId ||
      !Number.isSafeInteger(binding.version) ||
      binding.version < 1
    ) {
      throw new ProviderDestinationAuthorityError();
    }
    return binding;
  };

  const admit = async (providerId: string): Promise<ProviderDestinationAdmission> => {
    const accountId = requireActor(options.actorId);
    if (revoked.has(authorityKey(accountId, providerId))) throw new ProviderDestinationAuthorityError();
    const existingOwner = accountOwners.get(providerId);
    if (existingOwner !== undefined && existingOwner !== accountId) throw new ProviderDestinationAuthorityError();
    const binding = await readBinding(providerId);
    let validated: Awaited<ReturnType<typeof assertProviderDiscoveryDestination>>;
    try {
      validated = await assertProviderDiscoveryDestination(resolveChatDestination(binding), options.dnsLookup);
    } catch {
      throw new ProviderDestinationAuthorityError();
    }
    const admission = {
      accountId,
      providerId,
      destination: validated.url.href,
      hostname: validated.url.hostname,
      version: binding.version,
      expiresAt: now() + evidenceTtlMs,
    };
    accountOwners.set(providerId, accountId);
    active.set(authorityKey(accountId, providerId), admission);
    return admission;
  };

  return {
    admit,
    async assertCurrent(admission: ProviderDestinationAdmission): Promise<void> {
      const accountId = requireActor(options.actorId);
      if (accountId !== admission.accountId || !isActive(admission)) {
        throw new ProviderDestinationAuthorityError();
      }
      const binding = await readBinding(admission.providerId);
      if (binding.version !== admission.version) {
        active.delete(authorityKey(accountId, admission.providerId));
        throw new ProviderDestinationAuthorityError();
      }
      let validated: Awaited<ReturnType<typeof assertProviderDiscoveryDestination>>;
      try {
        validated = await assertProviderDiscoveryDestination(resolveChatDestination(binding), options.dnsLookup);
      } catch {
        throw new ProviderDestinationAuthorityError();
      }
      if (validated.url.href !== admission.destination || validated.url.hostname !== admission.hostname) {
        active.delete(authorityKey(accountId, admission.providerId));
        throw new ProviderDestinationAuthorityError();
      }
    },
    /** Sync-only predicate consumed by the Main TrustBroker at secret-lease time. */
    allowsProviderExecution(request: Readonly<{ accountId: string; providerId: string; hostname: string }>): boolean {
      const admission = active.get(authorityKey(request.accountId, request.providerId));
      return admission !== undefined && admission.hostname === request.hostname && isActive(admission);
    },
    revoke(admission: Pick<ProviderDestinationAdmission, 'accountId' | 'providerId'>): void {
      const key = authorityKey(admission.accountId, admission.providerId);
      revoked.add(key);
      active.delete(key);
    },
  };
};

export type ProviderDestinationAuthority = ReturnType<typeof createProviderDestinationAuthority>;
