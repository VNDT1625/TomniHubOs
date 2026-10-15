import { describe, expect, it } from 'vitest';
import type { PackageListing } from '../../../packages/desktop/src/common/packages';
import {
    buildLauncherModel,
    buildInstalledPackageCards,
  buildAllAppCards,

    isPackageListingInstalled,
  isAvailableSignedAppPackage,

  webEmbedAppsOf,
} from '../../../packages/desktop/src/renderer/pages/hub/installedPackageApps';

const listing = (id: string, overrides: Partial<PackageListing> = {}): PackageListing => {
  const manifest = { id, name: id, version: '1.0.0' } as PackageListing['manifest'];
  return {
    manifest,
    installedManifest: manifest,
    delivery: 'downloaded-package',
    trust: 'signed-store',
    state: 'installed',
    enabled: true,
    compatible: true,
    updateAvailable: false,
    ...overrides,
  } as PackageListing;
};

const builtIns = [
  { id: 'chat' },
  { id: 'browser' },
  { id: 'studio', packageId: 'com.tomni.studio', moduleId: 'studio' },
];
const modulesOf = (item: PackageListing) =>
  item.manifest.id === 'com.tomni.studio'
    ? [{ id: 'studio', title: 'Studio', pinnable: true }]
    : [{ id: 'main', title: item.manifest.id, pinnable: true }];

const view = (key: string, kind: string, enabled: boolean, status: 'on' | 'off' | 'error') => ({
  key,
  kind,
  title: key,
  enabled,
  status,
});

