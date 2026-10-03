import { describe, expect, it } from 'vitest';
import { parsePackageManifest, type InstalledPackageRecord, type PackageManifest } from '@/common/packages';
import {
  PackageContributionRegistry,
  type PackageContributionRegistryError,
} from '@/process/extensions/package-manager/contributionRegistry';

const module = (id: string) => ({ id, title: id, surface: `apps/${id}`, pinnable: true });

const ideManifest = (): PackageManifest =>
  parsePackageManifest({
    schemaVersion: 1,
    id: 'com.tomni.ide',
    publisherId: 'com.tomni',
    name: 'IDE',
    description: 'IDE core',
    type: 'app',
    bundleKind: 'single',
    version: '1.2.0',
    engines: { tomni: '>=1.0.0' },
    modules: [module('ide')],
    permissions: [],
    dependencies: [],
    contributions: {
      version: 1,
      apps: [{ id: 'ide', title: 'IDE', titleKey: 'packages.ide.title', moduleId: 'ide', order: 10 }],
      ide: {
        hostApiVersion: '^1.0.0',
        activityGroups: [
          { id: 'codebase', title: 'Codebase', titleKey: 'packages.ide.groups.codebase', order: 10 },
          { id: 'agent-ops', title: 'Agent operations', order: 20 },
        ],
      },
    },
    tags: [],
  });

const extensionManifest = (overrides: Record<string, unknown> = {}): PackageManifest =>
  parsePackageManifest({
    schemaVersion: 1,
    id: 'org.example.wiki',
    publisherId: 'org.example',
    name: 'Wiki',
    description: 'Wiki IDE extension',
    type: 'ui',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=1.0.0' },
    modules: [module('wiki')],
    permissions: [],
    dependencies: [{ id: 'com.tomni.ide', version: '^1.0.0' }],
    contributions: {
      version: 1,
      ide: {
        hostApiVersion: '^1.0.0',
        subtabs: [
          {
            id: 'wiki',
            title: 'Wiki',
            titleKey: 'packages.wiki.title',
            activityGroupId: 'codebase',
            moduleId: 'wiki',
            activation: 'on-open',
            order: 20,
          },
        ],
        commands: [{ id: 'wiki.open', title: 'Open Wiki' }],
        settings: [{ id: 'wiki.enabled', title: 'Wiki enabled', type: 'boolean', default: true }],
      },
    },
    tags: [],
    ...overrides,
  });

const installed = (
  manifest: PackageManifest,
  overrides: Partial<InstalledPackageRecord> = {}
): InstalledPackageRecord => ({
  id: manifest.id,
  version: manifest.version,
  state: 'installed',
  delivery: 'downloaded-package',
  enabled: true,
  installedAt: 1,
  updatedAt: 1,
  manifest,
  trust: manifest.id.startsWith('com.tomni.') ? 'signed-first-party' : 'signed-store',
  ...overrides,
});

describe('versioned package contribution contract', () => {
  it('requires only packages with IDE contributions to depend on com.tomni.ide', () => {
    expect(() => extensionManifest({ dependencies: [] })).toThrow();
    expect(() =>
      parsePackageManifest({ ...extensionManifest(), dependencies: [], contributions: undefined })
    ).not.toThrow();
  });

  it('models IDE extensions as UI packages and keeps the group ABI fixed', () => {
    expect(() => extensionManifest({ type: 'app' })).toThrow();
    expect(() =>
      extensionManifest({
        contributions: {
          version: 1,
          ide: {
            hostApiVersion: '^1.0.0',
            activityGroups: [{ id: 'foreign', title: 'Foreign' }],
          },
        },
      })
    ).toThrow();
  });

  it('requires valid module references, activation events and contract version', () => {
    expect(() =>
      extensionManifest({
        contributions: {
          version: 1,
          ide: {
            hostApiVersion: '^1.0.0',
            subtabs: [
              {
                id: 'wiki',
                title: 'Wiki',
                activityGroupId: 'codebase',
                moduleId: 'missing',
                activation: 'on-open',
              },
            ],
          },
        },
      })
    ).toThrow();
    expect(() => extensionManifest({ contributions: { version: 2 } })).toThrow();
  });

  it('rejects a Package App that attempts to expose two user-facing Surfaces', () => {
    const manifest = ideManifest();
    expect(() =>
      parsePackageManifest({
        ...manifest,
        modules: [...manifest.modules, module('secondary')],
        contributions: {
          ...manifest.contributions!,
          apps: [manifest.contributions!.apps![0]!, { id: 'secondary', title: 'Secondary', moduleId: 'secondary' }],
        },
      })
    ).toThrow(/at most 1/i);
  });
});

