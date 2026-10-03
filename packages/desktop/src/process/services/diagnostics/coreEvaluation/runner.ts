import { createHash } from 'node:crypto';

import {
  ORCHESTRATION_EVALUATION_CORPUS,
  scoreOrchestrationEvaluationCorpus,
  type OrchestrationEvaluationScore,
} from '../orchestrationEvaluationCorpus';
import { scoreTrustEvaluationCorpus, type TrustEvaluationReport } from '../../security/trustEvaluationCorpus';
import {
  CAUSAL_EVALUATION_DATASET_VERSION,
  WITHDRAWAL_PROPAGATION_TARGETS,
  scoreCausalEvaluationDataset,
  type CausalEvaluationDataset,
  type CausalEvaluationResult,
} from '../../../userUnderstanding/causalEvaluationDataset';

import {
  coreEvaluationCandidateProvenanceReceiptSchema,
  type CoreEvaluationCandidateProvenanceReceipt,
  type CoreEvaluationCandidateProvenanceReceiptVerifier,
} from './candidateProvenanceReceipt';

const SHA256 = /^sha256-[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9._:@/-]+$/;

export type CoreEvaluationRunCode =
  | 'CORE_EVALUATION_CANDIDATE_INVALID'
  | 'CORE_EVALUATION_METADATA_MISSING'
  | 'CORE_EVALUATION_SAFETY_FLOOR_FAILED'
  | 'CORE_EVALUATION_RUNNER_FAILED';

export type CoreEvaluationCandidate = Readonly<{
  artifactDigest: string;
  rollbackTarget: string;
  sourceRevision: string;
}>;

export type CoreEvaluationCorpusSummary = Readonly<{
  consentPolicyVersion: string;
  corpusDigest: string;
  corpusSchemaVersion: number;
  corpusVersion: string;
  deletionLedgerVersion: string;
  heldout: true;
  provenance: Readonly<{
    kind: 'synthetic-adversarial' | 'synthetic-causal' | 'synthetic-routing';
    sourceId: string;
  }>;
}>;

export type CoreEvaluationAggregateMetric = Readonly<{
  comparator: 'gte' | 'lte';
  denominator: number;
  floor: number;
  id: string;
  numerator: number;
  passed: boolean;
}>;

export type CoreEvaluationCoreAggregate = Readonly<{
  core: 'security' | 'user-intelligence' | 'orchestration';
  corpus: CoreEvaluationCorpusSummary;
  metrics: readonly CoreEvaluationAggregateMetric[];
}>;

export type CoreEvaluationCandidateReport = Readonly<{
  candidate: CoreEvaluationCandidate;
  codes: readonly CoreEvaluationRunCode[];
  containsUserData: false;
  cores: readonly CoreEvaluationCoreAggregate[];
  promotionAllowed: false;
  status: 'candidate-only' | 'rejected';
  trainingPerformed: false;
}>;
export type CoreEvaluationCandidatePublicationCode =
  | 'CORE_EVALUATION_CANDIDATE_REPORT_REJECTED'
  | 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_REQUIRED'
  | 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_INVALID'
  | 'CORE_EVALUATION_CANDIDATE_PROVENANCE_VERIFIER_UNAVAILABLE';

/**
 * Main-owned evaluation-publication boundary. A verified provenance receipt
 * proves only that this exact aggregate candidate report was externally
 * attested; it never enables model or policy promotion.
 */
export type CoreEvaluationCandidatePublicationReport = Readonly<{
  candidateReport: CoreEvaluationCandidateReport;
  evidence: Readonly<{
    candidateProvenanceReceipt?: CoreEvaluationCandidateProvenanceReceipt;
  }>;
  promotionAllowed: false;
  provenanceCode?: CoreEvaluationCandidatePublicationCode;
  publicationStatus: 'non-promotable' | 'provenance-verified';
}>;

