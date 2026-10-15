import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageSignaturePayload, type PackageCatalogEntry, type PackageManifest } from '@/common/packages';
import { createPackageManagerService } from '@process/extensions/package-manager';
import { computeArtifactIntegrity } from '@process/extensions/package-manager/artifactSecurity';

const roots: string[] = [];
const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-local-built-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type Pair = { keyId: string; publicPem: string; privateKey: KeyObject };
const newKey = (keyId: string): Pair => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { keyId, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
};

type BuildOptions = {
  id?: string;
  publisherId?: string;
  version?: string;
  runtime?: 'sandboxed-web' | 'trusted-react';
  key: Pair;
};

/** Writes a signed package directory the way the repo packager does, outside the installation root. */
const buildPackage = async (options: BuildOptions): Promise<{ directory: string; manifest: PackageManifest }> => {
  const directory = await tempRoot();
  await mkdir(path.join(directory, 'source'), { recursive: true });
  await writeFile(path.join(directory, 'index.html'), '<main>local</main>');
  await writeFile(path.join(directory, 'index.js'), 'export default {};');
  await writeFile(path.join(directory, 'source', 'README.md'), 'hello');
  const artifact = await computeArtifactIntegrity(directory);
  const unsigned: PackageManifest = {
    schemaVersion: 1,
    id: options.id ?? 'com.community.local-sample',
    publisherId: options.publisherId ?? 'com.community',
    name: 'Local sample',
    description: 'Built on this machine',
    type: 'app',
    bundleKind: 'single',
    version: options.version ?? '1.0.0',
    engines: { tomni: '>=1.0.0' },
    modules: [
      {
        id: 'main',
        title: 'Local',
        surface: 'local/main',
        pinnable: true,
        runtime: options.runtime ?? 'sandboxed-web',
        entrypoint: options.runtime === 'trusted-react' ? 'index.js' : 'index.html',
      },
    ],
    permissions: [],
    dependencies: [],
    tags: ['local'],
    artifact: { ...artifact, signature: { algorithm: 'ed25519', keyId: options.key.keyId, value: '' } },
  };
  const value = sign(null, Buffer.from(packageSignaturePayload(unsigned)), options.key.privateKey).toString('base64');
  const manifest: PackageManifest = {
    ...unsigned,
    artifact: { ...unsigned.artifact!, signature: { algorithm: 'ed25519', keyId: options.key.keyId, value } },
  };
  await writeFile(path.join(directory, 'tomny-package.json'), JSON.stringify(manifest));
  return { directory, manifest };
};

const serviceFor = (rootDir: string, localKey: Pair | undefined, extra: { trusted?: Pair } = {}) =>
  createPackageManagerService({
    rootDir,
    appVersion: '1.2.0',
    catalog: [],
    catalogLoader: async () => [],
    isPackageSandboxActive: () => false,
    reservePackageSandboxMutation: () => ({ release: () => undefined }),
    ...(extra.trusted ? { trustedKeys: { [extra.trusted.keyId]: extra.trusted.publicPem } } : {}),
    ...(localKey ? { localTrustedKeys: { [localKey.keyId]: localKey.publicPem } } : {}),
  });

