/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parsePackageManifest, type PackageManifest } from '@/common/packages';
import { automatedPackageReviewFindings } from '@/process/extensions/package-manager/catalog-federation/validation';
import type {
  AutomatedPackageReviewDecision,
  AutomatedPackageReviewReason,
} from '@/process/extensions/package-manager/catalog-federation/validation';
import { writeJsonAtomically } from '@/process/extensions/package-manager/catalog-federation/persistence';

const DEFAULT_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MIN_DOCUMENT_BYTES = 1_024;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const MAX_SUBMISSIONS = 10_000;
const MAX_ID_LENGTH = 200;
const SHA256_FINGERPRINT = /^sha256-[a-f0-9]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;

const REVIEW_REASONS = new Set<AutomatedPackageReviewReason>([
  'REVIEW_FINGERPRINT_CHANGED',
  'PACKAGE_TYPE_REQUIRES_REVIEW',
  'RUNTIME_REQUIRES_REVIEW',
  'PERMISSIONS_REQUIRE_REVIEW',
  'DEPENDENCIES_REQUIRE_REVIEW',
  'NATIVE_CODE_REQUIRES_REVIEW',
  'NATIVE_CODE_UNKNOWN',
  'AI_OPERATIONS_REQUIRE_REVIEW',
  'AI_OPERATIONS_UNKNOWN',
  'DESTINATIONS_REQUIRE_REVIEW',
  'DESTINATIONS_UNKNOWN',
]);

const isSafeFindingText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\\/]/.test(value) &&
  !/\b(?:sha256|secret|token|private key|public key|fingerprint)\b/i.test(value) &&
  !hasControlCharacters(value);

export type PublisherSubmissionStatus = 'auto-approved' | 'human-review-required';

export type PublisherSubmission = Readonly<{
  schemaVersion: 1;
  submissionId: string;
  idempotencyKey: string;
  publisherId: string;
  /** Immutable digest of raw staged `.tomny` ZIP bytes. */
  archiveFingerprint: string;
  /** Immutable digest of unpacked payload bytes, equal to signed manifest integrity. */
  artifactFingerprint: string;
  manifest: PackageManifest;
  manifestFingerprint: string;
  review: AutomatedPackageReviewDecision;
  reviewFingerprint: string;
  submittedAt: string;
  status: PublisherSubmissionStatus;
}>;

export type PublisherSubmissionRequest = Readonly<{
  idempotencyKey: string;
  publisherId: string;
  archiveFingerprint: string;
  artifactFingerprint: string;
  /**
   * The caller must already have parsed, inspected, and verified this manifest.
   * This queue is deliberately not a package verifier or a publication endpoint.
   */
  manifest: PackageManifest;
  review: AutomatedPackageReviewDecision;
  submittedAt: string;
}>;

export type PublisherSubmissionStoreOptions = Readonly<{
  /** Absolute directory used with the fixed `publisher-submissions.json` file name. */
  rootDir?: string;
  /** Absolute document path. Mutually exclusive with `rootDir`. */
  filePath?: string;
  createSubmissionId?: () => string;
  maxDocumentBytes?: number;
}>;

export type PublisherSubmissionStoreErrorCode =
  | 'PUBLISHER_SUBMISSION_INVALID'
  | 'PUBLISHER_SUBMISSION_IDEMPOTENCY_CONFLICT'
  | 'PUBLISHER_SUBMISSION_STORE_CORRUPT'
  | 'PUBLISHER_SUBMISSION_STORE_UNAVAILABLE';

export class PublisherSubmissionStoreError extends Error {
  public constructor(
    public readonly code: PublisherSubmissionStoreErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PublisherSubmissionStoreError';
  }
}

type PublisherSubmissionDocument = Readonly<{
  schemaVersion: 1;
  submissions: PublisherSubmission[];
  digest: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => structuredClone(value);

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
};

const digest = (value: unknown): string => `sha256-${createHash('sha256').update(canonicalize(value)).digest('hex')}`;

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });

const assertIdentifier = (label: string, value: string): void => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_ID_LENGTH ||
    hasControlCharacters(value) ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', `${label} is invalid.`);
  }
};

const assertIsoDate = (label: string, value: string): void => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', `${label} is invalid.`);
  }
};

