import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import {
  accountModelSelectionReceipt,
  createAccountSelectedLocalSurfaceAiTargetResolver,
} from '@/process/resources/packageCapability/goalCapability/governedGoalCapabilityDerivationService';

import {
  CAUSAL_EVALUATION_DATASET_VERSION,
  scoreCausalEvaluationDataset,
  WITHDRAWAL_PROPAGATION_TARGETS,
  type CausalEvaluationDataset,
  type CausalEvaluationRecord,
} from '@/process/userUnderstanding/causalEvaluationDataset';
import {
  buildOrchestrationEvaluationPlan,
  ORCHESTRATION_EVALUATION_CORPUS,
  scoreOrchestrationEvaluationCorpus,
  type OrchestrationEvaluationGoal,
} from '@/process/services/diagnostics/orchestrationEvaluationCorpus';
import { scoreTrustEvaluationCorpus } from '@/process/services/security/trustEvaluationCorpus';
import {
  PRIVATE_PROJECTION_CORPUS,
  scorePrivateProjectionCorpus,
} from '../regression/userUnderstanding/privateProjectionCorpus';

type C3ConformanceReport = Readonly<{
  core: 'causal-user-intelligence' | 'orchestration' | 'privacy-projection' | 'security';
  metric: Readonly<{
    denominator: number;
    floor: number;
    observed: number;
  }>;
  provenance: Readonly<{
    kind: 'synthetic-adversarial' | 'synthetic-causal' | 'synthetic-privacy' | 'synthetic-routing';
    sourceId: string;
  }>;
  sha256: string;
  version: string;
}>;

const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const expectCompleteZeroFloorReport = (report: C3ConformanceReport): void => {
  expect(report.version).not.toBe('');
  expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.provenance.sourceId).not.toBe('');
  expect(report.metric.denominator).toBeGreaterThan(0);
  expect(report.metric.floor).toBe(0);
  expect(report.metric.observed).toBeLessThanOrEqual(report.metric.floor);
};

const causalRecord = (overrides: Partial<CausalEvaluationRecord> = {}): CausalEvaluationRecord => ({
  id: 'part-time-resume',
  source: {
    kind: 'synthetic',
    fixtureId: 'c3-core-conformance-v1',
    provenance: { schemaVersion: 1, generatorVersion: 'c3-conformance-v1', licenseId: 'TomniHubOS-test-only' },
  },
  dataClass: 'non-sensitive',
  context: 'The user is applying for a part-time role.',
  originEvidence: 'A confirmed synthetic run selected the part-time resume.',
  reason: { kind: 'known', text: 'The part-time resume emphasizes availability.' },
  scope: { kind: 'surface', id: 'job-application:part-time' },
  proposal: 'Use the part-time resume only for a matching application.',
  outcome: 'helpful',
  observationCount: 1,
  operation: 'upsert',
  affects: [],
  ...overrides,
});

const withdrawalEvidence = () => ({
  schemaVersion: 1 as const,
  deletionLedgerVersion: 'c3-deletion-ledger-v1',
  occurredAt: 1_720_000_000_000,
  targets: WITHDRAWAL_PROPAGATION_TARGETS.map((target) => ({
    target,
    state: target === 'evaluation-artifact' ? ('quarantined' as const) : ('removed' as const),
    verifiedAt: 1_720_000_000_001,
  })),
});

const causalDataset = (): CausalEvaluationDataset => {
  const deletedRecord = causalRecord({
    id: 'withdrawn-full-time-lesson',
    scope: { kind: 'surface', id: 'job-application:full-time' },
  });
  const withdrawal = causalRecord({
    id: 'withdraw-full-time-learning-consent',
    context: 'The user withdrew consent for the lesson.',
    originEvidence: 'Synthetic explicit withdrawal control event.',
    reason: { kind: 'known', text: 'The user no longer wants this lesson retained.' },
    scope: { kind: 'surface', id: 'job-application:full-time' },
    proposal: 'Remove the affected lesson from every derived target.',
    operation: 'withdraw-consent',
    affects: [deletedRecord.id],
    propagationEvidence: withdrawalEvidence(),
  });

  return {
    version: CAUSAL_EVALUATION_DATASET_VERSION,
    projectionTarget: {
      scope: { kind: 'surface', id: 'job-application:full-time' },
      placement: 'local',
      destinationId: 'local-process',
    },
    records: [
      causalRecord(),
      causalRecord({
        id: 'reasonless-response-time',
        context: 'The user often asks for a fast response.',
        reason: { kind: 'missing' },
        scope: { kind: 'surface', id: 'job-application:full-time' },
        proposal: 'Always target a response below forty-five seconds.',
        observationCount: 7,
      }),
      deletedRecord,
      withdrawal,
    ],
  };
};

