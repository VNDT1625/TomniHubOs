import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageSignaturePayload, type PackageManifest } from '@/common/packages';
import {
  computeArtifactIntegrity,
  createPackageManagerService,
  JsonPackageStateStore,
} from '@process/extensions/package-manager';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PACKAGE_ID = 'com.community.recovery-fixture';
const VERSION = '1.0.0';
const KEY_ID = 'recovery-fixture-key';

/**
 * A signed, sealed package whose record was quarantined with PACKAGE_PAYLOAD_INCONSISTENT, the state a real
 * source-backed MCP package reaches after setup wrote into its folder.
 */
const quarantinedInstall = async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomny-payload-recovery-'));
  roots.push(rootDir);
  const payload = path.join(rootDir, 'packages', PACKAGE_ID, VERSION);
  await mkdir(path.join(payload, 'source', 'server'), { recursive: true });
  await mkdir(path.join(payload, 'source', '.claude-plugin'), { recursive: true });
  await mkdir(path.join(payload, 'adapter'), { recursive: true });
  await writeFile(path.join(payload, 'source', 'server', 'index.js'), 'process.stdin.resume();');
  await writeFile(path.join(payload, 'source', '.claude-plugin', 'plugin.json'), '{"name":"shipped"}');
  await writeFile(path.join(payload, 'adapter', 'adapter.json'), '{"connections":[]}');

  const artifact = await computeArtifactIntegrity(payload);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const unsigned: PackageManifest = {
    schemaVersion: 1,
    id: PACKAGE_ID,
    publisherId: 'com.community',
    name: 'Recovery fixture',
    description: 'Payload quarantine recovery fixture',
    type: 'agent-capsule',
    bundleKind: 'single',
    version: VERSION,
    engines: { tomni: '>=0.0.0' },
    modules: [],
    permissions: ['mcp.server.stdio'],
    dependencies: [],
    tags: ['mcp'],
    artifact: { ...artifact, signature: { algorithm: 'ed25519', keyId: KEY_ID, value: '' } },
  } as PackageManifest;
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
  await writeFile(path.join(payload, 'tomny-package.json'), JSON.stringify(manifest));

  const filePath = path.join(rootDir, 'installed.json');
  const store = new JsonPackageStateStore(filePath);
  await store.initialize();
  await store.save({
    id: PACKAGE_ID,
    version: VERSION,
    state: 'quarantined',
    delivery: 'downloaded-package',
    enabled: false,
    installedAt: 1_000,
    updatedAt: 2_000,
    manifest,
    trust: 'signed-store',
    provenance: { source: 'store', scope: 'optional', version: VERSION, integrity: artifact.integrity },
    lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
  } as never);
  const trustedKeys = { [KEY_ID]: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const createService = () =>
    createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [{ manifest, delivery: 'downloaded-package', trust: 'signed-store', sourceDirectory: payload }],
      stateStore: new JsonPackageStateStore(filePath),
      trustedKeys,
    });
  const persisted = async () =>
    (JSON.parse(await readFile(filePath, 'utf8')) as { packages: Array<Record<string, unknown>> }).packages.find(
      (record) => record.id === PACKAGE_ID
    );
  return { rootDir, payload, createService, persisted };
};

describe('payload quarantine recovery', () => {
  it('installs again, disabled, a package whose only difference is setup output', async () => {
    const { payload, createService, persisted } = await quarantinedInstall();
    await mkdir(path.join(payload, 'source', 'node_modules', 'dep'), { recursive: true });
    await writeFile(path.join(payload, 'source', 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');

    const service = createService();
    await service.initialize();

    await expect(service.status(PACKAGE_ID)).resolves.toMatchObject({ state: 'installed', enabled: false });
    expect(await persisted()).toMatchObject({ state: 'installed', enabled: false });
    expect((await persisted())?.lastError).toBeUndefined();
    // Setup output is left where it is: it is outside the verified payload and never executed from there.
    await expect(readFile(path.join(payload, 'source', 'node_modules', 'dep', 'index.js'), 'utf8')).resolves.toBe(
      'module.exports = 1;'
    );
  });

  it('keeps a package quarantined when a shipped file differs, even though setup output is also present', async () => {
    const { payload, createService, persisted } = await quarantinedInstall();
    await mkdir(path.join(payload, 'source', 'node_modules', 'dep'), { recursive: true });
    await writeFile(path.join(payload, 'source', 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');
    // What the package's own postinstall and runtime heal wrote into a shipped file.
    await writeFile(path.join(payload, 'source', '.claude-plugin', 'plugin.json'), '{"name":"rewritten"}');

    const service = createService();
    await service.initialize();

    await expect(service.status(PACKAGE_ID)).resolves.toMatchObject({ state: 'quarantined', enabled: false });
    expect(await persisted()).toMatchObject({ state: 'quarantined', lastError: 'PACKAGE_PAYLOAD_INCONSISTENT' });
  });
});
