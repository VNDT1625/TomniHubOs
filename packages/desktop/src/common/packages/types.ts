/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentType } from 'react';

export type PackageType = 'app' | 'ui' | 'agent-capsule';
export type PackageBundleKind = 'single' | 'suite';
export type PackageDeliveryMode = 'bundled-legacy' | 'bundled-package' | 'downloaded-package';
export type PackageTrust = 'trusted-first-party' | 'signed-first-party' | 'signed-store';

/**
 * Versioned renderer-only editor ABI that an optional Surface may consume
 * without importing the Core editor registry implementation. The host remains
 * responsible for file access and selects a package resolver per mount.
 */
export type EditorSurfaceAdapterProps = {
  filePath: string;
  content: string;
  savedContent: string;
  mode: 'text' | 'binary' | 'none';
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: Error | null;
  onChange: (next: string) => void;
  onSave: (next?: string) => Promise<void>;
  reload: () => Promise<void>;
  readOnly?: boolean;
  workspace?: string;
};

export type EditorSurfaceAdapterComponent = ComponentType<EditorSurfaceAdapterProps>;

/**
 * A package-local resolver is passed to a host editor mount. It does not mutate
 * Core registrations, so disable or uninstall removes the optional adapter.
 */
export type EditorSurfaceAdapterResolver<TKind extends string = string> = Readonly<{
  componentForKind: (kind: TKind) => EditorSurfaceAdapterComponent | null;
}>;

export type PackageSigningKeyPolicy = {
  publicKey: string;
  publisherId: string;
  trust: Extract<PackageTrust, 'signed-first-party' | 'signed-store'>;
};

/**
 * A Store-root-signed enrollment for one non-Tomni publisher signing key. The
 * certificate is data only: callers must still verify its Store signature and
 * validity window against a pinned Store root before admitting an artifact.
 */
export type StoreSignedPublisherKeyCertificate = {
  schemaVersion: 1;
  certificateId: string;
  publisherId: string;
  signingKey: {
    keyId: string;
    algorithm: 'ed25519';
    publicKeyPem: string;
    spkiSha256: string;
  };
  issuedAt: string;
  expiresAt: string;
  signature: {
    algorithm: 'ed25519';
    keyId: string;
    value: string;
  };
};
/**
 * A Store-root-signed withdrawal of one enrolled third-party publisher key.
 * Catalog v2 must carry this record before a client admits that key for any
 * artifact; a package-level revocation cannot safely substitute for it.
 */
export type StoreSignedPublisherKeyRevocation = {
  schemaVersion: 1;
  revocationId: string;
  certificateId: string;
  publisherId: string;
  signingKeyId: string;
  revokedAt: string;
  reasonCode: string;
  signature: {
    algorithm: 'ed25519';
    keyId: string;
    value: string;
  };
};
export type PackageLifecycleState =
  | 'available'
  | 'installing'
  | 'installed'
  | 'uninstalling'
  | 'failed'
  | 'quarantined';

export type PackageModuleRuntime = 'sandboxed-web' | 'trusted-react';

export type PackageModuleContribution = {
  id: string;
  title: string;
  surface: string;
  pinnable: boolean;
  runtime?: PackageModuleRuntime;
  entrypoint?: string;
  styleEntrypoint?: string;
};

/**
 * A package-owned operation that an AI may request only after the separate
 * C4 consent and broker gates pass. Omitting `aiAccess` means the Surface is
 * user-only; this declaration never grants model access by itself.
 */
export type PackageSurfaceAiOperation = {
  id: string;
  capability: string;
  inputSchemaVersion: 1;
  dataClasses: Array<'workspace' | 'conversation' | 'personal' | 'artifact' | 'secret-handle'>;
  destinationIds: string[];
};

export type PackageSurfaceAiAccessDeclaration = {
  schemaVersion: 1;
  operations: PackageSurfaceAiOperation[];
};

export type PackageAppContribution = {
  id: string;
  /** Fallback metadata only; production UI resolves titleKey through host i18n. */
  title: string;
  titleKey?: string;
  moduleId: string;
  order?: number;
};

export type PackageIdeActivityGroupId = 'codebase' | 'agent-ops';

export type PackageIdeActivityGroupContribution = {
  id: PackageIdeActivityGroupId;
  /** Fallback metadata only; production UI resolves titleKey through host i18n. */
  title: string;
  titleKey?: string;
  order?: number;
};

