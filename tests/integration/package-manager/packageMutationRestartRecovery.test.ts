import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { packageSignaturePayload, type PackageCatalogEntry, type PackageManifest } from '@/common/packages';
import {
  computeArtifactIntegrity,
  createPackageManagerService,
  JsonPackageStateStore,
} from '@process/extensions/package-manager';

const roots: string[] = [];

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-package-restart-'));
  roots.push(root);
  return root;
};

const packageManagerServiceModuleUrl = pathToFileURL(
  path.join(
    process.cwd(),
    'packages',
    'desktop',
    'src',
    'process',
    'extensions',
    'package-manager',
    'PackageManagerService.ts'
  )
).href;
const packageStateStoreModuleUrl = pathToFileURL(
  path.join(process.cwd(), 'packages', 'desktop', 'src', 'process', 'extensions', 'package-manager', 'packageStore.ts')
).href;

const INTERRUPTED_INSTALL_CHILD = `
import path from 'node:path';

void (async () => {
  const [serviceModuleUrl, storeModuleUrl, rootDir, packageId, catalogJson, trustedKeysJson] = process.argv.slice(1);
  if (!serviceModuleUrl || !storeModuleUrl || !rootDir || !packageId || !catalogJson || !trustedKeysJson) {
    throw new Error('Interrupted install child arguments are incomplete.');
  }
  const { createPackageManagerService } = (await import(serviceModuleUrl)).default;
  const { JsonPackageStateStore } = (await import(storeModuleUrl)).default;
  const durableState = new JsonPackageStateStore(path.join(rootDir, 'installed.json'));
  const stateStore = {
    initialize: () => durableState.initialize(),
    list: () => durableState.list(),
    get: (id) => durableState.get(id),
    save: async (record) => {
      if (record.id === packageId) process.kill(process.pid, 'SIGKILL');
      await durableState.save(record);
    },
    remove: (id) => durableState.remove(id),
  };
  const service = createPackageManagerService({
    rootDir,
    appVersion: '1.2.0',
    catalog: JSON.parse(catalogJson),
    trustedKeys: JSON.parse(trustedKeysJson),
    stateStore,
  });
  await service.initialize();
  await service.install(packageId);
  throw new Error('Interrupted install child reached a durable state commit.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

const terminateInstallAfterPayloadTransfer = async ({
  rootDir,
  packageId,
  catalog,
  trustedKeys,
}: Readonly<{
  rootDir: string;
  packageId: string;
  catalog: readonly PackageCatalogEntry[];
  trustedKeys: Readonly<Record<string, string>>;
}>): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        '-e',
        INTERRUPTED_INSTALL_CHILD,
        packageManagerServiceModuleUrl,
        packageStateStoreModuleUrl,
        rootDir,
        packageId,
        JSON.stringify(catalog),
        JSON.stringify(trustedKeys),
      ],
      { cwd: process.cwd(), stdio: 'ignore' }
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        reject(new Error('Interrupted install child reached a durable state commit.'));
        return;
      }
      resolve();
    });
  });

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const restartCatalog: PackageCatalogEntry[] = [
  {
    delivery: 'bundled-legacy',
    trust: 'trusted-first-party',
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.restartable-surface',
      publisherId: 'com.tomni',
      name: 'Restartable surface',
      description: 'Durable mutation recovery fixture',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [{ id: 'main', title: 'Restartable surface', surface: 'apps/restartable', pinnable: true }],
      permissions: [],
      dependencies: [],
      tags: ['restart'],
    },
  },
];

const PACKAGE_ID = restartCatalog[0]!.manifest.id;

const persistedRecords = async (rootDir: string): Promise<unknown[]> => {
  const persisted = JSON.parse(await readFile(path.join(rootDir, 'installed.json'), 'utf8')) as {
    packages: unknown[];
  };
  return persisted.packages;
};

describe('Package mutation restart recovery', () => {
  it('keeps one durable state and no filesystem orphan through install, disable, enable, and uninstall restarts', async () => {
    const rootDir = await tempRoot();
    const createService = () =>
      createPackageManagerService({
        rootDir,
        appVersion: '1.2.0',
        catalog: restartCatalog,
        stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
      });

    const initial = createService();
    await initial.initialize();
    await initial.install(PACKAGE_ID);

    const afterInstall = createService();
    await afterInstall.initialize();
    await expect(afterInstall.status(PACKAGE_ID)).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
      installedVersion: '1.0.0',
    });
    expect(await persistedRecords(rootDir)).toHaveLength(1);

    await afterInstall.disable(PACKAGE_ID);
    const afterDisable = createService();
    await afterDisable.initialize();
    await expect(afterDisable.status(PACKAGE_ID)).resolves.toMatchObject({
      state: 'installed',
      enabled: false,
      installedVersion: '1.0.0',
    });
    expect((await afterDisable.contributions()).snapshot.packageIds).toEqual([]);

    await afterDisable.enable(PACKAGE_ID);
    const afterEnable = createService();
    await afterEnable.initialize();
    await expect(afterEnable.status(PACKAGE_ID)).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
      installedVersion: '1.0.0',
    });
    expect((await afterEnable.contributions()).snapshot.packageIds).toEqual([PACKAGE_ID]);

    await afterEnable.uninstall(PACKAGE_ID);
    const afterUninstall = createService();
    await afterUninstall.initialize();
    await expect(afterUninstall.status(PACKAGE_ID)).resolves.toMatchObject({
      state: 'available',
      enabled: false,
    });
    expect(await persistedRecords(rootDir)).toEqual([]);
    expect((await afterUninstall.contributions()).snapshot.packageIds).toEqual([]);
    await expect(readdir(path.join(rootDir, 'packages'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
  });

  it('recovers a child process terminated after payload transfer and before durable state commit without a ghost Surface', async () => {
    const rootDir = await tempRoot();
    const sourceDirectory = await tempRoot();
    const packageId = 'org.example.interrupted-install';
    await writeFile(path.join(sourceDirectory, 'index.html'), '<main>interrupted install fixture</main>');
    const artifact = await computeArtifactIntegrity(sourceDirectory);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      ...restartCatalog[0]!.manifest,
      id: packageId,
      name: 'Interrupted install recovery fixture',
      version: '1.0.0',
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'interrupted-install-key', value: '' },
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

    const catalog: PackageCatalogEntry[] = [
      { manifest, delivery: 'downloaded-package', trust: 'signed-store', sourceDirectory },
    ];
    const filePath = path.join(rootDir, 'installed.json');
    const trustedKeys = { 'interrupted-install-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    const createService = () =>
      createPackageManagerService({
        rootDir,
        appVersion: '1.2.0',
        catalog,
        stateStore: new JsonPackageStateStore(filePath),
        trustedKeys,
      });

    await terminateInstallAfterPayloadTransfer({ rootDir, packageId, catalog, trustedKeys });
    await expect(
      readFile(path.join(rootDir, 'packages', packageId, manifest.version, 'index.html'), 'utf8')
    ).resolves.toBe('<main>interrupted install fixture</main>');
    expect(await persistedRecords(rootDir)).toEqual([]);

    const restarted = createService();
    await restarted.initialize();
    await expect(restarted.status(packageId)).resolves.toMatchObject({ state: 'available', enabled: false });
    await expect(restarted.readAsset(packageId, 'index.html')).rejects.toThrow();
    await expect(restarted.enable(packageId)).rejects.toThrow('Package ' + packageId + ' is not installed.');
    expect((await restarted.contributions()).snapshot.packageIds).toEqual([]);
    expect(await persistedRecords(rootDir)).toEqual([]);
    await expect(readdir(path.join(rootDir, 'packages'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
  });

  it('removes an unregistered payload left by a process terminated before durable install commit', async () => {
    const rootDir = await tempRoot();
    const unregisteredPayload = path.join(rootDir, 'packages', 'org.example.crashed-install', '1.0.0');
    await mkdir(unregisteredPayload, { recursive: true });
    await writeFile(path.join(unregisteredPayload, 'index.html'), '<main>orphaned crash payload</main>');

    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: restartCatalog,
      stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
    });
    await service.initialize();

    await expect(service.status(PACKAGE_ID)).resolves.toMatchObject({ state: 'available', enabled: false });
    expect((await service.contributions()).snapshot.packageIds).toEqual([]);
    await expect(readdir(path.join(rootDir, 'packages'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
  });

  it('discards a stale trash payload for a bundled record without writing package storage after restart', async () => {
    const rootDir = await tempRoot();
    const createService = () =>
      createPackageManagerService({
        rootDir,
        appVersion: '1.2.0',
        catalog: restartCatalog,
        stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
      });

    const initial = createService();
    await initial.initialize();
    await initial.install(PACKAGE_ID);

    const stalePayload = path.join(rootDir, '.trash', 'stale-bundled-payload');
    await mkdir(stalePayload, { recursive: true });
    await writeFile(path.join(stalePayload, 'tomny-package.json'), JSON.stringify(restartCatalog[0]!.manifest));
    await writeFile(path.join(stalePayload, 'index.html'), '<main>foreign stale payload</main>');

    const restarted = createService();
    await restarted.initialize();

    await expect(restarted.status(PACKAGE_ID)).resolves.toMatchObject({ state: 'installed', enabled: true });
    await expect(readdir(path.join(rootDir, 'packages'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
  });

  it('fails closed instead of re-enabling a disabled downloaded Surface after its payload is removed', async () => {
    const rootDir = await tempRoot();
    const sourceDirectory = await tempRoot();
    const packageId = 'org.example.enable-missing-payload';
    await writeFile(path.join(sourceDirectory, 'index.html'), '<main>enable payload fixture</main>');
    const artifact = await computeArtifactIntegrity(sourceDirectory);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      ...restartCatalog[0]!.manifest,
      id: packageId,
      name: 'Enable missing payload fixture',
      version: '1.0.0',
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'enable-missing-payload-key', value: '' },
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

    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [{ manifest, delivery: 'downloaded-package', trust: 'signed-store', sourceDirectory }],
      stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
      trustedKeys: { 'enable-missing-payload-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    });
    await service.initialize();
    await service.install(packageId);
    await service.disable(packageId);
    await rm(path.join(rootDir, 'packages', packageId, manifest.version), { recursive: true, force: true });

    await expect(service.enable(packageId)).rejects.toThrow(/payload/i);
    await expect(service.status(packageId)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
    });
    expect((await service.contributions()).snapshot.packageIds).toEqual([]);
  });

  it('removes an uncommitted downloaded update payload after restart while retaining the durable version', async () => {
    const rootDir = await tempRoot();
    const artifactRoot = await tempRoot();
    const packageId = 'org.example.interrupted-update';
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');

    const artifactFor = async (version: string) => {
      const sourceDirectory = path.join(artifactRoot, version);
      await mkdir(sourceDirectory, { recursive: true });
      await writeFile(path.join(sourceDirectory, 'index.html'), '<main>interrupted update ' + version + '</main>');
      const artifact = await computeArtifactIntegrity(sourceDirectory);
      const unsignedManifest: PackageManifest = {
        ...restartCatalog[0]!.manifest,
        id: packageId,
        name: 'Interrupted update recovery fixture',
        version,
        artifact: {
          ...artifact,
          signature: { algorithm: 'ed25519', keyId: 'interrupted-update-key', value: '' },
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
    let catalogArtifact = versionOne;
    const catalogEntry = (): PackageCatalogEntry => ({
      manifest: catalogArtifact.manifest,
      delivery: 'downloaded-package',
      trust: 'signed-store',
      sourceDirectory: catalogArtifact.sourceDirectory,
    });
    const createService = () =>
      createPackageManagerService({
        rootDir,
        appVersion: '1.2.0',
        catalog: [catalogEntry()],
        stateStore: new JsonPackageStateStore(path.join(rootDir, 'installed.json')),
        trustedKeys: { 'interrupted-update-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      });

    const initial = createService();
    await initial.initialize();
    await initial.install(packageId);

    // This is the exact post-promotion/pre-state-commit shape a killed update leaves behind.
    const uncommittedVersion = path.join(rootDir, 'packages', packageId, versionTwo.manifest.version);
    await mkdir(uncommittedVersion, { recursive: true });
    await writeFile(
      path.join(uncommittedVersion, 'index.html'),
      await readFile(path.join(versionTwo.sourceDirectory, 'index.html'))
    );
    await writeFile(path.join(uncommittedVersion, 'tomny-package.json'), JSON.stringify(versionTwo.manifest));
    catalogArtifact = versionTwo;

    const restarted = createService();
    await restarted.initialize();

    await expect(restarted.status(packageId)).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
      installedVersion: versionOne.manifest.version,
    });
    await expect(restarted.readAsset(packageId, 'index.html')).resolves.toMatchObject({
      content: '<main>interrupted update 1.0.0</main>',
    });
    await expect(readdir(path.join(rootDir, 'packages', packageId))).resolves.toEqual(['1.0.0']);
    expect(await persistedRecords(rootDir)).toHaveLength(1);
  });
});
