import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { packageSignaturePayload, parsePackageManifest, type PackageManifest } from '@/common/packages';
import { downloadPackageArtifact } from '@process/extensions/package-manager';
import { createStagedTomnyArtifactVerifier } from '@process/extensions/package-manager/packageDownloader';
import {
  parseRemotePackageCatalog,
  signRemotePackageCatalog,
  verifiedRemoteStoreArtifactBindingFor,
} from '@process/extensions/package-manager/remoteCatalog';

const roots: string[] = [];
const servers: Server[] = [];

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-package-download-test-'));
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

  vi.unstubAllGlobals();
});

const signedManifest = (): {
  manifest: PackageManifest;
  trustedKeys: Readonly<Record<string, string>>;
  privateKey: string;
} => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const unsignedManifest: PackageManifest = {
    schemaVersion: 1,
    id: 'com.tomni.download-security',
    publisherId: 'com.tomni',
    name: 'Download security',
    description: 'Security test package',
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=1.0.0' },
    modules: [{ id: 'main', title: 'Main', surface: 'security/main', pinnable: true }],
    permissions: [],
    dependencies: [],
    tags: ['security'],
    artifact: {
      integrity: `sha256-${'0'.repeat(64)}`,
      sizeBytes: 1,
      signature: { algorithm: 'ed25519', keyId: 'download-test-key', value: '' },
    },
  };
  const signature = sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64');
  const manifest: PackageManifest = {
    ...unsignedManifest,
    artifact: {
      ...unsignedManifest.artifact!,
      signature: { ...unsignedManifest.artifact!.signature, value: signature },
    },
  };
  return {
    manifest,
    trustedKeys: { 'download-test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};

const serve = async (bytes: Buffer): Promise<string> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': String(bytes.byteLength) });
    response.end(bytes);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test package server did not start.');
  return `http://127.0.0.1:${address.port}/artifact`;
};

const verifiedBindingFor = (
  manifest: PackageManifest,
  trustedKeys: Readonly<Record<string, string>>,
  privateKey: string,
  artifactUrl: string
) => {
  const now = new Date();
  const catalog = signRemotePackageCatalog(
    {
      schemaVersion: 1,
      revision: 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
      packages: [{ delivery: 'downloaded-package', trust: 'signed-store', artifactUrl, manifest }],
    },
    'download-test-key',
    privateKey
  );
  const binding = verifiedRemoteStoreArtifactBindingFor(parseRemotePackageCatalog(catalog, trustedKeys).packages[0]!);
  if (!binding) throw new Error('Test remote catalog artifact binding was not retained.');
  return binding;
};

const verificationFor = (
  manifest: PackageManifest,
  trustedKeys: Readonly<Record<string, string>>,
  privateKey?: string,
  artifactUrl?: string
) => ({
  expectedManifest: manifest,
  trustedKeys,
  allowLocalDevelopment: true,
  ...(privateKey && artifactUrl
    ? { verifiedRemoteStoreArtifactBinding: verifiedBindingFor(manifest, trustedKeys, privateKey, artifactUrl) }
    : {}),
});

const corruptCentralUncompressedSize = (archive: Buffer, entryName: string, size: number): void => {
  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = 0;
  while ((offset = archive.indexOf(centralSignature, offset)) !== -1) {
    const nameLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === entryName) {
      archive.writeUInt32LE(size, offset + 24);
      return;
    }
    offset += 4;
  }
  throw new Error(`Central directory entry was not found: ${entryName}`);
};

