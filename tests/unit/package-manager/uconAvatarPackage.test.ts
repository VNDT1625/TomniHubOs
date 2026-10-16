import { describe, expect, it } from 'vitest';
import { packageManifestSchema } from '@/common/packages/manifest';
import type { PackageListing } from '@/common/packages';
import {
  encodePackageAvatar,
  installedAvatarSkins,
  parsePackageAvatar,
  resolvePackagedAvatar,
} from '@/renderer/components/agents/uconPackageSkins';
import { encodeUconAvatar, parseUconAvatar, resolveUconAppearance } from '@/renderer/components/agents/uconBotConfig';

const manifest = {
  schemaVersion: 1 as const,
  id: 'com.example.ucon-chef',
  publisherId: 'com.example',
  name: 'Chef Avatar Pack',
  description: 'Data-only UI avatar skins.',
  type: 'ui' as const,
  bundleKind: 'single' as const,
  version: '1.0.0',
  engines: { tomni: '>=0.0.0' },
  modules: [],
  permissions: [],
  dependencies: [],
  tags: ['ui', 'avatar'],
  contributions: {
    version: 1 as const,
    avatarSkins: [
      {
        id: 'chef-mini',
        name: 'Chef Mini',
        archetype: 'maker' as const,
        appearance: { apron: 'chef' as const, ears: 'round' as const, prop: 'book' as const },
      },
    ],
  },
};
const installed = (overrides: Partial<PackageListing> = {}): PackageListing => ({
  manifest,
  installedManifest: manifest,
  installedVersion: '1.0.0',
  state: 'installed',
  compatible: true,
  enabled: true,
  updateAvailable: false,
  delivery: 'downloaded-package',
  trust: 'signed-store',
  ...overrides,
});

describe('UCON signed UI avatar package contract', () => {
  it('accepts only data-only packages with bounded, valid skins', () => {
    expect(packageManifestSchema.safeParse(manifest).success).toBe(true);
    const duplicate = structuredClone(manifest);
    duplicate.contributions.avatarSkins.push({ ...duplicate.contributions.avatarSkins[0] });
    expect(packageManifestSchema.safeParse(duplicate).success).toBe(false);
    const script = structuredClone(manifest);
    Object.assign(script.contributions.avatarSkins[0].appearance, { html: '<script>boom</script>' });
    expect(packageManifestSchema.safeParse(script).success).toBe(false);
    const external = structuredClone(manifest);
    Object.assign(external.contributions.avatarSkins[0], { url: 'https://example.com/script.js' });
    expect(packageManifestSchema.safeParse(external).success).toBe(false);
    const many = structuredClone(manifest);
    many.contributions.avatarSkins = Array.from({ length: 33 }, (_, i) => ({
      ...many.contributions.avatarSkins[0],
      id: 'avatar-' + i,
    }));
    expect(packageManifestSchema.safeParse(many).success).toBe(false);
  });

  it('filters unavailable, disabled, quarantined, revoked and catalog-only skins', () => {
    expect(installedAvatarSkins([installed()])).toHaveLength(1);
    for (const extra of [
      { state: 'quarantined' as const },
      { enabled: false },
      { compatible: false },
      { revoked: true },
      { installedManifest: undefined },
      { lastError: 'PACKAGE_PAYLOAD_MISSING' as const },
      { installedVersion: '0.8.0' },
    ]) {
      expect(installedAvatarSkins([installed(extra)])).toEqual([]);
    }
    expect(installedAvatarSkins([])).toEqual([]);
  });

  it('does not lose the selected customization if the package disappears', () => {
    const avatar = encodePackageAvatar({
      packageId: manifest.id,
      skinId: 'chef-mini',
      overrides: { beard: 'sage', apron: 'lab' },
    });
    const choice = parsePackageAvatar(avatar);
    expect(choice).not.toBeNull();
    if (!choice) throw new Error('bad test choice');
    const present = resolvePackagedAvatar(choice, installedAvatarSkins([installed()]));
    expect(present.fromPackage).toBe(true);
    expect(present.appearance).toMatchObject({
      ears: 'round',
      prop: 'book',
      apron: 'lab',
      beard: 'sage',
    });
    const missing = resolvePackagedAvatar(choice, []);
    expect(missing.fromPackage).toBe(false);
    expect(missing.appearance).toEqual(resolveUconAppearance('core', { beard: 'sage', apron: 'lab' }));
    expect(encodePackageAvatar(choice)).toBe(avatar);
    expect(resolvePackagedAvatar(choice, installedAvatarSkins([installed()])).fromPackage).toBe(true);
  });

  it('rejects forged markers and preserves legacy UCON Core avatars', () => {
    expect(parsePackageAvatar('uconpkg:../../etc/passwd:skin')).toBeNull();
    expect(parsePackageAvatar('uconpkg:com.example.x:avatar;apron=<script>')).toBeNull();
    expect(parsePackageAvatar('uconpkg:com.example.x:avatar;constructor=evil')).toBeNull();
    expect(parsePackageAvatar('uconpkg:com.example.x:avatar;eyes=code')).toMatchObject({
      overrides: { eyes: 'code' },
    });
    expect(parsePackageAvatar('ucon:core')).toBeNull();
    expect(parseUconAvatar(encodeUconAvatar({ archetype: 'core', overrides: { apron: 'chef' } }))?.overrides).toEqual({
      apron: 'chef',
    });
  });
});
