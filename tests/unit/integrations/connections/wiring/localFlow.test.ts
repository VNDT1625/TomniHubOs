/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import { buildTomnyPackageFromRepo } from '@process/extensions/package-manager/repoPackaging/packager';
import { createConnectionRuntime } from '@process/integrations/connections/wiring/connectionRuntime';
import {
  extractArtifactArchive,
  installLocalBuiltArtifact,
} from '@process/integrations/connections/wiring/localInstall';
import { createLocalSigningKeys, localKeyDirectory } from '@process/integrations/connections/wiring/localKeys';

const roots: string[] = [];
const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-local-flow-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }))
  );
});

const SKILL = '---\nname: demo-skill\ndescription: Does a demo\n---\n\n# Demo\n';

/** One simulated application start over the same user-data folder. */
const boot = async (userData: string) => {
  const rootDir = path.join(userData, 'tomny-packages');
  const keys = createLocalSigningKeys(localKeyDirectory(userData), () => ({
    directory: localKeyDirectory(userData),
  }));
  const service = createPackageManagerService({
    rootDir,
    appVersion: '1.2.0',
    catalog: [],
    catalogLoader: async () => [],
    isPackageSandboxActive: () => false,
    reservePackageSandboxMutation: () => ({ release: () => undefined }),
    localTrustedKeys: keys.trustedKeys,
  });
  await service.initialize();
  const runtime = createConnectionRuntime({
    stateFile: path.join(userData, 'connections.json'),
    packagesRoot: rootDir,
    packages: service,
    hosts: [],
    log: () => undefined,
  });
  await runtime.start();
  const unfollow = runtime.follow();
  return { rootDir, keys, service, runtime, unfollow };
};

const buildSkillPackage = async (userData: string, signing: object) => {
  const repo = path.join(userData, 'repo', 'demo-design');
  await mkdir(path.join(repo, 'skills', 'demo'), { recursive: true });
  await writeFile(path.join(repo, 'skills', 'demo', 'SKILL.md'), SKILL);
  await writeFile(path.join(repo, 'README.md'), '# demo');
  return buildTomnyPackageFromRepo({
    source: '',
    workspaceRoot: repo,
    outputDirectory: path.join(userData, 'tomny-packages'),
    signing: signing as never,
  });
};

