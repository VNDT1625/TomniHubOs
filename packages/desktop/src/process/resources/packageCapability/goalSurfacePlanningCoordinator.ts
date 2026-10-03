import { createHash } from 'node:crypto';
import {
  parseCapabilityQuery,
  type CapabilityQuery,
  type GoalSurfacePlan,
  type PackageIdentity,
} from '@/common/packages';
import type { SurfacePlanningService } from './surfacePlanningService';

const MAX_GOAL_LENGTH = 10_000;
const MAX_REQUIREMENTS = 32;

export type GoalCapabilityDeriver = Readonly<{
  /**
   * Main-owned model/agent adapter. Its result is untrusted even when the
   * adapter is local: the coordinator validates every requirement before Store
   * facts are consulted.
   */
  derive: (input: Readonly<{ requestId: string; goal: string; requestedAt: string }>) => Promise<unknown>;
}>;

export type GoalSurfacePlanningCoordinator = Readonly<{
  plan: (input: Readonly<{ requestId: string; goal: string; requestedAt: string }>) => Promise<GoalSurfacePlan>;
}>;

const sameIdentity = (left: PackageIdentity, right: PackageIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const requireText = (value: string, errorCode: string, maximum: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(errorCode);
  return value;
};

const parseDerivedRequirements = (value: unknown, requester: PackageIdentity): readonly CapabilityQuery[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REQUIREMENTS) {
    throw new Error('GOAL_SURFACE_REQUIREMENTS_INVALID');
  }
  const queryIds = new Set<string>();
  return value.map((candidate) => {
    let query: CapabilityQuery;
    try {
      query = parseCapabilityQuery(candidate);
    } catch {
      throw new Error('GOAL_SURFACE_REQUIREMENTS_INVALID');
    }
    if (!sameIdentity(query.requester, requester) || queryIds.has(query.queryId)) {
      throw new Error('GOAL_SURFACE_REQUIREMENTS_INVALID');
    }
    queryIds.add(query.queryId);
    // A model receives the raw goal but plans are durable/displayable evidence.
    // Do not let untrusted model text turn the capability purpose into another
    // projection channel for raw private goal context.
    return { ...query, purpose: `Capability requirement: ${query.capability}` };
  });
};

/**
 * Main-only C3 composition point for "what does this goal need?". It receives
 * no permission authority and can only emit deterministic Surface planning
 * facts. Installation, purchase, consent and Surface execution remain separate
 * C2/C4 actions.
 */
export const createGoalSurfacePlanningCoordinator = (
  options: Readonly<{
    hubIdentity: PackageIdentity;
    deriver: GoalCapabilityDeriver;
    surfacePlanner: SurfacePlanningService;
  }>
): GoalSurfacePlanningCoordinator => ({
  plan: async ({ requestId: rawRequestId, goal: rawGoal, requestedAt }) => {
    const requestId = requireText(rawRequestId, 'GOAL_SURFACE_REQUEST_INVALID', 200);
    const goal = requireText(rawGoal, 'GOAL_SURFACE_REQUEST_INVALID', MAX_GOAL_LENGTH);
    if (!Number.isFinite(Date.parse(requestedAt))) throw new Error('GOAL_SURFACE_REQUEST_INVALID');

    const requirements = parseDerivedRequirements(
      await options.deriver.derive({ requestId, goal, requestedAt }),
      options.hubIdentity
    );
    const steps = await options.surfacePlanner.plan({ queries: requirements, requestedAt });
    return {
      schemaVersion: 1,
      requestId,
      goalDigest: `sha256-${createHash('sha256').update(goal, 'utf8').digest('hex')}`,
      requirementCount: requirements.length,
      steps,
    };
  },
});
