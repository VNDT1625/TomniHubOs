/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type PackageType = 'app' | 'ui' | 'agent-capsule';
export type PackageBundleKind = 'single' | 'suite';
export type PackageDeliveryMode = 'bundled-legacy' | 'bundled-package' | 'downloaded-package';
export type PackageTrust = 'trusted-first-party' | 'signed-first-party' | 'signed-store';

export type PackageSigningKeyPolicy = {
  publicKey: string;
  publisherId: string;
  trust: Extract<PackageTrust, 'signed-first-party' | 'signed-store'>;
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

export type PackageContributionContract = {
  version: 1;
  apps?: PackageAppContribution[];
  ide?: {
    hostApiVersion: string;
    activityGroups?: PackageIdeActivityGroupContribution[];
    subtabs?: PackageIdeSubtabContribution[];
    commands?: PackageCommandContribution[];
    settings?: PackageSettingContribution[];
  };
};

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

  contributions?: PackageContributionContract;
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

export type PackagePublicErrorCode = PackageOperationFailureCode | 'PACKAGE_QUARANTINED';

export type PackageInstallSource = 'bundled' | 'store';
export type PackageInstallScope = 'core' | 'optional';

export type PackageInstallProvenance = {
  source: PackageInstallSource;
  scope: PackageInstallScope;
  version: string;
  integrity?: string;
};

export type PackageCatalogEntry = {
  manifest: PackageManifest;
  delivery: PackageDeliveryMode;
  trust: PackageTrust;
  installScope?: PackageInstallScope;
  sourceDirectory?: string;
  artifactUrl?: string;
};

export type InstalledPackageRecord = {
  id: string;
  version: string;
  previousVersion?: string;
  state: Extract<PackageLifecycleState, 'installed' | 'failed' | 'quarantined'>;
  delivery: PackageDeliveryMode;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  lastError?: string;
  manifest?: PackageManifest;
  trust?: PackageTrust;
  provenance?: PackageInstallProvenance;
};

export type PackageListing = {
  manifest: PackageManifest;
  delivery: PackageDeliveryMode;
  trust: PackageTrust;
  state: PackageLifecycleState;
  installedVersion?: string;
  installedManifest?: PackageManifest;
  /** Trust assertion for the exact installed artifact, not the latest catalog entry. */
  installedTrust?: PackageTrust;
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

export type PackageMutationAction = 'install' | 'uninstall';

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
