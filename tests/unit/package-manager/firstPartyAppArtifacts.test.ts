import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_SIGNING_KEY_ID, loadPackageSigningKey } from '../../../scripts/package-apps/signing';
import {
  FIRST_PARTY_PACKAGE_CATALOG,
  FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
  parsePackageManifest,
  type PackageCatalogEntry,
  type PackageManifest,
} from '@/common/packages';
import { createPackageManagerService } from '@process/extensions/package-manager';
import {
  packageArtifactManifestsMatch,
  readArtifactManifest,
  verifyArtifactSignature,
} from '../../../packages/desktop/src/process/extensions/package-manager/artifactSecurity';

type PackageBundle = {
  format: 'tomni-package-bundle-v1';
  manifest: unknown;
  files: Record<string, string>;
};

const runPackageBuild = (environment: NodeJS.ProcessEnv): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'bun.exe' : 'bun', ['scripts/package-apps/build.ts'], {
      cwd: path.resolve('.'),
      env: environment,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Package build failed with status ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
    });
  });

const PACKAGE_IDS = [
  'com.tomni.design-studio',
  'com.tomni.document-studio',
  'com.tomni.ide',
  'com.tomni.studio',
] as const;

const integrityFor = (files: Record<string, string>): { integrity: string; sizeBytes: number } => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const [relativePath, encoded] of Object.entries(files).toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const content = Buffer.from(encoded, 'base64');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    sizeBytes += content.byteLength;
  }
  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};

type SourceMetafile = {
  entry: string;
  inputs: Record<string, unknown>;
};

const expectPortableSourceClosure = (metafile: SourceMetafile): string[] => {
  const inputs = Object.keys(metafile.inputs).map((input) => input.replaceAll('\\', '/'));
  expect(inputs).toEqual(inputs.toSorted());
  expect(new Set(inputs).size).toBe(inputs.length);
  expect(inputs).toContain(metafile.entry);
  expect(
    inputs.every(
      (input) =>
        !input.includes('\0') &&
        !input.startsWith('/') &&
        !/^[a-z]:/i.test(input) &&
        input !== '..' &&
        !input.startsWith('../') &&
        !input.startsWith('node_modules/')
    )
  ).toBe(true);
  return inputs.map((input) => input.toLowerCase());
};

