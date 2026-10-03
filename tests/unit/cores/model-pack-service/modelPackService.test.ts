import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { access, mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModelPackCatalogClient,
  StrictHttpsFetcher,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/model-pack-service/catalogClient';
import { ModelPackService } from '../../../../packages/desktop/src/process/experimentalCore/catalog/model-pack-service/modelPackService';
import type { ModelPackAuditReceipt } from '../../../../packages/desktop/src/process/experimentalCore/catalog/model-pack-service/types';
import {
  Ed25519ModelCatalogTrustVerifier,
  modelCatalogSignedPayload,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelCatalogTrustVerifier';
import { modelPackManifestSha256 } from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelPackManifest';
import {
  InMemoryModelRegistryPersistence,
  ModelRegistryStore,
  type ModelPromotionGateVerifier,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelRegistryStore';
import {
  modelPackKey,
  type ModelCatalogTrustMetadata,
  type ModelPackManifest,
  type ModelPromotionGateReceipt,
  type ModelPromotionTarget,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelPackTypes';

const roots: string[] = [];
const keys = generateKeyPairSync('ed25519');
const baseSha = 'a'.repeat(64);
const urls = {
  metadata: 'https://catalog.example.com/metadata.json',
  catalog: 'https://catalog.example.com/catalog.json',
  artifact: 'https://cdn.example.com/security.zip',
};
const weights = Buffer.from('adapter weights');
const config = Buffer.from('{r:8,lora_alpha:16}');
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const manifest = (): ModelPackManifest => ({
  schemaVersion: 1,
  kind: 'model-adapter',
  id: 'com.tomny.core.security',
  version: '0.1.0',
  purpose: 'security',
  format: 'peft-lora-safetensors',
  baseModel: { id: 'Qwen/Qwen3.5-0.8B', revision: 'immutable-r1', sha256: baseSha },
  runtime: {
    engine: 'transformers-peft',
    peft: '>=0.18.1 <0.19.0',
    transformers: '>=5.5.0 <5.6.0',
    minTomnyVersion: '0.0.0',
  },
  contracts: {
    inputSchema: 'tomny.security.input.v1',
    outputSchema: 'tomny.security.output.v1',
    policyVersion: 'core-policy-v1',
  },
  files: [
    { path: 'adapter_model.safetensors', size: weights.byteLength, sha256: digest(weights) },
    { path: 'adapter_config.json', size: config.byteLength, sha256: digest(config) },
  ],
  training: {
    datasetManifestSha256: baseSha,
    recipeSha256: baseSha,
    seed: 1,
    provenanceSha256: baseSha,
  },
  evaluation: { reportSha256: baseSha, benchmarkVersion: 'tomny-core-v2', status: 'candidate' },
  license: 'Apache-2.0',
  createdAt: '2026-07-25T10:00:00Z',
});

const promotionReceipt = (candidate: ModelPackManifest, target: ModelPromotionTarget): ModelPromotionGateReceipt => ({
  schemaVersion: 1,
  target,
  candidate: {
    id: candidate.id,
    version: candidate.version,
    purpose: candidate.purpose,
    manifestSha256: modelPackManifestSha256(candidate),
  },
  verification: { verified: true, reportSha256: baseSha, provenanceSha256: candidate.training.provenanceSha256 },
  benchmark: {
    postTrainingReportSha256: baseSha,
    reportSha256: candidate.evaluation.reportSha256,
    confidenceGatePassed: true,
    candidateOnly: true,
    promotionAllowed: false,
  },
  humanApproval: {
    approvalId: `review-${candidate.version}-${target}`,
    approvalSha256: baseSha,
    approvedAt: '2026-07-25T12:00:00Z',
    approvedFor: target,
  },
});

const approvedPromotionGateVerifier: ModelPromotionGateVerifier = {
  verify: async () => ({ approved: true }),
};

type HarnessOptions = {
  diskBytes?: bigint;
  extraFile?: boolean;
  artifactTransform?: (bytes: Buffer) => Buffer;
  beforeArtifactResponse?: () => Promise<void>;
  artifactContentLength?: number;
  maxExtractedBytes?: number;
  maxTransactionQuarantineEntries?: number;
  auditFails?: boolean;
};

const createHarness = async (options: HarnessOptions = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tomny-model-pack-'));
  roots.push(root);
  const zip = new JSZip();
  zip.file('adapter_model.safetensors', weights);
  zip.file('adapter_config.json', config);
  if (options.extraFile) zip.file('run.exe', Buffer.from('x'));
  const artifact = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
  const catalog = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      entries: [
        {
          manifest: manifest(),
          artifact: { url: urls.artifact, size: artifact.byteLength, sha256: digest(artifact) },
        },
      ],
    })
  );
  const metadata: ModelCatalogTrustMetadata = {
    schemaVersion: 1,
    revision: 1,
    version: '1',
    expiresAt: '2099-01-01T00:00:00Z',
    sha256: digest(catalog),
    keyId: 'root',
  };
  metadata.signature = sign(null, modelCatalogSignedPayload(metadata), keys.privateKey).toString('base64');
  const metadataBytes = Buffer.from(JSON.stringify(metadata));
  let artifactRequests = 0;
  const fetcher = vi.fn(async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url === urls.metadata) {
      return new Response(metadataBytes, {
        status: 200,
        headers: { 'content-length': String(metadataBytes.byteLength) },
      });
    }
    if (url === urls.catalog) {
      return new Response(catalog, {
        status: 200,
        headers: { 'content-length': String(catalog.byteLength) },
      });
    }
    artifactRequests += 1;
    await options.beforeArtifactResponse?.();
    const delivered = options.artifactTransform?.(artifact) ?? artifact;
    return new Response(delivered, {
      status: 200,
      headers: {
        'content-length': String(options.artifactContentLength ?? delivered.byteLength),
      },
    });
  }) as unknown as typeof fetch;
  const network = new StrictHttpsFetcher({
    fetcher,
    allowedOrigins: ['https://catalog.example.com', 'https://cdn.example.com'],
  });
  const registry = new ModelRegistryStore(
    new InMemoryModelRegistryPersistence(),
    () => new Date('2026-07-25T12:00:00Z'),
    new Ed25519ModelCatalogTrustVerifier({ trustedKeys: { root: keys.publicKey } }),
    approvedPromotionGateVerifier
  );
  const catalogClient = new ModelPackCatalogClient({
    source: { metadataUrl: urls.metadata, catalogUrl: urls.catalog },
    registry,
    network,
  });
  const receipts: ModelPackAuditReceipt[] = [];
  let auditErrors = 0;
  let id = 0;
  const service = new ModelPackService({
    rootDir: root,
    registry,
    catalogClient,
    network,
    auditSink: {
      append: async (receipt) => {
        if (options.auditFails) throw new Error('audit unavailable');
        receipts.push(structuredClone(receipt));
      },
    },
    onAuditError: () => {
      auditErrors += 1;
    },
    expectedBases: { security: manifest().baseModel },
    availableDiskBytes: async () => options.diskBytes ?? 10n * 1024n * 1024n * 1024n,
    maxExtractedBytes: options.maxExtractedBytes,
    maxTransactionQuarantineEntries: options.maxTransactionQuarantineEntries,
    now: () => new Date('2026-07-25T12:00:00Z'),
    randomId: () => `operation-${++id}`,
  });
  await service.initialize();
  await service.refreshCatalog();
  return {
    root,
    service,
    registry,
    receipts,
    auditErrors: () => auditErrors,
    artifactRequests: () => artifactRequests,
    artifact,
  };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Model Pack installation service', () => {
  it('deduplicates concurrent installation and registers one immutable candidate', async () => {
    const harness = await createHarness();
    const [first, second] = await Promise.all([
      harness.service.install('com.tomny.core.security', '0.1.0'),
      harness.service.install('com.tomny.core.security', '0.1.0'),
    ]);
    expect(first.key).toBe(second.key);
    expect(harness.artifactRequests()).toBe(1);
    expect((await harness.registry.read()).records[first.key].status).toBe('candidate');
  });

  it('serializes uninstall behind an in-flight installation', async () => {
    let markArtifactStarted = (): void => undefined;
    let releaseArtifact = (): void => undefined;
    const artifactStarted = new Promise<void>((resolve) => {
      markArtifactStarted = resolve;
    });
    const artifactGate = new Promise<void>((resolve) => {
      releaseArtifact = resolve;
    });
    const harness = await createHarness({
      beforeArtifactResponse: async () => {
        markArtifactStarted();
        await artifactGate;
      },
    });

    const installation = harness.service.install('com.tomny.core.security', '0.1.0');
    await artifactStarted;
    const removal = harness.service.uninstall(modelPackKey(manifest()));
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseArtifact();

    const [installed] = await Promise.all([installation, removal]);
    expect((await harness.registry.read()).records[installed.key]).toBeUndefined();
    await expect(access(installed.installedPath!)).rejects.toBeDefined();
    expect(await readdir(path.join(harness.root, 'model-packs', '.transactions'))).toHaveLength(0);
  });

  it('coalesces concurrent removals of the same installed pack', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');

    await Promise.all([harness.service.uninstall(installed.key), harness.service.uninstall(installed.key)]);

    expect((await harness.registry.read()).records[installed.key]).toBeUndefined();
    await expect(access(installed.installedPath!)).rejects.toBeDefined();
  });

  it('rejects artifact tampering before staging is promoted', async () => {
    const harness = await createHarness({
      artifactTransform: (bytes) => {
        const tampered = Buffer.from(bytes);
        tampered[10] ^= 1;
        return tampered;
      },
    });
    await expect(harness.service.install('com.tomny.core.security', '0.1.0')).rejects.toMatchObject({
      code: 'artifact-tampered',
    });
    expect(Object.keys((await harness.registry.read()).records)).toHaveLength(0);
  });

  it('rejects a managed staging root swapped with a junction before cleanup', async () => {
    const harness = await createHarness();
    const staging = path.join(harness.root, 'model-packs', '.staging');
    const outside = path.join(harness.root, 'swapped-staging');
    await mkdir(outside, { recursive: true });
    await rm(staging, { recursive: true, force: true });
    await symlink(outside, staging, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(harness.service.initialize()).rejects.toMatchObject({ code: 'filesystem-error' });
  });

  it('quarantines an installed adapter whose bytes change after registration', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    const tampered = Buffer.from(weights);
    tampered[0] ^= 1;
    await writeFile(path.join(installed.installedPath!, 'adapter_model.safetensors'), tampered);

    await harness.service.initialize();

    expect((await harness.registry.read()).records[installed.key]).toMatchObject({
      status: 'quarantined',
      quarantineReason: 'installed-artifact-integrity-failed',
    });
  });

  it('does not briefly reactivate a known-invalid rollback model during reconciliation', async () => {
    const harness = await createHarness();
    const first = await harness.service.install('com.tomny.core.security', '0.1.0');
    let snapshot = await harness.registry.read();
    snapshot = await harness.registry.promote(
      first.key,
      'shadow',
      snapshot.revision,
      promotionReceipt(first.manifest, 'shadow')
    );
    snapshot = await harness.registry.promote(
      first.key,
      'pilot',
      snapshot.revision,
      promotionReceipt(first.manifest, 'pilot')
    );
    snapshot = await harness.registry.promote(
      first.key,
      'active',
      snapshot.revision,
      promotionReceipt(first.manifest, 'active')
    );
    const secondManifest = { ...manifest(), version: '0.2.0' };
    const secondKey = modelPackKey(secondManifest);
    const secondPath = path.join(harness.root, 'model-packs', 'installed', digest(Buffer.from(secondKey)));
    snapshot = await harness.registry.registerCandidate(secondManifest, secondPath, snapshot.revision);
    snapshot = await harness.registry.promote(
      secondKey,
      'shadow',
      snapshot.revision,
      promotionReceipt(secondManifest, 'shadow')
    );
    snapshot = await harness.registry.promote(
      secondKey,
      'pilot',
      snapshot.revision,
      promotionReceipt(secondManifest, 'pilot')
    );
    snapshot = await harness.registry.promote(
      secondKey,
      'active',
      snapshot.revision,
      promotionReceipt(secondManifest, 'active')
    );
    await harness.registry.rollback('security', snapshot.revision);
    await writeFile(path.join(first.installedPath!, 'adapter_model.safetensors'), Buffer.from('corrupt'));
    const originalQuarantine = harness.registry.quarantine.bind(harness.registry);
    let invalidRollbackWasExposed = false;
    vi.spyOn(harness.registry, 'quarantine').mockImplementation(async (key, reason, expectedRevision) => {
      const updated = await originalQuarantine(key, reason, expectedRevision);
      if (key === first.key) {
        invalidRollbackWasExposed = (await harness.registry.getActive('security'))?.key === secondKey;
      }
      return updated;
    });

    await harness.service.initialize();

    expect(invalidRollbackWasExposed).toBe(false);
    expect(await harness.registry.getActive('security')).toBeUndefined();
    expect((await harness.registry.read()).records[first.key].status).toBe('quarantined');
    expect((await harness.registry.read()).records[secondKey].status).toBe('quarantined');
  });

  it('rejects partial artifact download and leaves staging empty', async () => {
    const harness = await createHarness({
      artifactTransform: (bytes) => bytes.subarray(0, bytes.byteLength - 1),
      artifactContentLength: 1,
    });
    await expect(harness.service.install('com.tomny.core.security', '0.1.0')).rejects.toMatchObject({
      code: 'partial-download',
    });
    expect(await readdir(path.join(harness.root, 'model-packs', '.staging'))).toHaveLength(0);
  });

  it('recovers a stale failed-operation journal before a later install in the same session', async () => {
    const harness = await createHarness();
    const modelRoot = path.join(harness.root, 'model-packs');
    await writeFile(path.join(modelRoot, '.transactions', `${'7'.repeat(64)}.json`), '{');

    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');

    expect((await harness.registry.read()).records[installed.key].status).toBe('candidate');
    expect(await readdir(path.join(modelRoot, '.transactions'))).toHaveLength(0);
    expect(await readdir(path.join(modelRoot, '.transaction-quarantine'))).toHaveLength(1);
  });

  it('fails before extraction when available disk cannot hold archive, payload and reserve', async () => {
    const harness = await createHarness({ diskBytes: 1n });
    await expect(harness.service.install('com.tomny.core.security', '0.1.0')).rejects.toMatchObject({
      code: 'disk-full',
    });
    expect(Object.keys((await harness.registry.read()).records)).toHaveLength(0);
  });

  it('rejects an extra executable file even when the archive hash is catalog-bound', async () => {
    const harness = await createHarness({ extraFile: true });
    await expect(harness.service.install('com.tomny.core.security', '0.1.0')).rejects.toMatchObject({
      code: 'unsafe-entry',
    });
  });

  it('rejects a declared payload over the extraction cap before downloading', async () => {
    const harness = await createHarness({ maxExtractedBytes: 1 });
    await expect(harness.service.install('com.tomny.core.security', '0.1.0')).rejects.toMatchObject({
      code: 'payload-too-large',
    });
    expect(harness.artifactRequests()).toBe(0);
  });

  it('keeps a committed install successful when the audit sink is unavailable', async () => {
    const harness = await createHarness({ auditFails: true });
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    expect((await harness.registry.read()).records[installed.key].status).toBe('candidate');
    expect(harness.auditErrors()).toBeGreaterThanOrEqual(3);
  });

  it('recovers an uninstall interrupted after moving installed bytes to trash', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    const modelRoot = path.join(harness.root, 'model-packs');
    const trashName = 'b'.repeat(64);
    const trashPath = path.join(modelRoot, '.trash', trashName);
    const transactionPath = path.join(modelRoot, '.transactions', `${'c'.repeat(64)}.json`);
    await rename(installed.installedPath!, trashPath);
    await writeFile(
      transactionPath,
      JSON.stringify({
        schemaVersion: 1,
        operation: 'uninstall',
        key: installed.key,
        destinationName: path.basename(installed.installedPath!),
        trashName,
      })
    );

    await harness.service.initialize();

    await expect(access(installed.installedPath!)).resolves.toBeUndefined();
    expect(await readdir(path.join(modelRoot, '.transactions'))).toHaveLength(0);
    expect(await readdir(path.join(modelRoot, '.trash'))).toHaveLength(0);
  });

  it('quarantines truncated and traversal journals without changing valid or outside data', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    const modelRoot = path.join(harness.root, 'model-packs');
    const outside = path.join(harness.root, 'outside-sentinel');
    await writeFile(outside, 'keep');
    await writeFile(path.join(modelRoot, '.transactions', `${'1'.repeat(64)}.json`), '{schemaVersion:1');
    await writeFile(
      path.join(modelRoot, '.transactions', `${'2'.repeat(64)}.json`),
      JSON.stringify({
        schemaVersion: 1,
        operation: 'install',
        key: 'com.tomny.core.security@9.9.9',
        destinationName: '../outside-sentinel',
      })
    );

    await harness.service.initialize();

    expect(await readdir(path.join(modelRoot, '.transaction-quarantine'))).toHaveLength(2);
    await expect(access(outside)).resolves.toBeUndefined();
    expect((await harness.registry.read()).records[installed.key].status).toBe('candidate');
  });

  it('quarantines an oversized journal without loading or applying it', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    const modelRoot = path.join(harness.root, 'model-packs');
    const oversizedKey = `com.tomny.core.security@${'x'.repeat(20 * 1024)}`;
    await writeFile(
      path.join(modelRoot, '.transactions', `${'3'.repeat(64)}.json`),
      JSON.stringify({
        schemaVersion: 1,
        operation: 'install',
        key: oversizedKey,
        destinationName: digest(Buffer.from(oversizedKey)),
      })
    );

    await harness.service.initialize();

    expect(await readdir(path.join(modelRoot, '.transaction-quarantine'))).toHaveLength(1);
    expect((await harness.registry.read()).records[installed.key].status).toBe('candidate');
  });

  it('fails closed when transaction quarantine reaches its entry quota', async () => {
    const harness = await createHarness({ maxTransactionQuarantineEntries: 1 });
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    const modelRoot = path.join(harness.root, 'model-packs');
    await writeFile(path.join(modelRoot, '.transactions', `${'4'.repeat(64)}.json`), '{');
    await writeFile(path.join(modelRoot, '.transactions', `${'5'.repeat(64)}.json`), '{');

    await expect(harness.service.initialize()).rejects.toMatchObject({ code: 'filesystem-error' });

    expect(await readdir(path.join(modelRoot, '.transaction-quarantine'))).toHaveLength(1);
    await expect(access(installed.installedPath!)).resolves.toBeUndefined();
  });

  it('quarantines an installed tree containing an undeclared directory', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    await mkdir(path.join(installed.installedPath!, 'undeclared-empty'));

    await harness.service.initialize();

    expect((await harness.registry.read()).records[installed.key]).toMatchObject({
      status: 'quarantined',
      quarantineReason: 'installed-artifact-integrity-failed',
    });
  });

  it('quarantines an unbound cleanup journal without deleting a valid installed pack', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    const modelRoot = path.join(harness.root, 'model-packs');
    const transactionPath = path.join(modelRoot, '.transactions', `${'f'.repeat(64)}.json`);
    await writeFile(
      transactionPath,
      JSON.stringify({
        schemaVersion: 1,
        operation: 'install',
        key: 'com.tomny.core.security@9.9.9',
        destinationName: path.basename(installed.installedPath!),
      })
    );

    await harness.service.initialize();

    expect(await readdir(path.join(modelRoot, '.transaction-quarantine'))).toHaveLength(1);
    await expect(access(installed.installedPath!)).resolves.toBeUndefined();
    expect((await harness.registry.read()).records[installed.key].status).toBe('candidate');
  });

  it('removes an orphan destination left by an install interrupted before registry commit', async () => {
    const harness = await createHarness();
    const modelRoot = path.join(harness.root, 'model-packs');
    const transactionKey = 'com.tomny.core.security@9.9.9';
    const destinationName = digest(Buffer.from(transactionKey));
    const destination = path.join(modelRoot, 'installed', destinationName);
    const transactionPath = path.join(modelRoot, '.transactions', `${'e'.repeat(64)}.json`);
    await mkdir(destination, { recursive: true });
    await writeFile(
      transactionPath,
      JSON.stringify({
        schemaVersion: 1,
        operation: 'install',
        key: transactionKey,
        destinationName,
      })
    );

    await harness.service.initialize();

    await expect(access(destination)).rejects.toBeDefined();
    expect(await readdir(path.join(modelRoot, '.transactions'))).toHaveLength(0);
  });

  it('serializes recovery behind an in-flight uninstall commit', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    const originalUnregister = harness.registry.unregister.bind(harness.registry);
    let markUnregisterStarted = (): void => undefined;
    let releaseUnregister = (): void => undefined;
    const unregisterStarted = new Promise<void>((resolve) => {
      markUnregisterStarted = resolve;
    });
    const unregisterGate = new Promise<void>((resolve) => {
      releaseUnregister = resolve;
    });
    vi.spyOn(harness.registry, 'unregister').mockImplementation(async (key, expectedRevision) => {
      markUnregisterStarted();
      await unregisterGate;
      return originalUnregister(key, expectedRevision);
    });

    const removal = harness.service.uninstall(installed.key);
    await unregisterStarted;
    const recovery = harness.service.initialize();
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseUnregister();
    await Promise.all([removal, recovery]);

    expect((await harness.registry.read()).records[installed.key]).toBeUndefined();
    await expect(access(installed.installedPath!)).rejects.toBeDefined();
    expect(await readdir(path.join(harness.root, 'model-packs', '.transactions'))).toHaveLength(0);
  });

  it('refuses to uninstall an active pack and preserves its installed bytes', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    let snapshot = await harness.registry.read();
    snapshot = await harness.registry.promote(
      installed.key,
      'shadow',
      snapshot.revision,
      promotionReceipt(installed.manifest, 'shadow')
    );
    snapshot = await harness.registry.promote(
      installed.key,
      'pilot',
      snapshot.revision,
      promotionReceipt(installed.manifest, 'pilot')
    );
    await harness.registry.promote(
      installed.key,
      'active',
      snapshot.revision,
      promotionReceipt(installed.manifest, 'active')
    );
    await expect(harness.service.uninstall(installed.key)).rejects.toMatchObject({ code: 'pack-active' });
    await expect(access(installed.installedPath!)).resolves.toBeUndefined();
  });

  it('uninstalls a non-active candidate and removes registry and bytes', async () => {
    const harness = await createHarness();
    const installed = await harness.service.install('com.tomny.core.security', '0.1.0');
    await harness.service.uninstall(installed.key);
    expect((await harness.registry.read()).records[installed.key]).toBeUndefined();
    await expect(access(installed.installedPath!)).rejects.toBeDefined();
    expect(harness.receipts.at(-1)).toMatchObject({ operation: 'uninstall', status: 'succeeded' });
  });
});
