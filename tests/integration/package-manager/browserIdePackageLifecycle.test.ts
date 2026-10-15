/** Clean-root install/disable/restart/uninstall proof for four optional first-party app artifacts.
 * Uses an ephemeral development signing identity; does not admit development keys in production. */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { parsePackageManifest, type PackageCatalogEntry } from '@/common/packages';
import { createPackageManagerService } from '@process/extensions/package-manager';
import { verifyArtifactSignature } from '@process/extensions/package-manager/artifactSecurity';
import { loadPackageSigningKey } from '../../../scripts/package-apps/signing';

const APP_IDS = ['com.tomni.browser', 'com.tomni.ide', 'com.tomni.automation-studio', 'com.tomni.document-studio'] as const;
const PACKAGE_ENTRYPOINTS: Record<(typeof APP_IDS)[number], string> = {
  'com.tomni.browser': 'packages/package-apps/browser/src/entry.tsx',
  'com.tomni.ide': 'packages/package-apps/ide/src/entry.tsx',
  'com.tomni.automation-studio': 'packages/desktop/src/renderer/package-apps/automation/index.tsx',
  'com.tomni.document-studio': 'packages/package-apps/document-studio/src/renderer/entry.tsx',
};
const PACKAGE_MODULES: Record<(typeof APP_IDS)[number], string> = {
  'com.tomni.browser': 'browser',
  'com.tomni.ide': 'ide',
  'com.tomni.automation-studio': 'automation',
  'com.tomni.document-studio': 'document',
};

const runBuild = (root: string, artifactRoot: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'bun.exe' : 'bun', ['scripts/package-apps/build.ts'], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        LOCALAPPDATA: root,
        TOMNI_PACKAGE_DEV_SIGNING: '1',
        TOMNI_PACKAGE_OUTPUT_ROOT: artifactRoot,
        TOMNI_PACKAGE_TARGETS: APP_IDS.join(','),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr: Buffer[] = [];
    child.stderr?.on('data', (part: Buffer | string) => stderr.push(Buffer.from(part)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Browser/IDE package build exited ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
    });
  });