export type PackageIdeSubtabContribution = {
  id: string;
  /** Fallback metadata only; production UI resolves titleKey through host i18n. */
  title: string;
  titleKey?: string;
  activityGroupId: PackageIdeActivityGroupId;
  moduleId: string;
  activation: 'on-open' | 'on-startup';
  order?: number;
};

export type PackageCommandContribution = {
  id: string;
  /** Fallback metadata only; production UI resolves titleKey through host i18n. */
  title: string;
  titleKey?: string;
};

export type PackageSettingContribution = {
  id: string;
  /** Fallback metadata only; production UI resolves titleKey through host i18n. */
  title: string;
  titleKey?: string;
  type: 'boolean' | 'number' | 'string';
  default?: boolean | number | string;
};

export type PackageThemeContribution = {
  id: string;
  name: string;
  cover?: string;
  css: string;
};

export type PackageContributionContract = {
  version: 1;
  apps?: PackageAppContribution[];

  themes?: PackageThemeContribution[];
  ide?: {
    hostApiVersion: string;
    activityGroups?: PackageIdeActivityGroupContribution[];
    subtabs?: PackageIdeSubtabContribution[];
    commands?: PackageCommandContribution[];
    settings?: PackageSettingContribution[];
  };
};

/**
 * A fixed, signed declaration for Main-owned package wiring. It is only an
 * admission contract: it does not load code, start a process, or grant a
 * capability. New Main contribution kinds require a new reviewed ABI value.
 */
export type PackageMainContribution = Readonly<{
  schemaVersion: 1;
  id: 'browser-host-v1' | 'design-viu-v1' | 'terminal-host-v1';
}>;

export type RegisteredPackageContribution<T> = T & {
  key: string;
  packageId: string;
  packageVersion: string;
};

export type PackageContributionSnapshot = {
  revision: number;
  packageIds: string[];
  apps: Array<RegisteredPackageContribution<PackageAppContribution>>;
  activityGroups: Array<RegisteredPackageContribution<PackageIdeActivityGroupContribution>>;
  subtabs: Array<RegisteredPackageContribution<PackageIdeSubtabContribution>>;
  commands: Array<RegisteredPackageContribution<PackageCommandContribution>>;
  settings: Array<RegisteredPackageContribution<PackageSettingContribution>>;
};

export type PackageContributionDiagnosticCode =
  | 'invalid-package'
  | 'protected-namespace'
  | 'dependency-unavailable'
  | 'dependency-cycle'
  | 'payload-inconsistent'
  | 'core-repair-required'
  | 'host-api-incompatible'
  | 'contribution-collision'
  | 'dangling-reference';

export type PackageContributionDiagnostic = {
  packageId: string;
  code: PackageContributionDiagnosticCode;
  /** Present when a package operation failure caused this diagnostic. */
  failure?: PackageOperationFailure;
};

export type PackageContributionChangedEvent = Readonly<{
  revision: number;
}>;

export type PackageContributionState = {
  snapshot: PackageContributionSnapshot;
  diagnostics: PackageContributionDiagnostic[];
};

export type PackageDependency = {
  id: string;
  version: string;
};

export type PackageArtifactSignature = {
  algorithm: 'ed25519';
  keyId: string;
  value: string;
};

export type PackageArtifact = {
  integrity: string;
  sizeBytes: number;
  signature: PackageArtifactSignature;
};

export type PackageScreenshot = {
  url: string;
  alt?: string;
};

export type PackageManifest = {
  schemaVersion: 1;
  id: string;
  publisherId: string;
  name: string;
  description: string;
  type: PackageType;
  bundleKind: PackageBundleKind;
  version: string;
  engines: { tomni: string };
  modules: PackageModuleContribution[];
  permissions: string[];
  dependencies: PackageDependency[];

  /** Optional because every Package App must remain usable without AI. */
  aiAccess?: PackageSurfaceAiAccessDeclaration;

  contributions?: PackageContributionContract;
  /**
   * Fixed Main-wiring declarations protected by the artifact signature. The
   * declaration is inert until a separate lifecycle/revocation implementation
   * admits it.
   */
  mainContributions?: PackageMainContribution[];
  tags: string[];
  screenshots?: PackageScreenshot[];
  artifact?: PackageArtifact;
};

/** Declares the filesystem roots granted to one sandbox capability. */
export type PackageSandboxFilesystemScope = {
  readRoots?: string[];
  writeRoots?: string[];
};

