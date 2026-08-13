/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type CatalogSource = 'tomni-store' | 'microsoft-store';
export type CatalogProvenanceMethod = 'api' | 'winget-msstore' | 'store-uri';
export type CatalogAvailability = 'available' | 'installed' | 'unavailable' | 'unknown';

export type FederatedCatalogOffer = {
  source: CatalogSource;
  sourceItemId: string;
  provenance: {
    method: CatalogProvenanceMethod;
    revision?: string;
  };
  lastSeenAt: string;
  region: string;
  version?: string;
  price?: {
    amount: number;
    currency: string;
  };
  rating?: {
    value: number;
    count?: number;
  };
  availability: CatalogAvailability;
  trustSignal?: { kind: 'tomni-review'; tier: string } | { kind: 'microsoft-certification'; publisher?: string };
};

export type FederatedCatalogItem = {
  canonicalKey: string;
  display: {
    name: string;
    summary?: string;
    iconUrl?: string;
  };
  offers: FederatedCatalogOffer[];
};

export type CatalogSourceState = {
  source: CatalogSource;
  status: 'ready' | 'stale' | 'failed';
  checkedAt: string;
  errorCode?: 'CATALOG_SOURCE_UNAVAILABLE' | 'CATALOG_SOURCE_INVALID';
};

export type FederatedCatalogSearchRequest = {
  query: string;
  region: string;
  limit?: number;
};

export type FederatedCatalogSearchResult = {
  items: FederatedCatalogItem[];
  sources: CatalogSourceState[];
};

export type LinkedMicrosoftAppRecord = {
  schemaVersion: 1;
  id: string;
  tomniPackageId?: string;
  microsoft: {
    productId: string;
    packageFamilyName: string;
    publisherIdentity: string;
    version: {
      minimumInclusive?: string;
      maximumExclusive?: string;
    };
  };
  activation?: {
    uri: string;
  };
  connectors?: {
    appActions?: string[];
    agentLauncher?: string;
    mcpServerId?: string;
  };
  permissions: string[];
  requirements: {
    regions?: string[];
    deviceFamilies?: string[];
    license: 'free' | 'paid' | 'unknown';
  };
  review: {
    revision: string;
    reviewedAt: string;
    health: 'healthy' | 'degraded' | 'blocked';
    killSwitch: boolean;
  };
};

export type CatalogActionAuthorization = {
  action: 'install' | 'uninstall' | 'enable' | 'disable' | 'rollback' | 'launch' | 'open-store-page';
  source: CatalogSource;
  sourceItemId: string;
};

export type CatalogActionRequest = {
  source: CatalogSource;
  sourceItemId: string;
  /** Caller-supplied key for safely deduplicating one user action. */
  idempotencyKey?: string;
};
/**
 * A stable caller-generated key is mandatory for actions that can change package state.
 */
export type CatalogDurableActionRequest = CatalogActionRequest & {
  idempotencyKey: string;
  /** Opaque grant issued only after an explicit user decision. */
  consentId?: string;
  /** Trusted transport identity. Entry points must derive this from the sender, never renderer input. */
  ownerId?: string;
};

export type CatalogActionReceipt = {
  operationId: string;
  action: CatalogActionAuthorization['action'];
  source: CatalogSource;
  sourceItemId: string;
  provider: 'tomni-package-manager' | 'winget-msstore' | 'store-uri';
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'delegated-to-store';
  verification: 'verified' | 'not-applicable';
  installedVersion?: string;
};