const payloadIntegrity = (files: Readonly<Record<string, Buffer>>): string => {
  const hash = createHash('sha256');
  for (const [relativePath, content] of Object.entries(files).toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return `sha256-${hash.digest('hex')}`;
};

const signedTomnyArchive = async (
  options: Readonly<{ publisherId?: string; integrity?: string; unsafePath?: boolean }> = {}
) => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const files = { 'assets/main.txt': Buffer.from('publisher package') };
  const unsignedManifest = parsePackageManifest({
    schemaVersion: 1,
    id: 'com.tomni.publisher.surface',
    publisherId: options.publisherId ?? 'com.tomni.publisher',
    name: 'Publisher package',
    description: 'A signed staged package fixture.',
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=1.0.0 <2.0.0' },
    modules: [
      {
        id: 'main',
        title: 'Main',
        surface: 'publisher/main',
        pinnable: true,
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
      },
    ],
    contributions: { version: 1, apps: [{ id: 'main', title: 'Main', moduleId: 'main' }] },
    permissions: [],
    dependencies: [],
    tags: ['publisher'],
    artifact: {
      integrity: options.integrity ?? payloadIntegrity(files),
      sizeBytes: files['assets/main.txt'].byteLength,
      signature: { algorithm: 'ed25519', keyId: 'publisher-key', value: 'pending-signature' },
    },
  });
  const manifest = {
    ...unsignedManifest,
    artifact: {
      ...unsignedManifest.artifact!,
      signature: {
        ...unsignedManifest.artifact!.signature,
        value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
      },
    },
  };
  const archive = new JSZip();
  archive.file('tomny-package.json', JSON.stringify(manifest));
  archive.file(options.unsafePath ? '../escape.txt' : 'assets/main.txt', files['assets/main.txt']);
  return {
    bytes: await archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' }),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    manifest,
    trustedKeys: { 'publisher-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
  };
};

const publisherPrincipal = (
  publicKeyPem: string,
  overrides: Partial<{ publisherId: string; namespace: string; keyId: string }> = {}
) => ({
  publisherId: overrides.publisherId ?? 'com.tomni.publisher',
  subjectId: 'publisher-subject',
  namespace: overrides.namespace ?? 'com.tomni',
  activeSigningKey: { keyId: overrides.keyId ?? 'publisher-key', algorithm: 'Ed25519' as const, publicKeyPem },
});

describe('package artifact downloader security', () => {
  it('verifies a staged `.tomny` ZIP with its exact active publisher key and retains both identities', async () => {
    const fixture = await signedTomnyArchive();
    const reader = vi.fn(async () => fixture.bytes);
    const verifier = createStagedTomnyArtifactVerifier(reader);

    const verified = await verifier({
      principal: publisherPrincipal(fixture.publicKeyPem),
      idempotencyKey: 'submission-1',
      artifactId: 'artifact-1',
    });

    expect(reader).toHaveBeenCalledWith({
      publisherId: 'com.tomni.publisher',
      subjectId: 'publisher-subject',
      artifactId: 'artifact-1',
    });
    expect(verified.artifactFingerprint).toBe(verified.manifest.artifact?.integrity);
    expect(verified.archiveFingerprint).toBe(`sha256-${createHash('sha256').update(fixture.bytes).digest('hex')}`);
    expect(verified.archiveFingerprint).not.toBe(verified.artifactFingerprint);
    expect(verified.inspection).toEqual({ hasNativeCode: 'unknown', aiOperations: 'unknown', destinations: 'unknown' });
  });

  it('rejects staged ZIPs outside the authenticated publisher namespace', async () => {
    const fixture = await signedTomnyArchive({ publisherId: 'com.tomni.other' });
    const verifier = createStagedTomnyArtifactVerifier(async () => fixture.bytes);

    await expect(
      verifier({
        principal: publisherPrincipal(fixture.publicKeyPem),
        idempotencyKey: 'submission-1',
        artifactId: 'artifact-1',
      })
    ).rejects.toThrow(/namespace/i);
  });

  it('rejects a ZIP whose signature key is not the active publisher key', async () => {
    const fixture = await signedTomnyArchive();
    const verifier = createStagedTomnyArtifactVerifier(async () => fixture.bytes);

    await expect(
      verifier({
        principal: publisherPrincipal(fixture.publicKeyPem, { keyId: 'retired-publisher-key' }),
        idempotencyKey: 'submission-1',
        artifactId: 'artifact-1',
      })
    ).rejects.toThrow(/active publisher key/i);
  });

  it('rejects a signed ZIP whose unpacked payload hash is not the signed manifest integrity', async () => {
    const fixture = await signedTomnyArchive({ integrity: `sha256-${'0'.repeat(64)}` });
    const verifier = createStagedTomnyArtifactVerifier(async () => fixture.bytes);

    await expect(
      verifier({
        principal: publisherPrincipal(fixture.publicKeyPem),
        idempotencyKey: 'submission-1',
        artifactId: 'artifact-1',
      })
    ).rejects.toThrow(/integrity/i);
  });

  it('rejects an unsafe staged ZIP before reading payload bytes', async () => {
    const fixture = await signedTomnyArchive({ unsafePath: true });
    const verifier = createStagedTomnyArtifactVerifier(async () => fixture.bytes);

    await expect(
      verifier({
        principal: publisherPrincipal(fixture.publicKeyPem),
        idempotencyKey: 'submission-1',
        artifactId: 'artifact-1',
      })
    ).rejects.toThrow(/unsafe|path/i);
  });

  it('blocks direct loopback HTTP unless local development is explicitly enabled', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys } = signedManifest();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadPackageArtifact('http://127.0.0.1:4173/artifact', destination, {
        expectedManifest: manifest,
        trustedKeys,
      })
    ).rejects.toThrow(/HTTPS|local|private/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies an unbound public artifact before making a network request', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys } = signedManifest();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadPackageArtifact(
        'https://attacker.example/replaced.tomni',
        destination,
        verificationFor(manifest, trustedKeys)
      )
    ).rejects.toThrow(/verified signed Store catalog authority/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies a URL that diverges from its verified Store catalog artifact before fetch', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys, privateKey } = signedManifest();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const catalogArtifactUrl = 'https://store.example/catalog-bound.tomni';

    await expect(
      downloadPackageArtifact(
        'https://attacker.example/replaced.tomni',
        destination,
        verificationFor(manifest, trustedKeys, privateKey, catalogArtifactUrl)
      )
    ).rejects.toThrow(/SYSTEM_EGRESS_STORE_ARTIFACT_DESTINATION_DENIED/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a download when the server byte-count metadata conflicts with the received artifact', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys, privateKey } = signedManifest();
    const bytes = Buffer.from(
      JSON.stringify({
        format: 'tomni-package-bundle-v1',
        manifest,
        files: { 'payload.txt': Buffer.from('x').toString('base64') },
      })
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(bytes, { headers: { 'content-length': String(bytes.byteLength + 1) }, status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadPackageArtifact(
        'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact',
        destination,
        verificationFor(
          manifest,
          trustedKeys,
          privateKey,
          'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact'
        )
      )
    ).rejects.toThrow(/Content-Length.*received bytes/i);
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels the response body when byte-count metadata is invalid', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys, privateKey } = signedManifest();
    const cancelBody = vi.fn();
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel: cancelBody,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(responseBody, {
          headers: { 'content-length': 'invalid' },
          status: 200,
        })
      )
    );

    await expect(
      downloadPackageArtifact(
        'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact',
        destination,
        verificationFor(
          manifest,
          trustedKeys,
          privateKey,
          'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact'
        )
      )
    ).rejects.toThrow(/invalid Content-Length/i);
    expect(cancelBody).toHaveBeenCalledOnce();
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects every redirect from a verified Store artifact before a second request', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys, privateKey } = signedManifest();
    const cancelRedirectBody = vi.fn();
    const redirectBody = new ReadableStream<Uint8Array>({ cancel: cancelRedirectBody });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(redirectBody, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/tomni/artifact' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadPackageArtifact(
        'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact',
        destination,
        verificationFor(
          manifest,
          trustedKeys,
          privateKey,
          'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact'
        )
      )
    ).rejects.toThrow(/redirects are not allowed/i);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) })
    );
    expect(cancelRedirectBody).toHaveBeenCalledOnce();
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks an HTTPS redirect to a loopback address before the second request', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys, privateKey } = signedManifest();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://127.0.0.1/private-artifact' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadPackageArtifact(
        'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact',
        destination,
        verificationFor(
          manifest,
          trustedKeys,
          privateKey,
          'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact'
        )
      )
    ).rejects.toThrow(/redirects are not allowed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks an HTTPS-to-HTTP redirect downgrade before the second request', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys, privateKey } = signedManifest();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://downloads.example.com/artifact' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadPackageArtifact(
        'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact',
        destination,
        verificationFor(
          manifest,
          trustedKeys,
          privateKey,
          'https://github.com/VNDT1625/OmniAgent/releases/download/test/artifact'
        )
      )
    ).rejects.toThrow(/redirects are not allowed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a signed JSON bundle with an optional UTF-8 BOM', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys } = signedManifest();
    const json = Buffer.from(
      JSON.stringify({
        format: 'tomni-package-bundle-v1',
        manifest,
        files: { 'payload.txt': Buffer.from('x').toString('base64') },
      })
    );
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json]);

    await expect(
      downloadPackageArtifact(await serve(bytes), destination, verificationFor(manifest, trustedKeys))
    ).resolves.toBeUndefined();
    await expect(access(path.join(destination, 'payload.txt'))).resolves.toBeUndefined();
  });

  it('rejects a mismatched signed manifest before decoding JSON payload files', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys } = signedManifest();
    const mismatchedManifest: PackageManifest = {
      ...manifest,
      artifact: {
        ...manifest.artifact!,
        signature: { ...manifest.artifact!.signature, value: Buffer.alloc(64, 7).toString('base64') },
      },
    };
    const bytes = Buffer.from(
      JSON.stringify({
        format: 'tomni-package-bundle-v1',
        manifest: mismatchedManifest,
        files: { 'payload.txt': Buffer.from('must-not-be-decoded').toString('base64') },
      })
    );

    await expect(
      downloadPackageArtifact(await serve(bytes), destination, verificationFor(manifest, trustedKeys))
    ).rejects.toThrow(/manifest|signature/i);
    await expect(access(path.join(destination, 'payload.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the Main-owned local transport without issuing an HTTP fetch', async () => {
    const fixture = await signedTomnyArchive();
    const destination = path.join(await tempRoot(), 'local-download');
    const readArtifactBytes = vi.fn(async () => fixture.bytes);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadPackageArtifact('http://127.0.0.1:4173/artifact', destination, {
        expectedManifest: fixture.manifest,
        trustedKeys: fixture.trustedKeys,
        allowLocalDevelopment: true,
        readArtifactBytes,
      })
    ).resolves.toBeUndefined();

    expect(readArtifactBytes).toHaveBeenCalledWith('http://127.0.0.1:4173/artifact');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(access(path.join(destination, 'assets/main.txt'))).resolves.toBeUndefined();
  });

  it('rejects a ZIP traversal path before extracting any payload', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys } = signedManifest();
    const archive = new JSZip();
    archive.file('../escape.txt', 'escape');
    archive.file('tomny-package.json', JSON.stringify(manifest));
    const bytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' });

    await expect(
      downloadPackageArtifact(await serve(bytes), destination, verificationFor(manifest, trustedKeys))
    ).rejects.toThrow(/unsafe|path|escape/i);
    await expect(access(path.join(destination, 'escape.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a ZIP with too many entries before extracting any file', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys } = signedManifest();
    const archive = new JSZip();
    archive.file('tomny-package.json', JSON.stringify(manifest));
    for (let index = 0; index < 4096; index += 1) archive.file(`files/${index}.txt`, '');
    const bytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' });

    await expect(
      downloadPackageArtifact(await serve(bytes), destination, verificationFor(manifest, trustedKeys))
    ).rejects.toThrow(/file limit/i);
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an oversized ZIP from central-directory metadata before entry decompression', async () => {
    const destination = path.join(await tempRoot(), 'download');
    const { manifest, trustedKeys } = signedManifest();
    const archive = new JSZip();
    archive.file('payload.bin', Buffer.from('small'));
    archive.file('tomny-package.json', JSON.stringify(manifest));
    const bytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    corruptCentralUncompressedSize(bytes, 'payload.bin', 201 * 1024 * 1024);

    await expect(
      downloadPackageArtifact(await serve(bytes), destination, verificationFor(manifest, trustedKeys))
    ).rejects.toThrow(/size limit/i);
    await expect(access(path.join(destination, 'payload.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