/** Declares exact network origins granted to one sandbox capability. */
export type PackageSandboxNetworkScope = {
  allowedOrigins: string[];
};

/** Declares host IPC methods granted to one sandbox capability. */
export type PackageSandboxIpcScope = {
  methods: string[];
};

/**
 * A requested sandbox grant. The main-process boundary validates this against the
 * package manifest before it becomes an executable native runtime policy.
 */
export type PackageSandboxCapabilityGrant = {
  capability: string;
  filesystem?: PackageSandboxFilesystemScope;
  network?: PackageSandboxNetworkScope;
  ipc?: PackageSandboxIpcScope;
};

/** Versioned package sandbox policy carried by trusted main-process wiring only. */
export type PackageSandboxPermissionPolicy = {
  version: 1;
  packageId: string;
  capabilities: PackageSandboxCapabilityGrant[];
};

export type PackageDependencyResolutionCode =
  | 'dependency-missing'
  | 'dependency-inactive'
  | 'dependency-version-incompatible'
  | 'dependency-cycle';

export type PackageDependencyResolutionErrorDetails = {
  code: PackageDependencyResolutionCode;
  packageId: string;
  dependencyId?: string;
  requiredVersion?: string;
  actualVersion?: string;
  dependencyState?: PackageLifecycleState;
  cycle?: string[];
};

export type PackageDependencyResolutionCandidate = {
  manifest: PackageManifest;
  state: PackageLifecycleState;
  enabled: boolean;
};

export type PackageDependencyResolution = {
  /** Dependency IDs in activation order, with dependencies before their dependents. */
  packageIds: string[];
};

/** Public, stable package operation phases that are safe to serialize across process boundaries. */
export type PackageOperationPhase = 'install' | 'activation' | 'restore' | 'uninstall';

export type PackageOperationFailureCode =
  | 'PACKAGE_DEPENDENCY_MISSING'
  | 'PACKAGE_DEPENDENCY_DISABLED'
  | 'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION'
  | 'PACKAGE_DEPENDENCY_CYCLE'
  | 'PACKAGE_DEPENDENCY_QUARANTINED'
  | 'PACKAGE_PAYLOAD_INCONSISTENT'
  | 'PACKAGE_CORE_REPAIR_REQUIRED'
  | 'PACKAGE_OPERATION_FAILED';

/**
 * A stable public error payload. It intentionally excludes package paths, URLs, versions, and other internal metadata.
 */
export type PackageOperationFailure = {
  phase: PackageOperationPhase;
  code: PackageOperationFailureCode;
};

/** A JSON-serializable success/failure contract for package admission and activation work. */
export type PackageOperationResult<T> = { ok: true; value: T } | { ok: false; error: PackageOperationFailure };

export type PackagePublicErrorCode = PackageOperationFailureCode | 'PACKAGE_QUARANTINED' | 'PACKAGE_CATALOG_REVOKED';

export type PackageInstallSource = 'bundled' | 'store';
export type PackageInstallScope = 'core' | 'optional';

export type PackageInstallProvenance = {
  source: PackageInstallSource;
  scope: PackageInstallScope;
  version: string;
  integrity?: string;
};

/**
 * A signed Store instruction to stop using the exact manifest carried by its
 * catalog entry. It is intentionally not a delete instruction: the durable
 * record stays available for user-visible remediation and safe uninstall.
 */
export type PackageCatalogRevocation = {
  schemaVersion: 1;
  reasonCode: string;
  revokedAt: string;
};

/** A review decision included in, and therefore protected by, the signed catalog. */
export type PackagePublicationReview =
  | {
      schemaVersion: 1;
      disposition: 'auto-approved';
      fingerprint: string;
      reviewedAt: string;
    }
  | {
      schemaVersion: 1;
      disposition: 'human-approved';
      fingerprint: string;
      reviewedAt: string;
      reviewerId: string;
    }
  | {
      /** V2 binds the signed catalog review to immutable package bytes. */
      schemaVersion: 2;
      disposition: 'auto-approved';
      fingerprint: string;
      artifactIntegrity: string;
      reviewedAt: string;
    }
  | {
      /** V2 binds the signed catalog review to immutable package bytes. */
      schemaVersion: 2;
      disposition: 'human-approved';
      fingerprint: string;
      artifactIntegrity: string;
      reviewedAt: string;
      reviewerId: string;
    };