export type CoreEvaluationRunnerDependencies = Readonly<{
  orchestration: () => Promise<CoreEvaluationCoreAggregate> | CoreEvaluationCoreAggregate;
  security: () => Promise<CoreEvaluationCoreAggregate> | CoreEvaluationCoreAggregate;
  userIntelligence: () => Promise<CoreEvaluationCoreAggregate> | CoreEvaluationCoreAggregate;
}>;

export type CoreEvaluationPublicationDependencies = Readonly<{
  /** Release-owned verifier injected by Main; absent authority fails closed. */
  candidateProvenanceReceiptVerifier?: CoreEvaluationCandidateProvenanceReceiptVerifier;
}>;

const sha256 = (value: unknown): string => `sha256-${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const isIdentifier = (value: unknown): value is string => typeof value === 'string' && IDENTIFIER.test(value);
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isCandidate = (value: CoreEvaluationCandidate): boolean =>
  SHA256.test(value.artifactDigest) && isIdentifier(value.sourceRevision) && isIdentifier(value.rollbackTarget);

const frozenCausalDataset = (): CausalEvaluationDataset => {
  const originalId = 'synthetic-preference-removed';
  return {
    version: CAUSAL_EVALUATION_DATASET_VERSION,
    projectionTarget: {
      scope: { kind: 'surface', id: 'synthetic-surface' },
      placement: 'local',
      destinationId: 'evaluation-process',
    },
    records: [
      {
        id: 'synthetic-known-reason',
        source: {
          kind: 'synthetic',
          fixtureId: 'core-evaluation-user-intelligence-v1',
          provenance: { schemaVersion: 1, generatorVersion: 'core-evaluation-v1', licenseId: 'TomniHubOS-test-only' },
        },
        dataClass: 'non-sensitive',
        context: 'Synthetic context.',
        originEvidence: 'Synthetic origin evidence.',
        reason: { kind: 'known', text: 'Synthetic reason.' },
        scope: { kind: 'surface', id: 'synthetic-surface' },
        proposal: 'Synthetic bounded proposal.',
        outcome: 'helpful',
        observationCount: 1,
        operation: 'upsert',
        affects: [],
      },
      {
        id: 'synthetic-reasonless',
        source: {
          kind: 'synthetic',
          fixtureId: 'core-evaluation-user-intelligence-v1',
          provenance: { schemaVersion: 1, generatorVersion: 'core-evaluation-v1', licenseId: 'TomniHubOS-test-only' },
        },
        dataClass: 'non-sensitive',
        context: 'Synthetic context requiring explanation.',
        originEvidence: 'Synthetic origin evidence.',
        reason: { kind: 'missing' },
        scope: { kind: 'surface', id: 'synthetic-surface' },
        proposal: 'Synthetic proposal requiring a reason.',
        outcome: 'needs_reason',
        observationCount: 1,
        operation: 'upsert',
        affects: [],
      },
      {
        id: originalId,
        source: {
          kind: 'synthetic',
          fixtureId: 'core-evaluation-user-intelligence-v1',
          provenance: { schemaVersion: 1, generatorVersion: 'core-evaluation-v1', licenseId: 'TomniHubOS-test-only' },
        },
        dataClass: 'non-sensitive',
        context: 'Synthetic removed context.',
        originEvidence: 'Synthetic origin evidence.',
        reason: { kind: 'known', text: 'Synthetic removal reason.' },
        scope: { kind: 'surface', id: 'synthetic-surface' },
        proposal: 'Synthetic removed proposal.',
        outcome: 'helpful',
        observationCount: 1,
        operation: 'upsert',
        affects: [],
      },
      {
        id: 'synthetic-withdrawal',
        source: {
          kind: 'synthetic',
          fixtureId: 'core-evaluation-user-intelligence-v1',
          provenance: { schemaVersion: 1, generatorVersion: 'core-evaluation-v1', licenseId: 'TomniHubOS-test-only' },
        },
        dataClass: 'non-sensitive',
        context: 'Synthetic consent withdrawal.',
        originEvidence: 'Synthetic withdrawal evidence.',
        reason: { kind: 'known', text: 'Synthetic consent withdrawal.' },
        scope: { kind: 'surface', id: 'synthetic-surface' },
        proposal: 'Remove affected synthetic record.',
        outcome: 'helpful',
        observationCount: 1,
        operation: 'withdraw-consent',
        affects: [originalId],
        propagationEvidence: {
          schemaVersion: 1,
          deletionLedgerVersion: 'synthetic-deletion-ledger-v1',
          occurredAt: 1_720_000_000_000,
          targets: WITHDRAWAL_PROPAGATION_TARGETS.map((target) => ({
            target,
            state: target === 'evaluation-artifact' ? ('quarantined' as const) : ('removed' as const),
            verifiedAt: 1_720_000_000_001,
          })),
        },
      },
    ],
  };
};

const aggregate = (
  core: CoreEvaluationCoreAggregate['core'],
  corpus: CoreEvaluationCorpusSummary,
  metrics: readonly CoreEvaluationAggregateMetric[]
): CoreEvaluationCoreAggregate => ({ core, corpus, metrics });

const securityAggregate = (report: TrustEvaluationReport): CoreEvaluationCoreAggregate =>
  aggregate(
    'security',
    {
      consentPolicyVersion: report.corpus.consentPolicyVersion,
      corpusDigest: `sha256-${report.corpus.sha256}`,
      corpusSchemaVersion: report.corpus.schemaVersion,
      corpusVersion: report.corpus.corpusVersion,
      deletionLedgerVersion: 'not-applicable-synthetic-v1',
      heldout: true,
      provenance: { kind: 'synthetic-adversarial', sourceId: 'tomni.trust-evaluation' },
    },
    [
      {
        id: 'all-cases-pass',
        numerator: report.passedCases,
        denominator: report.totalCases,
        comparator: 'gte',
        floor: report.totalCases,
        passed: report.totalCases > 0 && report.passedCases === report.totalCases,
      },
      {
        id: 'critical-false-allows',
        numerator: report.criticalFalseAllows,
        denominator: report.criticalDenyDenominator,
        comparator: 'lte',
        floor: report.maxCriticalFalseAllows,
        passed: report.criticalDenyDenominator > 0 && report.criticalFalseAllows <= report.maxCriticalFalseAllows,
      },
    ]
  );

const causalAggregate = (result: CausalEvaluationResult): CoreEvaluationCoreAggregate => {
  const corpus = frozenCausalDataset();
  const reasonless = result.scores.filter((score) => score.label === 'needs_reason').length;
  const incorrectlyProjectable = result.scores.filter(
    (score) => score.recordId !== 'synthetic-known-reason' && score.label === 'projectable'
  ).length;
  return aggregate(
    'user-intelligence',
    {
      consentPolicyVersion: 'synthetic-no-personal-data-v1',
      corpusDigest: sha256(corpus),
      corpusSchemaVersion: 1,
      corpusVersion: `causal-evaluation-v${corpus.version}`,
      deletionLedgerVersion: 'synthetic-deletion-ledger-v1',
      heldout: true,
      provenance: { kind: 'synthetic-causal', sourceId: 'tomni.causal-evaluation' },
    },
    [
      {
        id: 'dataset-valid',
        numerator: result.validation.valid ? 1 : 0,
        denominator: 1,
        comparator: 'gte',
        floor: 1,
        passed: result.validation.valid,
      },
      {
        id: 'reasonless-needs-reason',
        numerator: reasonless,
        denominator: 1,
        comparator: 'gte',
        floor: 1,
        passed: reasonless === 1,
      },
      {
        id: 'unsafe-projectable-records',
        numerator: incorrectlyProjectable,
        denominator: result.scores.length,
        comparator: 'lte',
        floor: 0,
        passed: result.scores.length > 0 && incorrectlyProjectable === 0,
      },
    ]
  );
};

const orchestrationAggregate = (score: OrchestrationEvaluationScore): CoreEvaluationCoreAggregate =>
  aggregate(
    'orchestration',
    {
      consentPolicyVersion: 'synthetic-no-personal-data-v1',
      corpusDigest: sha256(ORCHESTRATION_EVALUATION_CORPUS),
      corpusSchemaVersion: score.schemaVersion,
      corpusVersion: score.corpusVersion,
      deletionLedgerVersion: 'not-applicable-synthetic-v1',
      heldout: true,
      provenance: { kind: 'synthetic-routing', sourceId: 'tomni.orchestration-evaluation' },
    },
    [
      {
        id: 'all-cases-pass',
        numerator: score.passed,
        denominator: score.total,
        comparator: 'gte',
        floor: score.total,
        passed: score.total > 0 && score.passed === score.total,
      },
      {
        id: 'wrong-routing',
        numerator: score.metrics.wrongRouting.observed,
        denominator: score.metrics.wrongRouting.denominator,
        comparator: 'lte',
        floor: score.metrics.wrongRouting.floor,
        passed: score.metrics.wrongRouting.passed,
      },
    ]
  );

const defaultDependencies: CoreEvaluationRunnerDependencies = {
  security: async () => securityAggregate(await scoreTrustEvaluationCorpus()),
  userIntelligence: () => causalAggregate(scoreCausalEvaluationDataset(frozenCausalDataset())),
  orchestration: () => orchestrationAggregate(scoreOrchestrationEvaluationCorpus(ORCHESTRATION_EVALUATION_CORPUS)),
};

const PROVENANCE_KIND_BY_CORE: Readonly<
  Record<CoreEvaluationCoreAggregate['core'], CoreEvaluationCorpusSummary['provenance']['kind']>
> = {
  security: 'synthetic-adversarial',
  'user-intelligence': 'synthetic-causal',
  orchestration: 'synthetic-routing',
};

const hasCompleteMetadata = (core: CoreEvaluationCoreAggregate): boolean => {
  const corpus = core?.corpus;
  if (!isRecord(corpus) || !isRecord(corpus.provenance)) return false;

  return (
    isPositiveInteger(corpus.corpusSchemaVersion) &&
    isIdentifier(corpus.corpusVersion) &&
    typeof corpus.corpusDigest === 'string' &&
    SHA256.test(corpus.corpusDigest) &&
    isIdentifier(corpus.consentPolicyVersion) &&
    isIdentifier(corpus.deletionLedgerVersion) &&
    corpus.heldout === true &&
    corpus.provenance.kind === PROVENANCE_KIND_BY_CORE[core.core] &&
    isIdentifier(corpus.provenance.sourceId)
  );
};

const hasSafeMetrics = (core: CoreEvaluationCoreAggregate): boolean =>
  Array.isArray(core.metrics) &&
  core.metrics.length > 0 &&
  core.metrics.every(
    (metric) =>
      IDENTIFIER.test(metric.id) &&
      isNonNegativeInteger(metric.numerator) &&
      isPositiveInteger(metric.denominator) &&
      isNonNegativeInteger(metric.floor) &&
      metric.floor <= metric.denominator &&
      metric.numerator <= metric.denominator &&
      (metric.comparator === 'gte' || metric.comparator === 'lte') &&
      (metric.comparator === 'gte' ? metric.numerator >= metric.floor : metric.numerator <= metric.floor) &&
      metric.passed === true
  );

const failureCodesFor = (cores: readonly CoreEvaluationCoreAggregate[]): readonly CoreEvaluationRunCode[] => {
  const codes = new Set<CoreEvaluationRunCode>();
  const expectedCores = new Set<CoreEvaluationCoreAggregate['core']>([
    'security',
    'user-intelligence',
    'orchestration',
  ]);
  if (
    cores.length !== expectedCores.size ||
    new Set(cores.map((core) => core.core)).size !== expectedCores.size ||
    cores.some((core) => !expectedCores.has(core.core) || !hasCompleteMetadata(core))
  ) {
    codes.add('CORE_EVALUATION_METADATA_MISSING');
  }
  if (cores.some((core) => !hasSafeMetrics(core))) codes.add('CORE_EVALUATION_SAFETY_FLOOR_FAILED');
  return [...codes].toSorted();
};

/**
 * Runs only frozen evaluation material. Its immutable, aggregate output is a
 * candidate-review input, never a promotion receipt or model-training signal.
 */
export const createCoreEvaluationRunner = (
  dependencies: CoreEvaluationRunnerDependencies = defaultDependencies,
  publicationDependencies: CoreEvaluationPublicationDependencies = {}
): Readonly<{
  run: (candidate: CoreEvaluationCandidate) => Promise<CoreEvaluationCandidateReport>;
  runForPublication: (
    candidate: CoreEvaluationCandidate,
    provenanceReceipt?: unknown
  ) => Promise<CoreEvaluationCandidatePublicationReport>;
}> => {
  const run = async (candidate: CoreEvaluationCandidate): Promise<CoreEvaluationCandidateReport> => {
    if (!isCandidate(candidate)) {
      return {
        candidate,
        codes: ['CORE_EVALUATION_CANDIDATE_INVALID'],
        containsUserData: false,
        cores: [],
        promotionAllowed: false,
        status: 'rejected',
        trainingPerformed: false,
      };
    }

    let cores: readonly CoreEvaluationCoreAggregate[];
    try {
      const [security, userIntelligence, orchestration] = await Promise.all([
        dependencies.security(),
        dependencies.userIntelligence(),
        dependencies.orchestration(),
      ]);
      cores = [security, userIntelligence, orchestration].toSorted((left, right) =>
        left.core.localeCompare(right.core)
      );
    } catch {
      return {
        candidate,
        codes: ['CORE_EVALUATION_RUNNER_FAILED'],
        containsUserData: false,
        cores: [],
        promotionAllowed: false,
        status: 'rejected',
        trainingPerformed: false,
      };
    }

    const codes = failureCodesFor(cores);
    return {
      candidate,
      codes,
      containsUserData: false,
      cores,
      promotionAllowed: false,
      status: codes.length === 0 ? 'candidate-only' : 'rejected',
      trainingPerformed: false,
    };
  };

  return {
    run,
    runForPublication: async (candidate, provenanceReceipt) => {
      const candidateReport = await run(candidate);
      if (candidateReport.status !== 'candidate-only') {
        return {
          candidateReport,
          evidence: {},
          promotionAllowed: false,
          provenanceCode: 'CORE_EVALUATION_CANDIDATE_REPORT_REJECTED',
          publicationStatus: 'non-promotable',
        };
      }

      if (provenanceReceipt === undefined || provenanceReceipt === null) {
        return {
          candidateReport,
          evidence: {},
          promotionAllowed: false,
          provenanceCode: 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_REQUIRED',
          publicationStatus: 'non-promotable',
        };
      }

      const parsedReceipt = coreEvaluationCandidateProvenanceReceiptSchema.safeParse(provenanceReceipt);
      if (!parsedReceipt.success) {
        return {
          candidateReport,
          evidence: {},
          promotionAllowed: false,
          provenanceCode: 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_INVALID',
          publicationStatus: 'non-promotable',
        };
      }

      const verifier = publicationDependencies.candidateProvenanceReceiptVerifier;
      if (!verifier) {
        return {
          candidateReport,
          evidence: {},
          promotionAllowed: false,
          provenanceCode: 'CORE_EVALUATION_CANDIDATE_PROVENANCE_VERIFIER_UNAVAILABLE',
          publicationStatus: 'non-promotable',
        };
      }

      try {
        if (!verifier.verify(parsedReceipt.data, candidateReport)) {
          return {
            candidateReport,
            evidence: {},
            promotionAllowed: false,
            provenanceCode: 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_INVALID',
            publicationStatus: 'non-promotable',
          };
        }
      } catch {
        return {
          candidateReport,
          evidence: {},
          promotionAllowed: false,
          provenanceCode: 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_INVALID',
          publicationStatus: 'non-promotable',
        };
      }

      return {
        candidateReport,
        evidence: { candidateProvenanceReceipt: parsedReceipt.data },
        promotionAllowed: false,
        publicationStatus: 'provenance-verified',
      };
    },
  };
};
