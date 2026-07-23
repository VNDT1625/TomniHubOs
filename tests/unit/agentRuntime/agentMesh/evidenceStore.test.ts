import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JsonEvidenceStore } from '@process/agentRuntime/agentMesh/evidenceStore';
import type { EvidenceClaim, EvidenceSummary } from '@process/agentRuntime/agentMesh/research';

const temporaryDirectories: string[] = [];

const temporaryStore = async (): Promise<{ directory: string; store: JsonEvidenceStore }> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tomny-evidence-'));
  temporaryDirectories.push(directory);
  return { directory, store: new JsonEvidenceStore(directory) };
};

const archiveSource = (store: JsonEvidenceStore, id = 'source-a', rawContent = 'Original source evidence.') =>
  store.archiveSource({
    id,
    title: `Source ${id}`,
    kind: 'web',
    accessMethod: 'http',
    rawContent,
    retrievedAt: '2026-07-18T00:00:00.000Z',
    url: `https://example.test/${id}`,
    primary: true,
  });

const evidenceClaim = (overrides: Partial<EvidenceClaim> = {}): EvidenceClaim => ({
  id: 'claim-a',
  sectionId: 'architecture',
  text: 'A claim tied to the archived source.',
  importance: 'important',
  references: [{ sourceId: 'source-a', chunkId: 'chunk-a', locator: 'p. 1', relation: 'supports' }],
  verification: { status: 'supported', checkedAt: '2026-07-18T00:00:00.000Z' },
  ...overrides,
});

const evidenceSummary = (overrides: Partial<EvidenceSummary> = {}): EvidenceSummary => ({
  id: 'summary-a',
  scope: 'section',
  scopeId: 'architecture',
  sourceIds: ['source-a'],
  claimIds: ['claim-a'],
  text: 'A synthesis that links back to original evidence.',
  createdAt: '2026-07-18T00:00:00.000Z',
  ...overrides,
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('JsonEvidenceStore source archive', () => {
  it('persists the unmodified raw source beside its content-addressed metadata', async () => {
    const { directory, store } = await temporaryStore();
    const snapshot = await archiveSource(store, 'source-a', 'Raw evidence\nwith exact formatting.');

    expect(await readFile(path.join(directory, snapshot.rawArtifactPath), 'utf8')).toBe(
      'Raw evidence\nwith exact formatting.'
    );
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await store.read()).sources).toEqual([snapshot]);
  });

  it('returns the same snapshot for an idempotent retry but rejects changed content under the same id', async () => {
    const { store } = await temporaryStore();
    const first = await archiveSource(store);

    await expect(archiveSource(store)).resolves.toEqual(first);
    await expect(archiveSource(store, 'source-a', 'Different source body.')).rejects.toThrow(/different content/i);
  });

  it('rejects unsafe ids before they can escape the source directory', async () => {
    const { store } = await temporaryStore();

    await expect(archiveSource(store, '../outside')).rejects.toThrow(/unsafe evidence id/i);
  });

  it('rejects an empty raw source instead of archiving unverifiable metadata', async () => {
    const { store } = await temporaryStore();

    await expect(archiveSource(store, 'source-a', '   ')).rejects.toThrow(/raw source content cannot be empty/i);
  });
});

describe('JsonEvidenceStore provenance graph', () => {
  it('retains source-to-chunk, claim-to-citation and summary-to-original backlinks', async () => {
    const { store } = await temporaryStore();
    await archiveSource(store);
    await store.addChunk({
      id: 'chunk-a',
      sourceId: 'source-a',
      locator: 'p. 1',
      contentHash: 'chunk-a-hash',
      excerpt: 'Original evidence excerpt.',
    });
    await store.addClaim(evidenceClaim());
    await store.addSummary(evidenceSummary());

    const persisted = await store.read();
    expect(persisted.chunks[0]).toMatchObject({ id: 'chunk-a', sourceId: 'source-a' });
    expect(persisted.claims[0]?.references).toEqual([
      { sourceId: 'source-a', chunkId: 'chunk-a', locator: 'p. 1', relation: 'supports' },
    ]);
    expect(persisted.summaries[0]).toMatchObject({ sourceIds: ['source-a'], claimIds: ['claim-a'] });
  });

  it('rejects a chunk when its original source was never archived', async () => {
    const { store } = await temporaryStore();

    await expect(
      store.addChunk({
        id: 'chunk-a',
        sourceId: 'missing-source',
        locator: 'p. 1',
        contentHash: 'chunk-a-hash',
        excerpt: 'Detached evidence.',
      })
    ).rejects.toThrow(/missing its original source/i);
  });

  it('rejects claims and summaries with no original-source provenance', async () => {
    const { store } = await temporaryStore();

    await expect(store.addClaim(evidenceClaim({ references: [] }))).rejects.toThrow(
      /missing original-source provenance/i
    );
    await expect(store.addSummary(evidenceSummary({ sourceIds: [] }))).rejects.toThrow(
      /missing original-source provenance/i
    );
  });

  it('rejects dangling claim citations instead of accepting a non-existent chunk', async () => {
    const { store } = await temporaryStore();
    await archiveSource(store);

    await expect(store.addClaim(evidenceClaim())).rejects.toThrow(/missing|unknown|provenance/i);
  });

  it('persists cross-section contradictions as source-backed reconciliation records', async () => {
    const { store } = await temporaryStore();
    await archiveSource(store);
    await archiveSource(store, 'source-b', 'Independent source evidence.');
    await store.addChunk({
      id: 'chunk-a',
      sourceId: 'source-a',
      locator: 'p. 1',
      contentHash: 'chunk-a-hash',
      excerpt: 'Original evidence excerpt.',
    });
    await store.addChunk({
      id: 'chunk-b',
      sourceId: 'source-b',
      locator: 'p. 2',
      contentHash: 'chunk-b-hash',
      excerpt: 'Contradictory evidence excerpt.',
    });
    await store.addClaim(evidenceClaim());
    await store.addClaim(
      evidenceClaim({
        id: 'claim-b',
        sectionId: 'operations',
        references: [{ sourceId: 'source-b', chunkId: 'chunk-b', locator: 'p. 2', relation: 'contradicts' }],
      })
    );

    await store.addReconciliation({
      id: 'conflict-a-b',
      sectionIds: ['architecture', 'operations'],
      claimIds: ['claim-a', 'claim-b'],
      sourceIds: ['source-a', 'source-b'],
      relation: 'contradiction',
      cause: 'scope',
      resolution: 'novel-insight',
      rationale: 'The findings differ because each source measures a different deployment scope.',
      insight: 'Control effectiveness changes materially by deployment scope.',
      verifiedByAgentId: 'consistency-editor',
      checkedAt: '2026-07-18T00:00:00.000Z',
    });

    expect((await store.read()).reconciliations[0]).toMatchObject({
      id: 'conflict-a-b',
      resolution: 'novel-insight',
      sourceIds: ['source-a', 'source-b'],
    });
  });

  it('rejects a summary that names a source which is not in the archive', async () => {
    const { store } = await temporaryStore();

    await expect(store.addSummary(evidenceSummary({ sourceIds: ['missing-source'] }))).rejects.toThrow(
      /missing|unknown|provenance/i
    );
  });
});
