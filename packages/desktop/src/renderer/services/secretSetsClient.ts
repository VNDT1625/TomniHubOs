import type {
  LegacySecretsImportReport,
  LegacySecretsStatus,
  PackageAccessOverviewView,
  SecretSetInput,
  SecretSetView,
  SecretsListing,
  SecretsResult,
} from '@/common/types/platform/sessionSecrets';

/** The five operations on the secret sets of one scope, bound to that scope's owner (a conversation or a company). */
export type SecretSetsApi = {
  list: () => Promise<SecretsResult<SecretsListing>>;
  save: (set: SecretSetInput) => Promise<SecretsResult<SecretSetView>>;
  remove: (handle: string) => Promise<SecretsResult<boolean>>;
  /** Plaintext, returned only after a native approval. Callers must drop it quickly. */
  reveal: (handle: string, field: string) => Promise<SecretsResult<string>>;
  dismissRequest: (requestId: string) => Promise<SecretsResult<boolean>>;
  /** Only a Package App whose older keys can be imported has this. */
  legacy?: {
    status: () => Promise<SecretsResult<LegacySecretsStatus>>;
    import: () => Promise<SecretsResult<LegacySecretsImportReport>>;
  };
};

const UNAVAILABLE = { ok: false, error: 'UNAVAILABLE' } as const;

/** Which general app secrets one Package App may use; the person decides, the package only asks. */
export type PackageAccessApi = {
  overview: () => Promise<SecretsResult<PackageAccessOverviewView>>;
  approve: (requestId: string) => Promise<SecretsResult<boolean>>;
  deny: (requestId: string) => Promise<SecretsResult<boolean>>;
  grant: (handle: string) => Promise<SecretsResult<boolean>>;
  revoke: (handle: string) => Promise<SecretsResult<boolean>>;
};

export const packageSecretAccess = (packageId: string): PackageAccessApi => ({
  overview: async () => window.electronAPI?.packageSecrets?.access.overview({ packageId }) ?? UNAVAILABLE,
  approve: async (requestId) =>
    window.electronAPI?.packageSecrets?.access.approve({ packageId, requestId }) ?? UNAVAILABLE,
  deny: async (requestId) => window.electronAPI?.packageSecrets?.access.deny({ packageId, requestId }) ?? UNAVAILABLE,
  grant: async (handle) => window.electronAPI?.packageSecrets?.access.grant({ packageId, handle }) ?? UNAVAILABLE,
  revoke: async (handle) => window.electronAPI?.packageSecrets?.access.revoke({ packageId, handle }) ?? UNAVAILABLE,
});

/** Temporary secret sets of one conversation ("Khóa bí mật" in the Hub rail). */
export const sessionSecretSets = (sessionId: string): SecretSetsApi => ({
  list: async () => window.electronAPI?.sessionSecrets?.list({ sessionId }) ?? UNAVAILABLE,
  save: async (set) => window.electronAPI?.sessionSecrets?.save({ sessionId, set }) ?? UNAVAILABLE,
  remove: async (handle) => window.electronAPI?.sessionSecrets?.remove({ sessionId, handle }) ?? UNAVAILABLE,
  reveal: async (handle, field) =>
    window.electronAPI?.sessionSecrets?.reveal({ sessionId, handle, field }) ?? UNAVAILABLE,
  dismissRequest: async (requestId) =>
    window.electronAPI?.sessionSecrets?.dismissRequest({ sessionId, requestId }) ?? UNAVAILABLE,
});

/** Permanent secret sets that only one Package App may use (Store, package detail). */
export const packageSecretSets = (packageId: string): SecretSetsApi => ({
  list: async () => window.electronAPI?.packageSecrets?.list({ packageId }) ?? UNAVAILABLE,
  save: async (set) => window.electronAPI?.packageSecrets?.save({ packageId, set }) ?? UNAVAILABLE,
  remove: async (handle) => window.electronAPI?.packageSecrets?.remove({ packageId, handle }) ?? UNAVAILABLE,
  reveal: async (handle, field) =>
    window.electronAPI?.packageSecrets?.reveal({ packageId, handle, field }) ?? UNAVAILABLE,
  dismissRequest: async (requestId) =>
    window.electronAPI?.packageSecrets?.dismissRequest({ packageId, requestId }) ?? UNAVAILABLE,
  legacy: {
    status: async () => window.electronAPI?.packageSecrets?.legacy.status({ packageId }) ?? UNAVAILABLE,
    import: async () => window.electronAPI?.packageSecrets?.legacy.import({ packageId }) ?? UNAVAILABLE,
  },
});

/** Permanent secret sets that only one company's group chat may use (company settings, advanced). */
export const companySecretSets = (companyId: string): SecretSetsApi => ({
  list: async () => window.electronAPI?.companySecrets?.list({ companyId }) ?? UNAVAILABLE,
  save: async (set) => window.electronAPI?.companySecrets?.save({ companyId, set }) ?? UNAVAILABLE,
  remove: async (handle) => window.electronAPI?.companySecrets?.remove({ companyId, handle }) ?? UNAVAILABLE,
  reveal: async (handle, field) =>
    window.electronAPI?.companySecrets?.reveal({ companyId, handle, field }) ?? UNAVAILABLE,
  dismissRequest: async (requestId) =>
    window.electronAPI?.companySecrets?.dismissRequest({ companyId, requestId }) ?? UNAVAILABLE,
});
