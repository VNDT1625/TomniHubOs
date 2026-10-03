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
const PACKAGE_ID = 'org.example.revocation-restart';
const reviewedAt = '2030-08-01T00:00:00.000Z';

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-revocation-restart-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Package revocation restart recovery', () => {
  it('durably seals an exact signed, reviewed artifact after revocation and never reactivates it after restart', async () => {
    const rootDir = await tempRoot();
    const artifactRoot = await tempRoot();
    const sourceDirectory = path.join(artifactRoot, '1.0.0');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, 'index.html'), '<main>revocation restart fixture</main>');

    const artifact = await computeArtifactIntegrity(sourceDirectory);
    const unsignedManifest: PackageManifest = {
      schemaVersion: 1,
      id: PACKAGE_ID,
      publisherId: 'org.example',
      name: 'Revocation restart fixture',
      description: 'A signed reviewed package whose exact artifact is revoked before restart.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'revocation-restart',
          title: 'Revocation restart',
          surface: 'apps/revocation-restart',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['revoke', 'restart'],
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'revocation-restart-key', value: '' },
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

    let revoked = false;
    const catalogEntry = (): PackageCatalogEntry => ({
      manifest,
      delivery: 'downloaded-package',
      trust: 'signed-store',
      sourceDirectory,
      publicationReview: {
        schemaVersion: 1,
        disposition: 'auto-approved',
        fingerprint: `sha256-${'a'.repeat(64)}`,
        reviewedAt,
      },
      ...(revoked
        ? {
            revocation: {
              schemaVersion: 1,
              reasonCode: 'MALWARE_DETECTED',
              revokedAt: reviewedAt,
            },
          }
        : {}),
    });
    const runtimeRegistry = createPackageRuntimeRegistry();
    const quiescedPackageIds: string[] = [];
    let markQuiesceStarted: (() => void) | undefined;
    let releaseQuiesce: (() => void) | undefined;
    const quiesceStarted = new Promise<void>((resolve) => {
      markQuiesceStarted = resolve;
    });
    const quiesceReleased = new Promise<void>((resolve) => {
      releaseQuiesce = resolve;
    });
    let holdQuiesce = false;
    const createService = () =>
      createPackageManagerService({
        rootDir,
        appVersion: '1.2.0',
        catalog: [catalogEntry()],
        catalogLoader: async () => [catalogEntry()],
        stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
        trustedKeys: { 'revocation-restart-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
        isPackageSandboxActive: runtimeRegistry.isActive,
        reservePackageSandboxMutation: runtimeRegistry.reserveMutation,
        revokePackageSandbox: runtimeRegistry.revokePackage,
        quiescePackageRuntime: async (packageId) => {
          quiescedPackageIds.push(packageId);
          if (!holdQuiesce) return;
          markQuiesceStarted?.();
          await quiesceReleased;
        },
      });

    const initial = createService();
    await initial.initialize();
    await expect(initial.install(PACKAGE_ID)).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
      installedVersion: '1.0.0',
    });
    runtimeRegistry.open('renderer-revocation-restart', {
      packageId: PACKAGE_ID,
      packageVersion: manifest.version,
      publisherId: manifest.publisherId,
      moduleId: 'revocation-restart',
      runtimeId: 'sandbox-revocation-restart',
    });

    quiescedPackageIds.length = 0;
    revoked = true;
    holdQuiesce = true;
    const refresh = initial.refreshCatalog();
    await quiesceStarted;
    expect(quiescedPackageIds).toEqual([PACKAGE_ID]);
    await expect(initial.status(PACKAGE_ID)).resolves.toMatchObject({ state: 'installed', enabled: true });
    releaseQuiesce?.();
    holdQuiesce = false;
    await refresh;
    await expect(initial.status(PACKAGE_ID)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_CATALOG_REVOKED',
      revoked: true,
    });
    expect(runtimeRegistry.isActive(PACKAGE_ID)).toBe(false);
    expect((await initial.contributions()).snapshot.packageIds).toEqual([]);

    const restarted = createService();
    await restarted.initialize();
    await expect(restarted.status(PACKAGE_ID)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      installedVersion: '1.0.0',
      lastError: 'PACKAGE_CATALOG_REVOKED',
      revoked: true,
    });
    expect((await restarted.contributions()).snapshot.packageIds).toEqual([]);
    await expect(restarted.readAsset(PACKAGE_ID, 'index.html')).rejects.toThrow(/not installed and enabled/i);
    await expect(restarted.enable(PACKAGE_ID)).rejects.toThrow(/revoked by the Store catalog/i);
    await expect(restarted.install(PACKAGE_ID)).rejects.toThrow(/revoked by the Store catalog/i);

    const persisted = JSON.parse(await readFile(path.join(rootDir, 'installed.json'), 'utf8')) as {
      packages: Array<{ id: string; version: string; state: string; enabled: boolean; lastError?: string }>;
    };
    expect(persisted.packages).toEqual([
      expect.objectContaining({
        id: PACKAGE_ID,
        version: '1.0.0',
        state: 'quarantined',
        enabled: false,
        lastError: 'PACKAGE_CATALOG_REVOKED',
      }),
    ]);
    await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
    // Current quarantine keeps the exact signed payload for attributable investigation;
    // it is unavailable to every activation path, but is not erased by revocation.
    await expect(readdir(path.join(rootDir, 'packages', PACKAGE_ID))).resolves.toEqual(['1.0.0']);
  });
});
