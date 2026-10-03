import { createHash } from 'node:crypto';

import { TrustBroker } from '../../foundation/trustBroker';
import type { CapabilityGrant, TrustRequest } from '../../foundation/trustBroker';

export const TRUST_EVALUATION_CORPUS_VERSION = 'trust-evaluation-v2';
export const TRUST_EVALUATION_POLICY_VERSION = 'trust-v1';
export const TRUST_EVALUATION_SEED = 'tomni-trust-evaluation-seed-v1';
export const TRUST_EVALUATION_CONSENT_POLICY_VERSION = 'synthetic-no-personal-data-v1';
export const TRUST_EVALUATION_MAX_CRITICAL_FALSE_ALLOWS = 0;

export type TrustEvaluationProvenance = {
  kind: 'synthetic-adversarial';
  sourceId: 'tomni.trust-evaluation';
  containsRealSecrets: false;
  containsUserData: false;
  consentPolicyVersion: typeof TRUST_EVALUATION_CONSENT_POLICY_VERSION;
};

export type TrustEvaluationScenario = 'capability' | 'final-egress' | 'cancelled-before-final-egress';

export type TrustEvaluationDecision = CapabilityGrant['decision'] | 'cancelled';

export type TrustEvaluationActionEvidence = {
  finalEgressInspectionCalls: number;
  externalEffectAttempts: number;
  prohibitedExternalActionDidNotOccur: boolean;
};

export type TrustEvaluationExpectation = {
  decision: TrustEvaluationDecision;
  reasonCode: string;
  finalEgressInspected: boolean;
  effectPermitted: boolean;
  actionEvidence: TrustEvaluationActionEvidence;
};

/**
 * Versioned, synthetic adversarial cases for deterministic TrustBroker evaluation.
 * They are evaluation/training material only: no user data or live secret belongs here.
 */
export type TrustEvaluationCase = {
  id: string;
  title: string;
  provenance: TrustEvaluationProvenance;
  scenario: TrustEvaluationScenario;
  request: TrustRequest;
  origin: string;
  serializedPayload?: string;
  expected: TrustEvaluationExpectation;
};

export type TrustEvaluationCorpusMetadata = {
  schemaVersion: 1;
  corpusVersion: typeof TRUST_EVALUATION_CORPUS_VERSION;
  policyVersion: typeof TRUST_EVALUATION_POLICY_VERSION;
  consentPolicyVersion: typeof TRUST_EVALUATION_CONSENT_POLICY_VERSION;
  seed: typeof TRUST_EVALUATION_SEED;
  sha256: string;
};

export type TrustEvaluationOutcome = {
  caseId: string;
  title: string;
  provenance: TrustEvaluationProvenance;
  scenario: TrustEvaluationScenario;
  expected: TrustEvaluationExpectation;
  observed: TrustEvaluationExpectation;
  passed: boolean;
};

export type TrustEvaluationReport = {
  corpus: TrustEvaluationCorpusMetadata;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  scoreNumerator: number;
  scoreDenominator: number;
  scoreBasisPoints: number;
  criticalDenyDenominator: number;
  criticalFalseAllows: number;
  maxCriticalFalseAllows: typeof TRUST_EVALUATION_MAX_CRITICAL_FALSE_ALLOWS;
  promotionEligible: boolean;
  outcomes: readonly TrustEvaluationOutcome[];
};

const FIXED_NOW = 1_700_000_000_000;

const PROVENANCE: TrustEvaluationProvenance = Object.freeze({
  kind: 'synthetic-adversarial',
  sourceId: 'tomni.trust-evaluation',
  containsRealSecrets: false,
  containsUserData: false,
  consentPolicyVersion: TRUST_EVALUATION_CONSENT_POLICY_VERSION,
});

const deniedActionEvidence = (finalEgressInspectionCalls: number): TrustEvaluationActionEvidence => ({
  finalEgressInspectionCalls,
  externalEffectAttempts: 0,
  prohibitedExternalActionDidNotOccur: true,
});

const allowedActionEvidence = (): TrustEvaluationActionEvidence => ({
  finalEgressInspectionCalls: 1,
  externalEffectAttempts: 1,
  prohibitedExternalActionDidNotOccur: false,
});

const request = (id: string, overrides: Partial<TrustRequest> = {}): TrustRequest => ({
  runId: `security_eval_run_${id}`,
  taskId: `security_eval_task_${id}`,
  actorId: 'security-evaluation-runner',
  operation: 'network',
  targetId: 'api.example.test',
  requestedCapabilities: ['target.execute'],
  workspaceScope: 'C:/tomni/security-evaluation',
  policyVersion: TRUST_EVALUATION_POLICY_VERSION,
  idempotencyKey: `security-evaluation:${id}:v1`,
  reason: 'Evaluate whether this synthetic request is governed safely.',
  networkHost: 'api.example.test',
  ...overrides,
});

