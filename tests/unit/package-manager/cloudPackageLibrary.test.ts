import { describe, expect, it } from 'vitest';
import type { PackageListing } from '@/common/packages';
import { cloudPackageOf, isCloudRestorablePackage } from '@/renderer/pages/hub/cloudPackageLibrary';
import { buildRestorePrompt } from '@/renderer/pages/hub/PackageRestoreOnboarding';
import { DEFAULT_ONBOARDING_APPS } from '@/renderer/pages/guid/HubHome/sidebarPins';

const listing = (id: string, trust: PackageListing['trust'] = 'signed-store'): PackageListing => ({
  manifest: { id, name: id, type: 'app' },
  installedManifest: { id, name: id, type: 'app' },
  delivery: 'downloaded-package',
  trust,
  installedTrust: trust,
  state: 'installed',
  enabled: true,
  compatible: true,
  updateAvailable: false,
} as PackageListing);

describe('account package library', () => {
  it('uploads only the names/IDs of genuinely installed Store artifacts', () => {
    expect(cloudPackageOf(listing('org.example.notes'))).toEqual({
      package_id: 'org.example.notes', name: 'org.example.notes',
    });
    expect(isCloudRestorablePackage(listing('com.tomni.calculator', 'signed-first-party'))).toBe(true);
    expect(cloudPackageOf(listing('org.example.my-repo', 'local-built'))).toBeNull();
        expect(cloudPackageOf(listing('org.example.revoked', 'unsigned-revoked'))).toBeNull();
    expect(cloudPackageOf({ ...listing('org.example.signed-revoked'), revoked: true })).toBeNull();
    expect(cloudPackageOf(listing('org.example.legacy', 'trusted-first-party'))).toBeNull();

    expect(cloudPackageOf({ ...listing('org.example.uninstalled'), state: 'available' })).toBeNull();
  });
  it('offers all five default packages for a new account on an empty device', () => {
    const result = buildRestorePrompt([], [], []);
    expect(result?.kind).toBe('first-login');
    expect(result?.options.map((item) => item.id)).toEqual(DEFAULT_ONBOARDING_APPS.map((app) => app.id));
  });
    it('does not offer an incompatible signed artifact for automatic restoration', () => {
    const unsupported = { ...listing('com.tomni.calculator'), compatible: false };
    const catalog = [{ ...unsupported, state: 'available' as const, installedManifest: undefined }];
    expect(buildRestorePrompt([], [], catalog)?.options.find((item) => item.id === 'com.tomni.calculator'))
      .toMatchObject({ available: false });
    expect(buildRestorePrompt([{ package_id: 'com.tomni.calculator', name: 'Calculator' }], [], catalog)).toBeNull();
  });
  it('does not interrupt an already populated device with no saved cloud library', () => {
    expect(buildRestorePrompt([], [listing('com.tomni.browser')], [])).toBeNull();
  });
  it('offers only missing signed Store packages on a new machine', () => {
    const cloud = [
      { package_id: 'com.tomni.calculator', name: 'Calculator' },
      { package_id: 'org.example.local-repo', name: 'Dangerous local repo' },
    ];
    const catalog = [
      { ...listing('com.tomni.calculator'), state: 'available', installedManifest: undefined },
      { ...listing('org.example.local-repo', 'local-built'), state: 'available', installedManifest: undefined },
    ];
    expect(buildRestorePrompt(cloud, [], catalog)?.options).toEqual([
      { id: 'com.tomni.calculator', name: 'Calculator', available: true },
    ]);
    expect(buildRestorePrompt(cloud, [listing('com.tomni.calculator')], catalog)).toBeNull();
  });
});