describe('package contribution registry', () => {
  it('registers deterministically and resolves extension references to IDE core groups', () => {
    const core = installed(ideManifest());
    const extension = installed(extensionManifest());
    const first = new PackageContributionRegistry().replace([extension, core]);
    const second = new PackageContributionRegistry().replace([core, extension]);
    expect(first).toEqual(second);
    expect(first.packageIds).toEqual(['com.tomni.ide', 'org.example.wiki']);
    expect(first.activityGroups.map(({ id }) => id)).toEqual(['codebase', 'agent-ops']);
    expect(first.subtabs[0]).toMatchObject({
      key: 'org.example.wiki/wiki',
      id: 'wiki',
      activityGroupId: 'codebase',
      activation: 'on-open',
      packageId: 'org.example.wiki',
    });
  });

  it('projects localized metadata with owner-scoped keys', () => {
    const duplicateLocalCommand = extensionManifest({
      id: 'org.example.understand',
      name: 'Understand',
      contributions: {
        version: 1,
        ide: {
          hostApiVersion: '^1.0.0',
          commands: [{ id: 'wiki.open', title: 'Open Understand' }],
        },
      },
    });
    const snapshot = new PackageContributionRegistry().replace([
      installed(ideManifest()),
      installed(extensionManifest()),
      installed(duplicateLocalCommand),
    ]);
    expect(snapshot.apps[0]).toMatchObject({
      key: 'com.tomni.ide/ide',
      titleKey: 'packages.ide.title',
      packageId: 'com.tomni.ide',
    });
    expect(snapshot.commands.map(({ key }) => key)).toEqual([
      'org.example.understand/wiki.open',
      'org.example.wiki/wiki.open',
    ]);
  });

  it('rejects duplicate local contribution ids', () => {
    expect(() =>
      extensionManifest({
        contributions: {
          version: 1,
          ide: {
            hostApiVersion: '^1.0.0',
            commands: [
              { id: 'wiki.open', title: 'First' },
              { id: 'wiki.open', title: 'Second' },
            ],
          },
        },
      })
    ).toThrow();
  });

  it('excludes disabled and non-installed packages', () => {
    const snapshot = new PackageContributionRegistry().replace([
      installed(ideManifest()),
      installed(extensionManifest(), { enabled: false }),
    ]);
    const failed = new PackageContributionRegistry().replace([
      installed(ideManifest()),
      installed(extensionManifest(), { state: 'failed' }),
    ]);
    expect(snapshot.packageIds).toEqual(['com.tomni.ide']);
    expect(snapshot.subtabs).toEqual([]);
    expect(failed.packageIds).toEqual(['com.tomni.ide']);
  });

  it('rejects missing dependencies and preserves the previous atomic snapshot', () => {
    const registry = new PackageContributionRegistry();
    const previous = registry.replace([installed(ideManifest())]);
    expect(() => registry.replace([installed(extensionManifest())])).toThrowError(
      expect.objectContaining({ code: 'dependency-unavailable' }) as PackageContributionRegistryError
    );
    expect(registry.read()).toEqual(previous);
  });

  it('rejects a subtab whose fixed core group is unavailable', () => {
    const coreWithoutAgentOps = ideManifest();
    coreWithoutAgentOps.contributions = {
      version: 1,
      apps: coreWithoutAgentOps.contributions?.apps,
      ide: {
        hostApiVersion: '^1.0.0',
        activityGroups: [{ id: 'codebase', title: 'Codebase' }],
      },
    };
    const dangling = extensionManifest({
      contributions: {
        version: 1,
        ide: {
          hostApiVersion: '^1.0.0',
          subtabs: [
            {
              id: 'wiki',
              title: 'Wiki',
              activityGroupId: 'agent-ops',
              moduleId: 'wiki',
              activation: 'on-startup',
            },
          ],
        },
      },
    });
    expect(() =>
      new PackageContributionRegistry().replace([installed(coreWithoutAgentOps), installed(dangling)])
    ).toThrowError(expect.objectContaining({ code: 'dangling-reference' }) as PackageContributionRegistryError);
  });

  it('rejects an incompatible IDE host API range atomically', () => {
    const registry = new PackageContributionRegistry('1.4.0');
    const previous = registry.replace([installed(ideManifest())]);
    const incompatible = extensionManifest({
      contributions: { version: 1, ide: { hostApiVersion: '^2.0.0' } },
    });
    expect(() => registry.register(installed(incompatible))).toThrowError(
      expect.objectContaining({ code: 'host-api-incompatible' }) as PackageContributionRegistryError
    );
    expect(registry.read()).toEqual(previous);
  });

  it('restores valid packages while reporting startup diagnostics for offenders', () => {
    const forged = extensionManifest({ id: 'com.tomni.untrusted', publisherId: 'com.tomni' });
    const result = new PackageContributionRegistry().restore([
      installed(extensionManifest()),
      installed(forged, { trust: 'signed-store' }),
      installed(ideManifest()),
    ]);
    expect(result.snapshot.packageIds).toEqual(['com.tomni.ide', 'org.example.wiki']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ packageId: 'com.tomni.untrusted', code: 'protected-namespace' }),
    ]);
  });

  it('restores dependencies without granting a package-name priority', () => {
    const core = installed(ideManifest());
    const extension = installed(extensionManifest());
    const registry = new PackageContributionRegistry();

    const result = registry.restore([extension, core]);

    expect(result.snapshot.packageIds).toEqual(['com.tomni.ide', 'org.example.wiki']);
    expect(result.diagnostics).toEqual([]);
  });

  it('protects com.tomni package ids from store publishers', () => {
    const manifest = extensionManifest({ id: 'com.tomni.untrusted', publisherId: 'com.tomni' });
    expect(() =>
      new PackageContributionRegistry().replace([
        installed(ideManifest()),
        installed(manifest, { trust: 'signed-store' }),
      ])
    ).toThrowError(expect.objectContaining({ code: 'protected-namespace' }) as PackageContributionRegistryError);
  });

  it('rejects removal of a required package and removes dependents deterministically', () => {
    const registry = new PackageContributionRegistry();
    const stable = registry.replace([installed(ideManifest()), installed(extensionManifest())]);
    expect(() => registry.remove('com.tomni.ide')).toThrowError(
      expect.objectContaining({ code: 'dependency-unavailable' }) as PackageContributionRegistryError
    );
    expect(registry.read()).toEqual(stable);
    registry.remove('org.example.wiki');
    const final = registry.remove('com.tomni.ide');
    expect(final.packageIds).toEqual([]);
  });
});
