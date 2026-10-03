import { createHash } from 'node:crypto';

import {
  CAUSAL_EVALUATION_DATASET_VERSION,
  WITHDRAWAL_PROPAGATION_TARGETS,
  scoreCausalEvaluationDataset,
  type CausalEvaluationDataset,
  type CausalEvaluationRecord,
} from '@/process/userUnderstanding/causalEvaluationDataset';

export const PRIVATE_PROJECTION_CORPUS_VERSION = 'c3-private-projection-v1' as const;
const APPROVED_CLOUD_DESTINATION = 'cloud://evaluation/private-projection-approved' as const;
const MISMATCHED_CLOUD_DESTINATION = 'cloud://evaluation/private-projection-mismatched' as const;
const FIXTURE_TIMESTAMP = 1_720_000_000_000;

type PrivateProjectionFixture = {
  id: string;
  dataClass: 'private' | 'sensitive';
  context: string;
  proposal: string;
};

export type PrivateProjectionCorpus = {
  schemaVersion: 1;
  corpusVersion: typeof PRIVATE_PROJECTION_CORPUS_VERSION;
  provenance: {
    kind: 'synthetic';
    generatorVersion: string;
    licenseId: string;
  };
  fixtures: readonly PrivateProjectionFixture[];
};

/**
 * This fixture is synthetic and contains no collected user data. Its records
 * model consent states so the causal projection seam—not a secret scanner—owns
 * private and sensitive cloud-projection decisions.
 */
export const PRIVATE_PROJECTION_CORPUS: PrivateProjectionCorpus = {
  schemaVersion: 1,
  corpusVersion: PRIVATE_PROJECTION_CORPUS_VERSION,
  provenance: {
    kind: 'synthetic',
    generatorVersion: 'c3-private-projection-fixture-generator-v1',
    licenseId: 'TomniHubOS-test-only',
  },
  fixtures: [
    {
      id: 'private-email',
      dataClass: 'private',
      context: 'Synthetic contact email: aria.nguyen@example.test.',
      proposal: 'Use the synthetic contact email only for the confirmed support follow-up.',
    },
    {
      id: 'private-phone',
      dataClass: 'private',
      context: 'Synthetic contact phone: +84 912 000 111.',
      proposal: 'Use the synthetic contact phone only for the confirmed support follow-up.',
    },
    {
      id: 'sensitive-national-id',
      dataClass: 'sensitive',
      context: 'Synthetic national identifier: 079203000101.',
      proposal: 'Use the synthetic national identifier only for the confirmed verification step.',
    },
    {
      id: 'sensitive-passport',
      dataClass: 'sensitive',
      context: 'Synthetic passport number: P12345678.',
      proposal: 'Use the synthetic passport only for the confirmed verification step.',
    },
    {
      id: 'private-address',
      dataClass: 'private',
      context: 'Synthetic home address: 1 Nguyen Hue Street, District 1.',
      proposal: 'Use the synthetic address only for the confirmed delivery step.',
    },
  ],
};

type ScenarioId =
  | 'exact-destination-consent'
  | 'missing-destination-consent'
  | 'mismatched-destination-consent'
  | 'withdrawn-consent';

type PrivateProjectionScenario = {
  id: ScenarioId;
  unauthorizedCloudProjection: boolean;
  dataset: CausalEvaluationDataset;
};

const projectionTarget = (destinationId: string): CausalEvaluationDataset['projectionTarget'] => ({
  scope: { kind: 'workspace', id: 'synthetic-private-projection-workspace' },
  placement: 'cloud',
  destinationId,
});

const consentedSource = (cloudProjectionDestinationId?: string): CausalEvaluationRecord['source'] => ({
  kind: 'consented-user',
  consent: {
    programId: 'synthetic-private-projection-consent-scenario',
    policyVersion: 'synthetic-consent-policy-v1',
    grantedAt: FIXTURE_TIMESTAMP,
    privateDataApproved: true,
    sensitiveDataApproved: true,
    ...(cloudProjectionDestinationId === undefined ? {} : { cloudProjectionDestinationId }),
  },
});

const recordsFor = (cloudProjectionDestinationId?: string): CausalEvaluationRecord[] =>
  PRIVATE_PROJECTION_CORPUS.fixtures.map((fixture) => ({
    id: fixture.id,
    source: consentedSource(cloudProjectionDestinationId),
    dataClass: fixture.dataClass,
    context: fixture.context,
    originEvidence: 'Synthetic privacy-projection fixture with a confirmed causal purpose.',
    reason: { kind: 'known', text: 'The synthetic user confirmed the bounded purpose and scope.' },
    scope: { kind: 'workspace', id: 'synthetic-private-projection-workspace' },
    proposal: fixture.proposal,
    outcome: 'helpful',
    observationCount: 1,
    operation: 'upsert',
    affects: [],
  }));