export type PackageCatalogEntry = {
  manifest: PackageManifest;
  delivery: PackageDeliveryMode;
  trust: PackageTrust;
  /** Signed ordinary-payment offer for this exact catalog identity, when paid. */
  offer?: ProductOffer;
  installScope?: PackageInstallScope;
  sourceDirectory?: string;
  artifactUrl?: string;
  /**
   * Store-root-signed mirror of `manifest.mainContributions`. A remote catalog
   * parser rejects a missing or non-identical mirror before admission.
   */
  mainContributions?: PackageMainContribution[];
  revocation?: PackageCatalogRevocation;
  publicationReview?: PackagePublicationReview;
};

export type InstalledPackageRecord = {
  id: string;
  version: string;
  previousVersion?: string;
  /** Verified identity evidence retained for a rollback payload after the catalog advances. */
  previousManifest?: PackageManifest;
  previousTrust?: PackageTrust;
  previousProvenance?: PackageInstallProvenance;
  /** Signed review evidence bound to the retained previous artifact. */
  previousPublicationReview?: PackagePublicationReview;
  state: Extract<PackageLifecycleState, 'installed' | 'failed' | 'quarantined'>;
  delivery: PackageDeliveryMode;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  lastError?: string;
  manifest?: PackageManifest;
  trust?: PackageTrust;
  provenance?: PackageInstallProvenance;
  /** Signed review evidence bound to the exact installed artifact. */
  publicationReview?: PackagePublicationReview;
};

export type PackageListing = {
  manifest: PackageManifest;
  delivery: PackageDeliveryMode;
  trust: PackageTrust;
  /** Catalog offer is display/proposal data only; it never grants activation. */
  offer?: ProductOffer;
  /** Signed catalog review for the exact catalog artifact, when this listing is installable. */
  publicationReview?: PackagePublicationReview;
  /** A signed catalog revocation is visible to resolver/UI code as a hard blocker. */
  revoked?: boolean;
  state: PackageLifecycleState;
  installedVersion?: string;
  installedManifest?: PackageManifest;
  /** Trust assertion for the exact installed artifact, not the latest catalog entry. */
  installedTrust?: PackageTrust;
  /** Signed review bound to the exact installed artifact, not a newer catalog version. */
  installedPublicationReview?: PackagePublicationReview;
  previousVersion?: string;
  updateAvailable: boolean;
  compatible: boolean;
  enabled: boolean;
  lastError?: PackagePublicErrorCode;
};

export type PackageListFilter = {
  type?: PackageType;
  installedOnly?: boolean;
};

export type PackageSearchRequest = PackageListFilter & {
  query: string;
};

export type PackageInstallRequest = {
  id: string;
};

export type PackageUninstallRequest = {
  id: string;
};

export type PackageMutationAction = 'install' | 'uninstall' | 'enable' | 'disable' | 'rollback';

export type PackageMutationConsentRequest = {
  id: string;
  action: PackageMutationAction;
  idempotencyKey: string;
  region: string;
  confirmed: true;
};

export type PackageMutationConsentGrant = {
  consentId: string;
  expiresAt: string;
};

export type PackageMutationExecuteRequest = {
  id: string;
  action: PackageMutationAction;
  idempotencyKey: string;
  region: string;
  consentId: string;
  /** Required only when an install updates the package permission set. */
  permissionConsentId?: string;
};

export type PackageManifestRevision = {
  version: string;
  revision: string;
};

export type PackagePermissionChange = {
  added: string[];
  removed: string[];
  changed: Array<{ from: string; to: string }>;
};

/** Main-process challenge; it cannot authorize an update by itself. */
export type PackageUpdatePermissionConsentChallenge = {
  challengeId: string;
  packageId: string;
  from: PackageManifestRevision;
  to: PackageManifestRevision;
  permissions: PackagePermissionChange;
  issuedAt: string;
  expiresAt: string;
};

export type PackageUpdatePermissionConsentPreparation = {
  required: boolean;
  challenge?: PackageUpdatePermissionConsentChallenge;
};

/** Short-lived, owner-bound approval for one exact package permission change. */
export type PackageUpdatePermissionConsentGrant = {
  receiptId: string;
  packageId: string;
  from: PackageManifestRevision;
  to: PackageManifestRevision;
  permissions: PackagePermissionChange;
  issuedAt: string;
  expiresAt: string;
};

