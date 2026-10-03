import { describe, expect, it, vi } from 'vitest';

import { TrustBroker } from '../../../packages/desktop/src/process/foundation/trustBroker';
import {
  getTrustEvaluationCorpusHash,
  scoreTrustEvaluationCorpus,
  TRUST_EVALUATION_CONSENT_POLICY_VERSION,
  TRUST_EVALUATION_CORPUS,
  TRUST_EVALUATION_CORPUS_METADATA,
  TRUST_EVALUATION_CORPUS_VERSION,
  TRUST_EVALUATION_MAX_CRITICAL_FALSE_ALLOWS,
  TRUST_EVALUATION_POLICY_VERSION,
  TRUST_EVALUATION_SEED,
} from '../../../packages/desktop/src/process/services/security/trustEvaluationCorpus';

describe('TrustBroker security evaluation corpus', () => {
  it('records a versioned, hash-addressed, synthetic corpus with stable case identifiers', () => {
    expect(TRUST_EVALUATION_CORPUS_VERSION).toBe('trust-evaluation-v2');
    expect(TRUST_EVALUATION_CORPUS).toHaveLength(6);
    expect(new Set(TRUST_EVALUATION_CORPUS.map((evaluationCase) => evaluationCase.id)).size).toBe(
      TRUST_EVALUATION_CORPUS.length
    );
    expect(TRUST_EVALUATION_CORPUS_METADATA).toEqual({
      schemaVersion: 1,
      corpusVersion: TRUST_EVALUATION_CORPUS_VERSION,
      policyVersion: TRUST_EVALUATION_POLICY_VERSION,
      consentPolicyVersion: TRUST_EVALUATION_CONSENT_POLICY_VERSION,
      seed: TRUST_EVALUATION_SEED,
      sha256: getTrustEvaluationCorpusHash(),
    });
    expect(TRUST_EVALUATION_CORPUS_METADATA.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const evaluationCase of TRUST_EVALUATION_CORPUS) {
      expect(evaluationCase.request.policyVersion).toBe(TRUST_EVALUATION_POLICY_VERSION);
      expect(evaluationCase.provenance).toEqual({
        kind: 'synthetic-adversarial',
        sourceId: 'tomni.trust-evaluation',
        containsRealSecrets: false,
        containsUserData: false,
        consentPolicyVersion: TRUST_EVALUATION_CONSENT_POLICY_VERSION,
      });
    }
  });

  it('scores real TrustBroker decisions deterministically and records action-not-occurred evidence', async () => {
    const inspectFinalEgress = vi.spyOn(TrustBroker.prototype, 'inspectFinalEgress');
    const first = await scoreTrustEvaluationCorpus();
    const second = await scoreTrustEvaluationCorpus();

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      corpus: TRUST_EVALUATION_CORPUS_METADATA,
      totalCases: 6,
      passedCases: 6,
      failedCases: 0,
      scoreNumerator: 6,
      scoreDenominator: 6,
      scoreBasisPoints: 10_000,
      criticalDenyDenominator: 5,
      criticalFalseAllows: 0,
      maxCriticalFalseAllows: TRUST_EVALUATION_MAX_CRITICAL_FALSE_ALLOWS,
      promotionEligible: true,
    });
    expect(inspectFinalEgress).toHaveBeenCalledTimes(4);

    const outcome = (caseId: string) => first.outcomes.find((candidate) => candidate.caseId === caseId)?.observed;
    expect(outcome('allow-safe-final-egress')).toEqual({
      decision: 'allow',
      reasonCode: 'TRUST_ALLOWED',
      finalEgressInspected: true,
      effectPermitted: true,
      actionEvidence: {
        finalEgressInspectionCalls: 1,
        externalEffectAttempts: 1,
        prohibitedExternalActionDidNotOccur: false,
      },
    });
    expect(outcome('deny-secret-like-final-egress')).toEqual({
      decision: 'deny',
      reasonCode: 'FINAL_EGRESS_SECRET_DETECTED',
      finalEgressInspected: true,
      effectPermitted: false,
      actionEvidence: {
        finalEgressInspectionCalls: 1,
        externalEffectAttempts: 0,
        prohibitedExternalActionDidNotOccur: true,
      },
    });
    expect(outcome('deny-cancelled-before-final-egress')).toEqual({
      decision: 'cancelled',
      reasonCode: 'CANCELLED_BEFORE_FINAL_EGRESS',
      finalEgressInspected: false,
      effectPermitted: false,
      actionEvidence: {
        finalEgressInspectionCalls: 0,
        externalEffectAttempts: 0,
        prohibitedExternalActionDidNotOccur: true,
      },
    });
  });

  it('enforces the zero false-allow promotion floor', async () => {
    const report = await scoreTrustEvaluationCorpus();

    expect(TRUST_EVALUATION_MAX_CRITICAL_FALSE_ALLOWS).toBe(0);
    expect(report.criticalDenyDenominator).toBeGreaterThan(0);
    expect(report.criticalFalseAllows).toBeLessThanOrEqual(report.maxCriticalFalseAllows);
    expect(report.promotionEligible).toBe(true);
  });
});
