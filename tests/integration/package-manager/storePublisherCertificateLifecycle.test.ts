import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {},
  dialog: {},
  ipcMain: {},
  MessageChannelMain: {},
}));

import {
  packageSignaturePayload,
  storePublisherKeyCertificateSignaturePayload,
  storePublisherKeyRevocationSignaturePayload,
  type PackageManifest,
  type StoreSignedPublisherKeyCertificate,
  type StoreSignedPublisherKeyRevocation,
} from '@/common/packages';
import { createPackageManagerService } from '@process/extensions/package-manager';
import {
  createPackageRuntimeRegistry,
  createVerifiedStorePublisherKeySet,
} from '@process/extensions/package-manager/packageBridge';
import {
  createRemotePackageCatalogLoader,
  signRemotePackageCatalog,
  type RemotePackageCatalogDocument,
} from '@process/extensions/package-manager/remoteCatalog';

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

const publisherKeyDigest = (publicKeyPem: string): string =>
  `sha256-${createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' }))
    .digest('hex')}`;

const signedArtifact = (
  privateKey: string,
  content: string,
  packageName = 'Publisher Notes'
): { manifest: PackageManifest; bytes: Buffer } => {
  const files = { 'index.html': Buffer.from(content) };
  const artifact = artifactIntegrity(files);
  const unsigned: PackageManifest = {
    schemaVersion: 1,
    id: 'com.example.publisher.notes',
    publisherId: 'com.example.publisher',
    name: packageName,
    description: 'Third-party package signed by its Store-certified publisher key.',
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=1.0.0 <2.0.0' },
    modules: [
      {
        id: 'main',
        title: 'Main',
        surface: 'publisher/notes',
        pinnable: true,
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
      },
    ],
    permissions: [],
    dependencies: [],
    tags: ['notes'],
    artifact: {
      ...artifact,
      signature: { algorithm: 'ed25519', keyId: 'publisher-key-2030', value: '' },
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
  return {
    manifest,
    bytes: Buffer.from(
      JSON.stringify({
        format: 'tomni-package-bundle-v1',
        manifest,
        files: Object.fromEntries(
          Object.entries(files).map(([fileName, value]) => [fileName, value.toString('base64')])
        ),
      })
    ),
  };
};

describe('Store publisher certificate lifecycle', () => {
  it('admits only the matching certified artifact, then stops a live sandbox and fails closed after signed key revocation', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-store-publisher-certificate-'));
    roots.push(rootDir);
    const now = new Date('2030-08-01T00:00:00.000Z');
    const storeRoot = generateKeyPairSync('ed25519');
    const publisher = generateKeyPairSync('ed25519');
    const storePrivateKey = storeRoot.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const storePublicKey = storeRoot.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const publisherPrivateKey = publisher.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publisherPublicKey = publisher.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const pinnedKeys = Object.freeze({ 'store-root-2030': storePublicKey });
    const certificateUnsigned = {
      schemaVersion: 1 as const,
      certificateId: 'certificate.com.example.publisher.2030',
      publisherId: 'com.example.publisher',
      signingKey: {
        keyId: 'publisher-key-2030',
        algorithm: 'ed25519' as const,
        publicKeyPem: publisherPublicKey,
        spkiSha256: publisherKeyDigest(publisherPublicKey),
      },
      issuedAt: now.toISOString(),
      expiresAt: new Date('2030-12-31T00:00:00.000Z').toISOString(),
      signature: { algorithm: 'ed25519' as const, keyId: 'store-root-2030', value: '' },
    };
    const certificate: StoreSignedPublisherKeyCertificate = {
      ...certificateUnsigned,
      signature: {
        ...certificateUnsigned.signature,
        value: sign(
          null,
          Buffer.from(storePublisherKeyCertificateSignaturePayload(certificateUnsigned)),
          storePrivateKey
        ).toString('base64'),
      },
    };
    const revocationUnsigned = {
      schemaVersion: 1 as const,
      revocationId: 'revocation.certificate.com.example.publisher.2030',
      certificateId: certificate.certificateId,
      publisherId: certificate.publisherId,
      signingKeyId: certificate.signingKey.keyId,
      revokedAt: now.toISOString(),
      reasonCode: 'KEY_COMPROMISED',
      signature: { algorithm: 'ed25519' as const, keyId: 'store-root-2030', value: '' },
    };
    const revocation: StoreSignedPublisherKeyRevocation = {
      ...revocationUnsigned,
      signature: {
        ...revocationUnsigned.signature,
        value: sign(
          null,
          Buffer.from(storePublisherKeyRevocationSignaturePayload(revocationUnsigned)),
          storePrivateKey
        ).toString('base64'),
      },
    };
    const matching = signedArtifact(publisherPrivateKey, '<main>matching package</main>');
    const mismatched = signedArtifact(publisherPrivateKey, '<main>wrong artifact</main>', 'Wrong publisher artifact');
    const catalogUrl = 'https://store.example/catalog.json';
    const matchingArtifactUrl = 'https://artifacts.example/matching.tomni';
    const mismatchedArtifactUrl = 'https://artifacts.example/mismatched.tomni';
    let document: RemotePackageCatalogDocument = signRemotePackageCatalog(
      {
        schemaVersion: 1,
        revision: 1,
        issuedAt: now.toISOString(),
        expiresAt: new Date('2030-08-02T00:00:00.000Z').toISOString(),
        packages: [
          {
            delivery: 'downloaded-package',
            trust: 'signed-store',
            artifactUrl: matchingArtifactUrl,
            manifest: matching.manifest,
          },
        ],
        publisherKeyCertificates: [certificate],
        publisherKeyRevocations: [],
      },
      'store-root-2030',
      storePrivateKey
    );
    let artifact = mismatched.bytes;
    const artifactFetcher = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === matchingArtifactUrl) {
        return new Response(artifact, { headers: { 'content-length': String(artifact.byteLength) }, status: 200 });
      }
      if (url === mismatchedArtifactUrl) {
        return new Response(mismatched.bytes, {
          headers: { 'content-length': String(mismatched.bytes.byteLength) },
          status: 200,
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', artifactFetcher);

    const runtimeRegistry = createPackageRuntimeRegistry();
    const createService = () => {
      const keySet = createVerifiedStorePublisherKeySet(pinnedKeys);
      const catalogLoader = createRemotePackageCatalogLoader({
        url: catalogUrl,
        cachePath: path.join(rootDir, 'catalog-cache.json'),
        fallbackCatalog: [],
        trustedKeys: pinnedKeys,
        fetcher: vi
          .fn<typeof fetch>()
          .mockImplementation(async () => new Response(JSON.stringify(document), { status: 200 })),
        now: () => now,
        onVerifiedStorePublisherKeys: keySet.replaceVerifiedStorePublisherKeys,
      });
      return {
        keySet,
        service: createPackageManagerService({
          rootDir: path.join(rootDir, 'package-manager'),
          appVersion: '1.2.0',
          catalog: [],
          catalogLoader,
          trustedKeys: keySet.trustedKeys,
          resolveArtifactUrl: () => mismatchedArtifactUrl,
          allowLocalArtifactUrls: true,
          isPackageSandboxActive: (packageId) => runtimeRegistry.isActive(packageId),
          reservePackageSandboxMutation: (packageId) => runtimeRegistry.reserveMutation(packageId),
          revokePackageSandbox: (packageId) => runtimeRegistry.revokePackage(packageId),
        }),
      };
    };

    let runtime = createService();
    await runtime.service.initialize();
    expect(runtime.keySet.trustedKeys).toEqual({ ...pinnedKeys, 'publisher-key-2030': publisherPublicKey });
    await expect(runtime.service.install(matching.manifest.id)).rejects.toThrow(/does not match the Store catalog/i);

    artifact = matching.bytes;
    await expect(runtime.service.install(matching.manifest.id)).resolves.toMatchObject({
      installedVersion: '1.0.0',
      enabled: true,
    });
    expect(
      artifactFetcher.mock.calls.map(([input]) =>
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      )
    ).toEqual([matchingArtifactUrl, matchingArtifactUrl]);
    runtimeRegistry.open('renderer-1', {
      packageId: matching.manifest.id,
      packageVersion: matching.manifest.version,
      publisherId: matching.manifest.publisherId,
      runtimeId: 'publisher-runtime-1',
      moduleId: 'main',
    });
    expect(runtimeRegistry.isActive(matching.manifest.id)).toBe(true);

    document = signRemotePackageCatalog(
      {
        schemaVersion: 1,
        revision: 2,
        issuedAt: now.toISOString(),
        expiresAt: new Date('2030-08-02T00:00:00.000Z').toISOString(),
        packages: [],
        publisherKeyCertificates: [certificate],
        publisherKeyRevocations: [revocation],
      },
      'store-root-2030',
      storePrivateKey
    );
    await runtime.service.refreshCatalog();
    expect(runtime.keySet.trustedKeys).toEqual(pinnedKeys);
    expect(runtimeRegistry.isActive(matching.manifest.id)).toBe(false);
    await expect(runtime.service.status(matching.manifest.id)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
    });

    runtime = createService();
    await runtime.service.initialize();
    await expect(runtime.service.status(matching.manifest.id)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
    });
    await expect(runtime.service.install(matching.manifest.id)).rejects.toThrow(/no downloadable artifact/i);
    expect(artifactFetcher).toHaveBeenCalledTimes(2);
  });
});
