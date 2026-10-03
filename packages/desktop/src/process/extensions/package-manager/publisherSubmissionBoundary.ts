/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { parsePackageManifest, type PackageManifest } from '@/common/packages';
import {
  automatedPackageReviewFindings,
  decideAutomatedPackageReview,
  type AutomatedPackageReviewDecision,
  type AutomatedPackageReviewInput,
} from './catalog-federation/validation';
import type {
  PublisherSubmissionStore,
  PublisherSubmission,
} from '@/process/services/database/publisherSubmissionStore';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_INSPECTION_ITEMS = 128;
const MAX_INSPECTION_ITEM_LENGTH = 512;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const SHA256_FINGERPRINT = /^sha256-[a-f0-9]{64}$/;

export type AuthenticatedPublisherPrincipal = Readonly<{
  /** Resolved by Main-owned Account authority for each submit attempt. */
  publisherId: string;
  subjectId: string;
  /** Package-id namespace granted by the Main-owned publisher authority. */
  namespace: string;
  /** Exact currently active key; the renderer never supplies or selects it. */
  activeSigningKey: Readonly<{
    keyId: string;
    algorithm: 'Ed25519';
    publicKeyPem: string;
  }>;
}>;

export type PublisherPrincipalResolver = () => Promise<AuthenticatedPublisherPrincipal>;

export type PublisherSubmissionInput = Readonly<{
  /** Immutable key supplied by the authenticated publisher client. */
  idempotencyKey: string;
  /** Opaque artifact reference; it is never accepted as a filesystem path or URL. */
  artifactId: string;
}>;

export type VerifiedStagedPublisherArtifact = Readonly<{
  /** Parsed only again at this boundary; artifact verification cannot be delegated blindly. */
  manifest: PackageManifest;
  /** Digest of raw staged `.tomny` ZIP bytes. It is distinct from signed payload integrity. */
  archiveFingerprint: string;
  /** Exact verified payload digest, bound to the signed manifest artifact integrity. */
  artifactFingerprint: string;
  inspection: AutomatedPackageReviewInput['inspection'];
}>;

export type PublisherArtifactVerifier = (
  input: Readonly<{
    principal: AuthenticatedPublisherPrincipal;
    idempotencyKey: string;
    artifactId: string;
  }>
) => Promise<VerifiedStagedPublisherArtifact>;

export type PublisherSubmissionReviewer = (
  input: Readonly<{
    manifest: PackageManifest;
    artifactFingerprint: string;
    inspection: AutomatedPackageReviewInput['inspection'];
    /** Existing evidence is supplied only to make an altered artifact reviewable. */
    priorApprovalFingerprint?: string;
  }>
) => Promise<AutomatedPackageReviewDecision> | AutomatedPackageReviewDecision;

export type PublisherSubmissionReceipt = Readonly<{
  schemaVersion: 1;
  submissionId: string;
  publisherId: string;
  packageId: string;
  version: string;
  status: PublisherSubmission['status'];
  manifestFingerprint: string;
  archiveFingerprint: string;
  artifactFingerprint: string;
  reviewFingerprint: string;
  review: Readonly<{
    disposition: PublisherSubmission['review']['disposition'];
    findings: PublisherSubmission['review']['findings'];
  }>;
  submittedAt: string;
}>;

export type PublisherSubmissionBoundaryErrorCode =
  | 'PUBLISHER_SUBMISSION_PRINCIPAL_INVALID'
  | 'PUBLISHER_SUBMISSION_INPUT_INVALID'
  | 'PUBLISHER_SUBMISSION_ARTIFACT_INVALID'
  | 'PUBLISHER_SUBMISSION_ARTIFACT_REJECTED'
  | 'PUBLISHER_SUBMISSION_REVIEW_INVALID';

/** Deliberately stable, non-sensitive errors for the Main-process publisher intake boundary. */
export class PublisherSubmissionBoundaryError extends Error {
  public constructor(
    public readonly code: PublisherSubmissionBoundaryErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PublisherSubmissionBoundaryError';
  }
}

