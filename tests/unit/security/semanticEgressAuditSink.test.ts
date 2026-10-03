import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createFileSemanticEgressAuditSink } from '@process/services/security/semanticEgressAuditSink';

describe('semantic egress audit sink', () => {
  it('persists only the declared hash-only audit shape', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-semantic-audit-'));
    const filePath = path.join(directory, 'semantic-egress-audit.jsonl');
    const payload = 'do-not-write-private-payload';
    try {
      await createFileSemanticEgressAuditSink(filePath).append({
        contentHash: 'a'.repeat(64),
        policyVersion: 'policy-v1',
        modelVersion: 'model-v1',
        classification: 'gray',
        decision: 'allow',
        reasonCode: 'semantic_model_allow',
        cacheHit: false,
        elapsedMs: 12,
        origin: 'tomny://provider-execution',
        recordedAt: '2026-09-07T00:00:00.000Z',
        rawPayload: payload,
      } as never);

      const persisted = await readFile(filePath, 'utf8');
      expect(persisted).not.toContain(payload);
      expect(JSON.parse(persisted)).toEqual({
        contentHash: 'a'.repeat(64),
        policyVersion: 'policy-v1',
        modelVersion: 'model-v1',
        classification: 'gray',
        decision: 'allow',
        reasonCode: 'semantic_model_allow',
        cacheHit: false,
        elapsedMs: 12,
        origin: 'tomny://provider-execution',
        recordedAt: '2026-09-07T00:00:00.000Z',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