describe('installed package app state', () => {
    it('preflights only signed, compatible and unrevoked Store app releases', () => {
        const base = listing('com.tomni.document-studio', { trust: 'signed-first-party' });
    const valid = { ...base, manifest: { ...base.manifest, type: 'app' as const } };
    expect(isAvailableSignedAppPackage(valid)).toBe(true);
    expect(isAvailableSignedAppPackage({ ...valid, compatible: false })).toBe(false);
        expect(isAvailableSignedAppPackage({ ...valid, revoked: true })).toBe(false);
    expect(isAvailableSignedAppPackage({ ...valid, state: 'quarantined' })).toBe(false);
        expect(isAvailableSignedAppPackage({ ...valid, state: 'failed', installedManifest: undefined })).toBe(true);
    expect(isPackageListingInstalled({ ...valid, state: 'failed' })).toBe(false);
    expect(isAvailableSignedAppPackage({ ...valid, state: 'installing' })).toBe(false);
    expect(isAvailableSignedAppPackage({ ...valid, state: 'available' })).toBe(true);

    expect(isAvailableSignedAppPackage({ ...valid, trust: 'local-built' })).toBe(false);
    expect(isAvailableSignedAppPackage(undefined)).toBe(false);
  });
  it('treats only installed downloaded packages with an installed manifest as installed', () => {
    expect(isPackageListingInstalled(listing('a'))).toBe(true);
    expect(isPackageListingInstalled(listing('a', { state: 'available' }))).toBe(false);
    expect(isPackageListingInstalled(listing('a', { state: 'quarantined' }))).toBe(false);
    expect(isPackageListingInstalled(listing('a', { installedManifest: undefined }))).toBe(false);
    expect(isPackageListingInstalled(listing('a', { delivery: 'bundled-legacy' }))).toBe(false);
  });

  it('hides package-backed built-ins and does not count them when the package is not installed', () => {
    const model = buildLauncherModel(builtIns, [listing('com.tomni.studio', { state: 'available' })], modulesOf);
    expect(model.builtInApps.map((app) => app.id)).toEqual(['chat', 'browser']);
    expect(model.packageApps).toEqual([]);
    expect(model.total).toBe(2);
  });

  it('counts an installed package-backed built-in once, not as built-in plus pinned module', () => {
    const model = buildLauncherModel(
      builtIns,
      [listing('com.tomni.studio'), listing('org.example.notes')],
      modulesOf
    );
    expect(model.builtInApps.map((app) => app.id)).toEqual(['chat', 'browser', 'studio']);
    expect(model.packageApps.map((app) => app.id)).toEqual(['org.example.notes:main']);
    expect(model.pinnedPackageApps.map((app) => app.id)).toEqual(['com.tomni.studio:studio', 'org.example.notes:main']);
    expect(model.total).toBe(4);
  });

  it('lists only web-embed connections that are switched on, by package and connection id', () => {
    expect(
      webEmbedAppsOf('org.example.notes', [
        view('web-embed:board', 'web-embed', true, 'on'),
        view('web-embed:draft', 'web-embed', false, 'off'),
        view('web-embed:broken', 'web-embed', false, 'error'),
        view('mcp:docs', 'mcp', true, 'on'),
        view('web-embed:', 'web-embed', true, 'on'),
      ])
    ).toEqual([
      {
        id: 'web-embed:org.example.notes:board',
        packageId: 'org.example.notes',
        connectionId: 'board',
        title: 'web-embed:board',
      },
    ]);
  });

    it('shows one truthful app card per installed package, including local-built headless packages', () => {
    const packaged = (id: string, type: 'app' | 'ui', trust: PackageListing['trust'] = 'signed-store') => {
      const base = listing(id, { trust, installedTrust: trust });
      return {
        ...base,
        manifest: { ...base.manifest, type },
        installedManifest: { ...base.manifest, type },
      };
    };
    const browser = packaged('com.tomni.browser', 'app', 'signed-first-party');
    const local = packaged('org.example.repo-tool', 'app', 'local-built');
    const notInstalled = { ...packaged('org.example.missing', 'app'), state: 'available' as const };
    const theme = packaged('org.example.theme', 'ui');
    const cards = buildInstalledPackageCards([browser, browser, local, notInstalled, theme], (item) =>
      item.manifest.id === browser.manifest.id ? [{ id: 'browser', title: 'Browser', pinnable: true }] : []
    );
    expect(cards).toEqual([
      { packageId: 'com.tomni.browser', title: 'com.tomni.browser', moduleId: 'browser', pinnable: true, localBuilt: false, enabled: true, revoked: false },
      { packageId: 'org.example.repo-tool', title: 'org.example.repo-tool', pinnable: false, localBuilt: true, enabled: true, revoked: false },
    ]);
        expect(buildInstalledPackageCards([local], () => [])).toHaveLength(1);
    expect(buildInstalledPackageCards([{ ...local, enabled: false }], () => [])[0])
      .toMatchObject({ enabled: false, revoked: false });
    expect(buildInstalledPackageCards([{ ...local, installedTrust: 'unsigned-revoked' }], () => [])[0])
      .toMatchObject({ enabled: false, revoked: true });
    expect(buildInstalledPackageCards([{ ...local, state: 'quarantined' }], () => [])).toEqual([]);
  });

    it('always renders the five defaults plus distinct installed apps without faking installations', () => {
    const defaults = ['browser', 'ide', 'document', 'automation', 'calculator'].map((id) => ({
      packageId: `com.tomni.${id}`, moduleId: id, title: id,
    }));
    const browser = { packageId: 'com.tomni.browser', moduleId: 'browser', title: 'Browser',
      pinnable: true, localBuilt: false, enabled: true, revoked: false };
    const local = { ...browser, packageId: 'org.example.local', title: 'Local', localBuilt: true };
    const cards = buildAllAppCards(defaults, [browser, local]);
    expect(cards).toHaveLength(6);
    expect(cards.map((item) => item.packageId)).toEqual([...defaults.map((item) => item.packageId), 'org.example.local']);
    expect(cards[0]).toMatchObject({ installed: true, enabled: true });
    expect(cards[1]).toMatchObject({ installed: false, enabled: false });
    expect(cards[5]).toMatchObject({ installed: true, localBuilt: true });
  });

  it('counts web-embed apps once and drops those of a package that is no longer installed', () => {
    const apps = [
      {
        id: 'web-embed:org.example.notes:board',
        packageId: 'org.example.notes',
        connectionId: 'board',
        title: 'Board',
      },
      { id: 'web-embed:org.gone:app', packageId: 'org.gone', connectionId: 'app', title: 'Gone' },
    ];
    const model = buildLauncherModel(builtIns, [listing('org.example.notes')], modulesOf, apps);
    expect(model.webEmbedApps.map((app) => app.id)).toEqual(['web-embed:org.example.notes:board']);
    expect(model.total).toBe(2 + 1 + 1);
    expect(buildLauncherModel(builtIns, [], modulesOf).webEmbedApps).toEqual([]);
  });
});
