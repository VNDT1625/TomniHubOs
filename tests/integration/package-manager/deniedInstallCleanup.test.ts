import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { packageSignaturePayload, type PackageManifest } from '@/common/packages';
import { createPackageManagerService, JsonPackageStateStore } from '@process/extensions/package-manager';

const roots: string[] = [];
const PACKAGE_ID = 'org.example.admission-denied';

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-denied-install-cleanup-'));
  roots.push(root);
  return root;
};

const artifactIntegrity = (files: Readonly<Record<string, Buffer>>): { integrity: string; sizeBytes: number } => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const [relativePath, content] of Object.entries(files).toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    sizeBytes += content.byteLength;
  }
  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('C4 denied package installation cleanup', () => {
  it('cleans both pre-download commercial denial and post-staging transfer failure without a ghost package', async () => {
    const rootDir = await tempRoot();
    const files = { 'index.html': Buffer.from('<main>paid Surface</main>') };
    const artifact = artifactIntegrity(files);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const unsigned: PackageManifest = {
      schemaVersion: 1,
      id: PACKAGE_ID,
      publisherId: 'org.example',
      name: 'Admission-denied Surface',
      description: 'A signed paid package fixture whose acquisition grant is deliberately absent.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0 <2.0.0' },
      modules: [
        {
          id: 'main',
          title: 'Main',
          surface: 'apps/admission-denied',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['paid', 'cleanup'],
      contributions: { version: 1, apps: [{ id: 'admission-denied', title: 'Main', moduleId: 'main' }] },
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'admission-denied-key', value: '' },
      },
    };
    const manifest: PackageManifest = {
      ...unsigned,
      artifact: {
        ...unsigned.artifact!,
        signature: {
          ...unsigned.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(unsigned)), privateKey).toString('base64'),
        },
      },
    };
    const bundle = Buffer.from(
      JSON.stringify({
        format: 'tomni-package-bundle-v1',
        manifest,
        files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, content.toString('base64')])),
      })
    );
    const fetchArtifact = vi.fn(
      async () =>
        new Response(bundle, {
          status: 200,
          headers: {
            'content-length': String(bundle.byteLength),
            'content-type': 'application/vnd.tomni.package+json',
          },
        })
    );
    vi.stubGlobal('fetch', fetchArtifact);

    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [
        {
          manifest,
          delivery: 'downloaded-package',
          trust: 'signed-store',
          artifactUrl: 'http://127.0.0.1:43101/admission-denied.tomni-package.json',
        },
      ],
      trustedKeys: { 'admission-denied-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      allowLocalArtifactUrls: true,
      paidPackageActivationRequirement: (entry) =>
        entry.manifest.id === PACKAGE_ID ? { accountId: 'account-c4', offerId: 'offer-c4' } : undefined,
      stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
    });
    await service.initialize();

    await expect(service.install(PACKAGE_ID)).rejects.toThrow(/active Store acquisition grant/i);

    expect(fetchArtifact).not.toHaveBeenCalled();
    await expect(service.status(PACKAGE_ID)).resolves.toMatchObject({ state: 'available', enabled: false });
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: PACKAGE_ID }),
        state: 'available',
        enabled: false,
      }),
    ]);
    expect((await service.contributions()).snapshot.packageIds).toEqual([]);
    await expect(readFile(path.join(rootDir, 'installed.json'), 'utf8')).resolves.toBe(
      '{\n  "schemaVersion": 1,\n  "packages": []\n}\n'
    );
    await expect(readdir(path.join(rootDir, 'packages'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);

    const transactionIds = ['download-c4', 'staging-collision-c4'];
    const postStagingDenial = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [
        {
          manifest,
          delivery: 'downloaded-package',
          trust: 'signed-store',
          artifactUrl: 'http://127.0.0.1:43101/admission-denied.tomni-package.json',
        },
      ],
      trustedKeys: { 'admission-denied-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      allowLocalArtifactUrls: true,
      randomId: () => transactionIds.shift() ?? 'unexpected-transaction-id',
      stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
    });
    await postStagingDenial.initialize();
    await mkdir(path.join(rootDir, '.staging', `${PACKAGE_ID}-1.0.0-staging-collision-c4`, 'index.html'), {
      recursive: true,
    });

    await expect(postStagingDenial.install(PACKAGE_ID)).rejects.toThrow();

    await expect(postStagingDenial.status(PACKAGE_ID)).resolves.toMatchObject({ state: 'failed', enabled: false });
    expect((await postStagingDenial.contributions()).snapshot.packageIds).toEqual([]);
    await expect(readdir(path.join(rootDir, 'packages'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
  });
});
