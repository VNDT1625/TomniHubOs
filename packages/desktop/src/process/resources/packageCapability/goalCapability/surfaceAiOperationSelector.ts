import type {
  CapabilityCandidate,
  PackageIdentity,
  PackageListing,
  PackageManifest,
  PackagePublicationReview,
  PackageSurfaceAiOperation,
  SurfacePlanningStep,
} from '@/common/packages';

const MAX_IDENTIFIER_LENGTH = 160;
const LOCAL_DESTINATION = /^local(?:[._-][a-z0-9]+(?:[._-][a-z0-9]+)*)?(?::[a-z0-9]+(?:[._-][a-z0-9]+)*)?$/;
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DATA_CLASSES = new Set<PackageSurfaceAiOperation['dataClasses'][number]>([
  'workspace',
  'conversation',
  'personal',
  'artifact',
  'secret-handle',
]);

export type SurfaceAiOperationSelectorErrorCode =
  | 'SURFACE_AI_OPERATION_SELECTOR_STEP_INVALID'
  | 'SURFACE_AI_OPERATION_SELECTOR_SURFACE_STATE_INVALID'
  | 'SURFACE_AI_OPERATION_SELECTOR_IDENTITY_MISMATCH'
  | 'SURFACE_AI_OPERATION_SELECTOR_REVIEW_INVALID'
  | 'SURFACE_AI_OPERATION_SELECTOR_OPERATION_UNDECLARED'
  | 'SURFACE_AI_OPERATION_SELECTOR_OPERATION_AMBIGUOUS'
  | 'SURFACE_AI_OPERATION_SELECTOR_SECRET_USE_DENIED'
  | 'SURFACE_AI_OPERATION_SELECTOR_SECRET_DATA_DENIED'
  | 'SURFACE_AI_OPERATION_SELECTOR_DESTINATION_INVALID';

export class SurfaceAiOperationSelectorError extends Error {
  public constructor(public readonly code: SurfaceAiOperationSelectorErrorCode) {
    super(code);
    this.name = 'SurfaceAiOperationSelectorError';
  }
}

export type SurfaceAiOperationSelection = Readonly<{
  surface: PackageIdentity;
  operation: PackageSurfaceAiOperation;
}>;

export type SurfaceAiOperationSelectorInput = Readonly<{
  /** A deterministic C3 plan created in Main, never a renderer or model operation request. */
  planStep: SurfacePlanningStep;
  /** Fresh Store state for the exact installed artifact selected by the plan. */
  installedListing: PackageListing;
  /** Secret-backed Surface operations require the separate lease authority and are rejected here. */
  secretUse: boolean;
}>;

// `SurfacePlanningStep` groups local and remote execution in one union member,
// so `Extract<..., { kind: 'execute-local' }>` cannot narrow it. Keep the
// local discriminator together with its canonical candidate facts explicitly.
type ReadyLocalPlanStep = SurfacePlanningStep &
  Readonly<{
    kind: 'execute-local';
    candidate: CapabilityCandidate;
  }>;

const fail = (code: SurfaceAiOperationSelectorErrorCode): never => {
  throw new SurfaceAiOperationSelectorError(code);
};

const isBoundedIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && IDENTIFIER.test(value);

const isValidLocalDestination = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_IDENTIFIER_LENGTH &&
  LOCAL_DESTINATION.test(value);

const sameIdentity = (left: PackageIdentity, right: PackageIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const identityFor = (manifest: PackageManifest): PackageIdentity => ({
  packageId: manifest.id,
  packageVersion: manifest.version,
  publisherId: manifest.publisherId,
});

const isReviewed = (review: unknown): review is PackagePublicationReview => {
  if (typeof review !== 'object' || review === null || Array.isArray(review)) return false;
  const candidate = review as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    !isBoundedIdentifier(candidate.fingerprint) ||
    typeof candidate.reviewedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.reviewedAt))
  ) {
    return false;
  }
  if (candidate.disposition === 'auto-approved') return true;
  return candidate.disposition === 'human-approved' && isBoundedIdentifier(candidate.reviewerId);
};

const isInstalledTrusted = (trust: unknown): boolean =>
  trust === 'trusted-first-party' || trust === 'signed-first-party' || trust === 'signed-store';

const isReadyLocalStep = (value: SurfacePlanningStep): value is ReadyLocalPlanStep =>
  value.kind === 'execute-local' &&
  value.candidate.state === 'ready-local' &&
  value.candidate.trusted === true &&
  value.candidate.compatible === true &&
  value.candidate.healthy === true &&
  (!value.query.requireUi || value.candidate.supportsUi === true) &&
  (!value.query.requireOffline || value.candidate.supportsOffline === true) &&
  (value.query.dataLocation !== 'local-only' || value.candidate.dataLocation === 'local-only') &&
  value.resolution.selectedCandidateId === value.candidate.candidateId &&
  value.resolution.queryId === value.query.queryId &&
  value.query.capability === value.candidate.capability &&
  value.resolution.candidates.some(
    (candidate) =>
      candidate.candidateId === value.candidate.candidateId &&
      sameIdentity(candidate.package, value.candidate.package) &&
      candidate.capability === value.candidate.capability &&
      candidate.state === 'ready-local' &&
      candidate.trusted === true &&
      candidate.compatible === true &&
      candidate.healthy === true
  );

