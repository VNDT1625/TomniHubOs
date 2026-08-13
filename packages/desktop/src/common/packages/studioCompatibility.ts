/**
 * Pure compatibility contracts for decomposing the legacy Studio suite.
 * This module never reads storage, installs packages, or mutates user data.
 */

export const STUDIO_COMPATIBILITY_VERSION = 1 as const;
export const LEGACY_STUDIO_PACKAGE_ID = 'com.tomni.studio' as const;
export const LEGACY_STUDIO_MODULE_ID = 'studio' as const;

/**
 * Local process-start override for the non-destructive Studio split redirect.
 * Only the exact value `1` enables the redirect; unset, `0`, and malformed
 * values retain the legacy Studio runtime. The renderer never reads this
 * environment variable directly.
 */
export const STUDIO_SPLIT_ROUTE_REDIRECT_ENV_KEY = 'TOMNY_STUDIO_SPLIT_ROUTE_REDIRECT' as const;

/** Narrow, read-only bootstrap channel from the Electron main process to preload. */
export const STUDIO_SPLIT_ROUTE_REDIRECT_BOOTSTRAP_CHANNEL = 'studio-compatibility.bootstrap-redirect-enabled' as const;

/** Parse the main-process override with a strict fail-closed default. */
export const resolveStudioSplitRouteRedirectEnvironment = (value: unknown): boolean => value === '1';

/** Accept only the boolean emitted by the trusted preload bootstrap. */
export const isStudioSplitRouteRedirectBootstrapEnabled = (value: unknown): boolean => value === true;

/** Read the one-way preload bootstrap and retain legacy behavior on any failure. */
export const readStudioSplitRouteRedirectBootstrap = (read: () => unknown): boolean => {
  try {
    return isStudioSplitRouteRedirectBootstrapEnabled(read());
  } catch {
    return false;
  }
};

/** Preserve same-origin legacy query parameters while routing through the package compatibility gate. */
export const createStudioCompatibilityRouteDestination = (search: string): string => {
  const parameters = new URLSearchParams(search);
  parameters.set('legacySource', 'route');
  return `/store/app/${LEGACY_STUDIO_PACKAGE_ID}/${LEGACY_STUDIO_MODULE_ID}?${parameters.toString()}`;
};

const STUDIO_PACKAGE_GATE_RETURN_KIND = 'tomni.studio-package-gate-return.v1' as const;
const STUDIO_COMPATIBILITY_LEGACY_FALLBACK_VALUE = 'package-gate' as const;

/** State retained only while a Store package gate replaces a legacy Studio route. */
export type StudioPackageGateNavigationState = {
  kind: typeof STUDIO_PACKAGE_GATE_RETURN_KIND;
  navigationSearch: string;
  navigationState: unknown;
};

/** Keep an opaque caller state while ensuring the eventual return route is fixed to the legacy package surface. */
export const createStudioPackageGateNavigationState = (
  navigationSearch: string,
  navigationState: unknown
): StudioPackageGateNavigationState => ({
  kind: STUDIO_PACKAGE_GATE_RETURN_KIND,
  navigationSearch,
  navigationState,
});

/** Identify the exact state shape created by the package gate before restoring it. */
export const isStudioPackageGateNavigationState = (value: unknown): value is StudioPackageGateNavigationState =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === STUDIO_PACKAGE_GATE_RETURN_KIND &&
  typeof (value as { navigationSearch?: unknown }).navigationSearch === 'string';

/** Return from an install gate only to the known legacy Studio package route, never an arbitrary path. */
export const createStudioCompatibilityLegacyFallbackDestination = (search: string): string => {
  const parameters = new URLSearchParams(search);
  parameters.set('legacyFallback', STUDIO_COMPATIBILITY_LEGACY_FALLBACK_VALUE);
  return `/store/app/${LEGACY_STUDIO_PACKAGE_ID}/${LEGACY_STUDIO_MODULE_ID}?${parameters.toString()}`;
};

/** The explicit return marker prevents a package gate from immediately redirecting back to itself. */
export const isStudioCompatibilityLegacyFallback = (value: unknown): boolean =>
  value === STUDIO_COMPATIBILITY_LEGACY_FALLBACK_VALUE;

