import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  EvidenceArchiveSnapshot,
  EvidenceChunk,
  EvidenceClaim,
  EvidenceReconciliation,
  EvidenceSummary,
  ResearchAccessMethod,
  ResearchSourceKind,
  SourceSnapshot,
} from './research';

const emptyArchive = (): EvidenceArchiveSnapshot => ({
  schema: 'tomny.evidence-archive.v1',
  sources: [],
  chunks: [],
  claims: [],
  summaries: [],
  reconciliations: [],
});

const assertSafeId = (id: string): void => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error(`Unsafe evidence id: ${id}`);
};

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

export type ArchiveSourceInput = {
  id: string;
  title: string;
  kind: ResearchSourceKind;
  accessMethod: ResearchAccessMethod;
  rawContent: string;
  retrievedAt?: string;
  url?: string;
  author?: string;
  publishedAt?: string;
  primary?: boolean;
};

export class JsonEvidenceStore {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly rootDirectory: string) {}

  async read(): Promise<EvidenceArchiveSnapshot> {
    try {
      const raw = await readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as EvidenceArchiveSnapshot;
      if (parsed.schema !== 'tomny.evidence-archive.v1') throw new Error('Unsupported evidence archive schema');
      return { ...parsed, reconciliations: parsed.reconciliations ?? [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyArchive();
      throw error;
    }
  }

  archiveSource(input: ArchiveSourceInput): Promise<SourceSnapshot> {
    return this.serialize(async () => {
      assertSafeId(input.id);
      if (!input.rawContent.trim()) throw new Error('Raw source content cannot be empty');
      const archive = await this.read();
      const contentHash = sha256(input.rawContent);
      const existing = archive.sources.find((source) => source.id === input.id);
      if (existing) {
        if (existing.contentHash !== contentHash) {
          throw new Error(`Source ${input.id} already exists with different content`);
        }
        return existing;
      }

      if (archive.sources.some((source) => source.contentHash === contentHash)) {
        throw new Error('Duplicate source content is already archived');
      }

      await mkdir(this.sourcesDirectory, { recursive: true });
      const rawArtifactPath = path.posix.join('sources', `${input.id}.txt`);
      await writeFile(path.join(this.rootDirectory, rawArtifactPath), input.rawContent, 'utf8');
      const snapshot: SourceSnapshot = {
        id: input.id,
        title: input.title,
        kind: input.kind,
        accessMethod: input.accessMethod,
        retrievedAt: input.retrievedAt ?? new Date().toISOString(),
        contentHash,
        rawArtifactPath,
        url: input.url,
        author: input.author,
        publishedAt: input.publishedAt,
        primary: input.primary ?? false,
      };
      archive.sources.push(snapshot);
      await this.writeState(archive);
      return snapshot;
    });
  }

  addChunk(chunk: EvidenceChunk): Promise<void> {
    return this.serialize(async () => {
      assertSafeId(chunk.id);
      const archive = await this.read();
      if (!archive.sources.some((source) => source.id === chunk.sourceId)) {
        throw new Error(`Chunk ${chunk.id} is missing its original source`);
      }
      if (archive.chunks.some((item) => item.id === chunk.id)) throw new Error(`Evidence ${chunk.id} already exists`);
      archive.chunks.push(chunk);
      await this.writeState(archive);
    });
  }

  addClaim(claim: EvidenceClaim): Promise<void> {
    return this.serialize(async () => {
      assertSafeId(claim.id);
      const archive = await this.read();
      if (claim.references.length === 0) throw new Error(`Claim ${claim.id} is missing original-source provenance`);
      const referencesExist = claim.references.every((reference) =>
        archive.chunks.some((chunk) => chunk.id === reference.chunkId && chunk.sourceId === reference.sourceId)
      );
      if (!referencesExist) throw new Error(`Claim ${claim.id} references a missing original-source chunk`);
      if (archive.claims.some((item) => item.id === claim.id)) throw new Error(`Evidence ${claim.id} already exists`);
      archive.claims.push(claim);
      await this.writeState(archive);
    });
  }

  addSummary(summary: EvidenceSummary): Promise<void> {
    return this.serialize(async () => {
      assertSafeId(summary.id);
      const archive = await this.read();
      if (summary.sourceIds.length === 0)
        throw new Error(`Summary ${summary.id} is missing original-source provenance`);
      const sourceIds = new Set(archive.sources.map((source) => source.id));
      const claimIds = new Set(archive.claims.map((claim) => claim.id));
      if (!summary.sourceIds.every((sourceId) => sourceIds.has(sourceId))) {
        throw new Error(`Summary ${summary.id} references a missing original source`);
      }
      if (!summary.claimIds.every((claimId) => claimIds.has(claimId))) {
        throw new Error(`Summary ${summary.id} references a missing claim`);
      }
      if (archive.summaries.some((item) => item.id === summary.id)) {
        throw new Error(`Evidence ${summary.id} already exists`);
      }
      archive.summaries.push(summary);
      await this.writeState(archive);
    });
  }

  addReconciliation(reconciliation: EvidenceReconciliation): Promise<void> {
    return this.serialize(async () => {
      assertSafeId(reconciliation.id);
      const archive = await this.read();
      const sourceIds = new Set(archive.sources.map((source) => source.id));
      const claimIds = new Set(archive.claims.map((claim) => claim.id));
      if (reconciliation.sectionIds.length < 2) {
        throw new Error(`Reconciliation ${reconciliation.id} requires at least two sections`);
      }
      if (
        reconciliation.sourceIds.length === 0 ||
        !reconciliation.sourceIds.every((sourceId) => sourceIds.has(sourceId))
      ) {
        throw new Error(`Reconciliation ${reconciliation.id} references a missing original source`);
      }
      if (reconciliation.claimIds.length === 0 || !reconciliation.claimIds.every((claimId) => claimIds.has(claimId))) {
        throw new Error(`Reconciliation ${reconciliation.id} references a missing claim`);
      }
      if (archive.reconciliations.some((item) => item.id === reconciliation.id)) {
        throw new Error(`Evidence ${reconciliation.id} already exists`);
      }
      archive.reconciliations.push(reconciliation);
      await this.writeState(archive);
    });
  }

  private get statePath(): string {
    return path.join(this.rootDirectory, 'archive.json');
  }

  private get sourcesDirectory(): string {
    return path.join(this.rootDirectory, 'sources');
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(
      (): void => {},
      (): void => {}
    );
    return result;
  }

  private async writeState(archive: EvidenceArchiveSnapshot): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    await writeFile(this.statePath, JSON.stringify(archive, null, 2), 'utf8');
  }
}
