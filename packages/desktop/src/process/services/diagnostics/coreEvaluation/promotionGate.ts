import { verify } from 'node:crypto';
import { z } from 'zod';
import {
  createCoreCandidateArtifactWithdrawalAuthority,
  type CoreCandidateArtifactWithdrawalAuthority,
  type CoreCandidateArtifactWithdrawalStatus,
} from './candidatePlan';
import type {
  CoreEvaluationPromotionDecision,
  CoreEvaluationPromotionReceipt,
  CoreEvaluationReceiptVerifier,
} from './types';

const IDENTIFIER = /^[A-Za-z0-9._:@/-]+$/;
const SHA256 = /^sha256-[a-f0-9]{64}$/;
const text = z.string().trim().min(1).max(200).regex(IDENTIFIER);
const digest = z.string().regex(SHA256);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveCounter = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const metricSchema = z
  .object({
    metricId: text,
    numerator: counter,
    denominator: positiveCounter,
    comparator: z.enum(['gte', 'lte', 'eq']),
    thresholdNumerator: counter,
    thresholdDenominator: positiveCounter,
  })
  .strict()
  .superRefine((metric, context) => {
    if (metric.numerator > metric.denominator || metric.thresholdNumerator > metric.thresholdDenominator) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Evaluation ratios must be bounded by their denominator.',
      });
    }
  });

export const coreEvaluationPromotionReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: text,
    claim: z
      .object({
        schemaVersion: z.literal(1),
        core: z.enum(['security', 'user-intelligence', 'orchestration']),
        candidateArtifactDigest: digest,
        policyVersion: text,
        corpusVersion: text,
        corpusDigest: digest,
        provenancePolicyVersion: text,
        deletionLedgerVersion: text,
        evaluatedAt: z.string().datetime({ offset: true }),
        expiresAt: z.string().datetime({ offset: true }),
        metrics: z.array(metricSchema).min(1).max(100),
      })
      .strict()
      .superRefine((claim, context) => {
        if (Date.parse(claim.expiresAt) <= Date.parse(claim.evaluatedAt)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Promotion receipt expiry must follow evaluation.',
          });
        }
        const ids = new Set<string>();
        for (const [index, metric] of claim.metrics.entries()) {
          if (ids.has(metric.metricId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['metrics', index, 'metricId'],
              message: 'Metric ids must be unique.',
            });
          }
          ids.add(metric.metricId);
        }
      }),
    attestation: z.object({ keyId: text, signature: z.string().trim().min(1).max(16_384) }).strict(),
  })
  .strict();

const meetsMetricFloor = (metric: z.infer<typeof metricSchema>): boolean => {
  const observed = metric.numerator * metric.thresholdDenominator;
  const threshold = metric.thresholdNumerator * metric.denominator;
  switch (metric.comparator) {
    case 'gte':
      return observed >= threshold;
    case 'lte':
      return observed <= threshold;
    case 'eq':
      return observed === threshold;
  }
};

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
};

/** The canonical payload signed by release CI; the attestation cannot sign itself. */
export const coreEvaluationClaimPayload = (receipt: CoreEvaluationPromotionReceipt): Buffer =>
  Buffer.from(
    canonicalize({ schemaVersion: receipt.schemaVersion, receiptId: receipt.receiptId, claim: receipt.claim }),
    'utf8'
  );

/**
 * Ed25519 verifier for a release-owned keyring. Unknown keys never fall back
 * to package, provider, or user keys.
 */
export const createEd25519CoreEvaluationReceiptVerifier = (
  trustedKeys: Readonly<Record<string, string>>
): CoreEvaluationReceiptVerifier => ({
  verify: (receipt) => {
    const publicKey = trustedKeys[receipt.attestation.keyId];
    if (!publicKey) return false;
    try {
      return verify(
        null,
        coreEvaluationClaimPayload(receipt),
        publicKey,
        Buffer.from(receipt.attestation.signature, 'base64')
      );
    } catch {
      return false;
    }
  },
});

export type CoreEvaluationPromotionGateDecision =
  | CoreEvaluationPromotionDecision
  | Readonly<{
      enabled: false;
      code: 'CORE_EVALUATION_CANDIDATE_WITHDRAWN';
      withdrawalStatus: CoreCandidateArtifactWithdrawalStatus;
    }>;

export type CoreEvaluationPromotionGate = Readonly<{
  evaluate: (receipt: unknown) => Promise<CoreEvaluationPromotionGateDecision>;
}>;

/**
 * Fail-closed release gate for a candidate Core policy/model. It is deliberately
 * inert without an external trusted verifier; a local `passed: true` file can
 * never promote a candidate.
 */
export const createCoreEvaluationPromotionGate = (
  options: {
    /** Main-owned authority that tracks trusted candidate withdrawal receipts. */
    candidateWithdrawalAuthority?: CoreCandidateArtifactWithdrawalAuthority;
    verifier?: CoreEvaluationReceiptVerifier;
    now?: () => number;
  } = {}
): CoreEvaluationPromotionGate => {
  const now = options.now ?? Date.now;
  const consumedReceiptIds = new Set<string>();
  const candidateWithdrawalAuthority =
    options.candidateWithdrawalAuthority ?? createCoreCandidateArtifactWithdrawalAuthority();

  return {
    evaluate: async (rawReceipt) => {
      const parsed = coreEvaluationPromotionReceiptSchema.safeParse(rawReceipt);
      if (!parsed.success) return { enabled: false, code: 'CORE_EVALUATION_RECEIPT_INVALID' };
      const receipt = parsed.data as CoreEvaluationPromotionReceipt;
      const withdrawalStatus = candidateWithdrawalAuthority.statusFor(receipt.claim);
      if (withdrawalStatus) {
        return {
          enabled: false,
          code: 'CORE_EVALUATION_CANDIDATE_WITHDRAWN',
          withdrawalStatus,
        };
      }
      if (Date.parse(receipt.claim.expiresAt) <= now()) {
        return { enabled: false, code: 'CORE_EVALUATION_RECEIPT_EXPIRED' };
      }
      if (consumedReceiptIds.has(receipt.receiptId)) {
        return { enabled: false, code: 'CORE_EVALUATION_RECEIPT_REPLAYED' };
      }
      if (!receipt.claim.metrics.every(meetsMetricFloor)) {
        return { enabled: false, code: 'CORE_EVALUATION_METRIC_REGRESSED' };
      }
      if (!options.verifier) return { enabled: false, code: 'CORE_EVALUATION_VERIFIER_UNAVAILABLE' };
      if (!(await options.verifier.verify(receipt))) {
        return { enabled: false, code: 'CORE_EVALUATION_ATTESTATION_INVALID' };
      }
      consumedReceiptIds.add(receipt.receiptId);
      return { enabled: true, code: 'CORE_EVALUATION_PROMOTION_ENABLED' };
    },
  };
};
