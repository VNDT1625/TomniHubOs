import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  coreEvaluationClaimPayload,
  createCoreEvaluationPromotionGate,
  createEd25519CoreEvaluationReceiptVerifier,
} from '@/process/services/diagnostics/coreEvaluation';
import type { CoreEvaluationPromotionReceipt } from '@/process/services/diagnostics/coreEvaluation';

const receipt = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  receiptId: 'receipt-1',
  claim: {
    schemaVersion: 1,
    core: 'security',
    candidateArtifactDigest: `sha256-${'a'.repeat(64)}`,
    policyVersion: 'security-policy-v1',
    corpusVersion: 'security-corpus-v1',
    corpusDigest: `sha256-${'b'.repeat(64)}`,
    provenancePolicyVersion: 'provenance-v1',
    deletionLedgerVersion: 'deletion-v1',
    evaluatedAt: '2026-08-20T00:00:00.000Z',
    expiresAt: '2026-08-21T00:00:00.000Z',
    metrics: [
      {
        metricId: 'critical-false-allow-rate',
        numerator: 0,
        denominator: 6,
        comparator: 'lte',
        thresholdNumerator: 0,
        thresholdDenominator: 1,
      },
    ],
  },
  attestation: { keyId: 'release-key-1', signature: 'signed-proof' },
  ...overrides,
});

describe('CoreEvaluationPromotionGate', () => {
  it('fails closed without a trusted attestation verifier', async () => {
    const gate = createCoreEvaluationPromotionGate({ now: () => Date.parse('2026-08-20T12:00:00.000Z') });
    await expect(gate.evaluate(receipt())).resolves.toEqual({
      enabled: false,
      code: 'CORE_EVALUATION_VERIFIER_UNAVAILABLE',
    });
  });

  it('binds a passing trusted receipt exactly once', async () => {
    const gate = createCoreEvaluationPromotionGate({
      now: () => Date.parse('2026-08-20T12:00:00.000Z'),
      verifier: { verify: (candidate) => candidate.attestation.signature === 'signed-proof' },
    });
    await expect(gate.evaluate(receipt())).resolves.toEqual({
      enabled: true,
      code: 'CORE_EVALUATION_PROMOTION_ENABLED',
    });
    await expect(gate.evaluate(receipt())).resolves.toEqual({
      enabled: false,
      code: 'CORE_EVALUATION_RECEIPT_REPLAYED',
    });
  });

  it('rejects expired, malformed, and regressed evidence before verifier approval', async () => {
    const gate = createCoreEvaluationPromotionGate({
      now: () => Date.parse('2026-08-20T12:00:00.000Z'),
      verifier: { verify: () => true },
    });
    await expect(
      gate.evaluate(receipt({ claim: { ...receipt().claim, expiresAt: '2026-08-20T11:59:59.000Z' } }))
    ).resolves.toMatchObject({
      code: 'CORE_EVALUATION_RECEIPT_EXPIRED',
    });
    await expect(
      gate.evaluate(
        receipt({ claim: { ...receipt().claim, metrics: [{ ...receipt().claim.metrics[0], numerator: 1 }] } })
      )
    ).resolves.toMatchObject({ code: 'CORE_EVALUATION_METRIC_REGRESSED' });
    await expect(gate.evaluate({ schemaVersion: 1 })).resolves.toMatchObject({
      code: 'CORE_EVALUATION_RECEIPT_INVALID',
    });
  });

  it('verifies only an exact release-signed claim from a pinned Ed25519 key', async () => {
    const keys = generateKeyPairSync('ed25519');
    const unsigned = receipt({ attestation: { keyId: 'release-key-2', signature: 'pending' } });
    const signed = {
      ...unsigned,
      attestation: {
        keyId: 'release-key-2',
        signature: sign(
          null,
          coreEvaluationClaimPayload(unsigned as CoreEvaluationPromotionReceipt),
          keys.privateKey
        ).toString('base64'),
      },
    };
    const gate = createCoreEvaluationPromotionGate({
      now: () => Date.parse('2026-08-20T12:00:00.000Z'),
      verifier: createEd25519CoreEvaluationReceiptVerifier({
        'release-key-2': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      }),
    });

    await expect(gate.evaluate(signed)).resolves.toMatchObject({ enabled: true });
    const tampered = {
      ...signed,
      receiptId: 'receipt-2',
      claim: { ...signed.claim, policyVersion: 'security-policy-v2' },
    };
    await expect(gate.evaluate(tampered)).resolves.toMatchObject({
      enabled: false,
      code: 'CORE_EVALUATION_ATTESTATION_INVALID',
    });
  });
});
