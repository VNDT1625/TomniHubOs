import { verify } from 'node:crypto';

import { z } from 'zod';

const IDENTIFIER = /^[A-Za-z0-9._:@/-]+$/;
const SHA256 = /^sha256-[a-f0-9]{64}$/;
const identifier = z.string().trim().min(1).max(200).regex(IDENTIFIER);
const digest = z.string().regex(SHA256);
const instant = z.string().datetime({ offset: true });

const candidateIdentitySchema = z
  .object({
    core: z.enum(['security', 'user-intelligence', 'orchestration']),
    candidateArtifactDigest: digest,
  })
  .strict();

const withdrawalDispositionSchema = z.enum(['quarantine', 'retrain', 'no-future-use']);

/**
 * Data-minimised, release-attested withdrawal evidence. The evidence itself is
 * held by the deletion/provenance authority; this receipt retains only its
 * immutable digest so candidate metadata never carries personal records.
 */
export const coreCandidateArtifactWithdrawalReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    withdrawalReceiptId: identifier,
    claim: z
      .object({
        schemaVersion: z.literal(1),
        candidate: candidateIdentitySchema,
        withdrawal: z
          .object({
            deletionLedgerVersion: identifier,
            evidenceDigest: digest,
            evidenceVersion: identifier,
            occurredAt: instant,
            disposition: withdrawalDispositionSchema,
          })
          .strict(),
        issuedAt: instant,
      })
      .strict()
      .superRefine((claim, context) => {
        if (Date.parse(claim.issuedAt) < Date.parse(claim.withdrawal.occurredAt)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A withdrawal receipt cannot be issued before its evidence occurred.',
          });
        }
      }),
    attestation: z.object({ keyId: identifier, signature: z.string().trim().min(1).max(16_384) }).strict(),
  })
  .strict();

export type CoreCandidateArtifactIdentity = Readonly<{
  core: 'security' | 'user-intelligence' | 'orchestration';
  candidateArtifactDigest: string;
}>;

export type CoreCandidateArtifactWithdrawalReceipt = z.infer<typeof coreCandidateArtifactWithdrawalReceiptSchema>;
export type CoreCandidateArtifactWithdrawalDisposition = z.infer<typeof withdrawalDispositionSchema>;
export type CoreCandidateArtifactWithdrawalStatus = 'quarantined' | 'no-future-use';

export type CoreCandidateArtifactWithdrawalCode =
  | 'CORE_CANDIDATE_WITHDRAWAL_RECORDED'
  | 'CORE_CANDIDATE_WITHDRAWAL_RECEIPT_INVALID'
  | 'CORE_CANDIDATE_WITHDRAWAL_RECEIPT_REPLAYED'
  | 'CORE_CANDIDATE_WITHDRAWAL_AUTHORITY_UNAVAILABLE'
  | 'CORE_CANDIDATE_WITHDRAWAL_ATTESTATION_INVALID'
  | 'CORE_CANDIDATE_WITHDRAWAL_CANDIDATE_ALREADY_BLOCKED';

export type CoreCandidateArtifactWithdrawalDecision = Readonly<{
  code: CoreCandidateArtifactWithdrawalCode;
  receipt?: Readonly<{
    candidate: CoreCandidateArtifactIdentity;
    disposition: CoreCandidateArtifactWithdrawalDisposition;
    withdrawalReceiptId: string;
  }>;
  status: CoreCandidateArtifactWithdrawalStatus | 'rejected';
}>;

export type CoreCandidateArtifactWithdrawalReceiptVerifier = Readonly<{
  verify: (receipt: CoreCandidateArtifactWithdrawalReceipt) => Promise<boolean> | boolean;
}>;

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
};

/** The canonical payload signed by the deletion/provenance authority. */
export const coreCandidateArtifactWithdrawalClaimPayload = (receipt: CoreCandidateArtifactWithdrawalReceipt): Buffer =>
  Buffer.from(
    canonicalize({
      schemaVersion: receipt.schemaVersion,
      withdrawalReceiptId: receipt.withdrawalReceiptId,
      claim: receipt.claim,
    }),
    'utf8'
  );

/**
 * Verifies only receipts signed by the pinned Main-process withdrawal keyring.
 * Unknown package, provider, or user keys cannot make a candidate unavailable.
 */
export const createEd25519CoreCandidateArtifactWithdrawalReceiptVerifier = (
  trustedKeys: Readonly<Record<string, string>>
): CoreCandidateArtifactWithdrawalReceiptVerifier => ({
  verify: (receipt) => {
    const publicKey = trustedKeys[receipt.attestation.keyId];
    if (!publicKey) return false;
    try {
      return verify(
        null,
        coreCandidateArtifactWithdrawalClaimPayload(receipt),
        publicKey,
        Buffer.from(receipt.attestation.signature, 'base64')
      );
    } catch {
      return false;
    }
  },
});

