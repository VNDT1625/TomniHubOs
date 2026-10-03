import type { PackageListing, SurfacePlanningStep } from '@/common/packages';
import type { SurfaceAiAccessConsent } from '../surfaceAiAccessBroker';
import type { SurfaceAiRuntimeTransportBinding } from '../surfaceAiRuntimeTransport';
import { selectReadyLocalSurfaceAiOperation, type SurfaceAiOperationSelection } from './surfaceAiOperationSelector';

export type SurfaceAiActionReadinessErrorCode =
  | 'SURFACE_AI_ACTION_CONSENT_UNAVAILABLE'
  | 'SURFACE_AI_ACTION_CONSENT_MISMATCH'
  | 'SURFACE_AI_ACTION_CONSENT_EXPIRED'
  | 'SURFACE_AI_ACTION_RUNTIME_UNAVAILABLE'
  | 'SURFACE_AI_ACTION_RUNTIME_AMBIGUOUS';

export class SurfaceAiActionReadinessError extends Error {
  public constructor(public readonly code: SurfaceAiActionReadinessErrorCode) {
    super(code);
    this.name = 'SurfaceAiActionReadinessError';
  }
}

export type SurfaceAiActionReadinessInput = Readonly<{
  /** Main-authored C3 step; no renderer or model operation is accepted here. */
  planStep: SurfacePlanningStep;
  /** Fresh signed Store listing for the exact planned package. */
  installedListing: PackageListing;
  accountId: string;
  consentId: string;
}>;

export type SurfaceAiActionReadiness = Readonly<{
  selection: SurfaceAiOperationSelection;
  consent: SurfaceAiAccessConsent;
  /** A single live authenticated port endpoint; multiple windows must be resolved by a later Main UI policy. */
  runtime: SurfaceAiRuntimeTransportBinding;
}>;

export type SurfaceAiActionReadinessDeps = Readonly<{
  /** The durable Main consent store may require asynchronous initialization. */
  getConsent: (consentId: string) => SurfaceAiAccessConsent | undefined | Promise<SurfaceAiAccessConsent | undefined>;
  listVerifiedRuntimeBindings: (packageId: string) => Promise<readonly SurfaceAiRuntimeTransportBinding[]>;
  isTransportActive: (binding: SurfaceAiRuntimeTransportBinding) => boolean;
  now?: () => number;
}>;

const sameIdentity = (
  left: SurfaceAiOperationSelection['surface'],
  right: SurfaceAiOperationSelection['surface']
): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

const requireText = (value: string, code: SurfaceAiActionReadinessErrorCode): string => {
  const normalized = value.trim();
  if (!normalized) throw new SurfaceAiActionReadinessError(code);
  return normalized;
};

/**
 * Binds an already planned local Surface action to current Store, consent, and
 * authenticated-port facts. It has no execution side effect and deliberately
 * rejects multiple live runtimes until a Main-owned surface-instance picker is
 * introduced; renderer-provided runtime IDs are never a selection mechanism.
 */
export const prepareReadyLocalSurfaceAiAction = async (
  deps: SurfaceAiActionReadinessDeps,
  input: SurfaceAiActionReadinessInput
): Promise<SurfaceAiActionReadiness> => {
  const accountId = requireText(input.accountId, 'SURFACE_AI_ACTION_CONSENT_MISMATCH');
  const consentId = requireText(input.consentId, 'SURFACE_AI_ACTION_CONSENT_UNAVAILABLE');
  const selection = selectReadyLocalSurfaceAiOperation({
    planStep: input.planStep,
    installedListing: input.installedListing,
    secretUse: false,
  });
  const consent = await deps.getConsent(consentId);
  const now = deps.now?.() ?? Date.now();
  if (!consent) throw new SurfaceAiActionReadinessError('SURFACE_AI_ACTION_CONSENT_UNAVAILABLE');
  if (consent.revokedAt !== undefined || consent.grantedAt > now || consent.expiresAt <= now) {
    throw new SurfaceAiActionReadinessError('SURFACE_AI_ACTION_CONSENT_EXPIRED');
  }
  if (
    consent.accountId !== accountId ||
    !sameIdentity(consent.surface, selection.surface) ||
    consent.placement !== 'local' ||
    consent.operationId !== selection.operation.id ||
    consent.capability !== selection.operation.capability ||
    consent.inputSchemaVersion !== selection.operation.inputSchemaVersion ||
    consent.secretUse !== false ||
    !sameStrings(consent.dataClasses, selection.operation.dataClasses) ||
    !sameStrings(consent.destinationIds, selection.operation.destinationIds)
  ) {
    throw new SurfaceAiActionReadinessError('SURFACE_AI_ACTION_CONSENT_MISMATCH');
  }

  const runtimes = (await deps.listVerifiedRuntimeBindings(selection.surface.packageId)).filter(
    (runtime) => sameIdentity(runtime.surface, selection.surface) && deps.isTransportActive(runtime)
  );
  if (runtimes.length === 0) throw new SurfaceAiActionReadinessError('SURFACE_AI_ACTION_RUNTIME_UNAVAILABLE');
  if (runtimes.length !== 1) throw new SurfaceAiActionReadinessError('SURFACE_AI_ACTION_RUNTIME_AMBIGUOUS');

  return Object.freeze({
    selection: Object.freeze({
      surface: Object.freeze({ ...selection.surface }),
      operation: Object.freeze({
        ...selection.operation,
        dataClasses: [...selection.operation.dataClasses],
        destinationIds: [...selection.operation.destinationIds],
      }),
    }),
    consent: Object.freeze({
      ...consent,
      surface: Object.freeze({ ...consent.surface }),
      dataClasses: [...consent.dataClasses],
      destinationIds: [...consent.destinationIds],
      limits: Object.freeze({ ...consent.limits }),
    }),
    runtime: Object.freeze({ ...runtimes[0], surface: Object.freeze({ ...runtimes[0].surface }) }),
  });
};
