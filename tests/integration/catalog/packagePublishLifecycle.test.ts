import { generateKeyPairSync } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PackageCatalogEntry } from '@/common/packages';
import { createPackageManagerService } from '@process/extensions/package-manager';

import { createPackageHttpRuntimeRegistry } from '@process/extensions/package-manager/packageHttpApi';
import {
  createRemotePackageCatalogLoader,
  parseRemotePackageCatalog,
  signRemotePackageCatalog,
  type RemotePackageCatalogDocument,
} from '@process/extensions/package-manager/remoteCatalog';
import { buildPackageProject, type PackageBuildResult } from '../../../scripts/package-apps/packageProject';
import { loadPublishCatalog, mergePublishCatalog } from '../../../scripts/package-apps/publishCatalog';

const roots: string[] = [];
const servers: Server[] = [];

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type TestReleaseStore = {
  fetcher: typeof fetch;
  resolveToLocalUrl: (url: string) => string;
  remove: (url: string) => void;
};

const readRequestBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const startTestReleaseStore = async (): Promise<TestReleaseStore> => {
  const objects = new Map<string, Buffer>();
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const objectPath = request.url ?? '/';
    if (request.method === 'PUT') {
      objects.set(objectPath, await readRequestBody(request));
      response.writeHead(201).end();
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    const object = objects.get(objectPath);
    if (!object) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-length': String(object.byteLength),
      'content-type': objectPath.endsWith('.json') ? 'application/json' : 'application/zip',
    });
    response.end(object);
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => response.writeHead(500).end());
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test release store did not start.');
  const localOrigin = `http://127.0.0.1:${address.port}`;
  const resolveToLocalUrl = (url: string): string => {
    const remote = new URL(url);
    return new URL(`${remote.pathname}${remote.search}`, localOrigin).toString();
  };
  const fetcher: typeof fetch = async (input, init) => {
    const remote = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    return fetch(resolveToLocalUrl(remote.toString()), init);
  };
  return {
    fetcher,
    resolveToLocalUrl,
    remove: (url) => objects.delete(new URL(url).pathname),
  };
};

const createPackageProject = async (root: string, id: string, name: string): Promise<string> => {
  const projectDirectory = path.join(root, id);
  await mkdir(path.join(projectDirectory, 'payload'), { recursive: true });
  await writeFile(
    path.join(projectDirectory, 'tomny-package.json'),
    JSON.stringify({
      schemaVersion: 1,
      id,
      publisherId: 'com.example',
      name,
      description: `${name} test package`,
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'main',
          title: name,
          surface: `apps/${id}`,
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['e2e'],
    })
  );
  await writeFile(
    path.join(projectDirectory, 'payload', 'index.html'),
    `<!doctype html><title>${name}</title><main data-package=${id}>Package running</main>`
  );
  return projectDirectory;
};

const releaseUrlFor = (result: PackageBuildResult): string =>
  `https://github.example/releases/download/tomni-store-v1/${encodeURIComponent(path.basename(result.artifactPath))}`;

const catalogEntryFor = (result: PackageBuildResult): PackageCatalogEntry => ({
  delivery: 'downloaded-package',
  trust: 'signed-store',
  artifactUrl: releaseUrlFor(result),
  manifest: result.manifest,
});

type PublishedFixture = {
  root: string;
  store: TestReleaseStore;
  catalogUrl: string;
  publicKey: string;
  target: PackageCatalogEntry;
};

