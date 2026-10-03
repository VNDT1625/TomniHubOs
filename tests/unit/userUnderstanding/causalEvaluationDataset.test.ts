import { describe, expect, it } from 'vitest';

import {
  CAUSAL_EVALUATION_DATASET_VERSION,
  WITHDRAWAL_PROPAGATION_TARGETS,
  scoreCausalEvaluationDataset,
  validateCausalEvaluationDataset,
  type CausalEvaluationDataset,
  type CausalEvaluationRecord,
} from '@/process/userUnderstanding/causalEvaluationDataset';

const record = (overrides: Partial<CausalEvaluationRecord> = {}): CausalEvaluationRecord => ({
  id: 'resume-part-time',
  source: {
    kind: 'synthetic',
    fixtureId: 'causal-eval-v2',
    provenance: { schemaVersion: 1, generatorVersion: 'fixture-generator-v1', licenseId: 'TomniHubOS-test-only' },
  },
  dataClass: 'non-sensitive',
  context: 'Applying for a part-time role.',
  originEvidence: 'User selected a part-time resume in a confirmed run.',
  reason: { kind: 'known', text: 'The part-time resume emphasizes availability.' },
  scope: { kind: 'surface', id: 'job-application:part-time' },
  proposal: 'Use the part-time resume for this application.',
  outcome: 'helpful',
  observationCount: 1,
  operation: 'upsert',
  affects: [],
  ...overrides,
});

const dataset = (
  records: CausalEvaluationRecord[],
  overrides: Partial<CausalEvaluationDataset> = {}
): CausalEvaluationDataset => ({
  version: CAUSAL_EVALUATION_DATASET_VERSION,
  projectionTarget: {
    scope: { kind: 'surface', id: 'job-application:part-time' },
    placement: 'local',
    destinationId: 'local-process',
  },
  records,
  ...overrides,
});

const propagationEvidence = () => ({
  schemaVersion: 1 as const,
  deletionLedgerVersion: 'deletion-ledger-v1',
  occurredAt: 1_720_000_000_000,
  targets: WITHDRAWAL_PROPAGATION_TARGETS.map((target) => ({
    target,
    state: target === 'evaluation-artifact' ? ('quarantined' as const) : ('removed' as const),
    verifiedAt: 1_720_000_000_001,
  })),
});

