import { createHash, verify } from 'node:crypto';

import { z } from 'zod';

const IDENTIFIER = /^[A-Za-z0-9._:@/-]+$/;
const SHA256 = /^sha256-[a-f0-9]{64}$/;

const identifier = z.string().trim().min(1).max(200).regex(IDENTIFIER);
const digest = z.string().regex(SHA256);

const candidateSchema = z
  .object({
    artifactDigest: digest,
    rollbackTarget: identifier,
    sourceRevision: identifier,
  })
  .strict();

const metricSchema = z
  .object({
    comparator: z.enum(['gte', 'lte']),
    denominator: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    floor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    id: identifier,
    numerator: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    passed: z.literal(true),
  })
  .strict()
  .superRefine((metric, context) => {
    if (metric.floor > metric.denominator || metric.numerator > metric.denominator) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Evaluation ratios must be bounded by their denominator.',
      });
    }
  });

const corpusSchema = z
  .object({
    consentPolicyVersion: identifier,
    corpusDigest: digest,
    corpusSchemaVersion: z.number().int().positive(),
    corpusVersion: identifier,
    deletionLedgerVersion: identifier,
    heldout: z.literal(true),
    provenance: z
      .object({
        kind: z.enum(['synthetic-adversarial', 'synthetic-causal', 'synthetic-routing']),
        sourceId: identifier,
      })
      .strict(),
  })
  .strict();

const coreAggregateSchema = z
  .object({
    core: z.enum(['security', 'user-intelligence', 'orchestration']),
    corpus: corpusSchema,
    metrics: z.array(metricSchema).min(1).max(100),
  })
  .strict();

/**
 * Strict, aggregate-only report input accepted for candidate provenance. It is
 * intentionally narrower than an evaluation runner implementation so private
 * prompts, samples, key material, and arbitrary extension fields cannot be
 * hidden behind the signed report digest.
 */
export const coreEvaluationCandidateReportForProvenanceSchema = z
  .object({
    candidate: candidateSchema,
    codes: z.array(z.never()).length(0),
    containsUserData: z.literal(false),
    cores: z.array(coreAggregateSchema).length(3),
    promotionAllowed: z.literal(false),
    status: z.literal('candidate-only'),
    trainingPerformed: z.literal(false),
  })
  .strict()
  .superRefine((report, context) => {
    const cores = new Set(report.cores.map((core) => core.core));
    const expected = ['security', 'user-intelligence', 'orchestration'] as const;
    if (cores.size !== expected.length || expected.some((core) => !cores.has(core))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cores'],
        message: 'A receipt-bound candidate report must carry exactly one aggregate for each Core.',
      });
    }
  });

const candidateProvenanceClaimSchema = z
  .object({
    candidate: candidateSchema,
    corpusDigests: z
      .object({
        orchestration: digest,
        security: digest,
        userIntelligence: digest,
      })
      .strict(),
    reportDigest: digest,
    schemaVersion: z.literal(1),
  })
  .strict();

export const coreEvaluationCandidateProvenanceReceiptSchema = z
  .object({
    attestation: z
      .object({
        keyId: identifier,
        signature: z.string().trim().min(1).max(16_384),
      })
      .strict(),
    claim: candidateProvenanceClaimSchema,
    receiptId: identifier,
    schemaVersion: z.literal(1),
  })
  .strict();

export type CoreEvaluationCandidateProvenanceClaim = z.infer<typeof candidateProvenanceClaimSchema>;
export type CoreEvaluationCandidateProvenanceReceipt = z.infer<typeof coreEvaluationCandidateProvenanceReceiptSchema>;

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
};

const digestCandidateReport = (report: z.infer<typeof coreEvaluationCandidateReportForProvenanceSchema>): string =>
  `sha256-${createHash('sha256').update(canonicalize(report), 'utf8').digest('hex')}`;

/**
 * Derives the complete deterministic claim from a valid, aggregate-only report.
 * No private input or arbitrary caller-supplied digest participates in the
 * claim, and invalid/missing Core records produce no claim to sign.
 */
export const createCoreEvaluationCandidateProvenanceClaim = (
  rawReport: unknown
): CoreEvaluationCandidateProvenanceClaim | undefined => {
  const parsed = coreEvaluationCandidateReportForProvenanceSchema.safeParse(rawReport);
  if (!parsed.success) return undefined;

  const byCore = new Map(parsed.data.cores.map((core) => [core.core, core.corpus.corpusDigest]));
  const security = byCore.get('security');
  const userIntelligence = byCore.get('user-intelligence');
  const orchestration = byCore.get('orchestration');
  if (!security || !userIntelligence || !orchestration) return undefined;

  return {
    schemaVersion: 1,
    candidate: parsed.data.candidate,
    corpusDigests: { orchestration, security, userIntelligence },
    reportDigest: digestCandidateReport(parsed.data),
  };
};

/** The canonical payload attested by the release-provenance Ed25519 keyring. */
export const coreEvaluationCandidateProvenanceReceiptPayload = (
  receipt: CoreEvaluationCandidateProvenanceReceipt
): Buffer =>
  Buffer.from(
    canonicalize({
      schemaVersion: receipt.schemaVersion,
      receiptId: receipt.receiptId,
      claim: receipt.claim,
    }),
    'utf8'
  );

export type CoreEvaluationCandidateProvenanceReceiptVerifier = Readonly<{
  /**
   * Fails closed unless the signed claim is exactly derived from this report.
   * A signature over an unrelated source revision, artifact, corpus, or report
   * digest is not candidate provenance for the supplied report.
   */
  verify: (receipt: unknown, report: unknown) => boolean;
}>;

/**
 * Reuses the release proof's Ed25519/key-id trust shape. It deliberately has
 * no signer and no fallback key: production key availability and clean-source
 * closure remain separate release-handoff evidence.
 */
export const createEd25519CoreEvaluationCandidateProvenanceReceiptVerifier = (
  trustedKeys: Readonly<Record<string, string>>
): CoreEvaluationCandidateProvenanceReceiptVerifier => ({
  verify: (rawReceipt, rawReport) => {
    const parsedReceipt = coreEvaluationCandidateProvenanceReceiptSchema.safeParse(rawReceipt);
    const expectedClaim = createCoreEvaluationCandidateProvenanceClaim(rawReport);
    if (!parsedReceipt.success || !expectedClaim) return false;

    const receipt = parsedReceipt.data;
    if (canonicalize(receipt.claim) !== canonicalize(expectedClaim)) return false;

    const publicKey = trustedKeys[receipt.attestation.keyId];
    if (!publicKey) return false;
    try {
      return verify(
        null,
        coreEvaluationCandidateProvenanceReceiptPayload(receipt),
        publicKey,
        Buffer.from(receipt.attestation.signature, 'base64')
      );
    } catch {
      return false;
    }
  },
});
