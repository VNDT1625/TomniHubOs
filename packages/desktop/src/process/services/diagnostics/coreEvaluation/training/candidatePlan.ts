import { createHash } from 'node:crypto';

import { z } from 'zod';

const SHA256 = /^sha256-[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9._:@/-]+$/;
const identifier = z.string().trim().min(1).max(200).regex(IDENTIFIER);
const digest = z.string().regex(SHA256);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveCount = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const instant = z.string().datetime({ offset: true });

const DATA_CLASSES = ['non-sensitive', 'private', 'sensitive'] as const;

const classCountSchema = z.object({ dataClass: z.enum(DATA_CLASSES), count }).strict();

const syntheticSourceSchema = z
  .object({
    kind: z.literal('synthetic'),
    generatorVersion: identifier,
    licenseId: identifier,
    /** Synthetic corpora may never carry a user-data exception. */
    containsUserData: z.literal(false),
  })
  .strict();

const consentedUserSourceSchema = z
  .object({
    kind: z.literal('consented-user'),
    consentProgramId: identifier,
    consentPolicyVersion: identifier,
    /** Opaque receipt identifier only; it must not embed a user identifier. */
    consentReceiptId: identifier,
    deletionLedgerVersion: identifier,
    expiresAt: instant,
    grantedAt: instant,
    /** A withdrawn record cannot be used for a future candidate. */
    withdrawalState: z.enum(['active', 'withdrawn']),
  })
  .strict()
  .superRefine((source, context) => {
    if (Date.parse(source.expiresAt) <= Date.parse(source.grantedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Consented source expiry must follow its grant.',
      });
    }
  });

const sourceSchema = z.union([syntheticSourceSchema, consentedUserSourceSchema]);

/**
 * Metadata-only input. In particular it has no records, prompt, samples,
 * labels, secret, or context field. The strict parser rejects those fields
 * instead of allowing a training queue to accidentally persist private data.
 */
export const coreTrainingDatasetManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: identifier,
    datasetVersion: identifier,
    datasetDigest: digest,
    recordCount: positiveCount,
    dataClassCounts: z.array(classCountSchema).min(1).max(DATA_CLASSES.length),
    source: sourceSchema,
  })
  .strict()
  .superRefine((dataset, context) => {
    const classes = new Set<string>();
    let total = 0;
    for (const [index, entry] of dataset.dataClassCounts.entries()) {
      if (classes.has(entry.dataClass)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataClassCounts', index, 'dataClass'],
          message: 'A data class may appear only once.',
        });
      }
      classes.add(entry.dataClass);
      total += entry.count;
    }
    if (total !== dataset.recordCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataClassCounts'],
        message: 'Data-class aggregate counts must equal recordCount.',
      });
    }
    if (
      dataset.source.kind === 'synthetic' &&
      dataset.dataClassCounts.some((entry) => entry.dataClass !== 'non-sensitive')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataClassCounts'],
        message: 'Synthetic candidate data is restricted to non-sensitive fixtures.',
      });
    }
  });

export const coreTrainingCandidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    core: z.enum(['security', 'user-intelligence', 'orchestration']),
    candidateArtifactDigest: digest,
    baseArtifactDigest: digest,
    rollbackArtifactDigest: digest,
    recipeDigest: digest,
    sourceRevision: identifier,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.candidateArtifactDigest === candidate.baseArtifactDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidateArtifactDigest'],
        message: 'Candidate and base artifacts must not have the same digest.',
      });
    }
  });

export const coreTrainingPlanRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidate: coreTrainingCandidateSchema,
    dataset: coreTrainingDatasetManifestSchema,
    heldoutEvaluation: z
      .object({
        corpusDigest: digest,
        corpusVersion: identifier,
        heldout: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.dataset.datasetDigest === request.heldoutEvaluation.corpusDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['heldoutEvaluation', 'corpusDigest'],
        message: 'A training dataset cannot be the held-out evaluation corpus.',
      });
    }
  });

export type CoreTrainingDatasetManifest = z.infer<typeof coreTrainingDatasetManifestSchema>;
export type CoreTrainingCandidate = z.infer<typeof coreTrainingCandidateSchema>;
export type CoreTrainingPlanRequest = z.infer<typeof coreTrainingPlanRequestSchema>;

