import { createHash } from 'node:crypto';
import type { CapabilityCandidate, CapabilityQuery, PackageIdentity, PackageListing } from '@/common/packages';
import {
  createGoalSurfacePlanningCoordinator,
  type GoalCapabilityDeriver,
  type GoalSurfacePlanningCoordinator,
} from './goalSurfacePlanningCoordinator';
import { createStoreSurfaceCandidateProvider } from './storeSurfaceCandidateProvider';
import { createSurfacePlanningService } from './surfacePlanningService';

type StoreListingSource = Readonly<{
  list: (filter?: { type?: 'app'; installedOnly?: boolean }) => Promise<PackageListing[]>;
}>;

/** Uses only the signed integer-minor-unit offer attached to the selected Surface. */
export const requiresPurchaseFromSignedOffer = (candidate: CapabilityCandidate): boolean =>
  candidate.offer?.active === true && candidate.offer.price.amountMinor > 0;

const proposalIdFor = (query: CapabilityQuery, candidate: CapabilityCandidate): string => {
  const fingerprint = JSON.stringify({
    queryId: query.queryId,
    idempotencyKey: query.idempotencyKey,
    candidateId: candidate.candidateId,
  });
  return `surface-proposal-${createHash('sha256').update(fingerprint, 'utf8').digest('hex').slice(0, 24)}`;
};

/**
 * Main-only C3 composition. The caller supplies both the Store readiness gate
 * and authoritative commercial facts; this runtime cannot initialize Store,
 * infer a free price, mutate a package, or authorize execution.
 */
export const createGoalSurfacePlanningRuntime = (
  options: Readonly<{
    hubIdentity: PackageIdentity;
    deriver: GoalCapabilityDeriver;
    store: StoreListingSource;
    ensureStoreReady: () => Promise<void>;
    /** Must be derived from the exact signed catalog offer, never UI price text. */
    requiresPurchase?: (candidate: CapabilityCandidate) => boolean;
    evaluatedAt?: () => string;
  }>
): GoalSurfacePlanningCoordinator => {
  const surfacePlanner = createSurfacePlanningService({
    sources: [createStoreSurfaceCandidateProvider(options.store)],
    createProposalId: proposalIdFor,
    requiresPurchase: options.requiresPurchase ?? requiresPurchaseFromSignedOffer,
    evaluatedAt: options.evaluatedAt,
  });
  return createGoalSurfacePlanningCoordinator({
    hubIdentity: options.hubIdentity,
    deriver: {
      derive: async (input) => {
        await options.ensureStoreReady();
        return options.deriver.derive(input);
      },
    },
    surfacePlanner,
  });
};
