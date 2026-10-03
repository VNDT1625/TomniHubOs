import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WITHDRAWAL_PROPAGATION_TARGETS } from '@/process/userUnderstanding/causalEvaluationDataset';

type SourceAssertion = Readonly<{
  path: string;
  requiredMarkers: readonly string[];
}>;

type UnprovenRuntimeTarget = Readonly<{
  target: (typeof WITHDRAWAL_PROPAGATION_TARGETS)[number];
  requiredOwner: string;
  status: 'unassigned';
}>;

const PROJECT_ROOT = process.cwd();
const PROCESS_ROOT = 'packages/desktop/src/process';

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error('C3 causal-propagation inventory source missing: ' + path);
  return readFileSync(absolutePath, 'utf8');
};

/**
 * These assertions pin the limited, currently demonstrated boundary: a validated
 * synthetic dataset removes invalidated records from its next evaluator projection.
 * They deliberately do not claim a durable user-context deletion implementation.
 */
const CURRENT_PROJECTION_EVIDENCE: readonly SourceAssertion[] = [
  {
    path: `${PROCESS_ROOT}/userUnderstanding/causalEvaluationDataset.ts`,
    requiredMarkers: [
      "operation: 'upsert' | 'correct' | 'delete' | 'withdraw-consent';",
      'const hasValidPropagationEvidence = (value: unknown): value is CausalEvaluationWithdrawalPropagationEvidence => {',
      'const removedIds = new Set(',
      "reasons: ['AFFECTED_BY_CORRECTION_OR_DELETION']",
      'export const scoreCausalEvaluationDataset = (input: unknown): CausalEvaluationResult => {',
    ],
  },
  {
    path: 'tests/regression/userUnderstanding/causalWithdrawalPropagation.test.ts',
    requiredMarkers: [
      "it('uses only the current causal chain for each next projection after correction, deletion, or consent withdrawal'",
      'expect(deletedProjection.projectionCandidates).toEqual([]);',
      'expect(withdrawnProjection.projectionCandidates).toEqual([]);',
    ],
  },
  {
    path: `${PROCESS_ROOT}/services/diagnostics/coreEvaluation/runner.ts`,
    requiredMarkers: [
      'const frozenCausalDataset = (): CausalEvaluationDataset => {',
      'WITHDRAWAL_PROPAGATION_TARGETS.map((target) => ({',
      'userIntelligence: () => causalAggregate(scoreCausalEvaluationDataset(frozenCausalDataset())),',
    ],
  },
] as const;

/**
 * The dataset schema names these targets, but this inventory found no durable
 * Main-process owner that propagates a real correction/deletion/withdrawal to
 * them. They remain explicit C3-03 work, not passing production evidence.
 */
const NAMED_UNPROVEN_RUNTIME_TARGETS: readonly UnprovenRuntimeTarget[] = [
  { target: 'search', requiredOwner: 'causal search index/query service', status: 'unassigned' },
  { target: 'package-context', requiredOwner: 'package-context projection broker', status: 'unassigned' },
  { target: 'corpus', requiredOwner: 'corpus manifest and derived-dataset ledger', status: 'unassigned' },
  { target: 'index', requiredOwner: 'derived index deletion worker', status: 'unassigned' },
  { target: 'cache', requiredOwner: 'cache invalidation service', status: 'unassigned' },
  { target: 'queued-job', requiredOwner: 'durable queue cancellation worker', status: 'unassigned' },
  { target: 'evaluation-artifact', requiredOwner: 'evaluation-artifact quarantine service', status: 'unassigned' },
  { target: 'backup', requiredOwner: 'retention-aware backup removal verifier', status: 'unassigned' },
] as const;

describe('C3 causal correction, deletion, and withdrawal propagation inventory', () => {
  it('pins only the evaluator projection and synthetic core-evaluation evidence currently demonstrated', () => {
    for (const assertion of CURRENT_PROJECTION_EVIDENCE) {
      const content = readSource(assertion.path);
      for (const marker of assertion.requiredMarkers) expect(content, assertion.path + ': ' + marker).toContain(marker);
    }
  });

  it('keeps every non-projection propagation target explicitly unproven until it has a durable runtime owner', () => {
    expect(WITHDRAWAL_PROPAGATION_TARGETS).toEqual([
      'projection',
      'search',
      'package-context',
      'corpus',
      'index',
      'cache',
      'queued-job',
      'evaluation-artifact',
      'backup',
    ]);
    expect(NAMED_UNPROVEN_RUNTIME_TARGETS.map((entry) => entry.target)).toEqual(
      WITHDRAWAL_PROPAGATION_TARGETS.slice(1)
    );
    expect(NAMED_UNPROVEN_RUNTIME_TARGETS.every((entry) => entry.status === 'unassigned')).toBe(true);
  });
});
