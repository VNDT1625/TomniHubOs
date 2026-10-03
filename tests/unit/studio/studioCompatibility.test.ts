import { describe, expect, it } from 'vitest';
import {
  createStudioCompatibilityLegacyFallbackDestination,
  createStudioCompatibilityRouteDestination,
  createStudioPackageGateNavigationState,
  LEGACY_STUDIO_MODULE_ID,
  LEGACY_STUDIO_PACKAGE_ID,
  createStudioAliasUninstallPlan,
  createStudioDataMigrationReceipt,
  createStudioDataRollbackPlan,
  isStudioCompatibilityLegacyFallback,
  isStudioPackageGateNavigationState,
  isStudioSplitRouteRedirectBootstrapEnabled,
  readStudioSplitRouteRedirectBootstrap,
  resolveStudioCompatibility,
  resolveStudioSplitRouteRedirectEnvironment,
  resolveStudioCompatibilityNavigation,
  type LegacyStudioMode,
  type StudioCompatibilityPackageState,
} from '@/common/packages/studioCompatibility';

const mappings: Array<{
  mode: LegacyStudioMode;
  packageId: string;
  moduleId: string;
}> = [
  { mode: 'dashboard', packageId: 'com.tomni.document-studio', moduleId: 'document' },
  { mode: 'file', packageId: 'com.tomni.document-studio', moduleId: 'document' },
  { mode: 'editor', packageId: 'com.tomni.document-studio', moduleId: 'document' },
  { mode: 'peer', packageId: 'com.tomni.document-studio', moduleId: 'document' },
  { mode: 'viu', packageId: 'com.tomni.design-studio', moduleId: 'design' },
  { mode: 'automation', packageId: 'com.tomni.automation-studio', moduleId: 'automation' },
  { mode: 'makeVideo', packageId: 'com.tomni.video-studio', moduleId: 'video' },
  { mode: 'music', packageId: 'com.tomni.music-studio', moduleId: 'music' },
];

describe('Studio compatibility resolver v1', () => {
  it.each(mappings)('maps route mode $mode to $packageId/$moduleId', ({ mode, packageId, moduleId }) => {
    const result = resolveStudioCompatibility({ kind: 'route', pathname: '/studio', mode }, [packageId]);

    expect(result).toMatchObject({
      kind: 'resolved',
      schemaVersion: 1,
      normalizedMode: mode,
      reason: 'mapped-mode',
      target: { packageId, moduleId },
      availability: 'ready',
    });
    expect(result).not.toHaveProperty('installGate');
  });

  it.each(mappings)('maps package deep-link mode $mode to the same target', ({ mode, packageId, moduleId }) => {
    const result = resolveStudioCompatibility(
      {
        kind: 'package-module',
        packageId: LEGACY_STUDIO_PACKAGE_ID,
        moduleId: LEGACY_STUDIO_MODULE_ID,
        mode,
      },
      [packageId]
    );

    expect(result).toMatchObject({
      kind: 'resolved',
      normalizedMode: mode,
      target: { packageId, moduleId },
      availability: 'ready',
    });
  });

  it('returns an install gate with legacy return metadata when the target is absent', () => {
    const result = resolveStudioCompatibility({ kind: 'route', pathname: '/studio/', mode: 'viu' }, []);

    expect(result).toMatchObject({
      kind: 'resolved',
      normalizedMode: 'viu',
      target: { packageId: 'com.tomni.design-studio', moduleId: 'design' },
      availability: 'install-required',
      installGate: {
        reason: 'target-package-not-installed',
        packageId: 'com.tomni.design-studio',
        moduleId: 'design',
        legacyPackageId: 'com.tomni.studio',
        legacyModuleId: 'studio',
        requestedMode: 'viu',
      },
    });
  });

  it.each([undefined, null, ''])('uses the document dashboard for an omitted mode (%s)', (mode) => {
    const result = resolveStudioCompatibility({ kind: 'route', pathname: '/studio?legacy=1', mode }, [
      'com.tomni.document-studio',
    ]);

    expect(result).toMatchObject({
      kind: 'resolved',
      requestedMode: null,
      normalizedMode: 'dashboard',
      reason: 'default-mode',
      target: { kind: 'package', packageId: 'com.tomni.document-studio', moduleId: 'document' },
    });
  });

  it.each(['future-canvas', 'makevideo', 'STUDIO_V2'])('safely falls back for unknown or future mode %s', (mode) => {
    const result = resolveStudioCompatibility({ kind: 'route', pathname: '/studio', mode }, []);

    expect(result).toMatchObject({
      kind: 'resolved',
      requestedMode: mode,
      normalizedMode: 'dashboard',
      reason: 'unknown-mode-fallback',
      target: { kind: 'package', packageId: 'com.tomni.document-studio', moduleId: 'document' },
      availability: 'install-required',
    });
  });

  it('does not claim unrelated routes or package modules', () => {
    expect(resolveStudioCompatibility({ kind: 'route', pathname: '/store', mode: 'music' }, [])).toMatchObject({
      kind: 'not-legacy-entry',
    });
    expect(
      resolveStudioCompatibility(
        { kind: 'package-module', packageId: 'com.tomni.studio', moduleId: 'unknown', mode: 'music' },
        []
      )
    ).toMatchObject({ kind: 'not-legacy-entry' });
  });
});