const assertManifestIdentity = (manifest: PackageManifest, publisherId: string): void => {
  let verifiedManifest: PackageManifest;
  try {
    verifiedManifest = parsePackageManifest(manifest);
  } catch (error) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', 'Verified package manifest is invalid.', {
      cause: error,
    });
  }
  if (
    !isRecord(verifiedManifest) ||
    typeof verifiedManifest.id !== 'string' ||
    typeof verifiedManifest.publisherId !== 'string'
  ) {
    throw new PublisherSubmissionStoreError(
      'PUBLISHER_SUBMISSION_INVALID',
      'Verified package manifest identity is invalid.'
    );
  }
  assertIdentifier('Package id', verifiedManifest.id);
  assertIdentifier('Manifest publisher id', verifiedManifest.publisherId);
  if (verifiedManifest.publisherId !== publisherId) {
    throw new PublisherSubmissionStoreError(
      'PUBLISHER_SUBMISSION_INVALID',
      'Submission publisher does not match the verified manifest publisher.'
    );
  }
  if (verifiedManifest.type === 'app') {
    const surfaces = verifiedManifest.contributions?.apps ?? [];
    if (surfaces.length !== 1 || !verifiedManifest.modules.some((module) => module.id === surfaces[0]?.moduleId)) {
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_INVALID',
        'Package App submissions must declare exactly one Surface backed by a package module.'
      );
    }
  }
};

const assertReview = (review: AutomatedPackageReviewDecision): void => {
  if (!isRecord(review) || (review.disposition !== 'auto-approved' && review.disposition !== 'human-review-required')) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', 'Automated review disposition is invalid.');
  }
  if (typeof review.fingerprint !== 'string' || !SHA256_FINGERPRINT.test(review.fingerprint)) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', 'Automated review fingerprint is invalid.');
  }
  if (!Array.isArray(review.reasons) || review.reasons.length > REVIEW_REASONS.size) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', 'Automated review reasons are invalid.');
  }
  const reasons = new Set(review.reasons);
  if (reasons.size !== review.reasons.length || [...reasons].some((reason) => !REVIEW_REASONS.has(reason))) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', 'Automated review reasons are invalid.');
  }
  if ((review.disposition === 'auto-approved') !== (review.reasons.length === 0)) {
    throw new PublisherSubmissionStoreError(
      'PUBLISHER_SUBMISSION_INVALID',
      'Automated review disposition does not match its reasons.'
    );
  }
  if (!Array.isArray(review.findings) || review.findings.length !== review.reasons.length) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', 'Automated review findings are invalid.');
  }
  const expectedFindings = automatedPackageReviewFindings(review.reasons);
  if (
    review.findings.some(
      (finding, index) =>
        !isRecord(finding) ||
        finding.code !== expectedFindings[index]?.code ||
        finding.severity !== expectedFindings[index]?.severity ||
        finding.evidence !== expectedFindings[index]?.evidence ||
        finding.remediation !== expectedFindings[index]?.remediation ||
        !isSafeFindingText(finding.evidence) ||
        !isSafeFindingText(finding.remediation)
    )
  ) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', 'Automated review findings are invalid.');
  }
};

const requestFingerprint = (request: PublisherSubmissionRequest): string =>
  digest({
    idempotencyKey: request.idempotencyKey,
    publisherId: request.publisherId,
    archiveFingerprint: request.archiveFingerprint,
    artifactFingerprint: request.artifactFingerprint,
    manifest: request.manifest,
    review: request.review,
    submittedAt: request.submittedAt,
  });

const submissionFingerprint = (submission: PublisherSubmission): string =>
  digest({
    idempotencyKey: submission.idempotencyKey,
    publisherId: submission.publisherId,
    archiveFingerprint: submission.archiveFingerprint,
    artifactFingerprint: submission.artifactFingerprint,
    manifest: submission.manifest,
    review: submission.review,
    submittedAt: submission.submittedAt,
  });

const documentPayload = (submissions: readonly PublisherSubmission[]) => ({ schemaVersion: 1 as const, submissions });

