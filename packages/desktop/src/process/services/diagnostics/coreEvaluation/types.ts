/**
 * Public, data-minimised promotion evidence for the three Core evaluators.
 * It deliberately contains only aggregate counters and immutable identifiers;
 * prompts, personal records, secrets, and sampled context are never valid here.
 */
export type CoreEvaluationKind = 'security' | 'user-intelligence' | 'orchestration';

export type CoreEvaluationMetric = Readonly<{
  metricId: string;
  numerator: number;
  denominator: number;
  comparator: 'gte' | 'lte' | 'eq';
  thresholdNumerator: number;
  thresholdDenominator: number;
}>;

export type CoreEvaluationClaim = Readonly<{
  schemaVersion: 1;
  core: CoreEvaluationKind;
  candidateArtifactDigest: string;
  policyVersion: string;
  corpusVersion: string;
  corpusDigest: string;
  provenancePolicyVersion: string;
  deletionLedgerVersion: string;
  evaluatedAt: string;
  expiresAt: string;
  metrics: readonly CoreEvaluationMetric[];
}>;

/** A release/CI attestation over the canonical serialisation of `claim`. */
export type CoreEvaluationPromotionReceipt = Readonly<{
  schemaVersion: 1;
  receiptId: string;
  claim: CoreEvaluationClaim;
  attestation: Readonly<{
    keyId: string;
    signature: string;
  }>;
}>;

export type CoreEvaluationPromotionDecision = Readonly<{
  enabled: boolean;
  code:
    | 'CORE_EVALUATION_PROMOTION_ENABLED'
    | 'CORE_EVALUATION_RECEIPT_INVALID'
    | 'CORE_EVALUATION_RECEIPT_EXPIRED'
    | 'CORE_EVALUATION_RECEIPT_REPLAYED'
    | 'CORE_EVALUATION_METRIC_REGRESSED'
    | 'CORE_EVALUATION_VERIFIER_UNAVAILABLE'
    | 'CORE_EVALUATION_ATTESTATION_INVALID';
}>;

export type CoreEvaluationReceiptVerifier = Readonly<{
  verify: (receipt: CoreEvaluationPromotionReceipt) => Promise<boolean> | boolean;
}>;
