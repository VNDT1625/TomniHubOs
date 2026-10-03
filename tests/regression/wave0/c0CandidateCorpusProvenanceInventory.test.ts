import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCoreEvaluationRunner } from '@/process/services/diagnostics/coreEvaluation/runner';

const PROJECT_ROOT = process.cwd();
const RUNNER_PATH = 'packages/desktop/src/process/services/diagnostics/coreEvaluation/runner.ts';
const PROMOTION_GATE_PATH = 'packages/desktop/src/process/services/diagnostics/coreEvaluation/promotionGate.ts';

const candidate = {
  artifactDigest: `sha256-${'a'.repeat(64)}`,
  rollbackTarget: 'release-2026.08.21',
  sourceRevision: 'release-2026.08.22',
} as const;

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error(`C0-01 provenance inventory source missing: ${path}`);
  return readFileSync(absolutePath, 'utf8');
};

/**
 * This inventory records the exact local candidate-report boundary. It is not a
 * release receipt and deliberately keeps C0-01 PARTIAL until an external signer
 * attests the frozen source revision, artifact, and corpus hashes together.
 */
describe('C0-01 candidate and corpus provenance inventory', () => {
  it('keeps the three deterministic held-out corpus provenance records bound to the caller-supplied candidate identity', async () => {
    const runner = createCoreEvaluationRunner();
    const first = await runner.run(candidate);
    const second = await runner.run(candidate);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      candidate,
      status: 'candidate-only',
      promotionAllowed: false,
      trainingPerformed: false,
      containsUserData: false,
    });
    expect(
      first.cores.map((core) => [core.core, core.corpus.provenance.kind, core.corpus.provenance.sourceId])
    ).toEqual([
      ['orchestration', 'synthetic-routing', 'tomni.orchestration-evaluation'],
      ['security', 'synthetic-adversarial', 'tomni.trust-evaluation'],
      ['user-intelligence', 'synthetic-causal', 'tomni.causal-evaluation'],
    ]);
    for (const core of first.cores) {
      expect(core.corpus.heldout).toBe(true);
      expect(core.corpus.corpusDigest).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(core.corpus.corpusVersion).toMatch(/^[A-Za-z0-9._:@/-]+$/);
      expect(core.corpus.consentPolicyVersion).toMatch(/^[A-Za-z0-9._:@/-]+$/);
      expect(core.corpus.deletionLedgerVersion).toMatch(/^[A-Za-z0-9._:@/-]+$/);
    }
  });

  it('explicitly records that a candidate-only report has no immutable signed same-revision receipt', async () => {
    const runner = createCoreEvaluationRunner();
    const report = await runner.run(candidate);
    const alternate = await runner.run({
      ...candidate,
      artifactDigest: `sha256-${'c'.repeat(64)}`,
      sourceRevision: 'another-valid-revision',
    });
    const reportRecord = report as unknown as Record<string, unknown>;
    const runnerSource = readSource(RUNNER_PATH);
    const promotionGateSource = readSource(PROMOTION_GATE_PATH);

    // The runner validates identifiers and carries them in local evidence, but
    // cannot authenticate that they name the frozen source/artifact/corpus set.
    expect(alternate).toMatchObject({
      candidate: {
        artifactDigest: `sha256-${'c'.repeat(64)}`,
        sourceRevision: 'another-valid-revision',
      },
      status: 'candidate-only',
      promotionAllowed: false,
    });
    expect(alternate.cores).toEqual(report.cores);

    expect(reportRecord).not.toHaveProperty('attestation');
    expect(reportRecord).not.toHaveProperty('signature');
    expect(reportRecord).not.toHaveProperty('receiptId');
    expect(JSON.stringify(report)).not.toContain('attestation');
    expect(JSON.stringify(report)).not.toContain('signature');
    expect(JSON.stringify(report)).not.toContain('receiptId');

    expect(runnerSource).toContain(
      'SHA256.test(value.artifactDigest) && isIdentifier(value.sourceRevision) && isIdentifier(value.rollbackTarget)'
    );
    expect(runnerSource).toContain('promotionAllowed: false');
    expect(runnerSource).not.toContain('CoreEvaluationPromotionReceipt');
    expect(runnerSource).not.toContain('createEd25519CoreEvaluationReceiptVerifier');

    // A separately implemented promotion receipt schema does not turn the
    // candidate-only runner output into an immutable same-revision receipt.
    expect(promotionGateSource).toContain('coreEvaluationPromotionReceiptSchema');
    expect(promotionGateSource).toContain('attestation: z.object({ keyId: text, signature:');
  });
});