describe('causal evaluation dataset', () => {
  it('requires fixture provenance or explicitly consented user data with a consent-policy version', () => {
    const consentedPrivate = record({
      id: 'consented-private-style',
      source: {
        kind: 'consented-user',
        consent: {
          programId: 'user-intelligence-evaluation-v2',
          policyVersion: 'consent-policy-v3',
          grantedAt: 1_720_000_000_000,
          privateDataApproved: true,
          sensitiveDataApproved: false,
        },
      },
      dataClass: 'private',
    });

    expect(validateCausalEvaluationDataset(dataset([record(), consentedPrivate]))).toEqual({ valid: true, issues: [] });

    const missingPolicyVersion = record({
      id: 'missing-consent-policy-version',
      source: {
        kind: 'consented-user',
        consent: {
          programId: 'user-intelligence-evaluation-v2',
          policyVersion: '',
          grantedAt: 1_720_000_000_000,
          privateDataApproved: true,
          sensitiveDataApproved: false,
        },
      },
      dataClass: 'private',
    });
    const missingProvenance = {
      ...record({ id: 'missing-provenance' }),
      source: { kind: 'synthetic', fixtureId: 'causal-eval-v2' },
    };

    expect(validateCausalEvaluationDataset(dataset([missingPolicyVersion]))).toMatchObject({
      valid: false,
      issues: [{ code: 'CONSENT_POLICY_VERSION_REQUIRED' }],
    });
    expect(validateCausalEvaluationDataset(dataset([missingProvenance]))).toMatchObject({
      valid: false,
      issues: [{ code: 'MISSING_PROVENANCE' }],
    });
  });

  it('blocks all private and sensitive cloud projection unless destination-bound consent matches', () => {
    const sensitive = record({
      id: 'sensitive-aesthetic-preference',
      source: {
        kind: 'consented-user',
        consent: {
          programId: 'user-intelligence-evaluation-v2',
          policyVersion: 'consent-policy-v3',
          grantedAt: 1_720_000_000_000,
          privateDataApproved: true,
          sensitiveDataApproved: true,
          cloudProjectionDestinationId: 'approved-cloud-model',
        },
      },
      dataClass: 'sensitive',
    });

    const unapproved = dataset([sensitive], {
      projectionTarget: {
        scope: { kind: 'surface', id: 'job-application:part-time' },
        placement: 'cloud',
        destinationId: 'different-cloud-model',
      },
    });
    expect(validateCausalEvaluationDataset(unapproved)).toMatchObject({
      valid: false,
      issues: [{ code: 'CLOUD_PROJECTION_CONSENT_REQUIRED' }],
    });
    expect(scoreCausalEvaluationDataset(unapproved).projectionCandidates).toEqual([]);

    const approved = dataset([sensitive], {
      projectionTarget: {
        scope: { kind: 'surface', id: 'job-application:part-time' },
        placement: 'cloud',
        destinationId: 'approved-cloud-model',
      },
    });
    expect(scoreCausalEvaluationDataset(approved).projectionCandidates.map((candidate) => candidate.id)).toEqual([
      'sensitive-aesthetic-preference',
    ]);
  });

  it('requires every causal stage and never turns reasonless repetition into a reusable rule', () => {
    const reasonlessRepeat = record({
      id: 'fast-response-repeat',
      reason: { kind: 'missing' },
      observationCount: 7,
      proposal: 'Target a response below forty-five seconds.',
    });
    const missingOrigin = { ...record(), id: 'missing-origin', originEvidence: '' };

    expect(validateCausalEvaluationDataset(dataset([missingOrigin]))).toMatchObject({
      valid: false,
      issues: [{ code: 'CAUSAL_STAGE_REQUIRED' }],
    });

    const result = scoreCausalEvaluationDataset(dataset([reasonlessRepeat]));
    expect(result.scores).toEqual([
      {
        recordId: 'fast-response-repeat',
        label: 'needs_reason',
        score: 0,
        reasons: ['REASONLESS_REPETITION_REQUIRES_QUESTION'],
      },
    ]);
    expect(result.projectionCandidates).toEqual([]);
  });

  it('keeps scoped full-time and part-time lessons separate instead of generalizing a candidate', () => {
    const partTime = record();
    const fullTimeTarget = dataset([partTime], {
      projectionTarget: {
        scope: { kind: 'surface', id: 'job-application:full-time' },
        placement: 'local',
        destinationId: 'local-process',
      },
    });

    expect(scoreCausalEvaluationDataset(fullTimeTarget)).toMatchObject({
      scores: [
        {
          recordId: 'resume-part-time',
          label: 'not_projectable',
          score: 0,
          reasons: ['SCOPED_CONFLICT_OR_MISMATCH'],
        },
      ],
      projectionCandidates: [],
    });
  });

  it('requires complete deletion or consent-withdrawal propagation evidence before removing candidates', () => {
    const original = record({ id: 'resume-part-time-lesson' });
    const withdrawal = record({
      id: 'withdraw-part-time-learning-consent',
      operation: 'withdraw-consent',
      affects: [original.id],
      context: 'The user withdrew learning consent for this lesson.',
      originEvidence: 'Explicit consent withdrawal control event.',
      reason: { kind: 'known', text: 'The user no longer wants this context retained.' },
      proposal: 'Remove the affected lesson from all future projections and derived stores.',
      propagationEvidence: propagationEvidence(),
    });

    const removed = scoreCausalEvaluationDataset(dataset([original, withdrawal]));
    expect(removed.scores.find((score) => score.recordId === original.id)?.label).toBe('removed');
    expect(removed.projectionCandidates).toEqual([]);

    const missingBackupProof = {
      ...withdrawal,
      id: 'withdrawal-missing-backup-proof',
      propagationEvidence: {
        ...propagationEvidence(),
        targets: propagationEvidence().targets.filter((entry) => entry.target !== 'backup'),
      },
    };
    expect(validateCausalEvaluationDataset(dataset([original, missingBackupProof]))).toMatchObject({
      valid: false,
      issues: [{ code: 'INVALID_WITHDRAWAL_PROPAGATION_EVIDENCE' }],
    });
  });

  it('rejects cache propagation proof that predates the withdrawal event', () => {
    const original = record({ id: 'resume-part-time-cache-lesson' });
    const withdrawal = record({
      id: 'withdraw-cache-lesson',
      operation: 'withdraw-consent',
      affects: [original.id],
      context: 'The user withdrew learning consent for the cached lesson.',
      originEvidence: 'Explicit consent withdrawal control event.',
      reason: { kind: 'known', text: 'The user no longer wants the cached lesson retained.' },
      proposal: 'Remove the affected cached lesson from all future projections.',
      propagationEvidence: {
        ...propagationEvidence(),
        targets: propagationEvidence().targets.map((target) =>
          target.target === 'cache' ? { ...target, verifiedAt: 1_719_999_999_999 } : target
        ),
      },
    });

    const result = scoreCausalEvaluationDataset(dataset([original, withdrawal]));
    expect(result.validation).toMatchObject({
      valid: false,
      issues: [{ code: 'INVALID_WITHDRAWAL_PROPAGATION_EVIDENCE' }],
    });
    expect(result.projectionCandidates).toEqual([]);
  });
});
