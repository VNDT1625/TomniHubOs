import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import { buildTomnyPackageFromRepo } from '@process/extensions/package-manager/repoPackaging/packager';
import { createConnectionRuntime } from '@process/integrations/connections/wiring/connectionRuntime';
import { installLocalBuiltArtifact } from '@process/integrations/connections/wiring/localInstall';
import { createLocalSigningKeys, localKeyDirectory } from '@process/integrations/connections/wiring/localKeys';
import {
  countLocalBuiltPackages,
  revokeLocalSigningKey,
} from '@process/integrations/connections/wiring/localRevocation';

const roots: string[] = [];
const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-local-revoke-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }))
  );
});

const SKILL = '---\nname: demo-skill\ndescription: Does a demo\n---\n\n# Demo\n';

/** One simulated application start over the same user-data folder. Store refreshes run as they do in production. */
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
    isRevokedLocalKey: keys.isRevoked,
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
  const install = (artifactPath: string) =>
    installLocalBuiltArtifact({ keys, packages: service, registry: runtime.registry }, artifactPath);
  const revoke = () => revokeLocalSigningKey({ keys, packages: service, registry: runtime.registry });
  return { keys, service, runtime, unfollow, install, revoke };
};

const buildSkillPackage = async (userData: string) => {
  const repo = path.join(userData, 'repo', 'demo-design');
  await mkdir(path.join(repo, 'skills', 'demo'), { recursive: true });
  await writeFile(path.join(repo, 'skills', 'demo', 'SKILL.md'), SKILL);
  await writeFile(path.join(repo, 'README.md'), '# demo');
  return buildTomnyPackageFromRepo({
    source: '',
    workspaceRoot: repo,
    outputDirectory: path.join(userData, 'tomny-packages'),
    signing: { keyDirectory: localKeyDirectory(userData) } as never,
  });
};

describe('revoking the local signing key', () => {
  it('makes a revoked key unable to verify, and keeps its package installed as unsigned-revoked across a restart', async () => {
    const userData = await tempRoot();
    const first = await boot(userData);
    const built = await buildSkillPackage(userData);
    const oldArchive = path.join(userData, 'old-build.tomny');
    await copyFile(built.artifactPath, oldArchive);
    const installed = await first.install(built.artifactPath);
    expect(installed.packageId).toBe(built.manifest.id);
    expect(await countLocalBuiltPackages(first.service)).toBe(1);

    const outcome = await first.revoke();
    expect(outcome).toEqual({ unsignedPackages: 1 });
    expect(await countLocalBuiltPackages(first.service)).toBe(0);
    const listing = await first.service.status(built.manifest.id);
    expect(listing.state).toBe('installed');
    expect(listing.installedTrust).toBe('unsigned-revoked');
    // The new key is the only trusted local key; the revoked one is not in the record again.
    expect(Object.keys(first.keys.trustedKeys)).not.toContain(built.keyId);

    // An archive still signed by the revoked key is refused and does not replace the installed package.
    await expect(first.install(oldArchive)).rejects.toThrow();
    expect((await first.service.status(built.manifest.id)).installedTrust).toBe('unsigned-revoked');
    first.unfollow();

    const second = await boot(userData);
    expect(Object.keys(second.keys.trustedKeys)).not.toContain(built.keyId);
    expect((await second.service.status(built.manifest.id)).installedTrust).toBe('unsigned-revoked');
    second.unfollow();
  });

  it('keeps a local package installed and local-built through a Store catalog refresh', async () => {
    const userData = await tempRoot();
    const app = await boot(userData);
    const built = await buildSkillPackage(userData);
    await app.install(built.artifactPath);

    await app.service.refreshCatalog();

    const listing = await app.service.status(built.manifest.id);
    expect(listing.state).toBe('installed');
    expect(listing.installedTrust).toBe('local-built');
    app.unfollow();
  });

  it('signs a package rebuilt with the new key again, while its connections stay off until approved', async () => {
    const userData = await tempRoot();
    const app = await boot(userData);
    const old = await buildSkillPackage(userData);
    await app.install(old.artifactPath);
    await app.revoke();

    const rebuilt = await buildSkillPackage(userData);
    expect(rebuilt.keyId).not.toBe(old.keyId);
    const outcome = await app.install(rebuilt.artifactPath);

    expect(outcome.packageId).toBe(old.manifest.id);
    const listing = await app.service.status(old.manifest.id);
    expect(listing.state).toBe('installed');
    expect(listing.installedTrust).toBe('local-built');
    expect(Object.keys(app.keys.trustedKeys)).toEqual([rebuilt.keyId]);
    expect(outcome.connections.every((connection) => connection.status !== 'on')).toBe(true);
    app.unfollow();
  });
});