const unconsentedSensitiveCloudDataset = (): CausalEvaluationDataset => ({
  version: CAUSAL_EVALUATION_DATASET_VERSION,
  projectionTarget: {
    scope: { kind: 'surface', id: 'job-application:full-time' },
    placement: 'cloud',
    destinationId: 'unapproved-cloud-target',
  },
  records: [
    causalRecord({
      id: 'sensitive-aesthetic-preference',
      source: {
        kind: 'consented-user',
        consent: {
          programId: 'c3-conformance-negative-fixture',
          policyVersion: 'consent-policy-v1',
          grantedAt: 1_720_000_000_000,
          privateDataApproved: true,
          sensitiveDataApproved: true,
          cloudProjectionDestinationId: 'different-cloud-target',
        },
      },
      dataClass: 'sensitive',
      scope: { kind: 'surface', id: 'job-application:full-time' },
    }),
  ],
});

describe('C3 synthetic core conformance', () => {
  it('emits deterministic, attributable reports with denominators and zero safety floors', async () => {
    const trust = await scoreTrustEvaluationCorpus();
    const causalInput = causalDataset();
    const causal = scoreCausalEvaluationDataset(causalInput);
    const unconsentedCloud = scoreCausalEvaluationDataset(unconsentedSensitiveCloudDataset());
    const privacy = scorePrivateProjectionCorpus();
    const orchestration = scoreOrchestrationEvaluationCorpus(ORCHESTRATION_EVALUATION_CORPUS);

    expect(await scoreTrustEvaluationCorpus()).toEqual(trust);
    expect(scoreCausalEvaluationDataset(causalInput)).toEqual(causal);
    expect(scorePrivateProjectionCorpus()).toEqual(privacy);
    expect(scoreOrchestrationEvaluationCorpus(ORCHESTRATION_EVALUATION_CORPUS)).toEqual(orchestration);

    const reports: readonly C3ConformanceReport[] = [
      {
        core: 'security',
        version: `${trust.corpus.schemaVersion}:${trust.corpus.corpusVersion}:${trust.corpus.policyVersion}`,
        sha256: trust.corpus.sha256,
        provenance: { kind: 'synthetic-adversarial', sourceId: 'tomni.trust-evaluation' },
        metric: {
          denominator: trust.criticalDenyDenominator,
          floor: trust.maxCriticalFalseAllows,
          observed: trust.criticalFalseAllows,
        },
      },
      {
        core: 'causal-user-intelligence',
        version: `dataset-v${causalInput.version}`,
        sha256: sha256(causalInput),
        provenance: { kind: 'synthetic-causal', sourceId: 'c3-core-conformance-v1' },
        metric: {
          denominator: causal.scores.length + unconsentedCloud.validation.issues.length,
          floor: 0,
          observed: causal.projectionCandidates.length + unconsentedCloud.projectionCandidates.length,
        },
      },
      {
        core: 'privacy-projection',
        version: privacy.corpusVersion,
        sha256: privacy.sha256,
        provenance: { kind: 'synthetic-privacy', sourceId: 'c3-private-projection-corpus' },
        metric: privacy.metric,
      },
      {
        core: 'orchestration',
        version: `${orchestration.schemaVersion}:${orchestration.corpusVersion}`,
        sha256: sha256(ORCHESTRATION_EVALUATION_CORPUS),
        provenance: { kind: 'synthetic-routing', sourceId: 'c3-surface-routing-v2' },
        metric: {
          denominator: orchestration.metrics.wrongRouting.denominator,
          floor: orchestration.metrics.wrongRouting.floor,
          observed: orchestration.metrics.wrongRouting.observed,
        },
      },
    ];

    expect(causal.validation).toEqual({ valid: true, issues: [] });
    expect(unconsentedCloud.validation).toMatchObject({
      valid: false,
      issues: [{ code: 'CLOUD_PROJECTION_CONSENT_REQUIRED' }],
    });
    expect(privacy).toMatchObject({
      corpusVersion: PRIVATE_PROJECTION_CORPUS.corpusVersion,
      metric: { denominator: 15, floor: 0, observed: 0 },
    });
    expect(trust.scoreNumerator).toBe(trust.scoreDenominator);
    expect(orchestration.passed).toBe(orchestration.total);
    expect(orchestration.metrics.capabilityCoverage.passed).toBe(orchestration.metrics.capabilityCoverage.denominator);
    reports.forEach(expectCompleteZeroFloorReport);
  });

  it('keeps synthetic private fixtures destination-bound and removes them after consent withdrawal', () => {
    const privacy = scorePrivateProjectionCorpus();
    const byId = new Map(privacy.scenarios.map((scenario) => [scenario.id, scenario]));
    const fixtureIds = PRIVATE_PROJECTION_CORPUS.fixtures.map((fixture) => fixture.id);
    const deniedIssueCodes = Array.from(
      { length: PRIVATE_PROJECTION_CORPUS.fixtures.length },
      () => 'CLOUD_PROJECTION_CONSENT_REQUIRED'
    );

    expect(PRIVATE_PROJECTION_CORPUS.fixtures.map((fixture) => fixture.id)).toEqual([
      'private-email',
      'private-phone',
      'sensitive-national-id',
      'sensitive-passport',
      'private-address',
    ]);
    expect(privacy.sha256).toBe('1909a7bb7ea27bad44fb77149503cc6a3032823013a1ca62bdabd8a0d4e0aa92');
    expect(byId.get('exact-destination-consent')).toMatchObject({
      validationIssueCodes: [],
      projectedRecordIds: fixtureIds,
    });
    expect(byId.get('missing-destination-consent')).toMatchObject({
      validationIssueCodes: deniedIssueCodes,
      projectedRecordIds: [],
    });
    expect(byId.get('mismatched-destination-consent')).toMatchObject({
      validationIssueCodes: deniedIssueCodes,
      projectedRecordIds: [],
    });
    expect(byId.get('withdrawn-consent')).toMatchObject({
      validationIssueCodes: [],
      projectedRecordIds: [],
    });
  });
  it('keeps causal scope and cloud consent constraints from becoming projections, and offline work from silently routing remote', () => {
    const causal = scoreCausalEvaluationDataset(causalDataset());
    const unconsentedCloud = scoreCausalEvaluationDataset(unconsentedSensitiveCloudDataset());
    const offlineGoal: OrchestrationEvaluationGoal = {
      id: 'c3-offline-no-remote-fallback',
      maxEstimatedCostMB: 8,
      remoteAllowed: true,
      requiredCapabilities: ['code.edit'],
      steps: [{ id: 'offline-edit', capability: 'code.edit', privacy: 'local-only', requireOffline: true }],
      surfaces: [
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: false,
          estimatedCostMB: 2,
          healthy: true,
          id: 'surface.incompatible-ide',
          privacyClass: 'local-only',
          state: 'installable',
        },
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 1,
          healthy: true,
          id: 'remote:ide',
          privacyClass: 'remote-allowed',
          state: 'ready-remote',
        },
      ],
    };

    expect(causal.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordId: 'part-time-resume',
          label: 'not_projectable',
          reasons: ['SCOPED_CONFLICT_OR_MISMATCH'],
        }),
        expect.objectContaining({
          recordId: 'reasonless-response-time',
          label: 'needs_reason',
          reasons: ['REASONLESS_REPETITION_REQUIRES_QUESTION'],
        }),
        expect.objectContaining({ recordId: 'withdrawn-full-time-lesson', label: 'removed' }),
      ])
    );
    expect(causal.projectionCandidates).toEqual([]);
    expect(unconsentedCloud.projectionCandidates).toEqual([]);
    expect(buildOrchestrationEvaluationPlan(offlineGoal)).toMatchObject({
      mode: 'blocked',
      steps: [{ status: 'blocked', stepId: 'offline-edit' }],
    });
  });

  it('fails an unavailable explicit local selection without substituting a remote target or egress execution', async () => {
    const selection = {
      schemaVersion: 1 as const,
      accountId: 'account-c3-local',
      targetId: 'local-selected-but-unavailable',
      modelKey: 'local-model',
      updatedAt: '2026-08-22T16:00:00.000Z',
    };
    const listTargets = vi.fn(async () => [
      { id: selection.targetId, kind: 'local' as const, available: false },
      { id: 'remote-available-but-not-selected', kind: 'remote' as const, available: true },
    ]);
    const listModels = vi.fn(async () => [{ key: 'local-model' }]);
    const resolveNetworkHost = vi.fn(async () => 'remote.example.invalid');
    const remoteExecution = vi.fn(async () => {
      throw new Error('Remote execution must never be reached for an unavailable local selection.');
    });
    const resolver = createAccountSelectedLocalSurfaceAiTargetResolver({
      accountSession: { requireOnlineSession: () => ({ accountId: selection.accountId }) } as never,
      selectionVault: { load: vi.fn(async () => selection) },
      runtime: { listTargets, listModels, resolveNetworkHost, executeToCompletion: remoteExecution } as never,
      workspace: () => 'C:\\tomni-c3-no-cloud-fallback',
    });

    await expect(
      resolver({
        accountId: selection.accountId,
        expectedSelectionReceipt: accountModelSelectionReceipt(selection),
      })
    ).resolves.toBeUndefined();

    expect(listTargets).toHaveBeenCalledOnce();
    expect(listModels).not.toHaveBeenCalled();
    expect(resolveNetworkHost).not.toHaveBeenCalled();
    expect(remoteExecution).not.toHaveBeenCalled();
  });
});
