import { describe, expect, it } from 'vitest';

import {
  createCoreTrainingPlanRunner,
  type CoreTrainingPlanRequest,
} from '@/process/services/diagnostics/coreEvaluation/training/candidatePlan';

const sha = (letter: string): `sha256-${string}` => `sha256-${letter.repeat(64)}`;
const FIXED_NOW = () => Date.parse('2026-08-21T00:00:00.000Z');

const request = (overrides: Partial<CoreTrainingPlanRequest> = {}): CoreTrainingPlanRequest => ({
  schemaVersion: 1,
  candidate: {
    schemaVersion: 1,
    core: 'user-intelligence',
    candidateArtifactDigest: sha('a'),
    baseArtifactDigest: sha('b'),
    rollbackArtifactDigest: sha('c'),
    recipeDigest: sha('d'),
    sourceRevision: 'core-training-2026.08.21',
  },
  dataset: {
    schemaVersion: 1,
    datasetId: 'synthetic-causal-training',
    datasetVersion: 'v1',
    datasetDigest: sha('e'),
    recordCount: 3,
    dataClassCounts: [{ dataClass: 'non-sensitive', count: 3 }],
    source: {
      kind: 'synthetic',
      generatorVersion: 'causal-generator-v1',
      licenseId: 'TomniHubOS-test-only',
      containsUserData: false,
    },
  },
  heldoutEvaluation: { corpusDigest: sha('f'), corpusVersion: 'causal-heldout-v1', heldout: true },
  ...overrides,
});

describe('CoreTrainingPlanRunner', () => {
  it('creates deterministic aggregate-only synthetic candidate evidence without training or promotion', () => {
    const runner = createCoreTrainingPlanRunner({ now: FIXED_NOW });
    const first = runner.plan(request());
    const second = runner.plan(request());

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: 'planned',
      codes: [],
      containsUserData: false,
      trainingPerformed: false,
      modelPromotionPerformed: false,
      promotionAllowed: false,
      plan: {
        trainingMode: 'offline-candidate-review-only',
        dataset: { datasetDigest: sha('e'), recordCount: 3, sourceKind: 'synthetic' },
      },
    });
    expect(JSON.stringify(first)).not.toContain('prompt');
    expect(JSON.stringify(first)).not.toContain('secret');
  });

  it('rejects a hidden raw-data field and held-out corpus reuse', () => {
    const runner = createCoreTrainingPlanRunner();
    const rawData = { ...request(), dataset: { ...request().dataset, records: ['private prompt'] } };
    const overlap = {
      ...request(),
      heldoutEvaluation: { ...request().heldoutEvaluation, corpusDigest: request().dataset.datasetDigest },
    };

    expect(runner.plan(rawData)).toEqual(
      expect.objectContaining({ status: 'rejected', codes: ['CORE_TRAINING_PLAN_INVALID'], containsUserData: false })
    );
    expect(runner.plan(overlap)).toEqual(
      expect.objectContaining({ status: 'rejected', codes: ['CORE_TRAINING_PLAN_INVALID'] })
    );
  });

  it('fails closed for consented data unless its bounded planning flag and consent lifecycle both pass', () => {
    const consented = request({
      dataset: {
        ...request().dataset,
        source: {
          kind: 'consented-user',
          consentProgramId: 'research-program-v1',
          consentPolicyVersion: 'research-consent-v1',
          consentReceiptId: 'opaque-receipt-v1',
          deletionLedgerVersion: 'deletion-ledger-v1',
          grantedAt: '2026-08-20T00:00:00.000Z',
          expiresAt: '2026-08-22T00:00:00.000Z',
          withdrawalState: 'active',
        },
      },
    });
    expect(createCoreTrainingPlanRunner({ now: FIXED_NOW }).plan(consented)).toMatchObject({
      status: 'rejected',
      codes: ['CORE_TRAINING_USER_DATA_DISABLED'],
      trainingPerformed: false,
    });
    expect(
      createCoreTrainingPlanRunner({ now: FIXED_NOW, allowConsentedUserDataPlanning: true }).plan(consented)
    ).toMatchObject({
      status: 'planned',
      containsUserData: true,
      trainingPerformed: false,
      modelPromotionPerformed: false,
    });
    expect(
      createCoreTrainingPlanRunner({ now: FIXED_NOW, allowConsentedUserDataPlanning: true }).plan({
        ...consented,
        dataset: { ...consented.dataset, source: { ...consented.dataset.source, withdrawalState: 'withdrawn' } },
      })
    ).toMatchObject({ status: 'rejected', codes: ['CORE_TRAINING_WITHDRAWN_DATA'] });
  });
});