export type CoreTrainingPlanCode =
  | 'CORE_TRAINING_PLAN_INVALID'
  | 'CORE_TRAINING_CONSENT_EXPIRED'
  | 'CORE_TRAINING_WITHDRAWN_DATA'
  | 'CORE_TRAINING_USER_DATA_DISABLED'
  | 'CORE_TRAINING_PRIVATE_DATA_UNAPPROVED';

export type CoreTrainingCandidatePlan = Readonly<{
  schemaVersion: 1;
  candidateArtifactDigest: string;
  core: 'security' | 'user-intelligence' | 'orchestration';
  dataset: Readonly<{
    datasetDigest: string;
    datasetId: string;
    datasetVersion: string;
    recordCount: number;
    sourceKind: 'synthetic' | 'consented-user';
  }>;
  /** A hash of only the canonical metadata request, never raw training data. */
  planDigest: string;
  trainingMode: 'offline-candidate-review-only';
}>;

export type CoreTrainingPlanReport = Readonly<{
  codes: readonly CoreTrainingPlanCode[];
  containsUserData: boolean;
  modelPromotionPerformed: false;
  plan?: CoreTrainingCandidatePlan;
  promotionAllowed: false;
  status: 'planned' | 'rejected';
  trainingPerformed: false;
}>;

export type CoreTrainingPlanRunner = Readonly<{
  plan: (request: unknown) => CoreTrainingPlanReport;
}>;

export type CoreTrainingPlanRunnerOptions = Readonly<{
  /**
   * This is deliberately false by default. Enabling it only permits a
   * metadata plan for an explicitly consented source; it never executes
   * training and never promotes an artifact.
   */
  allowConsentedUserDataPlanning?: boolean;
  now?: () => number;
}>;

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
};

const digestPlan = (request: CoreTrainingPlanRequest): string =>
  `sha256-${createHash('sha256').update(canonicalize(request)).digest('hex')}`;

const rejected = (codes: readonly CoreTrainingPlanCode[], containsUserData: boolean): CoreTrainingPlanReport => ({
  codes: [...new Set(codes)].toSorted(),
  containsUserData,
  modelPromotionPerformed: false,
  promotionAllowed: false,
  status: 'rejected',
  trainingPerformed: false,
});

/**
 * Makes a bounded, aggregate-only candidate-training plan. It intentionally
 * has no trainer dependency, file path, model loader, network access, or
 * promotion hook. A future offline trainer must consume this review artifact
 * through its own approved execution contract.
 */
export const createCoreTrainingPlanRunner = (options: CoreTrainingPlanRunnerOptions = {}): CoreTrainingPlanRunner => {
  const now = options.now ?? Date.now;
  const allowConsentedUserDataPlanning = options.allowConsentedUserDataPlanning === true;

  return {
    plan: (rawRequest) => {
      const parsed = coreTrainingPlanRequestSchema.safeParse(rawRequest);
      if (!parsed.success) return rejected(['CORE_TRAINING_PLAN_INVALID'], false);

      const request = parsed.data;
      const source = request.dataset.source;
      if (source.kind === 'consented-user') {
        if (source.withdrawalState === 'withdrawn') return rejected(['CORE_TRAINING_WITHDRAWN_DATA'], true);
        if (Date.parse(source.expiresAt) <= now()) return rejected(['CORE_TRAINING_CONSENT_EXPIRED'], true);
        if (!allowConsentedUserDataPlanning) return rejected(['CORE_TRAINING_USER_DATA_DISABLED'], true);
        if (request.dataset.dataClassCounts.some((entry) => entry.dataClass !== 'non-sensitive')) {
          return rejected(['CORE_TRAINING_PRIVATE_DATA_UNAPPROVED'], true);
        }
      }

      return {
        codes: [],
        containsUserData: source.kind === 'consented-user',
        modelPromotionPerformed: false,
        plan: {
          schemaVersion: 1,
          candidateArtifactDigest: request.candidate.candidateArtifactDigest,
          core: request.candidate.core,
          dataset: {
            datasetDigest: request.dataset.datasetDigest,
            datasetId: request.dataset.datasetId,
            datasetVersion: request.dataset.datasetVersion,
            recordCount: request.dataset.recordCount,
            sourceKind: source.kind,
          },
          planDigest: digestPlan(request),
          trainingMode: 'offline-candidate-review-only',
        },
        promotionAllowed: false,
        status: 'planned',
        trainingPerformed: false,
      };
    },
  };
};