describe('Studio compatibility route destination', () => {
  it('preserves legacy route parameters while marking the route source', () => {
    expect(createStudioCompatibilityRouteDestination('?mode=viu&workspace=example')).toBe(
      '/store/app/com.tomni.studio/studio?mode=viu&workspace=example&legacySource=route'
    );
  });

  it('creates a fixed legacy package return path for a package gate without losing the original query or state', () => {
    const originalState = { workspace: 'example', selection: 'document-4' };
    const state = createStudioPackageGateNavigationState('?mode=file&workspace=example', originalState);

    expect(isStudioPackageGateNavigationState(state)).toBe(true);
    expect(state).toEqual({
      kind: 'tomni.studio-package-gate-return.v1',
      navigationSearch: '?mode=file&workspace=example',
      navigationState: originalState,
    });
    expect(createStudioCompatibilityLegacyFallbackDestination(state.navigationSearch)).toBe(
      '/store/app/com.tomni.studio/studio?mode=file&workspace=example&legacyFallback=package-gate'
    );
  });

  it('rejects unstructured navigation state as a package-gate return marker', () => {
    expect(isStudioPackageGateNavigationState({ navigationSearch: '?mode=file' })).toBe(false);
  });

  it.each([undefined, '', 'package-gate-plus', true])('accepts no other legacy fallback marker (%p)', (value) => {
    expect(isStudioCompatibilityLegacyFallback(value)).toBe(false);
  });
});

describe('Studio split redirect bootstrap', () => {
  it('enables the split only for the explicit main-process environment override', () => {
    expect(resolveStudioSplitRouteRedirectEnvironment('1')).toBe(true);
  });

  it.each([undefined, null, '', '0', 'true', 'yes', true, 1])(
    'fails closed for an invalid or absent environment override (%p)',
    (value) => {
      expect(resolveStudioSplitRouteRedirectEnvironment(value)).toBe(false);
    }
  );

  it('accepts only the boolean value emitted by preload', () => {
    expect(isStudioSplitRouteRedirectBootstrapEnabled(true)).toBe(true);
    expect(isStudioSplitRouteRedirectBootstrapEnabled('1')).toBe(false);
  });

  it('retains the legacy runtime when the preload read fails', () => {
    expect(
      readStudioSplitRouteRedirectBootstrap(() => {
        throw new Error('bootstrap unavailable');
      })
    ).toBe(false);
  });

  it('rejects an untrusted preload result even when it looks truthy', () => {
    expect(readStudioSplitRouteRedirectBootstrap(() => '1')).toBe(false);
  });
});