const requireInstalledManifest = (listing: PackageListing): PackageManifest => {
  if (
    listing.state !== 'installed' ||
    listing.enabled !== true ||
    listing.compatible !== true ||
    listing.revoked === true ||
    listing.installedManifest === undefined ||
    listing.installedVersion === undefined ||
    listing.installedManifest.version !== listing.installedVersion ||
    !isInstalledTrusted(listing.installedTrust)
  ) {
    return fail('SURFACE_AI_OPERATION_SELECTOR_SURFACE_STATE_INVALID');
  }
  if (!isReviewed(listing.installedPublicationReview)) {
    return fail('SURFACE_AI_OPERATION_SELECTOR_REVIEW_INVALID');
  }
  return listing.installedManifest;
};

const hasExactSurfaceContribution = (candidate: CapabilityCandidate, manifest: PackageManifest): boolean => {
  const contributions = manifest.contributions?.apps;
  if (!contributions || contributions.length !== 1 || !candidate.contribution) return false;
  const [surface] = contributions;
  return (
    sameIdentity(candidate.contribution.package, identityFor(manifest)) &&
    candidate.contribution.contributionId === surface.id &&
    manifest.modules.some((module) => module.id === surface.moduleId)
  );
};

const cloneOperation = (operation: PackageSurfaceAiOperation): PackageSurfaceAiOperation => ({
  id: operation.id,
  capability: operation.capability,
  inputSchemaVersion: operation.inputSchemaVersion,
  dataClasses: [...operation.dataClasses],
  destinationIds: [...operation.destinationIds],
});

const validateNonSecretOperation = (operation: PackageSurfaceAiOperation): void => {
  if (
    !isBoundedIdentifier(operation.id) ||
    !isBoundedIdentifier(operation.capability) ||
    operation.inputSchemaVersion !== 1 ||
    !Array.isArray(operation.dataClasses) ||
    operation.dataClasses.length === 0 ||
    operation.dataClasses.some((dataClass) => !DATA_CLASSES.has(dataClass))
  ) {
    fail('SURFACE_AI_OPERATION_SELECTOR_OPERATION_UNDECLARED');
  }
  if (operation.dataClasses.includes('secret-handle')) fail('SURFACE_AI_OPERATION_SELECTOR_SECRET_DATA_DENIED');

  // An empty declaration means the local operation has no declared egress. Every
  // declared destination must still be a bounded local route in this C4 selector.
  if (!Array.isArray(operation.destinationIds)) fail('SURFACE_AI_OPERATION_SELECTOR_DESTINATION_INVALID');
  const destinations = new Set<string>();
  for (const destinationId of operation.destinationIds) {
    if (!isValidLocalDestination(destinationId) || destinations.has(destinationId)) {
      fail('SURFACE_AI_OPERATION_SELECTOR_DESTINATION_INVALID');
    }
    destinations.add(destinationId);
  }
};

/**
 * Main-only, side-effect-free C4 prerequisite. It binds one Main-authored
 * ready-local plan step to the reviewed installed artifact and exactly one
 * non-secret AI declaration. Consent, run creation, runtime dispatch, and IPC
 * intentionally remain outside this selector.
 */
export const selectReadyLocalSurfaceAiOperation = ({
  planStep,
  installedListing,
  secretUse,
}: SurfaceAiOperationSelectorInput): SurfaceAiOperationSelection => {
  if (secretUse !== false) fail('SURFACE_AI_OPERATION_SELECTOR_SECRET_USE_DENIED');
  const readyStep = isReadyLocalStep(planStep) ? planStep : fail('SURFACE_AI_OPERATION_SELECTOR_STEP_INVALID');

  const manifest = requireInstalledManifest(installedListing);
  const surface = identityFor(manifest);
  if (
    !sameIdentity(readyStep.candidate.package, surface) ||
    !hasExactSurfaceContribution(readyStep.candidate, manifest)
  ) {
    fail('SURFACE_AI_OPERATION_SELECTOR_IDENTITY_MISMATCH');
  }

  const operations = manifest.aiAccess?.schemaVersion === 1 ? manifest.aiAccess.operations : undefined;
  if (!Array.isArray(operations)) fail('SURFACE_AI_OPERATION_SELECTOR_OPERATION_UNDECLARED');

  const matching = operations.filter(
    (operation) =>
      operation.capability === readyStep.candidate.capability &&
      readyStep.candidate.candidateId === `surface:${surface.packageId}:${surface.packageVersion}:${operation.id}`
  );
  if (matching.length === 0) fail('SURFACE_AI_OPERATION_SELECTOR_OPERATION_UNDECLARED');
  if (matching.length !== 1) fail('SURFACE_AI_OPERATION_SELECTOR_OPERATION_AMBIGUOUS');

  const [operation] = matching;
  validateNonSecretOperation(operation);
  return Object.freeze({ surface: Object.freeze({ ...surface }), operation: Object.freeze(cloneOperation(operation)) });
};