const parseStoredSubmission = (value: unknown): PublisherSubmission => {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_STORE_CORRUPT', 'Submission record is invalid.');
  }
  const candidate = value as unknown as PublisherSubmission;
  try {
    assertIdentifier('Submission id', candidate.submissionId);
    assertIdentifier('Submission idempotency key', candidate.idempotencyKey);
    assertIdentifier('Submission publisher id', candidate.publisherId);
    if (
      typeof candidate.archiveFingerprint !== 'string' ||
      !SHA256_FINGERPRINT.test(candidate.archiveFingerprint) ||
      typeof candidate.artifactFingerprint !== 'string' ||
      !SHA256_FINGERPRINT.test(candidate.artifactFingerprint)
    ) {
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_STORE_CORRUPT',
        'Submission artifact evidence is invalid.'
      );
    }
    assertIsoDate('Submission time', candidate.submittedAt);
    assertManifestIdentity(candidate.manifest, candidate.publisherId);
    if (candidate.manifest.artifact?.integrity !== candidate.artifactFingerprint) {
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_STORE_CORRUPT',
        'Submission payload evidence is invalid.'
      );
    }
    assertReview(candidate.review);
  } catch (error) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_STORE_CORRUPT', 'Submission record is invalid.', {
      cause: error,
    });
  }
  if (
    typeof candidate.manifestFingerprint !== 'string' ||
    !SHA256_FINGERPRINT.test(candidate.manifestFingerprint) ||
    candidate.manifestFingerprint !== digest(candidate.manifest) ||
    typeof candidate.reviewFingerprint !== 'string' ||
    candidate.reviewFingerprint !== candidate.review.fingerprint ||
    candidate.status !== candidate.review.disposition
  ) {
    throw new PublisherSubmissionStoreError(
      'PUBLISHER_SUBMISSION_STORE_CORRUPT',
      'Submission record binding is invalid.'
    );
  }
  return clone(candidate);
};

const parseDocument = (value: unknown): PublisherSubmissionDocument => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.submissions) ||
    typeof value.digest !== 'string'
  ) {
    throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_STORE_CORRUPT', 'Submission document is invalid.');
  }
  if (value.submissions.length > MAX_SUBMISSIONS) {
    throw new PublisherSubmissionStoreError(
      'PUBLISHER_SUBMISSION_STORE_CORRUPT',
      'Submission document exceeds its record limit.'
    );
  }
  const submissions = value.submissions.map(parseStoredSubmission);
  const submissionIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const submission of submissions) {
    if (submissionIds.has(submission.submissionId) || idempotencyKeys.has(submission.idempotencyKey)) {
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_STORE_CORRUPT',
        'Submission document contains duplicate immutable identities.'
      );
    }
    submissionIds.add(submission.submissionId);
    idempotencyKeys.add(submission.idempotencyKey);
  }
  if (value.digest !== digest(documentPayload(submissions))) {
    throw new PublisherSubmissionStoreError(
      'PUBLISHER_SUBMISSION_STORE_CORRUPT',
      'Submission document digest is invalid.'
    );
  }
  return { schemaVersion: 1, submissions, digest: value.digest };
};

const resolveFilePath = (options: PublisherSubmissionStoreOptions): string => {
  if ((options.rootDir === undefined) === (options.filePath === undefined)) {
    throw new Error('Publisher submission store requires exactly one of rootDir or filePath.');
  }
  const filePath = options.filePath ?? path.join(options.rootDir!, 'publisher-submissions.json');
  if (!path.isAbsolute(filePath)) throw new Error('Publisher submission store path must be absolute.');
  return filePath;
};

const resolveMaxDocumentBytes = (value: number | undefined): number => {
  const maxDocumentBytes = value ?? DEFAULT_MAX_DOCUMENT_BYTES;
  if (
    !Number.isSafeInteger(maxDocumentBytes) ||
    maxDocumentBytes < MIN_DOCUMENT_BYTES ||
    maxDocumentBytes > MAX_DOCUMENT_BYTES
  ) {
    throw new Error('Publisher submission store size limit is invalid.');
  }
  return maxDocumentBytes;
};

/**
 * Durable main-process intake queue for pre-verified publisher submissions.
 * It records immutable review evidence only. It has no catalog signer,
 * remote transport, approval promotion, or publication operation.
 */
export class PublisherSubmissionStore {
  private readonly filePath: string;
  private readonly maxDocumentBytes: number;
  private readonly createSubmissionId: () => string;
  private pending: Promise<void> = Promise.resolve();

  public constructor(options: PublisherSubmissionStoreOptions) {
    this.filePath = resolveFilePath(options);
    this.maxDocumentBytes = resolveMaxDocumentBytes(options.maxDocumentBytes);
    this.createSubmissionId = options.createSubmissionId ?? randomUUID;
  }

