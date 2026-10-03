import {
  createCapabilityActivationProposal,
  resolveCapability,
  type ActivationProposal,
  type CapabilityCandidate,
  type CapabilityQuery,
  type CapabilityResolution,
  type SurfacePlanningStep,
} from '@/common/packages';

export type SurfaceCandidateSource = Readonly<{
  collect: (query: CapabilityQuery) => Promise<readonly CapabilityCandidate[]>;
}>;

export type SurfacePlanningService = Readonly<{
  plan: (input: {
    queries: readonly CapabilityQuery[];
    requestedAt: string;
  }) => Promise<readonly SurfacePlanningStep[]>;
}>;

const mergeCandidates = (sets: readonly (readonly CapabilityCandidate[])[]): CapabilityCandidate[] => {
  const byId = new Map<string, CapabilityCandidate>();
  for (const candidate of sets.flat()) {
    if (byId.has(candidate.candidateId)) throw new Error(`Duplicate Surface candidate: ${candidate.candidateId}`);
    byId.set(candidate.candidateId, candidate);
  }
  return [...byId.values()].toSorted((left, right) => left.candidateId.localeCompare(right.candidateId));
};

const blockedReasons = (resolution: CapabilityResolution): readonly string[] =>
  [...new Set(resolution.candidates.flatMap((candidate) => candidate.reasonCodes))].toSorted();

/**
 * Deterministic Store/Surface planner. It is intentionally incapable of
 * installation, purchase, consent, or execution; it only records the next
 * separately-governed action for each capability requirement.
 */
export const createSurfacePlanningService = (options: {
  sources: readonly SurfaceCandidateSource[];
  createProposalId: (query: CapabilityQuery, candidate: CapabilityCandidate) => string;
  requiresPurchase: (candidate: CapabilityCandidate) => boolean;
  evaluatedAt?: () => string;
}): SurfacePlanningService => {
  if (options.sources.length === 0) throw new Error('Surface planner requires at least one candidate source.');
  const evaluatedAt = options.evaluatedAt ?? (() => new Date().toISOString());

  return {
    plan: async ({ queries, requestedAt }) => {
      if (!requestedAt.trim()) throw new Error('Surface plan request time is required.');
      const queryIds = new Set<string>();
      for (const query of queries) {
        if (queryIds.has(query.queryId)) throw new Error(`Duplicate Surface plan query: ${query.queryId}`);
        queryIds.add(query.queryId);
      }
      return Promise.all(
        queries.map(async (query): Promise<SurfacePlanningStep> => {
          const candidates = mergeCandidates(await Promise.all(options.sources.map((source) => source.collect(query))));
          const resolution = resolveCapability(query, candidates, evaluatedAt());
          const selected = resolution.selectedCandidateId
            ? resolution.candidates.find((candidate) => candidate.candidateId === resolution.selectedCandidateId)
            : undefined;
          if (selected?.state === 'ready-local')
            return { kind: 'execute-local', query, resolution, candidate: selected };
          if (selected?.state === 'ready-remote')
            return { kind: 'execute-remote', query, resolution, candidate: selected };

          const installable = resolution.candidates.find((candidate) => candidate.state === 'installable');
          if (installable) {
            return {
              kind: 'propose-install',
              query,
              resolution,
              proposal: createCapabilityActivationProposal(resolution, installable.candidateId, {
                proposalId: options.createProposalId(query, installable),
                requestedAt,
                requiresPurchase: options.requiresPurchase(installable),
              }),
            };
          }
          return { kind: 'blocked', query, resolution, reasonCodes: blockedReasons(resolution) };
        })
      );
    },
  };
};