export type PackageUpdatePermissionConsentPrepareRequest = {
  id: string;
};

export type PackageUpdatePermissionConsentApproveRequest = {
  challengeId: string;
  confirmed: true;
};

export type PackageStateChangedEvent = Readonly<{
  id: string;
  state: PackageLifecycleState;
  error?: PackagePublicErrorCode;
}>;

export type PackageAssetRequest = {
  id: string;
  path: string;
};

export type PackageAsset = {
  content: string;
  contentType: 'application/javascript' | 'application/json' | 'text/css' | 'text/html' | 'text/plain';
};

/** C1 contracts shared by the package resolver and Store; no contract imports a package implementation. */
export const PACKAGE_RESOLUTION_SCHEMA_VERSION = 1 as const;
export const STORE_COMMERCE_SCHEMA_VERSION = 1 as const;

export type PackageIdentity = Readonly<{ packageId: string; packageVersion: string; publisherId: string }>;
export type ContributionIdentity = Readonly<{ package: PackageIdentity; contributionId: string }>;

export type CapabilityQuery = Readonly<{
  schemaVersion: typeof PACKAGE_RESOLUTION_SCHEMA_VERSION;
  queryId: string;
  requester: PackageIdentity;
  capability: string;
  purpose: string;
  dataLocation: 'local-only' | 'region-bound' | 'remote-allowed';
  requireUi: boolean;
  requireOffline: boolean;
  idempotencyKey: string;
}>;
export type CapabilityCandidateState = 'ready-local' | 'ready-remote' | 'installable' | 'unavailable';
export type CapabilityCandidate = Readonly<{
  schemaVersion: typeof PACKAGE_RESOLUTION_SCHEMA_VERSION;
  candidateId: string;
  package: PackageIdentity;
  contribution?: ContributionIdentity;
  capability: string;
  state: CapabilityCandidateState;
  trusted: boolean;
  compatible: boolean;
  healthy: boolean;
  dataLocation: 'local-only' | 'region-bound' | 'remote-allowed';
  supportsUi: boolean;
  supportsOffline: boolean;
  /** Exact signed Store offer, carried only to make a purchase proposal explicit. */
  offer?: ProductOffer;
  reasonCodes: readonly string[];
}>;
export type CapabilityResolution = Readonly<{
  schemaVersion: typeof PACKAGE_RESOLUTION_SCHEMA_VERSION;
  queryId: string;
  candidates: readonly CapabilityCandidate[];
  selectedCandidateId?: string;
  evaluatedAt: string;
}>;
/** A proposal is reviewable metadata only; it never installs, purchases, or grants capability. */
export type ActivationProposal = Readonly<{
  schemaVersion: typeof PACKAGE_RESOLUTION_SCHEMA_VERSION;
  proposalId: string;
  queryId: string;
  candidate: CapabilityCandidate;
  requestedAt: string;
  requiresInstall: boolean;
  requiresPurchase: boolean;
  requiredConsent: readonly ('install' | 'purchase' | 'permissions' | 'offline-data')[];
}>;
/** A deterministic next action only; a plan never installs, purchases, or invokes a Surface. */
export type SurfacePlanningStep =
  | Readonly<{
      kind: 'execute-local' | 'execute-remote';
      query: CapabilityQuery;
      resolution: CapabilityResolution;
      candidate: CapabilityCandidate;
    }>
  | Readonly<{
      kind: 'propose-install';
      query: CapabilityQuery;
      resolution: CapabilityResolution;
      proposal: ActivationProposal;
    }>
  | Readonly<{
      kind: 'blocked';
      query: CapabilityQuery;
      resolution: CapabilityResolution;
      reasonCodes: readonly string[];
    }>;
/** Displayable task-to-Surface plan. Raw task text is intentionally absent. */
export type GoalSurfacePlan = Readonly<{
  schemaVersion: typeof PACKAGE_RESOLUTION_SCHEMA_VERSION;
  requestId: string;
  goalDigest: string;
  requirementCount: number;
  steps: readonly SurfacePlanningStep[];
}>;
export type PackageSyscallEnvelope = Readonly<{
  schemaVersion: typeof PACKAGE_RESOLUTION_SCHEMA_VERSION;
  caller: PackageIdentity;
  runId: string;
  capabilityGrantId: string;
  syscall: string;
  idempotencyKey: string;
  timeoutMs: number;
  cancellationToken: string;
  resourceBudgetMb: number;
}>;

