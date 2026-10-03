import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  coreCandidateArtifactWithdrawalClaimPayload,
  createCoreCandidateArtifactWithdrawalAuthority,
  createEd25519CoreCandidateArtifactWithdrawalReceiptVerifier,
} from '@/process/services/diagnostics/coreEvaluation/candidatePlan';
import { createCoreEvaluationPromotionGate } from '@/process/services/diagnostics/coreEvaluation/promotionGate';

const sha = (letter: string): `sha256-${string}` => `sha256-${letter.repeat(64)}`;
const candidate = { core: 'security' as const, candidateArtifactDigest: sha('a') };

const withdrawalReceipt = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  withdrawalReceiptId: 'withdrawal-receipt-1',
  claim: {
    schemaVersion: 1,
    candidate,
    withdrawal: {
      deletionLedgerVersion: 'deletion-ledger-v1',
      evidenceDigest: sha('b'),
      evidenceVersion: 'withdrawal-evidence-v1',
      occurredAt: '2026-08-20T00:00:00.000Z',
      disposition: 'quarantine' as const,
    },
    issuedAt: '2026-08-20T00:01:00.000Z',
  },
  attestation: { keyId: 'withdrawal-key-1', signature: 'pending' },
  ...overrides,
});

const signedWithdrawalReceipt = (privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']) => {
  const unsigned = withdrawalReceipt();
  return {
    ...unsigned,
    attestation: {
      ...unsigned.attestation,
      signature: sign(null, coreCandidateArtifactWithdrawalClaimPayload(unsigned), privateKey).toString('base64'),
    },
  };
};

const promotionReceipt = () => ({
  schemaVersion: 1,
  receiptId: 'promotion-receipt-1',
  claim: {
    schemaVersion: 1,
    ...candidate,
    policyVersion: 'security-policy-v1',
    corpusVersion: 'security-corpus-v1',
    corpusDigest: sha('c'),
    provenancePolicyVersion: 'provenance-v1',
    deletionLedgerVersion: 'deletion-ledger-v1',
    evaluatedAt: '2026-08-20T00:00:00.000Z',
    expiresAt: '2026-08-21T00:00:00.000Z',
    metrics: [
      {
        metricId: 'critical-false-allow-rate',
        numerator: 0,
        denominator: 6,
        comparator: 'lte' as const,
        thresholdNumerator: 0,
        thresholdDenominator: 1,
      },
    ],
  },
  attestation: { keyId: 'release-key-1', signature: 'signed-proof' },
});