export type PublisherSubmissionBoundaryOptions = Readonly<{
  /**
   * Main-only resolver, called for every submit attempt. It must derive the
   * publisher from the current online Account session, never renderer input.
   */
  resolvePrincipal: PublisherPrincipalResolver;
  verifyAndStage: PublisherArtifactVerifier;
  automatedReviewer: PublisherSubmissionReviewer;
  submissionStore: PublisherSubmissionStore;
  now?: () => Date;
}>;

export type PublisherSubmissionBoundary = Readonly<{
  submit(input: PublisherSubmissionInput): Promise<PublisherSubmissionReceipt>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });

const assertIdentifier: (
  value: unknown,
  label: string,
  code: PublisherSubmissionBoundaryErrorCode
) => asserts value is string = (value, label, code) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    hasControlCharacters(value) ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    throw new PublisherSubmissionBoundaryError(code, `${label} is invalid.`);
  }
};

const assertTimestamp = (value: string): void => {
  if (!Number.isFinite(Date.parse(value))) {
    throw new PublisherSubmissionBoundaryError('PUBLISHER_SUBMISSION_INPUT_INVALID', 'Submission time is invalid.');
  }
};

const cloneInspectionItems = (value: unknown, label: string): readonly string[] | 'unknown' => {
  if (value === 'unknown') return value;
  if (!Array.isArray(value) || value.length > MAX_INSPECTION_ITEMS) {
    throw new PublisherSubmissionBoundaryError(
      'PUBLISHER_SUBMISSION_ARTIFACT_INVALID',
      `${label} inspection is invalid.`
    );
  }
  const normalized = value.map((item) => {
    if (
      typeof item !== 'string' ||
      !item.trim() ||
      item.length > MAX_INSPECTION_ITEM_LENGTH ||
      hasControlCharacters(item)
    ) {
      throw new PublisherSubmissionBoundaryError(
        'PUBLISHER_SUBMISSION_ARTIFACT_INVALID',
        `${label} inspection is invalid.`
      );
    }
    return item;
  });
  return Object.freeze([...normalized]);
};

const parseInspection = (value: unknown): AutomatedPackageReviewInput['inspection'] => {
  if (
    !isRecord(value) ||
    (value.hasNativeCode !== true && value.hasNativeCode !== false && value.hasNativeCode !== 'unknown')
  ) {
    throw new PublisherSubmissionBoundaryError(
      'PUBLISHER_SUBMISSION_ARTIFACT_INVALID',
      'Artifact inspection is invalid.'
    );
  }
  return Object.freeze({
    hasNativeCode: value.hasNativeCode,
    aiOperations: cloneInspectionItems(value.aiOperations, 'AI operations'),
    destinations: cloneInspectionItems(value.destinations, 'Destinations'),
  });
};

const parseReview = (value: unknown): AutomatedPackageReviewDecision => {
  if (
    !isRecord(value) ||
    (value.disposition !== 'auto-approved' && value.disposition !== 'human-review-required') ||
    typeof value.fingerprint !== 'string' ||
    !SHA256_FINGERPRINT.test(value.fingerprint) ||
    !Array.isArray(value.reasons) ||
    value.reasons.length > 11 ||
    value.reasons.some((reason) => typeof reason !== 'string' || reason.length > 128)
  ) {
    throw new PublisherSubmissionBoundaryError('PUBLISHER_SUBMISSION_REVIEW_INVALID', 'Automated review is invalid.');
  }
  const reasons = Object.freeze([...value.reasons]) as AutomatedPackageReviewDecision['reasons'];
  const findings = automatedPackageReviewFindings(reasons);
  if (
    !Array.isArray(value.findings) ||
    value.findings.length !== findings.length ||
    value.findings.some(
      (finding, index) =>
        !isRecord(finding) ||
        finding.code !== findings[index]?.code ||
        finding.severity !== findings[index]?.severity ||
        finding.evidence !== findings[index]?.evidence ||
        finding.remediation !== findings[index]?.remediation
    )
  ) {
    throw new PublisherSubmissionBoundaryError(
      'PUBLISHER_SUBMISSION_REVIEW_INVALID',
      'Automated review findings are invalid.'
    );
  }
  return Object.freeze({
    disposition: value.disposition,
    fingerprint: value.fingerprint,
    reasons,
    findings,
  });
};

