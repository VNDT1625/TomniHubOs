/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CatalogActionAuthorization,
  CatalogActionReceipt,
  CatalogActionRequest,
  CatalogDurableActionRequest,
  CatalogSource,
  FederatedCatalogItem,
  FederatedCatalogOffer,
  FederatedCatalogSearchRequest,
  FederatedCatalogSearchResult,
  LinkedMicrosoftAppRecord,
} from '../../../../common/packages';

export type CatalogFederationErrorCode =
  | 'CATALOG_REQUEST_INVALID'
  | 'CATALOG_SOURCE_DUPLICATE'
  | 'CATALOG_SOURCE_UNAVAILABLE'
  | 'CATALOG_CACHE_CORRUPT'
  | 'CATALOG_CACHE_ROLLBACK'
  | 'CATALOG_CONSENT_INVALID'
  | 'CATALOG_POLICY_UNAVAILABLE'
  | 'CATALOG_LEDGER_UNAVAILABLE'
  | 'CATALOG_ACTION_DENIED'
  | 'CATALOG_ACTION_UNSUPPORTED'
  | 'CATALOG_ACTION_IN_PROGRESS'
  | 'CATALOG_ACTION_IDEMPOTENCY_CONFLICT'
  | 'CATALOG_ACTION_RECOVERY_UNRESOLVED'
  | 'CATALOG_ACTION_RECOVERY_STALE'
  | 'CATALOG_ACTION_QUARANTINED'
  | 'LINKED_APP_INVALID'
  | 'LINKED_APP_BLOCKED'
  | 'LINKED_APP_NOT_REVIEWED'
  | 'LINKED_APP_IDENTITY_MISMATCH'
  | 'LINKED_APP_VERSION_INCOMPATIBLE';

export class CatalogFederationError extends Error {
  public constructor(
    public readonly code: CatalogFederationErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CatalogFederationError';
  }
}

export type CatalogProviderItem = {
  display: FederatedCatalogItem['display'];
  offer: FederatedCatalogOffer;
};

export type CatalogFederationCacheKey = {
  source: CatalogSource;
  query: string;
  region: string;
  limit: number;
};

export type CachedCatalogProviderItems = {
  revision: number;
  issuedAt: string;
  expiresAt: string;
  items: CatalogProviderItem[];
};

export type CatalogFederationCache = {
  store: (key: CatalogFederationCacheKey, items: readonly CatalogProviderItem[]) => Promise<void>;
  load: (key: CatalogFederationCacheKey) => Promise<CachedCatalogProviderItems | undefined>;
};

export type CatalogActionConsent = {
  schemaVersion: 1;
  consentId: string;
  action: CatalogActionAuthorization['action'];
  source: CatalogSource;
  sourceItemId: string;
  region?: string;
  grantedAt: string;
  expiresAt: string;
};

export type CatalogActionConsentDecision = {
  allowed: boolean;
  consent?: CatalogActionConsent;
};

export type CatalogActionConsentResolver = {
  authorize: (
    request: CatalogActionAuthorization & {
      region?: string;
      consentId?: string;
      ownerId?: string;
      idempotencyKey?: string;
    }
  ) => Promise<CatalogActionConsentDecision> | CatalogActionConsentDecision;
};

export type LinkedAppPolicySnapshot = {
  linkedAppId: string;
  reviewRevision: string;
  reviewedAt: string;
  health: LinkedMicrosoftAppRecord['review']['health'];
  killSwitch: boolean;
};

export type LinkedAppPolicyResolver = {
  refresh: () => Promise<readonly LinkedMicrosoftAppRecord[]>;
};

export type CatalogActionLedgerState = 'authorized' | 'invoking' | 'completed' | 'failed' | 'quarantined';

export type CatalogActionLedgerEntry = {
  schemaVersion: 1;
  id: string;
  state: CatalogActionLedgerState;
  idempotencyKey?: string;
  authorization: CatalogActionAuthorization;
  region?: string;
  consent?: CatalogActionConsent;
  policy?: LinkedAppPolicySnapshot;
  receipt?: CatalogActionReceipt;
  errorCode?: CatalogFederationErrorCode;
  errorMessage?: string;
  startedAt: string;
  updatedAt: string;
  previousDigest?: string;
  digest: string;
};

export type CatalogActionLedgerStart = Pick<
  CatalogActionLedgerEntry,
  'authorization' | 'region' | 'consent' | 'policy' | 'startedAt'
> & {
  idempotencyKey: string;
};

export type CatalogActionLedger = {
  begin: (input: CatalogActionLedgerStart) => Promise<CatalogActionLedgerEntry>;
  markInvoking: (id: string) => Promise<CatalogActionLedgerEntry>;
  complete: (id: string, receipt: CatalogActionReceipt) => Promise<CatalogActionLedgerEntry>;
  fail: (id: string, error: unknown) => Promise<CatalogActionLedgerEntry>;
  quarantine: (id: string, error: unknown) => Promise<CatalogActionLedgerEntry>;
  findByIdempotencyKey: (idempotencyKey: string) => Promise<CatalogActionLedgerEntry | undefined>;
  list: () => Promise<CatalogActionLedgerEntry[]>;
};

