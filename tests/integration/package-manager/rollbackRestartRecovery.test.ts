import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { packageSignaturePayload, type PackageCatalogEntry, type PackageManifest } from '@/common/packages';
import {
  computeArtifactIntegrity,
  createPackageManagerService,
  createPackageRuntimeRegistry,
  JsonPackageStateStore,
} from '@process/extensions/package-manager';

const roots: string[] = [];
const PACKAGE_ID = 'org.example.rollback-restart';

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-rollback-restart-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Package rollback restart recovery', () => {
  it('persists the restored signed version and its reversible history across a post-rollback restart', async () => {
    const rootDir = await tempRoot();
    const artifactRoot = await tempRoot();
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const artifactFor = async (version: string): Promise<PackageManifest> => {
      const sourceDirectory = path.join(artifactRoot, version);
      await mkdir(sourceDirectory, { recursive: true });
      await writeFile(path.join(sourceDirectory, 'index.html'), `<main>rollback restart ${version}</main>`);
      const artifact = await computeArtifactIntegrity(sourceDirectory);
      const unsignedManifest: PackageManifest = {
        schemaVersion: 1,
        id: PACKAGE_ID,
        publisherId: 'org.example',
        name: 'Rollback restart fixture',
        description: 'A signed package fixture for durable rollback recovery.',
        type: 'app',
        bundleKind: 'single',
        version,
        engines: { tomni: '>=1.0.0' },
        modules: [
          {
            id: 'rollback-restart',
            title: 'Rollback restart',
            surface: 'apps/rollback-restart',
            pinnable: true,
            runtime: 'sandboxed-web',
            entrypoint: 'index.html',
          },
        ],
        permissions: [],
        dependencies: [],
        tags: ['rollback', 'restart'],
        artifact: {
          ...artifact,
          signature: { algorithm: 'ed25519', keyId: 'rollback-restart-key', value: '' },
        },
      };
      const manifest: PackageManifest = {
        ...unsignedManifest,
        artifact: {
          ...unsignedManifest.artifact!,
          signature: {
            ...unsignedManifest.artifact!.signature,
            value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
          },
        },
      };
      await writeFile(path.join(sourceDirectory, 'tomny-package.json'), JSON.stringify(manifest));
      return manifest;
    };

    const manifests = new Map([
      ['1.0.0', await artifactFor('1.0.0')],
      ['1.1.0', await artifactFor('1.1.0')],
    ]);
    let catalogVersion = '1.0.0';
    const catalogEntry = (): PackageCatalogEntry => {
      const manifest = manifests.get(catalogVersion);
      if (!manifest) throw new Error(`Missing rollback fixture ${catalogVersion}.`);
      return {
        manifest,
        delivery: 'downloaded-package',
        trust: 'signed-store',
        sourceDirectory: path.join(artifactRoot, catalogVersion),
      };
    };
    const runtimeRegistry = createPackageRuntimeRegistry();
    const createService = () =>
      createPackageManagerService({
        rootDir,
        appVersion: '1.2.0',
        catalog: [catalogEntry()],
        catalogLoader: async () => [catalogEntry()],
        stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
        trustedKeys: { 'rollback-restart-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
        isPackageSandboxActive: runtimeRegistry.isActive,
        reservePackageSandboxMutation: runtimeRegistry.reserveMutation,
      });

    let service = createService();
    await service.initialize();
    await expect(service.install(PACKAGE_ID)).resolves.toMatchObject({ installedVersion: '1.0.0', enabled: true });

    catalogVersion = '1.1.0';
    await service.refreshCatalog();
    await expect(service.install(PACKAGE_ID)).resolves.toMatchObject({
      installedVersion: '1.1.0',
      previousVersion: '1.0.0',
    });

    await expect(service.rollback(PACKAGE_ID)).resolves.toMatchObject({
      installedVersion: '1.0.0',
      previousVersion: '1.1.0',
      enabled: true,
    });

    service = createService();
    await service.initialize();
    await expect(service.status(PACKAGE_ID)).resolves.toMatchObject({
      state: 'installed',
      installedVersion: '1.0.0',
      previousVersion: '1.1.0',
      enabled: true,
    });
    await expect(service.readAsset(PACKAGE_ID, 'index.html')).resolves.toMatchObject({
      content: '<main>rollback restart 1.0.0</main>',
    });
    expect((await service.contributions()).snapshot.packageIds).toEqual([PACKAGE_ID]);

    const persisted = JSON.parse(await readFile(path.join(rootDir, 'installed.json'), 'utf8')) as {
      packages: Array<{ id: string; version: string; previousVersion?: string }>;
    };
    expect(persisted.packages).toHaveLength(1);
    expect(persisted.packages[0]).toMatchObject({ id: PACKAGE_ID, version: '1.0.0', previousVersion: '1.1.0' });
    await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
  });
});
