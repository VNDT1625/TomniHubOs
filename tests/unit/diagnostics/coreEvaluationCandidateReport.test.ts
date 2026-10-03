import { describe, expect, it } from 'vitest';

import {
  createCoreEvaluationRunner,
  type CoreEvaluationCoreAggregate,
} from '@/process/services/diagnostics/coreEvaluation/runner';

const candidate = {
  artifactDigest: `sha256-${'a'.repeat(64)}`,
  sourceRevision: 'release-2026.08.22',
  rollbackTarget: 'release-2026.08.21',
} as const;

const PROVENANCE_KIND_BY_CORE = {
  security: 'synthetic-adversarial',
  'user-intelligence': 'synthetic-causal',
  orchestration: 'synthetic-routing',
} as const;

const aggregate = (core: CoreEvaluationCoreAggregate['core']): CoreEvaluationCoreAggregate => ({
  core,
  corpus: {
    corpusSchemaVersion: 1,
    corpusVersion: 'frozen-v1',
    corpusDigest: `sha256-${'b'.repeat(64)}`,
    provenance: { kind: PROVENANCE_KIND_BY_CORE[core], sourceId: 'tomni.evaluation' },
    consentPolicyVersion: 'synthetic-no-personal-data-v1',
    deletionLedgerVersion: 'synthetic-deletion-ledger-v1',
    heldout: true,
  },
  metrics: [{ id: 'safe', numerator: 1, denominator: 1, comparator: 'gte', floor: 1, passed: true }],
});

const runnerWithSecurity = (security: CoreEvaluationCoreAggregate) =>
  createCoreEvaluationRunner({
    security: () => security,
    userIntelligence: () => aggregate('user-intelligence'),
    orchestration: () => aggregate('orchestration'),
  });

describe('Core evaluation candidate reports', () => {
  it('keeps aggregate denominators, floors, and corpus provenance in candidate-only evidence', async () => {
    const report = await createCoreEvaluationRunner().run(candidate);

    expect(report).toMatchObject({
      status: 'candidate-only',
      promotionAllowed: false,
      trainingPerformed: false,
      containsUserData: false,
    });
    expect(report.cores).toHaveLength(3);
    for (const core of report.cores) {
      expect(core.corpus.provenance.sourceId).toMatch(/^[A-Za-z0-9._:@/-]+$/);
      expect(core.metrics).not.toHaveLength(0);
      for (const metric of core.metrics) {
        expect(metric.denominator).toBeGreaterThan(0);
        expect(metric.floor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('names and reproduces malformed baseline metric failure at the same candidate revision', async () => {
    const malformedMetrics = {
      ...aggregate('security'),
      metrics: undefined,
    } as unknown as CoreEvaluationCoreAggregate;
    const runner = runnerWithSecurity(malformedMetrics);

    const first = await runner.run(candidate);
    const second = await runner.run(candidate);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: 'rejected',
      codes: ['CORE_EVALUATION_SAFETY_FLOOR_FAILED'],
      candidate,
      promotionAllowed: false,
      trainingPerformed: false,
    });
  });

  it.each([
    [
      'denominator',
      () =>
        ({
          ...aggregate('security'),
          metrics: [{ ...aggregate('security').metrics[0], denominator: undefined }],
        }) as unknown as CoreEvaluationCoreAggregate,
      'CORE_EVALUATION_SAFETY_FLOOR_FAILED',
    ],
    [
      'floor',
      () =>
        ({
          ...aggregate('security'),
          metrics: [{ ...aggregate('security').metrics[0], floor: undefined }],
        }) as unknown as CoreEvaluationCoreAggregate,
      'CORE_EVALUATION_SAFETY_FLOOR_FAILED',
    ],

    [
      'comparator',
      () =>
        ({
          ...aggregate('security'),
          metrics: [
            {
              ...aggregate('security').metrics[0],
              comparator: 'eq',
              numerator: 0,
              floor: 1,
              passed: true,
            },
          ],
        }) as unknown as CoreEvaluationCoreAggregate,
      'CORE_EVALUATION_SAFETY_FLOOR_FAILED',
    ],
    [
      'provenance kind from a different core',
      () =>
        ({
          ...aggregate('security'),
          corpus: {
            ...aggregate('security').corpus,
            provenance: { ...aggregate('security').corpus.provenance, kind: 'synthetic-routing' },
          },
        }) as unknown as CoreEvaluationCoreAggregate,
      'CORE_EVALUATION_METADATA_MISSING',
    ],

    [
      'provenance',
      () =>
        ({
          ...aggregate('security'),
          corpus: {
            ...aggregate('security').corpus,
            provenance: { ...aggregate('security').corpus.provenance, sourceId: '' },
          },
        }) as unknown as CoreEvaluationCoreAggregate,
      'CORE_EVALUATION_METADATA_MISSING',
    ],
    [
      'provenance object',
      () =>
        ({
          ...aggregate('security'),
          corpus: { ...aggregate('security').corpus, provenance: undefined },
        }) as unknown as CoreEvaluationCoreAggregate,
      'CORE_EVALUATION_METADATA_MISSING',
    ],
    [
      'undefined provenance sourceId',
      () =>
        ({
          ...aggregate('security'),
          corpus: {
            ...aggregate('security').corpus,
            provenance: { ...aggregate('security').corpus.provenance, sourceId: undefined },
          },
        }) as unknown as CoreEvaluationCoreAggregate,
      'CORE_EVALUATION_METADATA_MISSING',
    ],
    [
      'non-string provenance sourceId',
      () =>
        ({
          ...aggregate('security'),
          corpus: {
            ...aggregate('security').corpus,
            provenance: { ...aggregate('security').corpus.provenance, sourceId: 42 },
          },
        }) as unknown as CoreEvaluationCoreAggregate,
      'CORE_EVALUATION_METADATA_MISSING',
    ],
  ])('rejects a candidate report missing frozen %s evidence', async (_field, invalidAggregate, code) => {
    const report = await runnerWithSecurity(invalidAggregate()).run(candidate);

    expect(report).toMatchObject({
      status: 'rejected',
      codes: [code],
      promotionAllowed: false,
      trainingPerformed: false,
    });
  });
});