describe('installing a package built on this machine', () => {
  it('registers it as local-built, installs it, records its connections off, and survives a restart', async () => {
    const userData = await tempRoot();
    const first = await boot(userData);
    // Nothing is trusted before the first key exists.
    expect(Object.keys(first.keys.trustedKeys)).toEqual([]);

    const built = await buildSkillPackage(userData, { keyDirectory: localKeyDirectory(userData) });
    expect(built.keyId).toMatch(/^local:[0-9a-f]{16}$/u);

    const outcome = await installLocalBuiltArtifact(
      { keys: first.keys, packages: first.service, registry: first.runtime.registry },
      built.artifactPath
    );
    expect(outcome.packageId).toBe(built.manifest.id);
    expect(Object.keys(first.keys.trustedKeys)).toEqual([built.keyId]);

    const listing = await first.service.status(outcome.packageId);
    expect(listing.state).toBe('installed');
    expect(listing.installedTrust).toBe('local-built');
    expect(listing.trust).toBe('local-built');

    // No host exists yet, so the skill is recorded but cannot be switched on, with a reason.
    expect(outcome.connections).toEqual([
      expect.objectContaining({ key: 'skill:source/skills/demo', status: 'unsupported' }),
    ]);
    expect(outcome.connections[0]?.reason).toBeTruthy();
    const file = JSON.parse(await readFile(path.join(userData, 'connections.json'), 'utf8')) as {
      records: { packageId: string; enabled: boolean }[];
    };
    expect(file.records.map((record) => [record.packageId, record.enabled])).toEqual([[outcome.packageId, false]]);

    // The temporary extraction is gone, and the installed copy carries the adapter written by the packager.
    expect(
      existsSync(path.join(first.rootDir, 'packages', outcome.packageId, outcome.version, 'adapter', 'adapter.json'))
    ).toBe(true);
    first.unfollow();

    // A new start finds the key pinned on disk, verifies the installed package, and keeps its state.
    const second = await boot(userData);
    expect(Object.keys(second.keys.trustedKeys)).toEqual([built.keyId]);
    expect((await second.service.status(outcome.packageId)).installedTrust).toBe('local-built');
    const views = await second.runtime.registry.view(outcome.packageId);
    expect(views.map((view) => view.state.status)).toEqual(['unsupported']);

    // Uninstalling removes every recorded connection.
    await second.service.uninstall(outcome.packageId);
    await vi.waitFor(async () => {
      const after = JSON.parse(await readFile(path.join(userData, 'connections.json'), 'utf8')) as {
        records: unknown[];
      };
      expect(after.records).toEqual([]);
    });
    second.unfollow();
  });

  it('installs an unrecognized source-only repository with no executable modules or enabled connections', async () => {
    const userData = await tempRoot();
    const app = await boot(userData);
    const repo = path.join(userData, 'repo', 'data-library');
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, 'notes.txt'), 'important project notes');
    const built = await buildTomnyPackageFromRepo({
      source: '',
      workspaceRoot: repo,
      outputDirectory: path.join(userData, 'exports'),
      signing: { keyDirectory: localKeyDirectory(userData) },
    });
    expect(built.manifest.modules).toEqual([]);
    expect(built.adapter?.connections).toEqual([]);
    const result = await installLocalBuiltArtifact(
      { keys: app.keys, packages: app.service, registry: app.runtime.registry },
      built.artifactPath
    );
    expect(result.connections).toEqual([]);
    expect((await app.service.status(result.packageId)).installedTrust).toBe('local-built');
    expect(
      existsSync(path.join(app.rootDir, 'packages', result.packageId, result.version, 'source', 'notes.txt'))
    ).toBe(true);
    app.unfollow();
  });

  it('installs a web application and its MCP sidecar without activating MCP automatically', async () => {
    const userData = await tempRoot();
    const app = await boot(userData);
    const repo = path.join(userData, 'repo', 'mixed');
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, 'index.html'), '<!doctype html><main>hello</main>');
    await writeFile(
      path.join(repo, '.mcp.json'),
      JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', 'example-mcp@1.0.0'] } } })
    );
    const built = await buildTomnyPackageFromRepo({
      source: '',
      workspaceRoot: repo,
      outputDirectory: path.join(userData, 'exports'),
      signing: { keyDirectory: localKeyDirectory(userData) },
    });
    expect(built.manifest.modules[0]?.entrypoint).toBe('index.html');
    expect(built.adapter?.connections.map((connection) => connection.kind)).toContain('mcp');
    const result = await installLocalBuiltArtifact(
      { keys: app.keys, packages: app.service, registry: app.runtime.registry },
      built.artifactPath
    );
    expect(result.connections.some((connection) => connection.key.startsWith('mcp:'))).toBe(true);
    const enabled = await app.runtime.registry.view(result.packageId);
    expect(enabled.every((connection) => connection.state.enabled === false)).toBe(true);
    expect(existsSync(path.join(app.rootDir, 'packages', result.packageId, result.version, 'index.html'))).toBe(true);
    app.unfollow();
  });

  it('refuses a package signed by a key that is not this machine key', async () => {
    const userData = await tempRoot();
    const app = await boot(userData);
    // The machine key exists (so local packages are enabled)...
    await app.keys.refresh();
    // ...but this archive is signed by somebody else's key that also uses the local: prefix.
    const foreign = {
      privateKeyPem: generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      keyId: 'local:ffffffffffffffff',
    };
    const built = await buildSkillPackage(userData, foreign);
    await expect(
      installLocalBuiltArtifact(
        { keys: app.keys, packages: app.service, registry: app.runtime.registry },
        built.artifactPath
      )
    ).rejects.toThrow();
    expect((await app.service.list({ installedOnly: true })).length).toBe(0);
    expect(existsSync(path.join(userData, 'connections.json'))).toBe(false);
  });
});

describe('extracting a package archive', () => {
  it('refuses an entry that would leave the destination', async () => {
    const userData = await tempRoot();
    const zip = new JSZip();
    zip.file('ok.txt', 'fine');
    zip.file('../escape.txt', 'bad');
    const archive = path.join(userData, 'bad.tomny');
    await writeFile(archive, await zip.generateAsync({ type: 'nodebuffer' }));
    const destination = path.join(userData, 'out');
    await mkdir(destination, { recursive: true });
    await expect(extractArtifactArchive(archive, destination)).rejects.toThrow();
    expect(existsSync(path.join(userData, 'escape.txt'))).toBe(false);
  });
});
