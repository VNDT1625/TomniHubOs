import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

import type { SemanticEgressAudit } from './semanticEgressGuard';

export type SemanticEgressAuditRecord = Readonly<
  SemanticEgressAudit & {
    origin: string;
    recordedAt: string;
  }
>;

export type SemanticEgressAuditSink = Readonly<{
  append(record: SemanticEgressAuditRecord): Promise<void>;
}>;
const persistedRecord = (record: SemanticEgressAuditRecord): SemanticEgressAuditRecord => ({
  contentHash: record.contentHash,
  policyVersion: record.policyVersion,
  modelVersion: record.modelVersion,
  classification: record.classification,
  decision: record.decision,
  // The guard accepts only identifier-shaped codes, never model-generated prose.
  reasonCode: record.reasonCode,
  cacheHit: record.cacheHit,
  elapsedMs: record.elapsedMs,
  origin: record.origin,
  recordedAt: record.recordedAt,
});

/** Writes only hashed, bounded egress evidence; payloads and secrets never reach disk. */
export const createFileSemanticEgressAuditSink = (filePath: string): SemanticEgressAuditSink => {
  let tail = Promise.resolve();

  return {
    append(record): Promise<void> {
      const operation = tail.then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        const handle = await open(filePath, 'a', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(persistedRecord(record))}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
      });
      tail = operation.catch((): void => undefined);
      return operation;
    },
  };
};
