import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Ed25519ModelCatalogTrustVerifier,
  modelCatalogSignedPayload,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelCatalogTrustVerifier';
import type { ModelCatalogTrustMetadata } from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelPackTypes';
import { DurableModelPackCatalogCache } from '../../../../packages/desktop/src/process/experimentalCore/catalog/model-pack-service/durableCatalogCache';
import { createModelPackBackend } from '../../../../packages/desktop/src/process/experimentalCore/catalog/model-pack-service/factory';
import { HashChainModelPackAuditSink } from '../../../../packages/desktop/src/process/experimentalCore/catalog/model-pack-service/hashChainAuditSink';
import type { ModelPackAuditReceipt } from '../../../../packages/desktop/src/process/experimentalCore/catalog/model-pack-service/types';

const roots: string[] = [];
const keys = generateKeyPairSync('ed25519');
const verifier = () => new Ed25519ModelCatalogTrustVerifier({ trustedKeys: { root: keys.publicKey } });

const signedCatalog = (revision: number, expiresAt = '2099-01-01T00:00:00Z') => {
  const catalogBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, revision, entries: [] }), 'utf8');
  const metadata: ModelCatalogTrustMetadata = {
    schemaVersion: 1,
    revision,
    version: String(revision),
    expiresAt,
    sha256: createHash('sha256').update(catalogBytes).digest('hex'),
    keyId: 'root',
  };
  metadata.signature = sign(null, modelCatalogSignedPayload(metadata), keys.privateKey).toString('base64');
  return { metadata, metadataBytes: Buffer.from(JSON.stringify(metadata), 'utf8'), catalogBytes };
};

const decodeRevision = async (file: string): Promise<number> => {
  const envelope = JSON.parse(await readFile(file, 'utf8')) as { metadataBase64: string };
  const metadata = JSON.parse(Buffer.from(envelope.metadataBase64, 'base64').toString('utf8')) as { revision: number };
  return metadata.revision;
};

const receipt = (subject = 'catalog'): ModelPackAuditReceipt => ({
  receiptId: `receipt-${subject}`,
  operation: 'catalog-refresh',
  subject,
  status: 'succeeded',
  startedAt: '2026-07-26T00:00:00.000Z',
  finishedAt: '2026-07-26T00:00:01.000Z',
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'tomny-model-persistence-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('durable Model Pack catalog cache', () => {
  it('recovers corrupt active bytes from the same-revision previous copy', async () => {
    const root = await temporaryRoot();
    const cache = new DurableModelPackCatalogCache({ directory: root, trustVerifier: verifier() });
    const revision = signedCatalog(2);
    await cache.store(revision.metadataBytes, revision.catalogBytes);
    await writeFile(path.join(root, 'active.json'), '{corrupt');

    const loaded = await cache.load();

    expect(loaded.catalogBytes).toEqual(revision.catalogBytes);
    expect(await decodeRevision(path.join(root, 'previous.json'))).toBe(2);
  });

  it('falls back to the old previous revision when active was written before the highest marker', async () => {
    const root = await temporaryRoot();
    const stagedRoot = await temporaryRoot();
    const cache = new DurableModelPackCatalogCache({ directory: root, trustVerifier: verifier() });
    const staged = new DurableModelPackCatalogCache({ directory: stagedRoot, trustVerifier: verifier() });
    const first = signedCatalog(1);
    const second = signedCatalog(2);
    await cache.store(first.metadataBytes, first.catalogBytes);
    await staged.store(second.metadataBytes, second.catalogBytes);
    await writeFile(path.join(root, 'active.json'), await readFile(path.join(stagedRoot, 'active.json')));
    expect(await decodeRevision(path.join(root, 'active.json'))).toBe(2);
    expect(await decodeRevision(path.join(root, 'previous.json'))).toBe(1);

    const loaded = await cache.load();

    expect(JSON.parse(loaded.catalogBytes.toString('utf8'))).toMatchObject({ revision: 1 });
  });

  it('uses new active after highest marker commit even when previous still has the old revision', async () => {
    const root = await temporaryRoot();
    const stagedRoot = await temporaryRoot();
    const cache = new DurableModelPackCatalogCache({ directory: root, trustVerifier: verifier() });
    const staged = new DurableModelPackCatalogCache({ directory: stagedRoot, trustVerifier: verifier() });
    const first = signedCatalog(1);
    const second = signedCatalog(2);
    await cache.store(first.metadataBytes, first.catalogBytes);
    await staged.store(second.metadataBytes, second.catalogBytes);
    await writeFile(path.join(root, 'active.json'), await readFile(path.join(stagedRoot, 'active.json')));
    await writeFile(path.join(root, 'highest-seen.json'), await readFile(path.join(stagedRoot, 'highest-seen.json')));
    expect(await decodeRevision(path.join(root, 'previous.json'))).toBe(1);

    const loaded = await cache.load();

    expect(JSON.parse(loaded.catalogBytes.toString('utf8'))).toMatchObject({ revision: 2 });
  });

  it('rejects offline cache beyond max-age and metadata expiry', async () => {
    const root = await temporaryRoot();
    let now = new Date('2026-07-26T00:00:00.000Z');
    const cache = new DurableModelPackCatalogCache({
      directory: root,
      trustVerifier: verifier(),
      offlineMaxAgeMs: 1_000,
      now: () => now,
    });
    const fresh = signedCatalog(1, '2026-07-26T00:00:10.000Z');
    await cache.store(fresh.metadataBytes, fresh.catalogBytes);
    now = new Date('2026-07-26T00:00:02.000Z');
    await expect(cache.load()).rejects.toMatchObject({ code: 'cache-unavailable' });

    const expiryRoot = await temporaryRoot();
    now = new Date('2026-07-26T00:00:00.000Z');
    const expiryCache = new DurableModelPackCatalogCache({
      directory: expiryRoot,
      trustVerifier: verifier(),
      offlineMaxAgeMs: 10_000,
      now: () => now,
    });
    const expiring = signedCatalog(1, '2026-07-26T00:00:01.000Z');
    await expiryCache.store(expiring.metadataBytes, expiring.catalogBytes);
    now = new Date('2026-07-26T00:00:02.000Z');
    await expect(expiryCache.load()).rejects.toMatchObject({ code: 'cache-unavailable' });
  });

  it('rejects a rollback and forged self-consistent metadata', async () => {
    const root = await temporaryRoot();
    const cache = new DurableModelPackCatalogCache({ directory: root, trustVerifier: verifier() });
    const second = signedCatalog(2);
    const first = signedCatalog(1);
    await cache.store(second.metadataBytes, second.catalogBytes);
    await expect(cache.store(first.metadataBytes, first.catalogBytes)).rejects.toMatchObject({ code: 'cache-stale' });

    const forgedCatalog = Buffer.from(JSON.stringify({ schemaVersion: 1, revision: 3, entries: [] }, null, 2));
    const forged = {
      ...signedCatalog(3).metadata,
      sha256: createHash('sha256').update(forgedCatalog).digest('hex'),
    };
    await expect(cache.store(Buffer.from(JSON.stringify(forged)), forgedCatalog)).rejects.toMatchObject({
      code: 'catalog-tampered',
    });
  });
});