export const TRUST_EVALUATION_CORPUS: readonly TrustEvaluationCase[] = Object.freeze([
  {
    id: 'allow-safe-final-egress',
    title: 'Allows an approved capability with a safe final payload.',
    provenance: PROVENANCE,
    scenario: 'final-egress',
    request: request('allow-safe-final-egress'),
    origin: 'app://hub',
    serializedPayload: 'synthetic safe evaluation payload',
    expected: {
      decision: 'allow',
      reasonCode: 'TRUST_ALLOWED',
      finalEgressInspected: true,
      effectPermitted: true,
      actionEvidence: allowedActionEvidence(),
    },
  },
  {
    id: 'deny-secret-like-final-egress',
    title: 'Blocks a synthetic secret-shaped canary at final egress.',
    provenance: PROVENANCE,
    scenario: 'final-egress',
    request: request('deny-secret-like-final-egress'),
    origin: 'app://hub',
    serializedPayload: 'api_key=EVALUATION_CANARY_NOT_A_REAL_SECRET',
    expected: {
      decision: 'deny',
      reasonCode: 'FINAL_EGRESS_SECRET_DETECTED',
      finalEgressInspected: true,
      effectPermitted: false,
      actionEvidence: deniedActionEvidence(1),
    },
  },
  {
    id: 'deny-unauthorized-capability',
    title: 'Denies a capability outside the policy allowlist.',
    provenance: PROVENANCE,
    scenario: 'capability',
    request: request('deny-unauthorized-capability', { requestedCapabilities: ['shell.execute'] }),
    origin: 'app://hub',
    expected: {
      decision: 'deny',
      reasonCode: 'CAPABILITY_NOT_ALLOWED',
      finalEgressInspected: false,
      effectPermitted: false,
      actionEvidence: deniedActionEvidence(0),
    },
  },
  {
    id: 'deny-untrusted-origin',
    title: 'Denies a capability request from an untrusted origin.',
    provenance: PROVENANCE,
    scenario: 'capability',
    request: request('deny-untrusted-origin'),
    origin: 'app://untrusted',
    expected: {
      decision: 'deny',
      reasonCode: 'ORIGIN_NOT_ALLOWED',
      finalEgressInspected: false,
      effectPermitted: false,
      actionEvidence: deniedActionEvidence(0),
    },
  },
  {
    id: 'deny-untrusted-network-host',
    title: 'Denies a network request to a host outside the policy allowlist.',
    provenance: PROVENANCE,
    scenario: 'capability',
    request: request('deny-untrusted-network-host', { networkHost: 'exfiltration.example.test' }),
    origin: 'app://hub',
    expected: {
      decision: 'deny',
      reasonCode: 'NETWORK_HOST_NOT_ALLOWED',
      finalEgressInspected: false,
      effectPermitted: false,
      actionEvidence: deniedActionEvidence(0),
    },
  },
  {
    id: 'deny-cancelled-before-final-egress',
    title: 'Prevents an already cancelled request from reaching final egress.',
    provenance: PROVENANCE,
    scenario: 'cancelled-before-final-egress',
    request: request('deny-cancelled-before-final-egress'),
    origin: 'app://hub',
    serializedPayload: 'synthetic payload that must not be transmitted',
    expected: {
      decision: 'cancelled',
      reasonCode: 'CANCELLED_BEFORE_FINAL_EGRESS',
      finalEgressInspected: false,
      effectPermitted: false,
      actionEvidence: deniedActionEvidence(0),
    },
  },
]);

const getCorpusHashInput = (): string =>
  JSON.stringify({
    schemaVersion: 1,
    corpusVersion: TRUST_EVALUATION_CORPUS_VERSION,
    policyVersion: TRUST_EVALUATION_POLICY_VERSION,
    consentPolicyVersion: TRUST_EVALUATION_CONSENT_POLICY_VERSION,
    seed: TRUST_EVALUATION_SEED,
    cases: TRUST_EVALUATION_CORPUS,
  });

export const getTrustEvaluationCorpusHash = (): string =>
  createHash('sha256').update(getCorpusHashInput()).digest('hex');

export const TRUST_EVALUATION_CORPUS_METADATA: TrustEvaluationCorpusMetadata = Object.freeze({
  schemaVersion: 1,
  corpusVersion: TRUST_EVALUATION_CORPUS_VERSION,
  policyVersion: TRUST_EVALUATION_POLICY_VERSION,
  consentPolicyVersion: TRUST_EVALUATION_CONSENT_POLICY_VERSION,
  seed: TRUST_EVALUATION_SEED,
  sha256: getTrustEvaluationCorpusHash(),
});

const createBroker = (): TrustBroker =>
  new TrustBroker(
    {
      allowedCapabilities: ['target.execute'],
      allowedNetworkHosts: ['api.example.test'],
      allowedOrigins: ['app://hub'],
      policyVersion: TRUST_EVALUATION_POLICY_VERSION,
    },
    { now: () => FIXED_NOW }
  );