describe('first-party package signing policy', () => {
  it('rejects an oversized on-disk package manifest before reading it into memory', async () => {
    const packageRoot = await fs.mkdtemp(path.join(tmpdir(), 'tomni-oversized-manifest-'));
    await fs.writeFile(path.join(packageRoot, 'tomny-package.json'), ' '.repeat(256 * 1024 + 1));

    await expect(readArtifactManifest(packageRoot)).rejects.toThrow(/manifest exceeds the size limit/i);

    await fs.rm(packageRoot, { recursive: true, force: true });
  });

  it('rejects a production build when no explicit private key is configured', async () => {
    const signingRoot = await fs.mkdtemp(path.join(tmpdir(), 'tomni-signing-empty-'));
    await expect(loadPackageSigningKey({ env: {}, signingRoot })).rejects.toThrow(
      /TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH/
    );
    await expect(fs.readdir(signingRoot)).resolves.toEqual([]);
    await fs.rm(signingRoot, { recursive: true, force: true });
  });

  it('rejects a different Ed25519 key under the production key id', async () => {
    const signingRoot = await fs.mkdtemp(path.join(tmpdir(), 'tomni-signing-wrong-anchor-'));
    const privateKeyPath = path.join(signingRoot, 'wrong.private.pem');
    const pair = generateKeyPairSync('ed25519');
    await fs.writeFile(privateKeyPath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
    await expect(
      loadPackageSigningKey({ env: { TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH: privateKeyPath }, signingRoot })
    ).rejects.toThrow(/committed trust anchor/);
    await fs.rm(signingRoot, { recursive: true, force: true });
  });

  it('isolates opt-in development signing behind a non-production key id', async () => {
    const signingRoot = await fs.mkdtemp(path.join(tmpdir(), 'tomni-signing-dev-'));
    const signingKey = await loadPackageSigningKey({ env: { TOMNI_PACKAGE_DEV_SIGNING: '1' }, signingRoot });
    expect(signingKey).toMatchObject({ keyId: DEVELOPMENT_SIGNING_KEY_ID, production: false });
    expect(DEVELOPMENT_SIGNING_KEY_ID).not.toBe('tomni-store-2026-02');
    await expect(fs.readdir(signingRoot)).resolves.toContain(`${DEVELOPMENT_SIGNING_KEY_ID}.private.pem`);
    await fs.rm(signingRoot, { recursive: true, force: true });
  });
});

describe('signed first-party app package artifacts', () => {
  it('builds a signed sandboxed pilot that declares only the supervised host ABI capability', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'tomni-runtime-pilot-'));
    try {
      await runPackageBuild({
        ...process.env,
        LOCALAPPDATA: root,
        TOMNI_PACKAGE_DEV_SIGNING: '1',
        TOMNI_PACKAGE_OUTPUT_ROOT: path.join(root, 'artifacts'),
        TOMNI_PACKAGE_TARGETS: 'com.tomni.runtime-pilot',
      });
      const artifactPath = path.join(root, 'artifacts', 'com.tomni.runtime-pilot-1.0.0.dev.tomny');
      const archive = await JSZip.loadAsync(await fs.readFile(artifactPath));
      const manifestEntry = archive.file('tomny-package.json');
      if (!manifestEntry) throw new Error('Runtime pilot is missing its manifest.');
      const manifest = parsePackageManifest(JSON.parse(await manifestEntry.async('text')) as unknown);
      const files = Object.fromEntries(
        await Promise.all(
          Object.entries(archive.files)
            .filter(([name, entry]) => !entry.dir && name !== 'tomny-package.json')
            .map(async ([name, entry]) => [name, (await entry.async('nodebuffer')).toString('base64')] as const)
        )
      );
      const signingKey = await loadPackageSigningKey({
        env: { TOMNI_PACKAGE_DEV_SIGNING: '1' },
        signingRoot: path.join(root, 'Tomni', 'StoreSigning', 'development'),
      });

      expect(manifest).toMatchObject({
        id: 'com.tomni.runtime-pilot',
        permissions: ['host.ipc'],
        modules: [{ runtime: 'sandboxed-web', entrypoint: 'index.html' }],
      });
      expect(() => verifyArtifactSignature(manifest, { [signingKey.keyId]: signingKey.publicKey })).not.toThrow();
      expect(integrityFor(files)).toEqual({
        integrity: manifest.artifact?.integrity,
        sizeBytes: manifest.artifact?.sizeBytes,
      });
      const html = Buffer.from(files['index.html']!, 'base64').toString('utf8');
      expect(html).toContain("type: 'tomni.capability.invoke'");
      expect(html).toContain("capability: 'host.runtime.info'");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('runs the signed runtime pilot through install, update, disable, enable, rollback, and uninstall', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'tomni-runtime-pilot-lifecycle-'));
    let server: Server | undefined;
    try {
      const artifactsRoot = path.join(root, 'artifacts');
      const buildPilot = async (version: string): Promise<void> =>
        runPackageBuild({
          ...process.env,
          LOCALAPPDATA: root,
          TOMNI_PACKAGE_DEV_SIGNING: '1',
          TOMNI_PACKAGE_OUTPUT_ROOT: artifactsRoot,
          TOMNI_PACKAGE_TARGETS: 'com.tomni.runtime-pilot',
          TOMNI_PACKAGE_VERSION: version,
        });
      await buildPilot('1.0.0');
      await buildPilot('1.1.0');

      const artifacts = new Map<string, Buffer>();
      const manifests = new Map<string, PackageManifest>();
      const builtArtifacts = await Promise.all(
        ['1.0.0', '1.1.0'].map(async (version) => {
          const artifactName = `com.tomni.runtime-pilot-${version}.dev.tomny`;
          const artifact = await fs.readFile(path.join(artifactsRoot, artifactName));
          const archive = await JSZip.loadAsync(artifact);
          const manifestEntry = archive.file('tomny-package.json');
          if (!manifestEntry) throw new Error(`Runtime pilot ${version} is missing its manifest.`);
          return {
            artifact,
            artifactName,
            manifest: parsePackageManifest(JSON.parse(await manifestEntry.async('text')) as unknown),
            version,
          };
        })
      );
      for (const { artifact, artifactName, manifest, version } of builtArtifacts) {
        artifacts.set(`/${artifactName}`, artifact);
        manifests.set(version, manifest);
      }

      server = createServer((request, response) => {
        const artifact = artifacts.get(request.url ?? '');
        if (!artifact) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          'content-length': String(artifact.byteLength),
          'content-type': 'application/vnd.tomni.package+zip',
        });
        response.end(artifact);
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Runtime pilot test package server did not start.');

      const signingKey = await loadPackageSigningKey({
        env: { TOMNI_PACKAGE_DEV_SIGNING: '1' },
        signingRoot: path.join(root, 'Tomni', 'StoreSigning', 'development'),
      });
      let catalogVersion = '1.0.0';
      const catalogEntryFor = (version: string): PackageCatalogEntry => ({
        manifest: manifests.get(version)!,
        delivery: 'downloaded-package',
        trust: 'signed-first-party',
        artifactUrl: `http://127.0.0.1:${address.port}/com.tomni.runtime-pilot-${version}.dev.tomny`,
      });
      const createService = () =>
        createPackageManagerService({
          rootDir: path.join(root, 'package-manager'),
          appVersion: '1.2.0',
          catalog: [catalogEntryFor(catalogVersion)],
          catalogLoader: async () => [catalogEntryFor(catalogVersion)],
          trustedKeys: { [signingKey.keyId]: signingKey.publicKey },
          allowLocalArtifactUrls: true,
          isPackageSandboxActive: () => false,
          reservePackageSandboxMutation: () => ({ release: () => undefined }),
        });
      let service = createService();
      await service.initialize();

      await expect(service.install('com.tomni.runtime-pilot')).resolves.toMatchObject({
        installedVersion: '1.0.0',
        enabled: true,
      });
      await expect(service.readAsset('com.tomni.runtime-pilot', 'index.html')).resolves.toMatchObject({
        content: expect.stringContaining("capability: 'host.runtime.info'"),
      });

      catalogVersion = '1.1.0';
      await expect(service.refreshCatalog()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ installedVersion: '1.0.0', updateAvailable: true })])
      );
      await expect(service.install('com.tomni.runtime-pilot')).resolves.toMatchObject({
        installedVersion: '1.1.0',
        previousVersion: '1.0.0',
      });
      service = createService();
      await service.initialize();
      await expect(service.disable('com.tomni.runtime-pilot')).resolves.toMatchObject({ enabled: false });
      await expect(service.enable('com.tomni.runtime-pilot')).resolves.toMatchObject({ enabled: true });
      await expect(service.rollback('com.tomni.runtime-pilot')).resolves.toMatchObject({
        installedVersion: '1.0.0',
        previousVersion: '1.1.0',
      });
      await expect(service.uninstall('com.tomni.runtime-pilot')).resolves.toMatchObject({ state: 'available' });
      await expect(service.readAsset('com.tomni.runtime-pilot', 'index.html')).rejects.toThrow(/not installed/i);
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  for (const packageId of PACKAGE_IDS) {
    it(`ships a verifiable independently downloadable ${packageId} bundle`, async () => {
      const catalogEntry = FIRST_PARTY_PACKAGE_CATALOG.find((entry) => entry.manifest.id === packageId);
      expect(catalogEntry?.delivery).toBe('downloaded-package');
      expect(catalogEntry?.trust).toBe('signed-first-party');
      const artifactName = new URL(catalogEntry!.artifactUrl!).pathname.split('/').at(-1)!;
      const content = await fs.readFile(path.resolve('store-artifacts', artifactName), 'utf8');
      const bundle = JSON.parse(content) as PackageBundle;
      const manifest = parsePackageManifest(bundle.manifest);

      expect(bundle.format).toBe('tomni-package-bundle-v1');
      expect(packageArtifactManifestsMatch(catalogEntry!.manifest, manifest)).toBe(true);
      expect(() => verifyArtifactSignature(manifest, FIRST_PARTY_PACKAGE_TRUSTED_KEYS)).not.toThrow();
      expect(integrityFor(bundle.files)).toEqual({
        integrity: manifest.artifact?.integrity,
        sizeBytes: manifest.artifact?.sizeBytes,
      });
      const javascript = Buffer.from(bundle.files['app.js']!, 'base64').toString('utf8');
      expect(Buffer.byteLength(javascript)).toBeGreaterThan(1024 * 1024);
      expect(Buffer.from(bundle.files['style.css']!, 'base64').byteLength).toBeGreaterThan(1024);

      if (packageId === 'com.tomni.design-studio') {
        const metafile = JSON.parse(
          Buffer.from(bundle.files['metafile.json']!, 'base64').toString('utf8')
        ) as SourceMetafile;
        const sourceInputs = expectPortableSourceClosure(metafile);
        const excludedOwnerPaths = [
          '/package-apps/document',
          '/package-apps/ide.tsx',
          '/package-apps/studio.tsx',
          '/pages/conversation/',
          '/pages/editor/',
          '/pages/music/',
          '/pages/studio/automation/',
          '/pages/studio/components/',
          '/pages/studio/makevideo/',
        ];
        const excludedIdeSource = sourceInputs.some(
          (input) => input.includes('/pages/studio/ide/') && !input.includes('/pages/studio/ide/viu/')
        );
        const excludedBundleMarkers = [
          'automationview',
          'chatconversation',
          'documentstudiopage',
          'expbasepanel',
          'ideworkspace',
          'musicstudio',
          'quicktestpanel',
          'teameditclient',
        ];

        expect(metafile.entry).toBe('packages/desktop/src/renderer/package-apps/design/index.tsx');
        expect(excludedIdeSource).toBe(false);
        expect(sourceInputs.some((input) => excludedOwnerPaths.some((owner) => input.includes(owner)))).toBe(false);
        expect(excludedBundleMarkers.some((marker) => javascript.toLowerCase().includes(marker))).toBe(false);
        expect(manifest.engines.tomni).toBe('>=1.0.0');
        expect(manifest.permissions).toEqual(['workspace.read', 'workspace.write']);
        expect(manifest.dependencies).toEqual([]);
        expect(manifest.artifact?.sizeBytes).toBeLessThan(10 * 1024 * 1024);
      }

      if (packageId === 'com.tomni.document-studio') {
        const metafile = JSON.parse(
          Buffer.from(bundle.files['metafile.json']!, 'base64').toString('utf8')
        ) as SourceMetafile;
        const sourceInputs = expectPortableSourceClosure(metafile);
        const excludedOwnerPaths = [
          '/pages/conversation/',
          '/pages/music/',
          '/pages/studio/automation/',
          '/pages/studio/ide/',
          '/pages/studio/makevideo/',
        ];
        const excludedBundleMarkers = [
          'automationview',
          'chatconversation',
          'ideworkspace',
          'musicstudio',
          'previewprovider',
          'studiopage',
          'viucanvas',
        ];

        expect(metafile.entry).toBe('packages/desktop/src/renderer/package-apps/documentStudio.tsx');
        expect(sourceInputs.some((input) => excludedOwnerPaths.some((owner) => input.includes(owner)))).toBe(false);
        expect(excludedBundleMarkers.some((marker) => javascript.toLowerCase().includes(marker))).toBe(false);
        expect(manifest.artifact?.sizeBytes).toBeLessThan(10 * 1024 * 1024);
      }
    });
  }
});