describe('Studio compatibility runtime navigation', () => {
  const documentPackage = (
    overrides: Partial<StudioCompatibilityPackageState> = {}
  ): StudioCompatibilityPackageState => ({
    id: 'com.tomni.document-studio',
    state: 'available',
    enabled: false,
    compatible: true,
    ...overrides,
  });

  it('routes the legacy /studio entry to an enabled installed Document Studio package', () => {
    const result = resolveStudioCompatibilityNavigation(
      { kind: 'route', pathname: '/studio' },
      [documentPackage({ state: 'installed', enabled: true })],
      true
    );

    expect(result).toEqual({
      kind: 'target-runtime',
      target: { kind: 'package', packageId: 'com.tomni.document-studio', moduleId: 'document' },
    });
  });

  it('sends a catalog-visible but uninstalled target through the package gate', () => {
    const result = resolveStudioCompatibilityNavigation(
      { kind: 'package-module', packageId: LEGACY_STUDIO_PACKAGE_ID, moduleId: LEGACY_STUDIO_MODULE_ID },
      [documentPackage()],
      true
    );

    expect(result).toEqual({
      kind: 'package-gate',
      target: { kind: 'package', packageId: 'com.tomni.document-studio', moduleId: 'document' },
    });
  });

  it('routes legacy IDE links to the default IDE surface without Store state', () => {
    const result = resolveStudioCompatibilityNavigation({ kind: 'route', pathname: '/studio', mode: 'ide' }, [], false);

    expect(result).toEqual({ kind: 'default-runtime', target: { kind: 'default-surface', pathname: '/ide' } });
  });

  it('keeps the legacy runtime when the target is not in the available package catalog', () => {
    const result = resolveStudioCompatibilityNavigation({ kind: 'route', pathname: '/studio' }, [], true);

    expect(result).toEqual({ kind: 'legacy-runtime', reason: 'target-unavailable' });
  });

  it('keeps the legacy runtime when the installed target is disabled', () => {
    const result = resolveStudioCompatibilityNavigation(
      { kind: 'route', pathname: '/studio' },
      [documentPackage({ state: 'installed' })],
      true
    );

    expect(result).toEqual({ kind: 'legacy-runtime', reason: 'target-disabled' });
  });

  it('keeps the legacy runtime when the catalog target is incompatible', () => {
    const result = resolveStudioCompatibilityNavigation(
      { kind: 'route', pathname: '/studio' },
      [documentPackage({ compatible: false })],
      true
    );

    expect(result).toEqual({ kind: 'legacy-runtime', reason: 'target-unavailable' });
  });

  it('keeps the legacy runtime when the trusted bootstrap is absent', () => {
    const result = resolveStudioCompatibilityNavigation({ kind: 'route', pathname: '/studio' }, [
      documentPackage({ state: 'installed', enabled: true }),
    ]);

    expect(result).toEqual({ kind: 'legacy-runtime', reason: 'redirect-disabled' });
  });

  it('keeps the legacy runtime when the redirect rollback switch is disabled', () => {
    const result = resolveStudioCompatibilityNavigation(
      { kind: 'route', pathname: '/studio' },
      [documentPackage({ state: 'installed', enabled: true })],
      false
    );

    expect(result).toEqual({ kind: 'legacy-runtime', reason: 'redirect-disabled' });
  });

  it('does not claim the Document Studio target and therefore cannot create a redirect loop', () => {
    const result = resolveStudioCompatibilityNavigation(
      { kind: 'package-module', packageId: 'com.tomni.document-studio', moduleId: 'document' },
      [documentPackage({ state: 'installed', enabled: true })],
      true
    );

    expect(result).toEqual({ kind: 'not-legacy-entry' });
  });
});

