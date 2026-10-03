import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  coreEvaluationCandidateProvenanceReceiptPayload,
  createCoreEvaluationCandidateProvenanceClaim,
  createEd25519CoreEvaluationCandidateProvenanceReceiptVerifier,
  type CoreEvaluationCandidateProvenanceReceipt,
} from '@/process/services/diagnostics/coreEvaluation/candidateProvenanceReceipt';
import {
  createCoreEvaluationRunner,
  type CoreEvaluationCandidateReport,
} from '@/process/services/diagnostics/coreEvaluation/runner';

const sha = (letter: string): `sha256-${string}` => `sha256-${letter.repeat(64)}`;

const candidate = {
  artifactDigest: sha('a'),
  rollbackTarget: 'release-2026.08.21',
  sourceRevision: 'release-2026.08.22',
} as const;

const report = async (): Promise<CoreEvaluationCandidateReport> => createCoreEvaluationRunner().run(candidate);

const signedReceipt = (reportInput: CoreEvaluationCandidateReport) => {
  const claim = createCoreEvaluationCandidateProvenanceClaim(reportInput);
  if (!claim) throw new Error('Fixture report must have a candidate provenance claim.');

  const keys = generateKeyPairSync('ed25519');
  const unsigned: CoreEvaluationCandidateProvenanceReceipt = {
    schemaVersion: 1,
    receiptId: 'candidate-provenance-receipt-1',
    claim,
    attestation: { keyId: 'release-candidate-key-1', signature: 'pending' },
  };
  const receipt: CoreEvaluationCandidateProvenanceReceipt = {
    ...unsigned,
    attestation: {
      ...unsigned.attestation,
      signature: sign(null, coreEvaluationCandidateProvenanceReceiptPayload(unsigned), keys.privateKey).toString(
        'base64'
      ),
    },
  };
  const verifier = createEd25519CoreEvaluationCandidateProvenanceReceiptVerifier({
    'release-candidate-key-1': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  return { receipt, verifier };
};

describe('Core evaluation candidate provenance receipt', () => {
  it('deterministically binds the candidate identity, three held-out corpus digests, and aggregate report to an Ed25519 receipt', async () => {
    const candidateReport = await report();
    const firstClaim = createCoreEvaluationCandidateProvenanceClaim(candidateReport);
    const secondClaim = createCoreEvaluationCandidateProvenanceClaim(candidateReport);
    const { receipt, verifier } = signedReceipt(candidateReport);

    expect(secondClaim).toEqual(firstClaim);
    expect(firstClaim).toMatchObject({
      candidate,
      corpusDigests: {
        security: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
        userIntelligence: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
        orchestration: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
      },
      reportDigest: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
    });
    expect(verifier.verify(receipt, candidateReport)).toBe(true);
  });

  it('fails closed when a signed receipt is paired with another revision, artifact, rollback, report, or any one Core corpus', async () => {
    const candidateReport = await report();
    const { receipt, verifier } = signedReceipt(candidateReport);
    const changedCorpusReport = (coreName: CoreEvaluationCandidateReport['cores'][number]['core']) => ({
      ...candidateReport,
      cores: candidateReport.cores.map((core) =>
        core.core === coreName ? { ...core, corpus: { ...core.corpus, corpusDigest: sha('d') } } : core
      ),
    });

    expect(
      verifier.verify(receipt, {
        ...candidateReport,
        candidate: { ...candidateReport.candidate, sourceRevision: 'other' },
      })
    ).toBe(false);
    expect(
      verifier.verify(receipt, {
        ...candidateReport,
        candidate: { ...candidateReport.candidate, artifactDigest: sha('e') },
      })
    ).toBe(false);
    expect(
      verifier.verify(receipt, {
        ...candidateReport,
        candidate: { ...candidateReport.candidate, rollbackTarget: 'other-rollback' },
      })
    ).toBe(false);
    for (const core of ['security', 'user-intelligence', 'orchestration'] as const) {
      expect(verifier.verify(receipt, changedCorpusReport(core))).toBe(false);
    }
    expect(verifier.verify({ ...receipt, claim: { ...receipt.claim, reportDigest: sha('f') } }, candidateReport)).toBe(
      false
    );
  });

  it('does not create or accept a receipt claim when any required aggregate input is absent or hidden data is added', async () => {
    const candidateReport = await report();
    const { receipt, verifier } = signedReceipt(candidateReport);
    const missingSecurity = {
      ...candidateReport,
      cores: candidateReport.cores.filter((core) => core.core !== 'security'),
    };

    expect(createCoreEvaluationCandidateProvenanceClaim(missingSecurity)).toBeUndefined();
    expect(
      createCoreEvaluationCandidateProvenanceClaim({ ...candidateReport, privatePrompt: 'do not sign' })
    ).toBeUndefined();
    expect(verifier.verify(receipt, missingSecurity)).toBe(false);
    expect(verifier.verify({ ...receipt, claim: { ...receipt.claim, reportDigest: undefined } }, candidateReport)).toBe(
      false
    );
    expect(createEd25519CoreEvaluationCandidateProvenanceReceiptVerifier({}).verify(receipt, candidateReport)).toBe(
      false
    );
  });

  it('keeps an evaluated report non-promotable with a stable reason until an explicit provenance receipt is verified', async () => {
    const runner = createCoreEvaluationRunner();

    await expect(runner.runForPublication(candidate)).resolves.toMatchObject({
      evidence: {},
      promotionAllowed: false,
      provenanceCode: 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_REQUIRED',
      publicationStatus: 'non-promotable',
    });
    await expect(runner.runForPublication(candidate, {})).resolves.toMatchObject({
      evidence: {},
      promotionAllowed: false,
      provenanceCode: 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_INVALID',
      publicationStatus: 'non-promotable',
    });
  });

  it('carries only an externally verified receipt into publication evidence without enabling promotion', async () => {
    const candidateReport = await report();
    const { receipt, verifier } = signedReceipt(candidateReport);
    const runner = createCoreEvaluationRunner(undefined, { candidateProvenanceReceiptVerifier: verifier });

    await expect(runner.runForPublication(candidate, receipt)).resolves.toMatchObject({
      candidateReport: { candidate, status: 'candidate-only' },
      evidence: { candidateProvenanceReceipt: receipt },
      promotionAllowed: false,
      publicationStatus: 'provenance-verified',
    });
    await expect(
      runner.runForPublication({ ...candidate, sourceRevision: 'different-revision' }, receipt)
    ).resolves.toMatchObject({
      evidence: {},
      promotionAllowed: false,
      provenanceCode: 'CORE_EVALUATION_CANDIDATE_PROVENANCE_RECEIPT_INVALID',
      publicationStatus: 'non-promotable',
    });
  });

  it('does not allow a rejected candidate report to reach receipt verification', async () => {
    const candidateReport = await report();
    const { receipt, verifier } = signedReceipt(candidateReport);
    const runner = createCoreEvaluationRunner(undefined, { candidateProvenanceReceiptVerifier: verifier });

    await expect(
      runner.runForPublication({ ...candidate, sourceRevision: 'invalid revision' }, receipt)
    ).resolves.toMatchObject({
      evidence: {},
      promotionAllowed: false,
      provenanceCode: 'CORE_EVALUATION_CANDIDATE_REPORT_REJECTED',
      publicationStatus: 'non-promotable',
    });
  });
});