  public submit(request: PublisherSubmissionRequest): Promise<PublisherSubmission> {
    return this.serialize(async () => {
      this.assertRequest(request);
      const document = await this.readDocument();
      const existing = document.submissions.find((submission) => submission.idempotencyKey === request.idempotencyKey);
      if (existing !== undefined) {
        if (submissionFingerprint(existing) !== requestFingerprint(request)) {
          throw new PublisherSubmissionStoreError(
            'PUBLISHER_SUBMISSION_IDEMPOTENCY_CONFLICT',
            'Submission idempotency key is already bound to different immutable evidence.'
          );
        }
        return clone(existing);
      }

      const submissionId = this.createSubmissionId();
      assertIdentifier('Generated submission id', submissionId);
      if (document.submissions.some((submission) => submission.submissionId === submissionId)) {
        throw new PublisherSubmissionStoreError(
          'PUBLISHER_SUBMISSION_STORE_UNAVAILABLE',
          'Submission identifier generator returned an existing immutable identity.'
        );
      }
      const submission: PublisherSubmission = {
        schemaVersion: 1,
        submissionId,
        idempotencyKey: request.idempotencyKey,
        publisherId: request.publisherId,
        archiveFingerprint: request.archiveFingerprint,
        artifactFingerprint: request.artifactFingerprint,
        manifest: clone(request.manifest),
        manifestFingerprint: digest(request.manifest),
        review: clone(request.review),
        reviewFingerprint: request.review.fingerprint,
        submittedAt: request.submittedAt,
        status: request.review.disposition,
      };
      const submissions = [...document.submissions, submission];
      await this.writeDocument(submissions);
      return clone(submission);
    });
  }

  public list(): Promise<PublisherSubmission[]> {
    return this.serialize(async () => clone((await this.readDocument()).submissions));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  }

  private assertRequest(request: PublisherSubmissionRequest): void {
    if (!isRecord(request)) {
      throw new PublisherSubmissionStoreError('PUBLISHER_SUBMISSION_INVALID', 'Submission request is invalid.');
    }
    assertIdentifier('Submission idempotency key', request.idempotencyKey);
    assertIdentifier('Submission publisher id', request.publisherId);
    if (
      typeof request.archiveFingerprint !== 'string' ||
      !SHA256_FINGERPRINT.test(request.archiveFingerprint) ||
      typeof request.artifactFingerprint !== 'string' ||
      !SHA256_FINGERPRINT.test(request.artifactFingerprint)
    ) {
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_INVALID',
        'Submission artifact evidence is invalid.'
      );
    }
    assertIsoDate('Submission time', request.submittedAt);
    assertManifestIdentity(request.manifest, request.publisherId);
    if (request.manifest.artifact?.integrity !== request.artifactFingerprint) {
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_INVALID',
        'Submission payload evidence is invalid.'
      );
    }
    assertReview(request.review);
  }

  private async readDocument(): Promise<PublisherSubmissionDocument> {
    try {
      const fileStat = await stat(this.filePath);
      if (!fileStat.isFile() || fileStat.size > this.maxDocumentBytes) {
        throw new PublisherSubmissionStoreError(
          'PUBLISHER_SUBMISSION_STORE_CORRUPT',
          'Submission document is not a bounded regular file.'
        );
      }
      const { readFile } = await import('node:fs/promises');
      return parseDocument(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: 1, submissions: [], digest: digest(documentPayload([])) };
      }
      if (error instanceof PublisherSubmissionStoreError) throw error;
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_STORE_CORRUPT',
        'Submission document cannot be read.',
        {
          cause: error,
        }
      );
    }
  }

  private async writeDocument(submissions: readonly PublisherSubmission[]): Promise<void> {
    const document: PublisherSubmissionDocument = {
      schemaVersion: 1,
      submissions: clone([...submissions]),
      digest: digest(documentPayload(submissions)),
    };
    const serializedBytes = Buffer.byteLength(JSON.stringify(document), 'utf8');
    if (serializedBytes > this.maxDocumentBytes) {
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_STORE_UNAVAILABLE',
        'Submission document would exceed its configured size limit.'
      );
    }
    try {
      await writeJsonAtomically(this.filePath, document);
    } catch (error) {
      throw new PublisherSubmissionStoreError(
        'PUBLISHER_SUBMISSION_STORE_UNAVAILABLE',
        'Submission document cannot be persisted.',
        {
          cause: error,
        }
      );
    }
  }
}
