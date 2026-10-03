import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { packageSignaturePayload, type PackageCatalogEntry, type PackageManifest } from '@/common/packages';
import {
  computeArtifactIntegrity,
  createPackageManagerService,
  JsonPackageStateStore,
} from '@process/extensions/package-manager';

const roots: string[] = [];
const servers: Server[] = [];
const PACKAGE_ID = 'org.example.update-failure-recovery';

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-update-failure-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type DownloadFailure = 'interrupted' | 'http-503';

const failedDownload = async (
  failure: DownloadFailure
): Promise<Readonly<{ url: string; receivedRequests: () => number }>> => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    if (failure === 'interrupted') {
      request.socket.destroy();
      return;
    }
    response.writeHead(503, { 'content-type': 'text/plain' });
    response.end('temporary package endpoint failure');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Interrupted update fixture did not start.');
  return {
    url: 'http://127.0.0.1:' + address.port + '/package.tomni',
    receivedRequests: () => requests,
  };
};

describe('Package update failure restart recovery', () => {
  it.each([
    { label: 'an interrupted downloader update', failure: 'interrupted' },
    { label: 'an HTTP 503 downloader update', failure: 'http-503' },
  ] as const)(
    'keeps the signed installed version, one registry record, contributions, and no mutation orphan after $label',
    async ({ failure }) => {
      const rootDir = await tempRoot();
      const artifactRoot = await tempRoot();
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const artifactFor = async (version: string): Promise<{ manifest: PackageManifest; sourceDirectory: string }> => {
        const sourceDirectory = path.join(artifactRoot, version);
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(path.join(sourceDirectory, 'index.html'), `<main>signed update fixture ${version}</main>`);
        const artifact = await computeArtifactIntegrity(sourceDirectory);
        const unsignedManifest: PackageManifest = {
          schemaVersion: 1,
          id: PACKAGE_ID,
          publisherId: 'org.example',
          name: 'Update failure recovery fixture',
          description: 'A signed package fixture that recovers safely from an interrupted update download.',
          type: 'app',
          bundleKind: 'single',
          version,
          engines: { tomni: '>=1.0.0' },
          modules: [{ id: 'update-failure', title: 'Update failure', surface: 'apps/update-failure', pinnable: true }],
          permissions: [],
          dependencies: [],
          tags: ['update', 'restart', 'failure'],
          artifact: {
            ...artifact,
            signature: { algorithm: 'ed25519', keyId: 'update-failure-key', value: '' },
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
        return { manifest, sourceDirectory };
      };

      const versionOne = await artifactFor('1.0.0');
      const versionTwo = await artifactFor('1.1.0');

      let catalogVersion = versionOne;
      let useFailedDownload = false;
      const update = await failedDownload(failure);
      const catalogEntry = (): PackageCatalogEntry => ({
        manifest: catalogVersion.manifest,
        delivery: 'downloaded-package',
        trust: 'signed-store',
        ...(useFailedDownload ? { artifactUrl: update.url } : { sourceDirectory: catalogVersion.sourceDirectory }),
      });
      const createService = () =>
        createPackageManagerService({
          rootDir,
          appVersion: '1.2.0',
          catalog: [catalogEntry()],
          catalogLoader: async () => [catalogEntry()],
          stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
          trustedKeys: { 'update-failure-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
          allowLocalArtifactUrls: true,
        });

      const initial = createService();
      await initial.initialize();
      await expect(initial.install(PACKAGE_ID)).resolves.toMatchObject({ installedVersion: '1.0.0', enabled: true });

      catalogVersion = versionTwo;
      useFailedDownload = true;
      await initial.refreshCatalog();
      await expect(initial.install(PACKAGE_ID)).rejects.toThrow();
      expect(update.receivedRequests()).toBe(1);
      await expect(initial.status(PACKAGE_ID)).resolves.toMatchObject({
        state: 'installed',
        installedVersion: '1.0.0',
        enabled: true,
        lastError: 'PACKAGE_OPERATION_FAILED',
      });

      const restarted = createService();
      await restarted.initialize();
      await expect(restarted.status(PACKAGE_ID)).resolves.toMatchObject({
        state: 'installed',
        installedVersion: '1.0.0',
        enabled: true,
        lastError: 'PACKAGE_OPERATION_FAILED',
      });
      await expect(restarted.readAsset(PACKAGE_ID, 'index.html')).resolves.toMatchObject({
        content: '<main>signed update fixture 1.0.0</main>',
      });
      expect((await restarted.contributions()).snapshot.packageIds).toEqual([PACKAGE_ID]);

      const persisted = JSON.parse(await readFile(path.join(rootDir, 'installed.json'), 'utf8')) as {
        packages: Array<{ id: string; version: string; previousVersion?: string }>;
      };
      expect(persisted.packages).toHaveLength(1);
      expect(persisted.packages[0]).toMatchObject({ id: PACKAGE_ID, version: '1.0.0' });
      expect(persisted.packages[0]).not.toHaveProperty('previousVersion');
      await expect(readdir(path.join(rootDir, 'packages', PACKAGE_ID))).resolves.toEqual(['1.0.0']);
      await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
      await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
      await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
    }
  );
});