describe('default optional applications independent package artifact lifecycle', () => {
  it('builds genuine signed 0.0.0-compatible artifacts and installs/uninstalls them from an empty root', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'tomni-browser-ide-lifecycle-'));
    let server: Server | undefined;
    try {
      const artifactRoot = path.join(root, 'artifacts');
      await runBuild(root, artifactRoot);
      const signingKey = await loadPackageSigningKey({
        env: { TOMNI_PACKAGE_DEV_SIGNING: '1' },
        signingRoot: path.join(root, 'Tomni', 'StoreSigning', 'development'),
      });
            const artifacts = new Map<string, Buffer>();
      const downloadCounts = new Map<string, number>();
      const catalog: PackageCatalogEntry[] = [];

      for (const id of APP_IDS) {
        const name = `${id}-1.0.0.dev.tomny`;
                // eslint-disable-next-line no-await-in-loop -- Check each signed artifact against its own immutable manifest.
        const artifact = await fs.readFile(path.join(artifactRoot, name));
                // eslint-disable-next-line no-await-in-loop -- Verify each independently signed zip archive.
        const archive = await JSZip.loadAsync(artifact);
        const manifestEntry = archive.file('tomny-package.json');
        if (!manifestEntry) throw new Error('Missing signed package manifest.');
        // eslint-disable-next-line no-await-in-loop -- Signature is bound to this archive's manifest.
        const manifest = parsePackageManifest(JSON.parse(await manifestEntry.async('text')) as unknown);
        expect(manifest.engines.tomni).toBe('>=0.0.0');
        expect(manifest.modules[0]).toMatchObject({
                    id: PACKAGE_MODULES[id],
          runtime: 'trusted-react',
          entrypoint: 'app.js',
        });
                expect(archive.file('app.js')).not.toBeNull();
        const metafileEntry = archive.file('metafile.json');
        if (!metafileEntry) throw new Error('Missing source closure evidence.');
        // eslint-disable-next-line no-await-in-loop -- Check this artifact's source closure.
        const metafile = JSON.parse(await metafileEntry.async('text')) as {
          entry: string;
          inputs: Record<string, unknown>;
        };
                expect(metafile.entry).toBe(PACKAGE_ENTRYPOINTS[id]);
        expect(Object.keys(metafile.inputs)).toContain(metafile.entry);
        expect(() => verifyArtifactSignature(manifest, { [signingKey.keyId]: signingKey.publicKey })).not.toThrow();
        artifacts.set('/' + name, artifact);
        catalog.push({
          delivery: 'downloaded-package',
          trust: 'signed-first-party',
          manifest,
          artifactUrl: '', // Filled only after the isolated localhost fixture has bound.
        });
      }

      server = createServer((request, response) => {
        const artifact = artifacts.get(request.url ?? '');
                if (!artifact) { response.writeHead(404).end(); return; }
        const artifactPath = request.url ?? '';
        downloadCounts.set(artifactPath, (downloadCounts.get(artifactPath) ?? 0) + 1);
        response.writeHead(200, {
          'content-length': String(artifact.length),
          'content-type': 'application/vnd.tomni.package+zip',
        }).end(artifact);
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
            const signedCatalog = catalog.map((item) => Object.assign({}, item, {
        artifactUrl: `http://127.0.0.1:${address.port}/${item.manifest.id}-1.0.0.dev.tomny`,
      }));

            const installedRoot = path.join(root, 'package-manager');
      const createService = () => createPackageManagerService({
        rootDir: installedRoot,
        appVersion: '0.0.0',
        catalog: signedCatalog,
        trustedKeys: { [signingKey.keyId]: signingKey.publicKey },
        firstPartyTrustedKeys: { [signingKey.keyId]: signingKey.publicKey },
        allowLocalArtifactUrls: true,
        isPackageSandboxActive: () => false,
        reservePackageSandboxMutation: () => ({ release: () => undefined }),
      });
      let service = createService();
      await service.initialize();
      for (const id of APP_IDS) {
                // eslint-disable-next-line no-await-in-loop -- Verify the complete disk transaction per package.
        await expect(service.readAsset(id, 'app.js')).rejects.toThrow(/not installed/i);
                // eslint-disable-next-line no-await-in-loop -- Installs are serialized against a shared package manager.
                await expect(service.install(id)).resolves.toMatchObject({ state: 'installed', enabled: true });
                // Downloaded archives must not remain cached; the extracted payload must be present.
        // eslint-disable-next-line no-await-in-loop -- Observe the disk after each serialized install.
        await expect(fs.readdir(path.join(installedRoot, '.downloads'))).resolves.toEqual([]);
        // eslint-disable-next-line no-await-in-loop -- Each installed artifact owns its own version directory.
        await expect(fs.access(path.join(installedRoot, 'packages', id, '1.0.0'))).resolves.toBeUndefined();
                // eslint-disable-next-line no-await-in-loop -- Each verified package must expose its installed script.
        await expect(service.readAsset(id, 'app.js')).resolves.toMatchObject({

          content: expect.any(String),
        });
      }
      service = createService();
      await service.initialize();
      for (const id of APP_IDS) {
                // eslint-disable-next-line no-await-in-loop -- Mutations are deliberately serial for durable recovery proof.
        await expect(service.disable(id)).resolves.toMatchObject({ enabled: false });
                // eslint-disable-next-line no-await-in-loop -- Re-enable follows verified disable.
        await expect(service.enable(id)).resolves.toMatchObject({ enabled: true });
                // eslint-disable-next-line no-await-in-loop -- Removal follows verified enable.
                await expect(service.uninstall(id)).resolves.toMatchObject({ state: 'available' });
                // Uninstall physically removes all owned package files, with no leftover download or trash.
        // eslint-disable-next-line no-await-in-loop -- Verify each package's removal before continuing.
        await expect(fs.access(path.join(installedRoot, 'packages', id))).rejects.toMatchObject({ code: 'ENOENT' });
        // eslint-disable-next-line no-await-in-loop -- Temporary archives must be gone after uninstall.
        await expect(fs.readdir(path.join(installedRoot, '.downloads'))).resolves.toEqual([]);
        // eslint-disable-next-line no-await-in-loop -- All removed-version trash should be finalized.
        await expect(fs.readdir(path.join(installedRoot, '.trash'))).resolves.toEqual([]);
                // eslint-disable-next-line no-await-in-loop -- Verify the complete disk transaction per package.
        await expect(service.readAsset(id, 'app.js')).rejects.toThrow(/not installed/i);
                    const artifactUrl = `/${id}-1.0.0.dev.tomny`;
        expect(downloadCounts.get(artifactUrl)).toBe(1);
        // A reinstall after disk cleanup downloads the signed artifact again.
        // eslint-disable-next-line no-await-in-loop -- Test independent signed downloads in order.
        await expect(service.install(id)).resolves.toMatchObject({ state: 'installed', enabled: true });
        expect(downloadCounts.get(artifactUrl)).toBe(2);
        // eslint-disable-next-line no-await-in-loop -- The re-downloaded payload is verified and readable.
        await expect(service.readAsset(id, 'app.js')).resolves.toMatchObject({ content: expect.any(String) });
        // eslint-disable-next-line no-await-in-loop -- Fully remove the second installation.
        await expect(service.uninstall(id)).resolves.toMatchObject({ state: 'available' });
        // eslint-disable-next-line no-await-in-loop -- No installed version remains on disk.
        await expect(fs.access(path.join(installedRoot, 'packages', id))).rejects.toMatchObject({ code: 'ENOENT' });
        // eslint-disable-next-line no-await-in-loop -- The download cache is empty.
        await expect(fs.readdir(path.join(installedRoot, '.downloads'))).resolves.toEqual([]);
        // eslint-disable-next-line no-await-in-loop -- Transaction trash is empty.
        await expect(fs.readdir(path.join(installedRoot, '.trash'))).resolves.toEqual([]);
      }
      // User/release-owned source files outside the managed install root are not ours to erase.
            for (const id of APP_IDS) {
        // eslint-disable-next-line no-await-in-loop -- Publisher build output is outside the managed installation.
        await expect(fs.access(path.join(artifactRoot, `${id}-1.0.0.dev.tomny`))).resolves.toBeUndefined();
      }
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 240_000);
});
