import { describe, expect, it, vi } from 'vitest';
import type { PackageListing, PackageManifest, PackageStateChangedEvent } from '@/common/packages';
import {
  createDesignViuContributionManager,
  DESIGN_VIU_CONTRIBUTION_ID,
  DESIGN_VIU_PACKAGE_ID,
} from '@/process/resources/packageProcessRuntime/designViuContributionManager';

const manifest = (overrides: Partial<PackageManifest> = {}): PackageManifest => ({
  schemaVersion: 1,
  id: DESIGN_VIU_PACKAGE_ID,
  publisherId: 'com.tomni',
  name: 'Design Studio',
  description: 'Test-only signed Design fixture.',
  type: 'app',
  bundleKind: 'single',
  version: '1.0.0',
  engines: { tomni: '>=1.0.0' },
  modules: [{ id: 'design', title: 'Design', surface: 'apps/design', pinnable: true, runtime: 'trusted-react' }],
  permissions: [],
  dependencies: [],
  mainContributions: [{ schemaVersion: 1, id: DESIGN_VIU_CONTRIBUTION_ID }],
  tags: ['design'],
  artifact: {
    integrity: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sizeBytes: 1,
    signature: { algorithm: 'ed25519', keyId: 'test', value: 'signed-fixture' },
  },
  ...overrides,
});

const listing = (overrides: Partial<PackageListing> = {}): PackageListing => {
  const installedManifest = overrides.installedManifest ?? manifest();
  return {
    manifest: installedManifest,
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    state: 'installed',
    installedVersion: installedManifest.version,
    installedManifest,
    installedTrust: 'signed-first-party',
    installedPublicationReview: {
      schemaVersion: 1,
      disposition: 'auto-approved',
      fingerprint: 'reviewed',
      reviewedAt: '2026-08-21T00:00:00.000Z',
    },
    updateAvailable: false,
    compatible: true,
    enabled: true,
    ...overrides,
  };
};

const fakePackages = (current: () => PackageListing) => {
  let listener: ((event: PackageStateChangedEvent) => void) | undefined;
  return {
    status: vi.fn(async () => current()),
    onStateChanged: vi.fn((next: (event: PackageStateChangedEvent) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
    emit: (event: PackageStateChangedEvent) => listener?.(event),
  };
};

describe('fixed Design VIU contribution manager', () => {
  it.each([
    [
      'absent declaration',
      listing({ installedManifest: manifest({ mainContributions: undefined }) }),
      'declaration-missing',
    ],
    [
      'identity mismatch',
      listing({ installedManifest: manifest({ publisherId: 'org.other' }) }),
      'package-identity-mismatch',
    ],
    ['review revoked', listing({ revoked: true }), 'package-revoked'],
  ] as const)('denies %s before granting a VIU service', async (_name, denied, reason) => {
    const packages = fakePackages(() => denied);
    const manager = createDesignViuContributionManager({ packages });

    await manager.initialize();

    expect(manager.state()).toBe('inactive');
    expect(manager.activeService()).toBeUndefined();
    expect(manager.evidence().at(-1)).toMatchObject({ kind: 'denied', reason });
  });

  it('admits only the fixed reviewed-host object and cancels it when Design stops', async () => {
    let current = listing();
    const packages = fakePackages(() => current);
    const manager = createDesignViuContributionManager({ packages, now: () => 123 });

    await manager.initialize();
    const active = manager.activeService();
    expect(manager.state()).toBe('active');
    expect(active).toMatchObject({ schemaVersion: 1, contributionId: DESIGN_VIU_CONTRIBUTION_ID });
    expect(active).not.toHaveProperty('entrypoint');
    expect(active).not.toHaveProperty('run');
    expect(active?.isCancelled()).toBe(false);

    manager.cancel();
    expect(active?.isCancelled()).toBe(true);
    expect(manager.activeService()).toBeUndefined();
    expect(manager.state()).toBe('inactive');
    expect(manager.evidence().at(-1)).toMatchObject({ kind: 'cancelled', reason: 'manual-stop' });

    await manager.refresh();
    const reactivated = manager.activeService();
    expect(reactivated?.isCancelled()).toBe(false);
    expect(active?.isCancelled()).toBe(true);

    current = listing({ revoked: true });
    packages.emit({ id: DESIGN_VIU_PACKAGE_ID, state: 'installed' });
    await manager.refresh();
    expect(reactivated?.isCancelled()).toBe(true);
    expect(manager.activeService()).toBeUndefined();
    expect(manager.evidence()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'cancelled', reason: 'package-state-changed' }),
        expect.objectContaining({ kind: 'denied', reason: 'package-revoked' }),
      ])
    );
  });
});