/** Integer minor units are authoritative money. Floating point values are display-only and never parse here. */
export type MoneyMinor = Readonly<{ currency: string; amountMinor: number }>;
export type ProductOffer = Readonly<{
  schemaVersion: typeof STORE_COMMERCE_SCHEMA_VERSION;
  offerId: string;
  productId: string;
  package: PackageIdentity;
  sellerKind: 'first-party' | 'third-party';
  price: MoneyMinor;
  taxTreatment: 'exclusive' | 'inclusive' | 'not-applicable';
  revision: string;
  active: boolean;
}>;
export type CommerceOrderState = 'created' | 'payment-pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
export type CommerceOrder = Readonly<{
  schemaVersion: typeof STORE_COMMERCE_SCHEMA_VERSION;
  orderId: string;
  accountId: string;
  offer: ProductOffer;
  state: CommerceOrderState;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}>;
export type PaymentEvent = Readonly<{
  schemaVersion: typeof STORE_COMMERCE_SCHEMA_VERSION;
  paymentEventId: string;
  orderId: string;
  providerEventId: string;
  kind: 'authorized' | 'captured' | 'failed' | 'refunded';
  amount: MoneyMinor;
  idempotencyKey: string;
  occurredAt: string;
}>;
export type Refund = Readonly<{
  schemaVersion: typeof STORE_COMMERCE_SCHEMA_VERSION;
  refundId: string;
  orderId: string;
  paymentEventId: string;
  amount: MoneyMinor;
  reasonCode: string;
  idempotencyKey: string;
  createdAt: string;
}>;
export type Entitlement = Readonly<{
  schemaVersion: typeof STORE_COMMERCE_SCHEMA_VERSION;
  entitlementId: string;
  accountId: string;
  offerId: string;
  package: PackageIdentity;
  state: 'active' | 'revoked' | 'expired';
  issuedAt: string;
  expiresAt?: string;
}>;
/** Commercial admission is opaque and cannot replace Trust, signature, compatibility, or consent. */
export type AcquisitionGrant = Readonly<{
  schemaVersion: typeof STORE_COMMERCE_SCHEMA_VERSION;
  grantId: string;
  accountId: string;
  offerId: string;
  package: PackageIdentity;
  entitlementId: string;
  policyVersion: string;
  expiresAt?: string;
  offlineRule?: 'none' | 'validated-install-retained';
}>;
/**
 * An authoritative, bounded Store snapshot for one order. It validates existing
 * commercial evidence; it does not mint Credit or invoke a payment provider.
 */
export type CommerceOrderLifecycle = Readonly<{
  order: CommerceOrder;
  paymentEvents: readonly PaymentEvent[];
  refunds: readonly Refund[];
  entitlement?: Entitlement;
  /** Present only while the matching entitlement can still admit paid activation. */
  activeGrant?: AcquisitionGrant;
}>;

export type CommissionEntry = Readonly<{
  schemaVersion: typeof STORE_COMMERCE_SCHEMA_VERSION;
  commissionId: string;
  orderId: string;
  gross: MoneyMinor;
  tax: MoneyMinor;
  refunded: MoneyMinor;
  publisherPayable: MoneyMinor;
  tomniCommission: MoneyMinor;
  rateBasisPoints: 1500;
}>;
export type PublisherPayable = Readonly<{
  schemaVersion: typeof STORE_COMMERCE_SCHEMA_VERSION;
  payableId: string;
  publisherId: string;
  commissionId: string;
  amount: MoneyMinor;
  state: 'accrued' | 'reversed' | 'paid';
}>;
export type StoreRankingLane = 'recommended' | 'featured' | 'sponsored';

const ORDER_TRANSITIONS: Readonly<Record<CommerceOrderState, readonly CommerceOrderState[]>> = {
  created: ['payment-pending', 'cancelled'],
  'payment-pending': ['paid', 'failed', 'cancelled'],
  paid: ['refunded'],
  failed: [],
  cancelled: [],
  refunded: [],
};
export const assertCommerceOrderTransition = (from: CommerceOrderState, to: CommerceOrderState): CommerceOrderState => {
  if (!ORDER_TRANSITIONS[from].includes(to)) throw new Error(`Invalid Store order transition: ${from} -> ${to}.`);
  return to;
};