export type LegacyStudioMode =
  | 'dashboard'
  | 'file'
  | 'editor'
  | 'peer'
  | 'viu'
  | 'automation'
  | 'makeVideo'
  | 'music'
  | 'ide';

export type StudioCompatibilityEntryPoint =
  | { kind: 'route'; pathname: string; mode?: string | null }
  | { kind: 'package-module'; packageId: string; moduleId: string; mode?: string | null };

export type StudioCompatibilityTarget = {
  packageId: string;
  moduleId: string;
};

export type StudioInstallGateMetadata = {
  reason: 'target-package-not-installed';
  packageId: string;
  moduleId: string;
  legacyPackageId: typeof LEGACY_STUDIO_PACKAGE_ID;
  legacyModuleId: typeof LEGACY_STUDIO_MODULE_ID;
  requestedMode: string | null;
};

export type StudioCompatibilityResolution =
  | {
      kind: 'not-legacy-entry';
      schemaVersion: typeof STUDIO_COMPATIBILITY_VERSION;
      source: StudioCompatibilityEntryPoint;
    }
  | {
      kind: 'resolved';
      schemaVersion: typeof STUDIO_COMPATIBILITY_VERSION;
      source: StudioCompatibilityEntryPoint;
      requestedMode: string | null;
      normalizedMode: LegacyStudioMode;
      reason: 'mapped-mode' | 'default-mode' | 'unknown-mode-fallback';
      target: StudioCompatibilityTarget;
      availability: 'ready' | 'install-required';
      installGate?: StudioInstallGateMetadata;
    };

export type StudioCompatibilityPackageState = {
  id: string;
  state: 'available' | 'installing' | 'installed' | 'uninstalling' | 'failed' | 'quarantined';
  enabled: boolean;
  compatible: boolean;
};

export type StudioCompatibilityNavigation =
  | { kind: 'not-legacy-entry' }
  | { kind: 'legacy-runtime'; reason: 'redirect-disabled' | 'target-unavailable' | 'target-disabled' }
  | { kind: 'target-runtime'; target: StudioCompatibilityTarget }
  | { kind: 'package-gate'; target: StudioCompatibilityTarget };

const DOCUMENT_STUDIO_TARGET = {
  packageId: 'com.tomni.document-studio',
  moduleId: 'document',
} as const satisfies StudioCompatibilityTarget;

const TARGETS: Readonly<Record<LegacyStudioMode, StudioCompatibilityTarget>> = {
  dashboard: DOCUMENT_STUDIO_TARGET,
  file: DOCUMENT_STUDIO_TARGET,
  editor: DOCUMENT_STUDIO_TARGET,
  peer: DOCUMENT_STUDIO_TARGET,
  viu: { packageId: 'com.tomni.design-studio', moduleId: 'design' },
  automation: { packageId: 'com.tomni.automation-studio', moduleId: 'automation' },
  makeVideo: { packageId: 'com.tomni.video-studio', moduleId: 'video' },
  music: { packageId: 'com.tomni.music-studio', moduleId: 'music' },
  ide: { packageId: 'com.tomni.ide', moduleId: 'ide' },
};

const STANDALONE_STUDIO_PACKAGE_IDS = [
  'com.tomni.automation-studio',
  'com.tomni.design-studio',
  'com.tomni.document-studio',
  'com.tomni.music-studio',
  'com.tomni.video-studio',
] as const;

const LEGACY_MODES = new Set<string>(Object.keys(TARGETS));

