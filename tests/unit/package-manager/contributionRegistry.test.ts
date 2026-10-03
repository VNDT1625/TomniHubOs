import { describe, expect, it } from 'vitest';
import type { InstalledPackageRecord, PackageManifest } from '@/common/packages';
import { PackageContributionRegistry } from '@process/extensions/package-manager';

const legacyCalculatorManifest: PackageManifest = {
  schemaVersion: 1,
  id: 'com.tomni.calculator',
  publisherId: 'com.tomni',
  name: 'Calculator',
  description: 'A downloaded sandboxed calculator.',
  type: 'app',
  bundleKind: 'single',
  version: '1.0.0',
  engines: { tomni: '>=1.0.0' },
  modules: [
    {
      id: 'calculator',
      title: 'Calculator',
      surface: 'apps/calculator',
      pinnable: true,
      runtime: 'sandboxed-web',
      entrypoint: 'index.html',
    },
  ],
  permissions: [],
  dependencies: [],
  tags: ['calculator'],
};

const installedRecord = (manifest: PackageManifest): InstalledPackageRecord => ({
  id: manifest.id,
  version: manifest.version,
  state: 'installed',
  delivery: 'downloaded-package',
  enabled: true,
  installedAt: 1,
  updatedAt: 1,
  manifest,
  trust: 'signed-first-party',
});

describe('PackageContributionRegistry', () => {
  it('projects a sandboxed app module from a signed legacy manifest without app contributions', () => {
    const snapshot = new PackageContributionRegistry().replace([installedRecord(legacyCalculatorManifest)]);

    expect(snapshot.apps).toEqual([
      expect.objectContaining({
        id: 'calculator',
        title: 'Calculator',
        moduleId: 'calculator',
        packageId: 'com.tomni.calculator',
        packageVersion: '1.0.0',
      }),
    ]);
  });

  it('uses an explicit app contribution instead of the compatibility projection', () => {
    const manifest: PackageManifest = {
      ...legacyCalculatorManifest,
      contributions: {
        version: 1,
        apps: [{ id: 'calculator-app', title: 'My Calculator', moduleId: 'calculator' }],
      },
    };
    const snapshot = new PackageContributionRegistry().replace([installedRecord(manifest)]);

    expect(snapshot.apps).toEqual([
      expect.objectContaining({ id: 'calculator-app', title: 'My Calculator', moduleId: 'calculator' }),
    ]);
  });

  it('does not turn a trusted-react module into an implicit sandboxed app', () => {
    const manifest: PackageManifest = {
      ...legacyCalculatorManifest,
      modules: [
        {
          ...legacyCalculatorManifest.modules[0]!,
          runtime: 'trusted-react',
          entrypoint: 'entry.js',
        },
      ],
    };

    expect(new PackageContributionRegistry().replace([installedRecord(manifest)]).apps).toEqual([]);
  });
});