const candidateKey = (candidate: CoreCandidateArtifactIdentity): string =>
  `${candidate.core}:${candidate.candidateArtifactDigest}`;

const parseCandidateIdentity = (value: unknown): CoreCandidateArtifactIdentity | undefined => {
  const parsed = candidateIdentitySchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { core, candidateArtifactDigest } = parsed.data;
  if (
    (core !== 'security' && core !== 'user-intelligence' && core !== 'orchestration') ||
    typeof candidateArtifactDigest !== 'string'
  ) {
    return undefined;
  }
  return { core, candidateArtifactDigest };
};

const statusForDisposition = (
  disposition: CoreCandidateArtifactWithdrawalDisposition
): CoreCandidateArtifactWithdrawalStatus => (disposition === 'quarantine' ? 'quarantined' : 'no-future-use');

const strongestWithdrawalStatus = (
  existing: CoreCandidateArtifactWithdrawalStatus,
  next: CoreCandidateArtifactWithdrawalStatus
): CoreCandidateArtifactWithdrawalStatus =>
  existing === 'no-future-use' || next === 'no-future-use' ? 'no-future-use' : 'quarantined';

export type CoreCandidateArtifactWithdrawalAuthority = Readonly<{
  /**
   * Records a trusted withdrawal receipt and makes the exact candidate
   * ineligible for every future promotion decision in this process lifetime.
   */
  record: (receipt: unknown) => Promise<CoreCandidateArtifactWithdrawalDecision>;
  statusFor: (candidate: unknown) => CoreCandidateArtifactWithdrawalStatus | undefined;
}>;

/**
 * Main-owned in-memory authority for candidate-only artifacts. It has no model
 * loader, trainer, filesystem, renderer, or network capability. Durable
 * recovery of this policy ledger remains a separate release requirement.
 */
export const createCoreCandidateArtifactWithdrawalAuthority = (
  options: { verifier?: CoreCandidateArtifactWithdrawalReceiptVerifier } = {}
): CoreCandidateArtifactWithdrawalAuthority => {
  const consumedReceiptIds = new Set<string>();
  const blockedCandidates = new Map<string, CoreCandidateArtifactWithdrawalStatus>();

  return {
    record: async (rawReceipt) => {
      const parsed = coreCandidateArtifactWithdrawalReceiptSchema.safeParse(rawReceipt);
      if (!parsed.success) return { status: 'rejected', code: 'CORE_CANDIDATE_WITHDRAWAL_RECEIPT_INVALID' };

      const receipt = parsed.data;
      if (consumedReceiptIds.has(receipt.withdrawalReceiptId)) {
        return { status: 'rejected', code: 'CORE_CANDIDATE_WITHDRAWAL_RECEIPT_REPLAYED' };
      }
      if (!options.verifier) {
        return { status: 'rejected', code: 'CORE_CANDIDATE_WITHDRAWAL_AUTHORITY_UNAVAILABLE' };
      }
      try {
        if (!(await options.verifier.verify(receipt))) {
          return { status: 'rejected', code: 'CORE_CANDIDATE_WITHDRAWAL_ATTESTATION_INVALID' };
        }
      } catch {
        return { status: 'rejected', code: 'CORE_CANDIDATE_WITHDRAWAL_ATTESTATION_INVALID' };
      }

      const identity = parseCandidateIdentity(receipt.claim.candidate);
      if (!identity) return { status: 'rejected', code: 'CORE_CANDIDATE_WITHDRAWAL_RECEIPT_INVALID' };
      const key = candidateKey(identity);
      const status = statusForDisposition(receipt.claim.withdrawal.disposition);
      consumedReceiptIds.add(receipt.withdrawalReceiptId);
      const existingStatus = blockedCandidates.get(key);
      if (existingStatus) {
        const effectiveStatus = strongestWithdrawalStatus(existingStatus, status);
        blockedCandidates.set(key, effectiveStatus);
        return {
          status: effectiveStatus,
          code: 'CORE_CANDIDATE_WITHDRAWAL_CANDIDATE_ALREADY_BLOCKED',
          receipt: {
            candidate: identity,
            disposition: receipt.claim.withdrawal.disposition,
            withdrawalReceiptId: receipt.withdrawalReceiptId,
          },
        };
      }

      blockedCandidates.set(key, status);
      return {
        status,
        code: 'CORE_CANDIDATE_WITHDRAWAL_RECORDED',
        receipt: {
          candidate: identity,
          disposition: receipt.claim.withdrawal.disposition,
          withdrawalReceiptId: receipt.withdrawalReceiptId,
        },
      };
    },
    statusFor: (rawCandidate) => {
      if (!rawCandidate || typeof rawCandidate !== 'object') return undefined;
      const candidate = rawCandidate as Record<string, unknown>;
      const identity = parseCandidateIdentity({
        core: candidate.core,
        candidateArtifactDigest: candidate.candidateArtifactDigest,
      });
      if (!identity) return undefined;
      return blockedCandidates.get(candidateKey(identity));
    },
  };
};