describe('Studio data migration compatibility contracts', () => {
  it('creates a deterministic, owner-changing receipt without mutating input order', () => {
    const bindings = [
      {
        legacyKey: 'studio.lastView',
        targetPackageId: 'com.tomni.design-studio',
        targetKey: 'design.lastView',
      },
      {
        legacyKey: 'studio.recentFiles',
        targetPackageId: 'com.tomni.document-studio',
        targetKey: 'document.recentFiles',
      },
    ];

    const receipt = createStudioDataMigrationReceipt('studio-split-v1', bindings);

    expect(bindings.map((binding) => binding.legacyKey)).toEqual(['studio.lastView', 'studio.recentFiles']);
    expect(receipt).toEqual({
      schemaVersion: 'tomni.studio-data-migration-receipt.v1',
      migrationId: 'studio-split-v1',
      sourceOwnerPackageId: 'com.tomni.studio',
      bindings: [bindings[0], bindings[1]].toSorted((left, right) => left.legacyKey.localeCompare(right.legacyKey)),
    });
  });

  it('rejects ambiguous receipts and bindings that keep the alias as owner', () => {
    expect(() =>
      createStudioDataMigrationReceipt('duplicate', [
        { legacyKey: 'studio.lastView', targetPackageId: 'com.tomni.design-studio', targetKey: 'design.view' },
        { legacyKey: 'studio.lastView', targetPackageId: 'com.tomni.document-studio', targetKey: 'document.view' },
      ])
    ).toThrow('Duplicate legacy migration key');
    expect(() =>
      createStudioDataMigrationReceipt('same-owner', [
        { legacyKey: 'studio.lastView', targetPackageId: 'com.tomni.studio', targetKey: 'studio.lastView.v2' },
      ])
    ).toThrow('new owner package');
  });

  it('builds rollback references that never delete data owned by standalone apps', () => {
    const receipt = createStudioDataMigrationReceipt('rollback-v1', [
      {
        legacyKey: 'studio.recentFiles',
        targetPackageId: 'com.tomni.document-studio',
        targetKey: 'document.recentFiles',
      },
    ]);

    const rollback = createStudioDataRollbackPlan(receipt);

    expect(rollback).toEqual({
      schemaVersion: 'tomni.studio-data-rollback-plan.v1',
      migrationId: 'rollback-v1',
      references: [
        {
          sourceOwnerPackageId: 'com.tomni.document-studio',
          sourceKey: 'document.recentFiles',
          restoreOwnerPackageId: 'com.tomni.studio',
          restoreKey: 'studio.recentFiles',
          strategy: 'copy-if-missing',
          deleteSource: false,
        },
      ],
      dataDeletions: [],
    });
  });

  it('uninstalls only the compatibility runtime and preserves every new-owner key', () => {
    const receipt = createStudioDataMigrationReceipt('uninstall-v1', [
      {
        legacyKey: 'studio.recentFiles',
        targetPackageId: 'com.tomni.document-studio',
        targetKey: 'document.recentFiles',
      },
      {
        legacyKey: 'studio.lastView',
        targetPackageId: 'com.tomni.design-studio',
        targetKey: 'design.lastView',
      },
    ]);

    const plan = createStudioAliasUninstallPlan([receipt]);

    expect(plan).toMatchObject({
      aliasPackageId: 'com.tomni.studio',
      action: 'remove-alias-runtime-only',
      preserveLegacyData: true,
      dataDeletions: [],
    });
    expect(plan.preserveOwnerPackageIds).toEqual(
      expect.arrayContaining([
        'com.tomni.document-studio',
        'com.tomni.design-studio',
        'com.tomni.automation-studio',
        'com.tomni.video-studio',
        'com.tomni.music-studio',
      ])
    );
    expect(plan.preserveData).toEqual([
      { ownerPackageId: 'com.tomni.design-studio', key: 'design.lastView' },
      { ownerPackageId: 'com.tomni.document-studio', key: 'document.recentFiles' },
    ]);
  });
});
