import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptyModelRegistry,
  FileModelRegistryPersistence,
  InMemoryModelRegistryPersistence,
  ModelRegistryStore,
  type ModelCatalogTrustVerifier,
  type ModelPromotionGateVerifier,
  type ModelRegistryPersistence,
} from '../../../packages/desktop/src/process/experimentalCore/catalog/modelRegistryStore';
import { modelPackManifestSha256 } from '../../../packages/desktop/src/process/experimentalCore/catalog/modelPackManifest';
import type {
  ModelPackManifest,
  ModelPromotionGateReceipt,
  ModelPromotionTarget,
} from '../../../packages/desktop/src/process/experimentalCore/catalog/modelPackTypes';

const sha = 'a'.repeat(64);
const signatureTrustVerifier: ModelCatalogTrustVerifier = {
  verify: async (metadata) =>
    metadata.signature === 'valid-signature' && metadata.keyId === 'root'
      ? { trusted: true, method: 'signature', keyId: 'root' }
      : { trusted: false, reason: 'signature verification failed' },
};
const pinnedDigestTrustVerifier: ModelCatalogTrustVerifier = {
  verify: async (metadata) => ({ trusted: true, method: 'pinned-digest', sha256: metadata.sha256 }),
};

const temporaryDirectories: string[] = [];

const manifest = (version: string): ModelPackManifest => ({
  schemaVersion: 1,
  kind: 'model-adapter',
  id: 'com.tomny.core.orchestrator',
  version,
  purpose: 'orchestrator',
  format: 'peft-lora-safetensors',
  baseModel: { id: 'Qwen/Qwen3.5-2B', revision: 'immutable-r1', sha256: sha },
  runtime: {
    engine: 'transformers-peft',
    peft: '>=0.18.1 <0.19.0',
    transformers: '>=5.5.0 <5.6.0',
    minTomnyVersion: '0.0.0',
  },
  contracts: {
    inputSchema: 'tomny.orchestrator.input.v1',
    outputSchema: 'tomny.orchestrator.output.v1',
    policyVersion: 'core-policy-v1',
  },
  files: [
    { path: 'adapter_model.safetensors', size: 1, sha256: version.startsWith('0.1') ? sha : 'b'.repeat(64) },
    { path: 'adapter_config.json', size: 1, sha256: sha },
  ],
  training: {
    datasetManifestSha256: sha,
    recipeSha256: sha,
    seed: 1,
    provenanceSha256: sha,
  },
  evaluation: { reportSha256: sha, benchmarkVersion: 'tomny-core-v2', status: 'candidate' },
  license: 'Apache-2.0',
  createdAt: '2026-07-25T10:00:00Z',
});

const promotionReceipt = (
  candidate: ModelPackManifest,
  target: ModelPromotionTarget,
  approvedAt = new Date().toISOString()
): ModelPromotionGateReceipt => ({
  schemaVersion: 1,
  target,
  candidate: {
    id: candidate.id,
    version: candidate.version,
    purpose: candidate.purpose,
    manifestSha256: modelPackManifestSha256(candidate),
  },
  verification: {
    verified: true,
    reportSha256: sha,
    provenanceSha256: candidate.training.provenanceSha256,
  },
  benchmark: {
    postTrainingReportSha256: sha,
    reportSha256: candidate.evaluation.reportSha256,
    confidenceGatePassed: true,
    candidateOnly: true,
    promotionAllowed: false,
  },
  humanApproval: {
    approvalId: `review-${candidate.version}-${target}`,
    approvalSha256: sha,
    approvedAt,
    approvedFor: target,
  },
});

const approvedPromotionGateVerifier: ModelPromotionGateVerifier = {
  verify: async () => ({ approved: true }),
};

const createPromotionReadyStore = (
  persistence: InMemoryModelRegistryPersistence = new InMemoryModelRegistryPersistence()
): ModelRegistryStore => new ModelRegistryStore(persistence, undefined, undefined, approvedPromotionGateVerifier);