const parseVerifiedArtifact = (
  value: unknown,
  principal: AuthenticatedPublisherPrincipal
): VerifiedStagedPublisherArtifact => {
  if (!isRecord(value)) {
    throw new PublisherSubmissionBoundaryError(
      'PUBLISHER_SUBMISSION_ARTIFACT_INVALID',
      'Verified artifact is invalid.'
    );
  }
  let manifest: PackageManifest;
  try {
    manifest = parsePackageManifest(value.manifest);
  } catch (error) {
    throw new PublisherSubmissionBoundaryError(
      'PUBLISHER_SUBMISSION_ARTIFACT_INVALID',
      'Verified artifact manifest is invalid.',
      {
        cause: error,
      }
    );
  }
  if (
    manifest.publisherId !== principal.publisherId ||
    (manifest.id !== principal.namespace && !manifest.id.startsWith(`${principal.namespace}.`))
  ) {
    throw new PublisherSubmissionBoundaryError(
      'PUBLISHER_SUBMISSION_ARTIFACT_REJECTED',
      'Authenticated publisher does not own the verified package namespace.'
    );
  }
  if (
    !manifest.artifact ||
    typeof value.archiveFingerprint !== 'string' ||
    !SHA256_FINGERPRINT.test(value.archiveFingerprint) ||
    typeof value.artifactFingerprint !== 'string' ||
    !SHA256_FINGERPRINT.test(value.artifactFingerprint)
  ) {
    throw new PublisherSubmissionBoundaryError(
      'PUBLISHER_SUBMISSION_ARTIFACT_INVALID',
      'Verified artifact integrity evidence is invalid.'
    );
  }
  if (manifest.artifact.integrity !== value.artifactFingerprint) {
    throw new PublisherSubmissionBoundaryError(
      'PUBLISHER_SUBMISSION_ARTIFACT_REJECTED',
      'Verified artifact does not match its signed manifest integrity.'
    );
  }
  return Object.freeze({
    manifest,
    archiveFingerprint: value.archiveFingerprint,
    artifactFingerprint: value.artifactFingerprint,
    inspection: parseInspection(value.inspection),
  });
};

const receiptFor = (submission: PublisherSubmission): PublisherSubmissionReceipt =>
  Object.freeze({
    schemaVersion: 1,
    submissionId: submission.submissionId,
    publisherId: submission.publisherId,
    packageId: submission.manifest.id,
    version: submission.manifest.version,
    status: submission.status,
    manifestFingerprint: submission.manifestFingerprint,
    archiveFingerprint: submission.archiveFingerprint,
    artifactFingerprint: submission.artifactFingerprint,
    reviewFingerprint: submission.reviewFingerprint,
    review: Object.freeze({
      disposition: submission.review.disposition,
      findings: submission.review.findings,
    }),
    submittedAt: submission.submittedAt,
  });

/**
 * Main-only intake composition for authenticated publisher submissions. It verifies and stages an
 * artifact before writing immutable review evidence, but deliberately has no catalog, signer,
 * promotion, transport, or publication dependency.
 */