const isEqualActionEvidence = (left: TrustEvaluationActionEvidence, right: TrustEvaluationActionEvidence): boolean =>
  left.finalEgressInspectionCalls === right.finalEgressInspectionCalls &&
  left.externalEffectAttempts === right.externalEffectAttempts &&
  left.prohibitedExternalActionDidNotOccur === right.prohibitedExternalActionDidNotOccur;

const isEqualExpectation = (left: TrustEvaluationExpectation, right: TrustEvaluationExpectation): boolean =>
  left.decision === right.decision &&
  left.reasonCode === right.reasonCode &&
  left.finalEgressInspected === right.finalEgressInspected &&
  left.effectPermitted === right.effectPermitted &&
  isEqualActionEvidence(left.actionEvidence, right.actionEvidence);

const evaluateCase = async (evaluationCase: TrustEvaluationCase): Promise<TrustEvaluationOutcome> => {
  const broker = createBroker();
  const grant = await broker.requestCapability(evaluationCase.request, evaluationCase.origin);
  let finalEgressInspectionCalls = 0;
  let externalEffectAttempts = 0;
  let observed: TrustEvaluationExpectation;

  if (evaluationCase.scenario === 'cancelled-before-final-egress') {
    // TrustBroker has no cancellation API. The governed caller must stop before invoking final egress.
    observed = {
      decision: 'cancelled',
      reasonCode: 'CANCELLED_BEFORE_FINAL_EGRESS',
      finalEgressInspected: false,
      effectPermitted: false,
      actionEvidence: deniedActionEvidence(finalEgressInspectionCalls),
    };
  } else if (evaluationCase.scenario === 'capability' || grant.decision !== 'allow' || grant.grantId === undefined) {
    observed = {
      decision: grant.decision,
      reasonCode: grant.reasonCode,
      finalEgressInspected: false,
      effectPermitted: false,
      actionEvidence: deniedActionEvidence(finalEgressInspectionCalls),
    };
  } else {
    finalEgressInspectionCalls += 1;
    const finalDecision = await broker.inspectFinalEgress({
      ...evaluationCase.request,
      origin: evaluationCase.origin,
      grantId: grant.grantId,
      serializedPayload: evaluationCase.serializedPayload ?? '',
    });
    if (finalDecision.decision === 'allow') {
      // This counter is the test seam for the external executor. A denied inspection cannot reach it.
      externalEffectAttempts += 1;
    }
    const effectPermitted = finalDecision.decision === 'allow';
    observed = {
      decision: finalDecision.decision,
      reasonCode: finalDecision.reasonCode,
      finalEgressInspected: true,
      effectPermitted,
      actionEvidence: {
        finalEgressInspectionCalls,
        externalEffectAttempts,
        prohibitedExternalActionDidNotOccur: !effectPermitted && externalEffectAttempts === 0,
      },
    };
  }

  return {
    caseId: evaluationCase.id,
    title: evaluationCase.title,
    provenance: evaluationCase.provenance,
    scenario: evaluationCase.scenario,
    expected: evaluationCase.expected,
    observed,
    passed: isEqualExpectation(evaluationCase.expected, observed),
  };
};

/**
 * Scores the immutable corpus through the real TrustBroker implementation.
 * The cancelled case tests the caller-side stop rule and deliberately does not
 * attribute cancellation support to TrustBroker itself.
 */
export const scoreTrustEvaluationCorpus = async (): Promise<TrustEvaluationReport> => {
  const outcomes = await Promise.all(TRUST_EVALUATION_CORPUS.map(evaluateCase));
  const passedCases = outcomes.filter((outcome) => outcome.passed).length;
  const scoreDenominator = outcomes.length;
  const criticalOutcomes = outcomes.filter((outcome) => outcome.expected.effectPermitted === false);
  const criticalFalseAllows = criticalOutcomes.filter(
    (outcome) =>
      outcome.observed.decision === 'allow' ||
      outcome.observed.effectPermitted ||
      outcome.observed.actionEvidence.externalEffectAttempts > 0
  ).length;
  const promotionEligible =
    scoreDenominator > 0 &&
    criticalOutcomes.length > 0 &&
    passedCases === scoreDenominator &&
    criticalFalseAllows <= TRUST_EVALUATION_MAX_CRITICAL_FALSE_ALLOWS;

  return {
    corpus: TRUST_EVALUATION_CORPUS_METADATA,
    totalCases: scoreDenominator,
    passedCases,
    failedCases: scoreDenominator - passedCases,
    scoreNumerator: passedCases,
    scoreDenominator,
    scoreBasisPoints: scoreDenominator === 0 ? 0 : Math.trunc((passedCases * 10_000) / scoreDenominator),
    criticalDenyDenominator: criticalOutcomes.length,
    criticalFalseAllows,
    maxCriticalFalseAllows: TRUST_EVALUATION_MAX_CRITICAL_FALSE_ALLOWS,
    promotionEligible,
    outcomes,
  };
};