const activate = async (
  store: ModelRegistryStore,
  candidate: ModelPackManifest,
  approvedAt?: string
): Promise<string> => {
  let snapshot = await store.read();
  snapshot = await store.registerCandidate(candidate, '/models/candidate', snapshot.revision);
  const key = Object.values(snapshot.records).find((record) => record.manifest.version === candidate.version)!.key;
  snapshot = await store.promote(key, 'shadow', snapshot.revision, promotionReceipt(candidate, 'shadow', approvedAt));
  snapshot = await store.promote(key, 'pilot', snapshot.revision, promotionReceipt(candidate, 'pilot', approvedAt));
  await store.promote(key, 'active', snapshot.revision, promotionReceipt(candidate, 'active', approvedAt));
  return key;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Model Registry lifecycle', () => {
  it('allows only one concurrent writer for an expected revision', async () => {
    const persistence = new InMemoryModelRegistryPersistence();
    const first = new ModelRegistryStore(persistence);
    const second = new ModelRegistryStore(persistence);
    const results = await Promise.allSettled([
      first.registerCandidate(manifest('0.1.0'), '/models/a', 0),
      second.registerCandidate(manifest('0.2.0'), '/models/b', 0),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('rejects rebinding one adapter key to different manifest fields or an install path', async () => {
    const store = new ModelRegistryStore(new InMemoryModelRegistryPersistence());
    const candidate = manifest('0.1.0');
    const registered = await store.registerCandidate(candidate, '/models/a', 0);
    await expect(store.registerCandidate(candidate, '/models/a', registered.revision)).resolves.toEqual(registered);
    const conflictingBaseModel: ModelPackManifest = {
      ...candidate,
      baseModel: { ...candidate.baseModel, revision: 'immutable-r2' },
    };

    await expect(store.registerCandidate(conflictingBaseModel, '/models/a', registered.revision)).rejects.toMatchObject(
      { code: 'immutable-version-conflict' }
    );
    await expect(store.registerCandidate(candidate, '/models/b', registered.revision)).rejects.toMatchObject({
      code: 'immutable-version-conflict',
    });
  });

  it('rejects skipping quality gates during promotion', async () => {
    const store = new ModelRegistryStore(new InMemoryModelRegistryPersistence());
    const candidate = manifest('0.1.0');
    const registered = await store.registerCandidate(candidate, '/models/a', 0);
    const key = Object.keys(registered.records)[0];
    await expect(
      store.promote(key, 'active', registered.revision, promotionReceipt(candidate, 'active'))
    ).rejects.toMatchObject({
      code: 'invalid-transition',
    });
  });

  it('fails closed when a candidate has no trusted promotion verifier', async () => {
    const store = new ModelRegistryStore(new InMemoryModelRegistryPersistence());
    const candidate = manifest('0.1.0');
    const registered = await store.registerCandidate(candidate, '/models/a', 0);
    const key = Object.keys(registered.records)[0];
    await expect(
      store.promote(key, 'shadow', registered.revision, promotionReceipt(candidate, 'shadow'))
    ).rejects.toMatchObject({
      code: 'promotion-gate-required',
    });
  });

  it('rejects an otherwise valid receipt when trusted verification refuses it', async () => {
    const rejectingVerifier: ModelPromotionGateVerifier = {
      verify: async () => ({ approved: false, reason: 'review signature revoked' }),
    };
    const store = new ModelRegistryStore(
      new InMemoryModelRegistryPersistence(),
      undefined,
      undefined,
      rejectingVerifier
    );
    const candidate = manifest('0.1.0');
    const registered = await store.registerCandidate(candidate, '/models/a', 0);
    const key = Object.keys(registered.records)[0];
    await expect(
      store.promote(key, 'shadow', registered.revision, promotionReceipt(candidate, 'shadow'))
    ).rejects.toMatchObject({
      code: 'promotion-gate-rejected',
    });
  });

  it('rejects a future-dated receipt before the trusted verifier can approve it', async () => {
    const verifier: ModelPromotionGateVerifier = { verify: async () => ({ approved: true }) };
    const store = new ModelRegistryStore(
      new InMemoryModelRegistryPersistence(),
      () => new Date('2026-07-25T12:00:00Z'),
      undefined,
      verifier
    );
    const candidate = manifest('0.1.0');
    const registered = await store.registerCandidate(candidate, '/models/a', 0);
    const key = Object.keys(registered.records)[0];

    await expect(
      store.promote(key, 'shadow', registered.revision, promotionReceipt(candidate, 'shadow', '2026-07-26T12:00:00Z'))
    ).rejects.toMatchObject({ code: 'promotion-gate-invalid' });
  });

  it('rejects reuse of one approval id for a different candidate', async () => {
    const store = createPromotionReadyStore();
    const firstCandidate = manifest('0.1.0');
    let snapshot = await store.registerCandidate(firstCandidate, '/models/a', 0);
    const firstKey = Object.keys(snapshot.records)[0];
    const firstReceipt = promotionReceipt(firstCandidate, 'shadow');
    snapshot = await store.promote(firstKey, 'shadow', snapshot.revision, firstReceipt);

    const secondCandidate = manifest('0.2.0');
    snapshot = await store.registerCandidate(secondCandidate, '/models/b', snapshot.revision);
    const secondKey = Object.values(snapshot.records).find((record) => record.manifest.version === '0.2.0')!.key;
    const replayedApproval = promotionReceipt(secondCandidate, 'shadow');
    replayedApproval.humanApproval.approvalId = firstReceipt.humanApproval.approvalId;

    await expect(store.promote(secondKey, 'shadow', snapshot.revision, replayedApproval)).rejects.toMatchObject({
      code: 'promotion-gate-invalid',
    });
  });

  it('retains reviewed candidates so approval ids cannot be reused after removal and reinstall', async () => {
    const store = createPromotionReadyStore();
    const candidate = manifest('0.1.0');
    let snapshot = await store.registerCandidate(candidate, '/models/a', 0);
    const key = Object.keys(snapshot.records)[0];
    snapshot = await store.promote(key, 'shadow', snapshot.revision, promotionReceipt(candidate, 'shadow'));

    await expect(store.unregister(key, snapshot.revision)).rejects.toMatchObject({ code: 'record-in-use' });
  });

  it('persists exactly one concurrent promotion for the same revision', async () => {
    const store = createPromotionReadyStore();
    const candidate = manifest('0.1.0');
    const registered = await store.registerCandidate(candidate, '/models/a', 0);
    const key = Object.keys(registered.records)[0];
    const receipt = promotionReceipt(candidate, 'shadow');

    const results = await Promise.allSettled([
      store.promote(key, 'shadow', registered.revision, receipt),
      store.promote(key, 'shadow', registered.revision, receipt),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await store.read()).records[key]).toMatchObject({
      status: 'shadow',
      promotionReceipts: { shadow: receipt },
    });
  });

  it('does not activate a candidate when durable promotion persistence fails', async () => {
    const durable = new InMemoryModelRegistryPersistence();
    const setup = createPromotionReadyStore(durable);
    const candidate = manifest('0.1.0');
    let snapshot = await setup.registerCandidate(candidate, '/models/a', 0);
    const key = Object.keys(snapshot.records)[0];
    snapshot = await setup.promote(key, 'shadow', snapshot.revision, promotionReceipt(candidate, 'shadow'));
    snapshot = await setup.promote(key, 'pilot', snapshot.revision, promotionReceipt(candidate, 'pilot'));
    const failingPersistence: ModelRegistryPersistence = {
      read: () => durable.read(),
      compareAndSwap: async () => {
        throw new Error('durable write failed');
      },
    };
    const store = new ModelRegistryStore(failingPersistence, undefined, undefined, approvedPromotionGateVerifier);

    await expect(
      store.promote(key, 'active', snapshot.revision, promotionReceipt(candidate, 'active'))
    ).rejects.toThrow('durable write failed');
    const afterFailure = await durable.read();
    expect(afterFailure.records[key]).toMatchObject({ status: 'pilot' });
    expect(afterFailure.activeByPurpose.orchestrator).toBeUndefined();
  });

  it('persists an approved receipt at every promotion boundary', async () => {
    const store = createPromotionReadyStore();
    const candidate = manifest('0.1.0');
    let snapshot = await store.registerCandidate(candidate, '/models/a', 0);
    const key = Object.keys(snapshot.records)[0];
    snapshot = await store.promote(key, 'shadow', snapshot.revision, promotionReceipt(candidate, 'shadow'));
    snapshot = await store.promote(key, 'pilot', snapshot.revision, promotionReceipt(candidate, 'pilot'));
    snapshot = await store.promote(key, 'active', snapshot.revision, promotionReceipt(candidate, 'active'));
    expect(Object.keys(snapshot.records[key].promotionReceipts ?? {}).sort()).toEqual(['active', 'pilot', 'shadow']);
    expect(await store.getActive('orchestrator')).toMatchObject({ key, status: 'active' });
  });

  it('does not expose a persisted active model after its runtime promotion gate is absent or revoked', async () => {
    const persistence = new InMemoryModelRegistryPersistence();
    const candidate = manifest('0.1.0');
    await activate(createPromotionReadyStore(persistence), candidate);

    const withoutRuntimeGate = new ModelRegistryStore(persistence);
    expect(await withoutRuntimeGate.getActive('orchestrator')).toBeUndefined();

    const revokedRuntimeGate: ModelPromotionGateVerifier = {
      verify: async () => ({ approved: false, reason: 'approval revoked' }),
    };
    const revoked = new ModelRegistryStore(persistence, undefined, undefined, revokedRuntimeGate);
    expect(await revoked.getActive('orchestrator')).toBeUndefined();
  });

  it('does not expose persisted approvals after a large forward or backward clock change', async () => {
    const persistence = new InMemoryModelRegistryPersistence();
    const candidate = manifest('0.1.0');
    await activate(
      new ModelRegistryStore(
        persistence,
        () => new Date('2026-07-25T12:00:00Z'),
        undefined,
        approvedPromotionGateVerifier
      ),
      candidate,
      '2026-07-25T12:00:00Z'
    );

    const beforeApproval = new ModelRegistryStore(
      persistence,
      () => new Date('2026-07-24T12:00:00Z'),
      undefined,
      approvedPromotionGateVerifier
    );
    const afterExpiry = new ModelRegistryStore(
      persistence,
      () => new Date('2026-09-01T12:00:00Z'),
      undefined,
      approvedPromotionGateVerifier
    );

    await expect(beforeApproval.getActive('orchestrator')).resolves.toBeUndefined();
    await expect(afterExpiry.getActive('orchestrator')).resolves.toBeUndefined();
  });

  it('quarantines a failing active adapter and restores previous active', async () => {
    const store = createPromotionReadyStore();
    const previousKey = await activate(store, manifest('0.1.0'));
    const failingKey = await activate(store, manifest('0.2.0'));
    const current = await store.read();
    const recovered = await store.quarantine(failingKey, 'schema regression', current.revision);
    expect(recovered.activeByPurpose.orchestrator).toBe(previousKey);
    expect(recovered.records[failingKey].status).toBe('quarantined');
  });

  it('rolls back atomically and retains the replaced adapter as the next rollback target', async () => {
    const store = createPromotionReadyStore();
    const firstKey = await activate(store, manifest('0.1.0'));
    const secondKey = await activate(store, manifest('0.2.0'));
    const current = await store.read();
    const rolledBack = await store.rollback('orchestrator', current.revision);
    expect(rolledBack.activeByPurpose.orchestrator).toBe(firstKey);
    expect(rolledBack.previousActiveByPurpose.orchestrator).toBe(secondKey);
  });

  it('rejects a forged signature when no cryptographic verifier is injected', async () => {
    const store = new ModelRegistryStore(new InMemoryModelRegistryPersistence());
    await expect(
      store.acceptCatalog(
        {
          schemaVersion: 1,
          revision: 1,
          version: '1',
          expiresAt: '2099-01-01T00:00:00Z',
          sha256: sha,
          signature: 'looks-non-empty',
          keyId: 'root',
        },
        0
      )
    ).rejects.toMatchObject({ code: 'catalog-trust-invalid' });
  });

  it('rejects a signature result that is not bound to the declared key id', async () => {
    const verifier: ModelCatalogTrustVerifier = {
      verify: async () => ({ trusted: true, method: 'signature', keyId: 'root' }),
    };
    const store = new ModelRegistryStore(
      new InMemoryModelRegistryPersistence(),
      () => new Date('2026-07-25T12:00:00Z'),
      verifier
    );
    await expect(
      store.acceptCatalog(
        {
          schemaVersion: 1,
          revision: 1,
          version: '1',
          expiresAt: '2026-07-26T12:00:00Z',
          sha256: sha,
          signature: 'forged',
          keyId: 'attacker-key',
        },
        0
      )
    ).rejects.toMatchObject({ code: 'catalog-trust-invalid' });
  });

  it('accepts a catalog digest only after a pinned-digest verifier confirms it', async () => {
    const store = new ModelRegistryStore(
      new InMemoryModelRegistryPersistence(),
      () => new Date('2026-07-25T12:00:00Z'),
      pinnedDigestTrustVerifier
    );
    const accepted = await store.acceptCatalog(
      { schemaVersion: 1, revision: 1, version: '1', expiresAt: '2026-07-26T12:00:00Z', sha256: sha },
      0
    );
    expect(accepted.trustedCatalogSha256).toBe(sha);
  });

  it('rejects expired and lower catalog revisions', async () => {
    const store = new ModelRegistryStore(
      new InMemoryModelRegistryPersistence(),
      () => new Date('2026-07-25T12:00:00Z'),
      signatureTrustVerifier
    );
    await expect(
      store.acceptCatalog(
        {
          schemaVersion: 1,
          revision: 1,
          version: '1',
          expiresAt: '2026-07-25T11:00:00Z',
          sha256: sha,
          signature: 'valid-signature',
          keyId: 'root',
        },
        0
      )
    ).rejects.toMatchObject({ code: 'catalog-freeze' });
    const accepted = await store.acceptCatalog(
      {
        schemaVersion: 1,
        revision: 2,
        version: '2',
        expiresAt: '2026-07-26T12:00:00Z',
        sha256: sha,
        signature: 'valid-signature',
        keyId: 'root',
      },
      0
    );
    await expect(
      store.acceptCatalog(
        {
          schemaVersion: 1,
          revision: 1,
          version: '1',
          expiresAt: '2026-07-26T12:00:00Z',
          sha256: sha,
          signature: 'valid-signature',
          keyId: 'root',
        },
        accepted.revision
      )
    ).rejects.toMatchObject({ code: 'catalog-rollback' });
  });

  it('rejects a persisted active pointer whose record is no longer active', async () => {
    const store = createPromotionReadyStore();
    const key = await activate(store, manifest('0.1.0'));
    const snapshot = await store.read();
    snapshot.records[key].status = 'candidate';
    expect(() => new InMemoryModelRegistryPersistence(snapshot)).toThrowError(
      expect.objectContaining({ code: 'corrupt-registry' })
    );
  });

  it('rejects a persisted active record without immutable promotion evidence', async () => {
    const store = createPromotionReadyStore();
    const key = await activate(store, manifest('0.1.0'));
    const snapshot = await store.read();
    delete snapshot.records[key].promotionReceipts;
    expect(() => new InMemoryModelRegistryPersistence(snapshot)).toThrowError(
      expect.objectContaining({ code: 'corrupt-registry' })
    );
  });

  it('rejects a persisted record whose dictionary key is forged', async () => {
    const store = createPromotionReadyStore();
    const key = await activate(store, manifest('0.1.0'));
    const snapshot = await store.read();
    snapshot.records.forged = snapshot.records[key];
    delete snapshot.records[key];
    expect(() => new InMemoryModelRegistryPersistence(snapshot)).toThrowError(
      expect.objectContaining({ code: 'corrupt-registry' })
    );
  });

  it('rejects a persisted record with a malformed Model Pack manifest', async () => {
    const store = createPromotionReadyStore();
    const key = await activate(store, manifest('0.1.0'));
    const snapshot = await store.read();
    (snapshot.records[key].manifest as ModelPackManifest & { format: string }).format = 'pickle';
    expect(() => new InMemoryModelRegistryPersistence(snapshot)).toThrowError(
      expect.objectContaining({ code: 'corrupt-registry' })
    );
  });

  it('does not replay approval evidence after a durable manifest changes across restart', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-model-registry-'));
    temporaryDirectories.push(directory);
    const registryPath = path.join(directory, 'registry.json');
    const store = new ModelRegistryStore(
      new FileModelRegistryPersistence(registryPath),
      undefined,
      undefined,
      approvedPromotionGateVerifier
    );
    const key = await activate(store, manifest('0.1.0'));
    const tampered = await store.read();
    tampered.records[key].manifest = {
      ...tampered.records[key].manifest,
      baseModel: { ...tampered.records[key].manifest.baseModel, revision: 'immutable-r2' },
      runtime: { ...tampered.records[key].manifest.runtime, peft: '>=0.18.2 <0.19.0' },
    };
    await writeFile(registryPath, JSON.stringify(tampered), 'utf8');

    const restarted = new ModelRegistryStore(
      new FileModelRegistryPersistence(registryPath),
      undefined,
      undefined,
      approvedPromotionGateVerifier
    );

    await expect(restarted.getActive('orchestrator')).resolves.toBeUndefined();
  });

  it('rejects malformed persisted catalog digests', () => {
    const snapshot = {
      ...createEmptyModelRegistry(),
      highestSeenCatalogRevision: 1,
      trustedCatalogSha256: 'not-a-sha256',
    };
    expect(() => new InMemoryModelRegistryPersistence(snapshot)).toThrowError(
      expect.objectContaining({ code: 'corrupt-registry' })
    );
  });

  it('recovers the previous complete revision when the active file is corrupt', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-model-registry-'));
    temporaryDirectories.push(directory);
    const registryPath = path.join(directory, 'registry.json');
    const persistence = new FileModelRegistryPersistence(registryPath);
    const store = new ModelRegistryStore(persistence, () => new Date(), signatureTrustVerifier);
    let snapshot = await store.acceptCatalog(
      {
        schemaVersion: 1,
        revision: 1,
        version: '1',
        expiresAt: '2099-01-01T00:00:00Z',
        sha256: sha,
        signature: 'valid-signature',
        keyId: 'root',
      },
      0
    );
    snapshot = await store.acceptCatalog(
      {
        schemaVersion: 1,
        revision: 2,
        version: '2',
        expiresAt: '2099-01-01T00:00:00Z',
        sha256: 'b'.repeat(64),
        signature: 'valid-signature',
        keyId: 'root',
      },
      snapshot.revision
    );
    await writeFile(registryPath, '{crashed');
    const recovered = await persistence.read();
    expect(recovered.highestSeenCatalogRevision).toBe(1);
    expect(recovered.revision).toBe(snapshot.revision - 1);
  });
});