describe('local-built packages', () => {
  it('registers, installs, survives a restart and uninstalls with local-built trust', async () => {
    const key = newKey('local:machine-1');
    const rootDir = await tempRoot();
    const { directory, manifest } = await buildPackage({ key });

    const service = serviceFor(rootDir, key);
    await service.initialize();
    const registered = await service.registerLocalPackage(directory);
    expect(registered.manifest.id).toBe(manifest.id);
    expect(registered.state).not.toBe('installed');

    const installed = await service.install(manifest.id);
    expect(installed.state).toBe('installed');
    expect(installed.installedTrust).toBe('local-built');

    const restarted = serviceFor(rootDir, key);
    await restarted.initialize();
    const after = await restarted.status(manifest.id);
    expect(after.state).toBe('installed');
    expect(after.installedTrust).toBe('local-built');

    await restarted.uninstall(manifest.id);
    const gone = (await restarted.list()).find((item) => item.manifest.id === manifest.id);
    expect(gone?.state ?? 'not-installed').not.toBe('installed');
  });

  it('keeps a registered package across a catalog refresh', async () => {
    const key = newKey('local:machine-1');
    const { directory, manifest } = await buildPackage({ key });
    const service = serviceFor(await tempRoot(), key);
    await service.initialize();
    await service.registerLocalPackage(directory);
    await service.refreshCatalog();
    expect((await service.list()).some((item) => item.manifest.id === manifest.id)).toBe(true);
  });

  it('refuses the protected com.tomni namespace, by publisher and by id', async () => {
    const key = newKey('local:machine-1');
    const service = serviceFor(await tempRoot(), key);
    await service.initialize();
    const byPublisher = await buildPackage({ key, publisherId: 'com.tomni' });
    await expect(service.registerLocalPackage(byPublisher.directory)).rejects.toThrow(/com\.tomni/);
    const byId = await buildPackage({ key, id: 'com.tomni.fake' });
    await expect(service.registerLocalPackage(byId.directory)).rejects.toThrow(/com\.tomni/);
  });

  it('refuses the trusted-react runtime', async () => {
    const key = newKey('local:machine-1');
    const service = serviceFor(await tempRoot(), key);
    await service.initialize();
    const { directory } = await buildPackage({ key, runtime: 'trusted-react' });
    await expect(service.registerLocalPackage(directory)).rejects.toThrow(/trusted-react/);
  });

  it('refuses a package signed by a key that is not a local key, including a Store key', async () => {
    const local = newKey('local:machine-1');
    const store = newKey('store-key');
    const service = serviceFor(await tempRoot(), local, { trusted: store });
    await service.initialize();
    const signedByStore = await buildPackage({ key: store });
    await expect(service.registerLocalPackage(signedByStore.directory)).rejects.toThrow(/not trusted/);
    const signedByStranger = await buildPackage({ key: newKey('local:other-machine') });
    await expect(service.registerLocalPackage(signedByStranger.directory)).rejects.toThrow(/not trusted/);
  });

  it('refuses a package whose files changed after signing', async () => {
    const key = newKey('local:machine-1');
    const service = serviceFor(await tempRoot(), key);
    await service.initialize();
    const { directory } = await buildPackage({ key });
    await writeFile(path.join(directory, 'index.html'), '<main>tampered</main>');
    await expect(service.registerLocalPackage(directory)).rejects.toThrow(/integrity/i);
  });

  it('is disabled without local keys, and refuses a relative or in-root path', async () => {
    const key = newKey('local:machine-1');
    const { directory } = await buildPackage({ key });
    const disabled = serviceFor(await tempRoot(), undefined);
    await disabled.initialize();
    await expect(disabled.registerLocalPackage(directory)).rejects.toThrow(/not enabled/);

    const rootDir = await tempRoot();
    const enabled = serviceFor(rootDir, key);
    await enabled.initialize();
    await expect(enabled.registerLocalPackage('relative/path')).rejects.toThrow(/absolute/);
    await mkdir(path.join(rootDir, 'inside'), { recursive: true });
    await expect(enabled.registerLocalPackage(path.join(rootDir, 'inside'))).rejects.toThrow(/outside/);
  });

  it('rejects local key ids that could collide with Store trust', () => {
    const store = newKey('store-key');
    const bad = newKey('store-key');
    expect(() =>
      createPackageManagerService({
        rootDir: path.join(os.tmpdir(), 'x-root'),
        appVersion: '1.2.0',
        catalog: [],
        trustedKeys: { [store.keyId]: store.publicPem },
        localTrustedKeys: { [bad.keyId]: bad.publicPem },
      })
    ).toThrow(/not allowed/);
    const unprefixed = newKey('machine-1');
    expect(() =>
      createPackageManagerService({
        rootDir: path.join(os.tmpdir(), 'x-root'),
        appVersion: '1.2.0',
        catalog: [],
        localTrustedKeys: { [unprefixed.keyId]: unprefixed.publicPem },
      })
    ).toThrow(/not allowed/);
  });

  it('never accepts local-built trust from a catalog', async () => {
    const key = newKey('local:machine-1');
    const { directory, manifest } = await buildPackage({ key });
    const entry: PackageCatalogEntry = {
      manifest,
      delivery: 'downloaded-package',
      trust: 'local-built',
      sourceDirectory: directory,
    };
    expect(() =>
      createPackageManagerService({
        rootDir: path.join(os.tmpdir(), 'x-root'),
        appVersion: '1.2.0',
        catalog: [entry],
        localTrustedKeys: { [key.keyId]: key.publicPem },
      })
    ).toThrow(/cannot claim local-built/);
  });

  it('cannot replace an installed catalog package or shadow a catalog id', async () => {
    const local = newKey('local:machine-1');
    const store = newKey('store-key');
    const { directory, manifest } = await buildPackage({ key: store, id: 'com.community.shared' });
    const storeEntry: PackageCatalogEntry = {
      manifest,
      delivery: 'downloaded-package',
      trust: 'signed-store',
      sourceDirectory: directory,
    };
    const service = createPackageManagerService({
      rootDir: await tempRoot(),
      appVersion: '1.2.0',
      catalog: [storeEntry],
      trustedKeys: { [store.keyId]: store.publicPem },
      localTrustedKeys: { [local.keyId]: local.publicPem },
    });
    await service.initialize();
    const localCopy = await buildPackage({ key: local, id: 'com.community.shared' });
    await expect(service.registerLocalPackage(localCopy.directory)).rejects.toThrow(/conflicts with a catalog/);
  });
});