const withdrawalRecord = (): CausalEvaluationRecord => ({
  id: 'withdraw-synthetic-private-projection-consent',
  source: consentedSource(APPROVED_CLOUD_DESTINATION),
  dataClass: 'sensitive',
  context: 'Synthetic user withdrew private and sensitive cloud-projection consent.',
  originEvidence: 'Synthetic explicit consent-withdrawal control event.',
  reason: { kind: 'known', text: 'The synthetic user no longer permits cloud projection.' },
  scope: { kind: 'workspace', id: 'synthetic-private-projection-workspace' },
  proposal: 'Remove every affected private fixture from future cloud projections and derived targets.',
  outcome: 'helpful',
  observationCount: 1,
  operation: 'withdraw-consent',
  affects: PRIVATE_PROJECTION_CORPUS.fixtures.map((fixture) => fixture.id),
  propagationEvidence: {
    schemaVersion: 1,
    deletionLedgerVersion: 'synthetic-deletion-ledger-v1',
    occurredAt: FIXTURE_TIMESTAMP + 1,
    targets: WITHDRAWAL_PROPAGATION_TARGETS.map((target) => ({
      target,
      state: target === 'evaluation-artifact' ? ('quarantined' as const) : ('removed' as const),
      verifiedAt: FIXTURE_TIMESTAMP + 2,
    })),
  },
});

const scenarios = (): PrivateProjectionScenario[] => [
  {
    id: 'exact-destination-consent',
    unauthorizedCloudProjection: false,
    dataset: {
      version: CAUSAL_EVALUATION_DATASET_VERSION,
      projectionTarget: projectionTarget(APPROVED_CLOUD_DESTINATION),
      records: recordsFor(APPROVED_CLOUD_DESTINATION),
    },
  },
  {
    id: 'missing-destination-consent',
    unauthorizedCloudProjection: true,
    dataset: {
      version: CAUSAL_EVALUATION_DATASET_VERSION,
      projectionTarget: projectionTarget(APPROVED_CLOUD_DESTINATION),
      records: recordsFor(),
    },
  },
  {
    id: 'mismatched-destination-consent',
    unauthorizedCloudProjection: true,
    dataset: {
      version: CAUSAL_EVALUATION_DATASET_VERSION,
      projectionTarget: projectionTarget(APPROVED_CLOUD_DESTINATION),
      records: recordsFor(MISMATCHED_CLOUD_DESTINATION),
    },
  },
  {
    id: 'withdrawn-consent',
    unauthorizedCloudProjection: true,
    dataset: {
      version: CAUSAL_EVALUATION_DATASET_VERSION,
      projectionTarget: projectionTarget(APPROVED_CLOUD_DESTINATION),
      records: [...recordsFor(APPROVED_CLOUD_DESTINATION), withdrawalRecord()],
    },
  },
];

const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type PrivateProjectionCorpusReport = {
  corpusVersion: typeof PRIVATE_PROJECTION_CORPUS_VERSION;
  sha256: string;
  provenance: PrivateProjectionCorpus['provenance'];
  metric: {
    denominator: number;
    floor: 0;
    observed: number;
  };
  scenarios: Array<{
    id: ScenarioId;
    validationIssueCodes: string[];
    projectedRecordIds: string[];
  }>;
};

/** Scores deterministic privacy fixtures through the causal projection seam. */
export const scorePrivateProjectionCorpus = (): PrivateProjectionCorpusReport => {
  const scoredScenarios = scenarios().map((scenario) => {
    const result = scoreCausalEvaluationDataset(scenario.dataset);
    return {
      scenario,
      validationIssueCodes: result.validation.issues.map((issue) => issue.code),
      projectedRecordIds: result.projectionCandidates.map((record) => record.id),
    };
  });
  const unauthorizedScenarios = scoredScenarios.filter(({ scenario }) => scenario.unauthorizedCloudProjection);
  return {
    corpusVersion: PRIVATE_PROJECTION_CORPUS_VERSION,
    sha256: sha256({
      corpus: PRIVATE_PROJECTION_CORPUS,
      scenarios: scoredScenarios.map(({ scenario }) => ({
        id: scenario.id,
        unauthorizedCloudProjection: scenario.unauthorizedCloudProjection,
        dataset: scenario.dataset,
      })),
    }),
    provenance: PRIVATE_PROJECTION_CORPUS.provenance,
    metric: {
      denominator: unauthorizedScenarios.reduce((total) => total + PRIVATE_PROJECTION_CORPUS.fixtures.length, 0),
      floor: 0,
      observed: unauthorizedScenarios.reduce((total, { projectedRecordIds }) => total + projectedRecordIds.length, 0),
    },
    scenarios: scoredScenarios.map(({ scenario, validationIssueCodes, projectedRecordIds }) => ({
      id: scenario.id,
      validationIssueCodes,
      projectedRecordIds,
    })),
  };
};