describe('CoreCandidateArtifactWithdrawalAuthority', () => {
  it('requires trusted withdrawal evidence, quarantines the exact candidate, and denies its later promotion', async () => {
    const keys = generateKeyPairSync('ed25519');
    const authority = createCoreCandidateArtifactWithdrawalAuthority({
      verifier: createEd25519CoreCandidateArtifactWithdrawalReceiptVerifier({
        'withdrawal-key-1': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      }),
    });

    await expect(authority.record(signedWithdrawalReceipt(keys.privateKey))).resolves.toMatchObject({
      status: 'quarantined',
      code: 'CORE_CANDIDATE_WITHDRAWAL_RECORDED',
      receipt: { candidate, disposition: 'quarantine' },
    });
    expect(authority.statusFor(candidate)).toBe('quarantined');
    expect(authority.statusFor({ ...candidate, candidateArtifactDigest: sha('d') })).toBeUndefined();

    const gate = createCoreEvaluationPromotionGate({
      candidateWithdrawalAuthority: authority,
      now: () => Date.parse('2026-08-20T12:00:00.000Z'),
      verifier: { verify: (receipt) => receipt.attestation.signature === 'signed-proof' },
    });
    await expect(gate.evaluate(promotionReceipt())).resolves.toEqual({
      enabled: false,
      code: 'CORE_EVALUATION_CANDIDATE_WITHDRAWN',
      withdrawalStatus: 'quarantined',
    });
  });

  it('maps retrain and no-future-use evidence to an irreversible future-use denial', async () => {
    const authority = createCoreCandidateArtifactWithdrawalAuthority({ verifier: { verify: () => true } });
    const retrain = withdrawalReceipt({
      claim: {
        ...withdrawalReceipt().claim,
        withdrawal: { ...withdrawalReceipt().claim.withdrawal, disposition: 'retrain' },
      },
    });
    const noFutureUse = withdrawalReceipt({
      withdrawalReceiptId: 'withdrawal-receipt-2',
      claim: {
        ...withdrawalReceipt().claim,
        withdrawal: { ...withdrawalReceipt().claim.withdrawal, disposition: 'no-future-use' },
      },
    });

    await expect(authority.record(retrain)).resolves.toMatchObject({
      status: 'no-future-use',
      code: 'CORE_CANDIDATE_WITHDRAWAL_RECORDED',
    });
    await expect(authority.record(noFutureUse)).resolves.toMatchObject({
      status: 'no-future-use',
      code: 'CORE_CANDIDATE_WITHDRAWAL_CANDIDATE_ALREADY_BLOCKED',
    });
  });

  it('escalates a quarantined candidate to no-future-use when later trusted evidence requires retraining', async () => {
    const authority = createCoreCandidateArtifactWithdrawalAuthority({ verifier: { verify: () => true } });
    const retrain = withdrawalReceipt({
      withdrawalReceiptId: 'withdrawal-receipt-retrain',
      claim: {
        ...withdrawalReceipt().claim,
        withdrawal: { ...withdrawalReceipt().claim.withdrawal, disposition: 'retrain' },
      },
    });

    await expect(authority.record(withdrawalReceipt())).resolves.toMatchObject({
      status: 'quarantined',
      code: 'CORE_CANDIDATE_WITHDRAWAL_RECORDED',
    });
    await expect(authority.record(retrain)).resolves.toMatchObject({
      status: 'no-future-use',
      code: 'CORE_CANDIDATE_WITHDRAWAL_CANDIDATE_ALREADY_BLOCKED',
    });
    expect(authority.statusFor(candidate)).toBe('no-future-use');
  });

  it('fails closed for unavailable, replayed, malformed, or tampered withdrawal receipts', async () => {
    const unavailable = createCoreCandidateArtifactWithdrawalAuthority();
    await expect(unavailable.record(withdrawalReceipt())).resolves.toEqual({
      status: 'rejected',
      code: 'CORE_CANDIDATE_WITHDRAWAL_AUTHORITY_UNAVAILABLE',
    });

    const authority = createCoreCandidateArtifactWithdrawalAuthority({
      verifier: { verify: (receipt) => receipt.attestation.signature === 'trusted' },
    });
    const trusted = withdrawalReceipt({ attestation: { keyId: 'withdrawal-key-1', signature: 'trusted' } });
    await expect(authority.record(trusted)).resolves.toMatchObject({
      status: 'quarantined',
      code: 'CORE_CANDIDATE_WITHDRAWAL_RECORDED',
    });
    await expect(authority.record(trusted)).resolves.toEqual({
      status: 'rejected',
      code: 'CORE_CANDIDATE_WITHDRAWAL_RECEIPT_REPLAYED',
    });
    await expect(
      authority.record(
        withdrawalReceipt({
          withdrawalReceiptId: 'withdrawal-receipt-tampered',
          attestation: { keyId: 'withdrawal-key-1', signature: 'tampered' },
        })
      )
    ).resolves.toEqual({
      status: 'rejected',
      code: 'CORE_CANDIDATE_WITHDRAWAL_ATTESTATION_INVALID',
    });
    const throwingAuthority = createCoreCandidateArtifactWithdrawalAuthority({
      verifier: { verify: () => Promise.reject(new Error('authority unavailable')) },
    });
    await expect(throwingAuthority.record(withdrawalReceipt())).resolves.toEqual({
      status: 'rejected',
      code: 'CORE_CANDIDATE_WITHDRAWAL_ATTESTATION_INVALID',
    });
    await expect(authority.record({ schemaVersion: 1 })).resolves.toEqual({
      status: 'rejected',
      code: 'CORE_CANDIDATE_WITHDRAWAL_RECEIPT_INVALID',
    });
  });
});