describe('append-only Model Pack audit chain', () => {
  it('propagates append failures', async () => {
    const root = await temporaryRoot();
    const auditPath = path.join(root, 'audit-as-directory');
    await mkdir(auditPath);
    const sink = new HashChainModelPackAuditSink({ auditPath });
    await expect(sink.append(receipt())).rejects.toBeDefined();
  });

  it('detects receipt tampering in the hash chain', async () => {
    const root = await temporaryRoot();
    const auditPath = path.join(root, 'audit.jsonl');
    const sink = new HashChainModelPackAuditSink({ auditPath });
    await sink.append(receipt('first'));
    await sink.append(receipt('second'));
    const tampered = (await readFile(auditPath, 'utf8')).replace('first', 'other');
    await writeFile(auditPath, tampered);

    await expect(sink.verify()).rejects.toMatchObject({ code: 'audit-tampered' });
  });
});

describe('Model Pack backend factory boundary', () => {
  it('rejects relative and filesystem-root userData paths', () => {
    const common = {
      source: {
        metadataUrl: 'https://catalog.example.com/metadata.json',
        catalogUrl: 'https://catalog.example.com/catalog.json',
      },
      trustedOrigins: ['https://catalog.example.com'],
      trustedKeys: { root: keys.publicKey },
      expectedBases: {},
    };
    expect(() => createModelPackBackend({ ...common, userDataPath: 'relative/user-data' })).toThrowError();
    expect(() => createModelPackBackend({ ...common, userDataPath: path.parse(process.cwd()).root })).toThrowError();
  });

  it('keeps every persistence path below injected Electron userData', async () => {
    const root = await temporaryRoot();
    const backend = createModelPackBackend({
      userDataPath: root,
      source: {
        metadataUrl: 'https://catalog.example.com/metadata.json',
        catalogUrl: 'https://catalog.example.com/catalog.json',
      },
      trustedOrigins: ['https://catalog.example.com'],
      trustedKeys: { root: keys.publicKey },
      expectedBases: {},
    });
    expect(path.relative(root, backend.storageRoot)).not.toMatch(/^\.\./u);
    await backend.service.initialize();
    await expect(backend.auditSink.verify()).resolves.toMatchObject({ entries: 1 });
  });
});
