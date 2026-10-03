import { describe, expect, it } from 'vitest';

import {
  CAUSAL_EVALUATION_DATASET_VERSION,
  scoreCausalEvaluationDataset,
  WITHDRAWAL_PROPAGATION_TARGETS,
  type CausalEvaluationDataset,
  type CausalEvaluationRecord,
} from '@/process/userUnderstanding/causalEvaluationDataset';

const projectionTarget: CausalEvaluationDataset['projectionTarget'] = {
  scope: { kind: 'workspace', id: 'correction-withdrawal-regression' },
  placement: 'local',
  destinationId: 'local-process',
};

const record = (overrides: Partial<CausalEvaluationRecord> = {}): CausalEvaluationRecord => ({
  id: 'preferred-editor',
  source: {
    kind: 'synthetic',
    fixtureId: 'c3-causal-withdrawal-propagation-v1',
    provenance: {
      schemaVersion: 1,
      generatorVersion: 'c3-causal-withdrawal-propagation-v1',
      licenseId: 'TomniHubOS-test-only',
    },
  },
  dataClass: 'non-sensitive',
  context: 'The synthetic user selected the current editor preference.',
  originEvidence: 'A confirmed synthetic user-control event recorded the preference.',
  reason: { kind: 'known', text: 'The selected editor supports the user’s project workflow.' },
  scope: projectionTarget.scope,
  proposal: 'Use the selected editor only for this workspace.',
  outcome: 'helpful',
  observationCount: 1,
  operation: 'upsert',
  affects: [],
  ...overrides,
});

const dataset = (records: CausalEvaluationRecord[]): CausalEvaluationDataset => ({
  version: CAUSAL_EVALUATION_DATASET_VERSION,
  projectionTarget,
  records,
});

const propagationEvidence = () => ({
  schemaVersion: 1 as const,
  deletionLedgerVersion: 'c3-causal-withdrawal-ledger-v1',
  occurredAt: 1_720_000_000_000,
  targets: WITHDRAWAL_PROPAGATION_TARGETS.map((target) => ({
    target,
    state: target === 'evaluation-artifact' ? ('quarantined' as const) : ('removed' as const),
    verifiedAt: 1_720_000_000_001,
  })),
});

const projectedIds = (records: CausalEvaluationRecord[]): string[] =>
  scoreCausalEvaluationDataset(dataset(records)).projectionCandidates.map((candidate) => candidate.id);

describe('C3 causal withdrawal propagation', () => {
  it('uses only the current causal chain for each next projection after correction, deletion, or consent withdrawal', () => {
    const original = record({
      id: 'editor-preference-v1',
      context: 'The synthetic user initially selected Editor A.',
      proposal: 'Use Editor A for this workspace.',
    });
    const correction = record({
      id: 'editor-preference-v2',
      context: 'The synthetic user corrected the preference to Editor B.',
      originEvidence: 'An explicit synthetic correction control event superseded Editor A.',
      reason: { kind: 'known', text: 'Editor B is now required by the workspace workflow.' },
      proposal: 'Use Editor B for this workspace.',
      operation: 'correct',
      affects: [original.id],
    });
    const deletion = record({
      id: 'delete-editor-preference',
      context: 'The synthetic user deleted the corrected editor preference.',
      originEvidence: 'An explicit synthetic deletion control event.',
      reason: { kind: 'known', text: 'The user no longer wants the preference retained.' },
      proposal: 'Remove the corrected preference from future projections.',
      operation: 'delete',
      affects: [correction.id],
      propagationEvidence: propagationEvidence(),
    });
    const withdrawal = record({
      id: 'withdraw-editor-learning-consent',
      context: 'The synthetic user withdrew consent for the original editor lesson.',
      originEvidence: 'An explicit synthetic learning-consent withdrawal control event.',
      reason: { kind: 'known', text: 'The user no longer permits retention of this lesson.' },
      proposal: 'Withhold the original editor lesson from all future projections.',
      operation: 'withdraw-consent',
      affects: [original.id],
      propagationEvidence: propagationEvidence(),
    });

    expect(projectedIds([original])).toEqual([original.id]);

    const correctedProjection = scoreCausalEvaluationDataset(dataset([original, correction]));
    expect(correctedProjection.scores).toContainEqual({
      recordId: original.id,
      label: 'removed',
      score: 0,
      reasons: ['AFFECTED_BY_CORRECTION_OR_DELETION'],
    });
    expect(correctedProjection.projectionCandidates.map((candidate) => candidate.id)).toEqual([correction.id]);

    const deletedProjection = scoreCausalEvaluationDataset(dataset([original, correction, deletion]));
    expect(deletedProjection.scores).toContainEqual({
      recordId: correction.id,
      label: 'removed',
      score: 0,
      reasons: ['AFFECTED_BY_CORRECTION_OR_DELETION'],
    });
    expect(deletedProjection.projectionCandidates).toEqual([]);

    const withdrawnProjection = scoreCausalEvaluationDataset(dataset([withdrawal, original]));
    expect(withdrawnProjection.scores).toContainEqual({
      recordId: original.id,
      label: 'removed',
      score: 0,
      reasons: ['AFFECTED_BY_CORRECTION_OR_DELETION'],
    });
    expect(withdrawnProjection.projectionCandidates).toEqual([]);
  });
});