const publishFixture = async (): Promise<PublishedFixture> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-publish-e2e-'));
  roots.push(root);
  const store = await startTestReleaseStore();
  const keyId = 'store-e2e-key';
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(root, 'store.private.pem');
  await writeFile(privateKeyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const outputDirectory = path.join(root, 'output');
  const existing = await buildPackageProject({
    projectDirectory: await createPackageProject(root, 'com.example.existing', 'Existing package'),
    outputDirectory,
    privateKeyPath,
    keyId,
  });
  const targetResult = await buildPackageProject({
    projectDirectory: await createPackageProject(root, 'com.example.published', 'Published package'),
    outputDirectory,
    privateKeyPath,
    keyId,
  });
  const existingEntry = catalogEntryFor(existing);
  const target = catalogEntryFor(targetResult);
  const catalogUrl = 'https://github.example/releases/download/tomni-store-v1/catalog.json';
  const trustedKeys = { [keyId]: publicKey };
  const catalogPrivateKey = await readFile(privateKeyPath, 'utf8');
  const initialIssueTime = new Date();
  const initialDocument: RemotePackageCatalogDocument = signRemotePackageCatalog(
    {
      schemaVersion: 1,
      revision: 1,
      issuedAt: initialIssueTime.toISOString(),
      expiresAt: new Date(initialIssueTime.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
      packages: [existingEntry],
    },
    keyId,
    catalogPrivateKey
  );
  await store.fetcher(existingEntry.artifactUrl!, { method: 'PUT', body: await readFile(existing.artifactPath) });
  await store.fetcher(catalogUrl, { method: 'PUT', body: JSON.stringify(initialDocument) });

  const currentCatalog = await loadPublishCatalog({
    url: catalogUrl,
    bootstrap: false,
    fetcher: store.fetcher,
    parse: (value) => parseRemotePackageCatalog(value, trustedKeys),
  });
  await store.fetcher(target.artifactUrl!, { method: 'PUT', body: await readFile(targetResult.artifactPath) });
  const publishedIssueTime = new Date();
  const publishedDocument: RemotePackageCatalogDocument = signRemotePackageCatalog(
    {
      schemaVersion: 1,
      revision: 2,
      issuedAt: publishedIssueTime.toISOString(),
      expiresAt: new Date(publishedIssueTime.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
      packages: mergePublishCatalog(currentCatalog, target),
    },
    keyId,
    catalogPrivateKey
  );
  parseRemotePackageCatalog(publishedDocument, trustedKeys);
  await store.fetcher(catalogUrl, { method: 'PUT', body: JSON.stringify(publishedDocument) });
  return { root, store, catalogUrl, publicKey, target };
};

const createRemoteClient = async ({ root, store, catalogUrl, publicKey }: PublishedFixture) => {
  const trustedKeys = { 'store-e2e-key': publicKey };
  const catalogLoader = createRemotePackageCatalogLoader({
    url: catalogUrl,
    cachePath: path.join(root, 'client', 'catalog-cache.json'),
    fallbackCatalog: [],
    trustedKeys,
    fetcher: store.fetcher,
  });
  const runtime = createPackageHttpRuntimeRegistry();
  const service = createPackageManagerService({
    rootDir: path.join(root, 'client', 'packages'),
    appVersion: '1.2.0',
    catalog: [],
    catalogLoader,
    trustedKeys,
    resolveArtifactUrl: store.resolveToLocalUrl,
    allowLocalArtifactUrls: true,
    isPackageSandboxActive: runtime.isActive,
    reservePackageSandboxMutation: runtime.reserveMutation,
  });
  await service.initialize();
  return service;
};

describe('account-free Store publish lifecycle', () => {
  it('builds and signs a package, merges it into the catalog, then lets another client install, read and remove it', async () => {
    const fixture = await publishFixture();
    const service = await createRemoteClient(fixture);

    expect((await service.search({ query: fixture.target.manifest.id })).map(({ manifest }) => manifest.id)).toEqual([
      fixture.target.manifest.id,
    ]);
    expect((await service.list()).map(({ manifest }) => manifest.id)).toEqual([
      'com.example.existing',
      fixture.target.manifest.id,
    ]);

    await service.install(fixture.target.manifest.id);
    await expect(service.readAsset(fixture.target.manifest.id, 'index.html')).resolves.toMatchObject({
      contentType: 'text/html',
      content: expect.stringContaining('<title>Published package</title>'),
    });

    await service.uninstall(fixture.target.manifest.id);
    await expect(service.readAsset(fixture.target.manifest.id, 'index.html')).rejects.toThrow(/not installed/i);
    await expect(
      access(path.join(fixture.root, 'client', 'packages', 'packages', fixture.target.manifest.id))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('shows catalog metadata but fails closed when the published artifact is missing', async () => {
    const fixture = await publishFixture();
    fixture.store.remove(fixture.target.artifactUrl!);
    const service = await createRemoteClient(fixture);

    await expect(service.status(fixture.target.manifest.id)).resolves.toMatchObject({ state: 'available' });
    await expect(service.install(fixture.target.manifest.id)).rejects.toThrow(/HTTP 404/i);
    await expect(service.readAsset(fixture.target.manifest.id, 'index.html')).rejects.toThrow(/not installed/i);
  });
});