const normalizePathname = (pathname: string): string => {
  const withoutQuery = pathname.trim().split(/[?#]/, 1)[0];
  const normalized = withoutQuery.replace(/\/+$/, '');
  return normalized || '/';
};

const isLegacyEntryPoint = (source: StudioCompatibilityEntryPoint): boolean =>
  source.kind === 'route'
    ? normalizePathname(source.pathname) === '/studio'
    : source.packageId === LEGACY_STUDIO_PACKAGE_ID && source.moduleId === LEGACY_STUDIO_MODULE_ID;

const resolveMode = (
  requestedMode: string | null
): { normalizedMode: LegacyStudioMode; reason: 'mapped-mode' | 'default-mode' | 'unknown-mode-fallback' } => {
  if (requestedMode === null || requestedMode.length === 0) {
    return { normalizedMode: 'dashboard', reason: 'default-mode' };
  }
  if (LEGACY_MODES.has(requestedMode)) {
    return { normalizedMode: requestedMode as LegacyStudioMode, reason: 'mapped-mode' };
  }
  return { normalizedMode: 'dashboard', reason: 'unknown-mode-fallback' };
};

/** Resolve a legacy Studio route or package deep link without performing navigation or installation. */
export const resolveStudioCompatibility = (
  source: StudioCompatibilityEntryPoint,
  availablePackageIds: readonly string[]
): StudioCompatibilityResolution => {
  if (!isLegacyEntryPoint(source)) {
    return { kind: 'not-legacy-entry', schemaVersion: STUDIO_COMPATIBILITY_VERSION, source: { ...source } };
  }

  const requestedMode = source.mode?.trim() || null;
  const mode = resolveMode(requestedMode);
  const target = { ...TARGETS[mode.normalizedMode] };
  const available = new Set(availablePackageIds.map((id) => id.trim()).filter(Boolean));
  if (available.has(target.packageId)) {
    return {
      kind: 'resolved',
      schemaVersion: STUDIO_COMPATIBILITY_VERSION,
      source: { ...source },
      requestedMode,
      ...mode,
      target,
      availability: 'ready',
    };
  }

  return {
    kind: 'resolved',
    schemaVersion: STUDIO_COMPATIBILITY_VERSION,
    source: { ...source },
    requestedMode,
    ...mode,
    target,
    availability: 'install-required',
    installGate: {
      reason: 'target-package-not-installed',
      packageId: target.packageId,
      moduleId: target.moduleId,
      legacyPackageId: LEGACY_STUDIO_PACKAGE_ID,
      legacyModuleId: LEGACY_STUDIO_MODULE_ID,
      requestedMode,
    },
  };
};

/**
 * Decide the runtime action for a legacy Studio entry without navigating or
 * installing anything. A catalog entry that is available but not installed
 * goes to the package detail gate; disabled or unavailable targets fail closed
 * to the still-supported legacy runtime.
 */
export const resolveStudioCompatibilityNavigation = (
  source: StudioCompatibilityEntryPoint,
  packages: readonly StudioCompatibilityPackageState[],
  redirectEnabled = false
): StudioCompatibilityNavigation => {
  const resolution = resolveStudioCompatibility(source, []);
  if (resolution.kind === 'not-legacy-entry') return { kind: 'not-legacy-entry' };
  if (!redirectEnabled) return { kind: 'legacy-runtime', reason: 'redirect-disabled' };

  const targetPackage = packages.find((candidate) => candidate.id === resolution.target.packageId);
  if (!targetPackage || !targetPackage.compatible) {
    return { kind: 'legacy-runtime', reason: 'target-unavailable' };
  }
  if (targetPackage.state === 'installed') {
    return targetPackage.enabled
      ? { kind: 'target-runtime', target: resolution.target }
      : { kind: 'legacy-runtime', reason: 'target-disabled' };
  }
  if (targetPackage.state === 'available') return { kind: 'package-gate', target: resolution.target };
  return { kind: 'legacy-runtime', reason: 'target-unavailable' };
};

export type StudioDataMigrationBinding = {
  legacyKey: string;
  targetPackageId: string;
  targetKey: string;
  contentSha256?: string;
};

export type StudioDataMigrationReceipt = {
  schemaVersion: 'tomni.studio-data-migration-receipt.v1';
  migrationId: string;
  sourceOwnerPackageId: typeof LEGACY_STUDIO_PACKAGE_ID;
  bindings: StudioDataMigrationBinding[];
};

export type StudioDataRollbackReference = {
  sourceOwnerPackageId: string;
  sourceKey: string;
  restoreOwnerPackageId: typeof LEGACY_STUDIO_PACKAGE_ID;
  restoreKey: string;
  strategy: 'copy-if-missing';
  deleteSource: false;
};

export type StudioDataRollbackPlan = {
  schemaVersion: 'tomni.studio-data-rollback-plan.v1';
  migrationId: string;
  references: StudioDataRollbackReference[];
  dataDeletions: [];
};

export type StudioAliasUninstallPlan = {
  schemaVersion: 'tomni.studio-alias-uninstall-plan.v1';
  aliasPackageId: typeof LEGACY_STUDIO_PACKAGE_ID;
  action: 'remove-alias-runtime-only';
  preserveLegacyData: true;
  preserveOwnerPackageIds: string[];
  preserveData: Array<{ ownerPackageId: string; key: string }>;
  dataDeletions: [];
};

const requireNonBlank = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be non-empty.`);
  return normalized;
};

const compareBindings = (left: StudioDataMigrationBinding, right: StudioDataMigrationBinding): number =>
  left.legacyKey.localeCompare(right.legacyKey) ||
  left.targetPackageId.localeCompare(right.targetPackageId) ||
  left.targetKey.localeCompare(right.targetKey);

/** Build a deterministic audit receipt; callers remain responsible for any separately authorized data copy. */
export const createStudioDataMigrationReceipt = (
  migrationId: string,
  bindings: readonly StudioDataMigrationBinding[]
): StudioDataMigrationReceipt => {
  const normalizedBindings = bindings.map((binding) => ({
    legacyKey: requireNonBlank(binding.legacyKey, 'legacyKey'),
    targetPackageId: requireNonBlank(binding.targetPackageId, 'targetPackageId'),
    targetKey: requireNonBlank(binding.targetKey, 'targetKey'),
    ...(binding.contentSha256 ? { contentSha256: binding.contentSha256.trim() } : {}),
  }));
  const legacyKeys = new Set<string>();
  for (const binding of normalizedBindings) {
    if (binding.targetPackageId === LEGACY_STUDIO_PACKAGE_ID) {
      throw new TypeError('A migrated binding must have a new owner package.');
    }
    if (legacyKeys.has(binding.legacyKey)) {
      throw new TypeError(`Duplicate legacy migration key: ${binding.legacyKey}`);
    }
    legacyKeys.add(binding.legacyKey);
  }

  return {
    schemaVersion: 'tomni.studio-data-migration-receipt.v1',
    migrationId: requireNonBlank(migrationId, 'migrationId'),
    sourceOwnerPackageId: LEGACY_STUDIO_PACKAGE_ID,
    bindings: normalizedBindings.toSorted(compareBindings),
  };
};

/** Build a non-destructive rollback plan that restores legacy references without deleting new-owner data. */
export const createStudioDataRollbackPlan = (receipt: StudioDataMigrationReceipt): StudioDataRollbackPlan => ({
  schemaVersion: 'tomni.studio-data-rollback-plan.v1',
  migrationId: receipt.migrationId,
  references: receipt.bindings.map((binding) => ({
    sourceOwnerPackageId: binding.targetPackageId,
    sourceKey: binding.targetKey,
    restoreOwnerPackageId: LEGACY_STUDIO_PACKAGE_ID,
    restoreKey: binding.legacyKey,
    strategy: 'copy-if-missing',
    deleteSource: false,
  })),
  dataDeletions: [],
});

/** Plan alias removal while explicitly preserving legacy and all standalone-owner data. */
export const createStudioAliasUninstallPlan = (
  receipts: readonly StudioDataMigrationReceipt[] = []
): StudioAliasUninstallPlan => {
  const preserveOwnerPackageIds = new Set<string>(STANDALONE_STUDIO_PACKAGE_IDS);
  const preserveData = new Map<string, { ownerPackageId: string; key: string }>();
  for (const receipt of receipts) {
    for (const binding of receipt.bindings) {
      preserveOwnerPackageIds.add(binding.targetPackageId);
      const key = `${binding.targetPackageId}\u0000${binding.targetKey}`;
      preserveData.set(key, { ownerPackageId: binding.targetPackageId, key: binding.targetKey });
    }
  }

  return {
    schemaVersion: 'tomni.studio-alias-uninstall-plan.v1',
    aliasPackageId: LEGACY_STUDIO_PACKAGE_ID,
    action: 'remove-alias-runtime-only',
    preserveLegacyData: true,
    preserveOwnerPackageIds: [...preserveOwnerPackageIds].toSorted(),
    preserveData: [...preserveData.values()].toSorted(
      (left, right) => left.ownerPackageId.localeCompare(right.ownerPackageId) || left.key.localeCompare(right.key)
    ),
    dataDeletions: [],
  };
};