export type CatalogProviderActionResult = Pick<
  CatalogActionReceipt,
  'provider' | 'status' | 'verification' | 'installedVersion'
>;

export type CatalogProviderActionContext = {
  idempotencyKey: string;
};

export type CatalogProviderRecoveryRequest = {
  authorization: CatalogActionAuthorization;
  region?: string;
  idempotencyKey: string;
};

export type CatalogProviderReconciliation =
  | { state: 'satisfied'; result: CatalogProviderActionResult }
  | { state: 'not-satisfied' | 'unknown' };

export type CatalogActionRecoveryReport = {
  recovered: CatalogActionReceipt[];
  failed: string[];
  quarantined: string[];
};

export type CatalogProvider = {
  source: CatalogSource;
  search: (request: FederatedCatalogSearchRequest) => Promise<CatalogProviderItem[]>;
  install?: (
    sourceItemId: string,
    region: string,
    context: CatalogProviderActionContext
  ) => Promise<CatalogProviderActionResult>;
  uninstall?: (
    sourceItemId: string,
    region: string,
    context: CatalogProviderActionContext
  ) => Promise<CatalogProviderActionResult>;
  enable?: (
    sourceItemId: string,
    region: string,
    context: CatalogProviderActionContext
  ) => Promise<CatalogProviderActionResult>;
  disable?: (
    sourceItemId: string,
    region: string,
    context: CatalogProviderActionContext
  ) => Promise<CatalogProviderActionResult>;
  rollback?: (
    sourceItemId: string,
    region: string,
    context: CatalogProviderActionContext
  ) => Promise<CatalogProviderActionResult>;
  launch?: (
    sourceItemId: string,
    region: string,
    context: CatalogProviderActionContext
  ) => Promise<CatalogProviderActionResult>;
  openStorePage?: (sourceItemId: string, context: CatalogProviderActionContext) => Promise<CatalogProviderActionResult>;
  reconcile?: (request: CatalogProviderRecoveryRequest) => Promise<CatalogProviderReconciliation>;
};

export type CatalogFederationBroker = {
  search: (request: FederatedCatalogSearchRequest) => Promise<FederatedCatalogSearchResult>;
  recoverPendingActions: () => Promise<CatalogActionRecoveryReport>;
  install: (request: CatalogDurableActionRequest & { region: string }) => Promise<CatalogActionReceipt>;
  uninstall: (request: CatalogDurableActionRequest & { region: string }) => Promise<CatalogActionReceipt>;
  enable: (request: CatalogDurableActionRequest & { region: string }) => Promise<CatalogActionReceipt>;
  disable: (request: CatalogDurableActionRequest & { region: string }) => Promise<CatalogActionReceipt>;
  rollback: (request: CatalogDurableActionRequest & { region: string }) => Promise<CatalogActionReceipt>;
  launch: (request: CatalogDurableActionRequest & { region: string }) => Promise<CatalogActionReceipt>;
  openStorePage: (request: CatalogActionRequest) => Promise<CatalogActionReceipt>;
};

export type CatalogFederationBrokerDeps = {
  providers: readonly CatalogProvider[];
  linkedApps?: readonly LinkedMicrosoftAppRecord[];
  cache?: CatalogFederationCache;
  consent?: CatalogActionConsentResolver;
  linkedAppPolicy?: LinkedAppPolicyResolver;
  ledger?: CatalogActionLedger;
  authorize: (request: CatalogActionAuthorization) => Promise<boolean> | boolean;
  now?: () => Date;
  randomId?: () => string;
};

export type SafeFileRunOptions = {
  timeoutMs: number;
  env?: Readonly<Record<string, string>>;
};

export type SafeFileRunResult = {
  stdout: string;
  stderr: string;
};

export type SafeFileRunner = (
  executable: 'winget' | 'powershell.exe',
  args: readonly string[],
  options: SafeFileRunOptions
) => Promise<SafeFileRunResult>;

export type MicrosoftStoreSearchHit = {
  productId: string;
  name: string;
  version?: string;
};

export type InstalledMicrosoftAppIdentity = {
  packageFamilyName: string;
  publisherIdentity: string;
  version: string;
};

export type WindowsMicrosoftStoreAdapter = {
  search: (query: string, limit: number) => Promise<MicrosoftStoreSearchHit[]>;
  installLinked: (record: LinkedMicrosoftAppRecord, region: string) => Promise<InstalledMicrosoftAppIdentity>;
  launchLinked: (record: LinkedMicrosoftAppRecord, region: string) => Promise<InstalledMicrosoftAppIdentity>;
  openStoreProduct: (productId: string) => Promise<void>;
};

export type WindowsMicrosoftStoreAdapterDeps = {
  runFile?: SafeFileRunner;
  openExternal?: (uri: string) => Promise<void>;
};