export const createPublisherSubmissionBoundary = (
  options: PublisherSubmissionBoundaryOptions
): PublisherSubmissionBoundary => {
  const resolvePrincipal = async (): Promise<AuthenticatedPublisherPrincipal> => {
    const principal = await options.resolvePrincipal();
    assertIdentifier(principal.publisherId, 'Authenticated publisher id', 'PUBLISHER_SUBMISSION_PRINCIPAL_INVALID');
    assertIdentifier(principal.subjectId, 'Authenticated publisher subject', 'PUBLISHER_SUBMISSION_PRINCIPAL_INVALID');
    assertIdentifier(
      principal.namespace,
      'Authenticated publisher namespace',
      'PUBLISHER_SUBMISSION_PRINCIPAL_INVALID'
    );
    assertIdentifier(
      principal.activeSigningKey?.keyId,
      'Authenticated publisher signing key',
      'PUBLISHER_SUBMISSION_PRINCIPAL_INVALID'
    );
    if (
      principal.activeSigningKey?.algorithm !== 'Ed25519' ||
      typeof principal.activeSigningKey.publicKeyPem !== 'string'
    ) {
      throw new PublisherSubmissionBoundaryError(
        'PUBLISHER_SUBMISSION_PRINCIPAL_INVALID',
        'Authenticated publisher signing key is invalid.'
      );
    }
    return Object.freeze({
      publisherId: principal.publisherId,
      subjectId: principal.subjectId,
      namespace: principal.namespace,
      activeSigningKey: Object.freeze({
        keyId: principal.activeSigningKey.keyId,
        algorithm: 'Ed25519',
        publicKeyPem: principal.activeSigningKey.publicKeyPem,
      }),
    });
  };

  return Object.freeze({
    submit: async (input: PublisherSubmissionInput): Promise<PublisherSubmissionReceipt> => {
      if (!isRecord(input)) {
        throw new PublisherSubmissionBoundaryError(
          'PUBLISHER_SUBMISSION_INPUT_INVALID',
          'Submission input is invalid.'
        );
      }
      assertIdentifier(input.idempotencyKey, 'Submission idempotency key', 'PUBLISHER_SUBMISSION_INPUT_INVALID');
      assertIdentifier(input.artifactId, 'Artifact reference', 'PUBLISHER_SUBMISSION_INPUT_INVALID');
      const principal = await resolvePrincipal();

      let staged: VerifiedStagedPublisherArtifact;
      try {
        staged = parseVerifiedArtifact(
          await options.verifyAndStage({
            principal,
            idempotencyKey: input.idempotencyKey,
            artifactId: input.artifactId,
          }),
          principal
        );
      } catch (error) {
        if (error instanceof PublisherSubmissionBoundaryError) throw error;
        throw new PublisherSubmissionBoundaryError(
          'PUBLISHER_SUBMISSION_ARTIFACT_REJECTED',
          'Artifact verification or staging failed.',
          { cause: error }
        );
      }

      const existing = (await options.submissionStore.list()).find(
        (submission) => submission.idempotencyKey === input.idempotencyKey
      );
      const automatedReviewInput = {
        manifest: staged.manifest,
        artifactFingerprint: staged.artifactFingerprint,
        inspection: staged.inspection,
        priorApprovalFingerprint: existing?.reviewFingerprint,
      };
      const expectedReview = decideAutomatedPackageReview(automatedReviewInput);
      let review: AutomatedPackageReviewDecision;
      try {
        review = parseReview(await options.automatedReviewer(automatedReviewInput));
        if (
          review.disposition !== expectedReview.disposition ||
          review.fingerprint !== expectedReview.fingerprint ||
          review.reasons.length !== expectedReview.reasons.length ||
          review.reasons.some((reason, index) => reason !== expectedReview.reasons[index])
        ) {
          throw new PublisherSubmissionBoundaryError(
            'PUBLISHER_SUBMISSION_REVIEW_INVALID',
            'Automated review does not match the deterministic review decision.'
          );
        }
      } catch (error) {
        if (error instanceof PublisherSubmissionBoundaryError) throw error;
        throw new PublisherSubmissionBoundaryError(
          'PUBLISHER_SUBMISSION_REVIEW_INVALID',
          'Automated review could not be derived.',
          { cause: error }
        );
      }
      const submittedAt = existing?.submittedAt ?? (options.now?.() ?? new Date()).toISOString();
      assertTimestamp(submittedAt);
      const submission = await options.submissionStore.submit({
        idempotencyKey: input.idempotencyKey,
        publisherId: principal.publisherId,
        archiveFingerprint: staged.archiveFingerprint,
        artifactFingerprint: staged.artifactFingerprint,
        manifest: staged.manifest,
        review,
        submittedAt,
      });
      return receiptFor(submission);
    },
  });
};
