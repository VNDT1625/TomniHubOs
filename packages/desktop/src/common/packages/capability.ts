import type {
  ActivationProposal,
  CapabilityCandidate,
  CapabilityCandidateState,
  CapabilityQuery,
  CapabilityResolution,
} from './types';

/** Versioned contracts for supervised native package capabilities. */

export const PACKAGE_CAPABILITY_ABI_VERSION = 1;

export const PACKAGE_NATIVE_CAPABILITIES = ['host.runtime.info'] as const;

export type PackageNativeCapability = (typeof PACKAGE_NATIVE_CAPABILITIES)[number];

export type PackageCapabilityLeaseRequest = Readonly<{
  version: typeof PACKAGE_CAPABILITY_ABI_VERSION;
  packageId: string;
  runtimeId: string;
  capability: PackageNativeCapability;
}>;

export type PackageCapabilityLease = Readonly<{
  version: typeof PACKAGE_CAPABILITY_ABI_VERSION;
  leaseId: string;
  packageId: string;
  runtimeId: string;
  capability: PackageNativeCapability;
  expiresAt: string;
}>;

export type PackageCapabilitySyscall = Readonly<{
  version: typeof PACKAGE_CAPABILITY_ABI_VERSION;
  leaseId: string;
  packageId: string;
  runtimeId: string;
  name: 'host.runtime.info';
}>;

export type PackageCapabilityReceipt = Readonly<{
  receiptId: string;
  packageId: string;
  runtimeId: string;
  capability: PackageNativeCapability;
  syscall: PackageCapabilitySyscall['name'];
  status: 'completed' | 'cancelled' | 'denied';
  recordedAt: string;
}>;

export type PackageCapabilityResult =
  | Readonly<{
      ok: true;
      data: { abiVersion: typeof PACKAGE_CAPABILITY_ABI_VERSION; packageId: string };
      receipt: PackageCapabilityReceipt;
    }>
  | Readonly<{ ok: false; code: PackageCapabilityErrorCode; receipt?: PackageCapabilityReceipt }>;

export type PackageCapabilityErrorCode =
  | 'PACKAGE_CAPABILITY_REQUEST_INVALID'
  | 'PACKAGE_CAPABILITY_PACKAGE_INACTIVE'
  | 'PACKAGE_CAPABILITY_NOT_DECLARED'
  | 'PACKAGE_CAPABILITY_LEASE_UNAVAILABLE'
  | 'PACKAGE_CAPABILITY_LEASE_EXPIRED'
  | 'PACKAGE_CAPABILITY_LEASE_REVOKED'
  | 'PACKAGE_CAPABILITY_SYSCALL_DENIED';

export const CAPABILITY_RESOLUTION_REASON = {
  CAPABILITY_MISMATCH: 'CAPABILITY_MISMATCH',
  UNTRUSTED: 'UNTRUSTED',
  INCOMPATIBLE: 'INCOMPATIBLE',
  UNHEALTHY: 'UNHEALTHY',
  DATA_LOCATION_DISALLOWED: 'DATA_LOCATION_DISALLOWED',
  UI_REQUIRED: 'UI_REQUIRED',
  OFFLINE_REQUIRED: 'OFFLINE_REQUIRED',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  INSTALL_REVIEW_REQUIRED: 'INSTALL_REVIEW_REQUIRED',
} as const;

type CapabilityResolutionReason = (typeof CAPABILITY_RESOLUTION_REASON)[keyof typeof CAPABILITY_RESOLUTION_REASON];

const dataLocationAllowed = (query: CapabilityQuery, candidate: CapabilityCandidate): boolean =>
  query.dataLocation === 'remote-allowed' ||
  candidate.dataLocation === 'local-only' ||
  (query.dataLocation === 'region-bound' && candidate.dataLocation === 'region-bound');

const selectionRank: Readonly<Record<CapabilityCandidateState, number>> = {
  'ready-local': 0,
  'ready-remote': 1,
  installable: 2,
  unavailable: 3,
};

/** Evaluates declared resolver facts only; it never installs, purchases, activates, or grants a capability. */
export const evaluateCapabilityCandidate = (
  query: CapabilityQuery,
  candidate: CapabilityCandidate
): CapabilityCandidate => {
  const blockers: CapabilityResolutionReason[] = [];
  if (candidate.capability !== query.capability) blockers.push(CAPABILITY_RESOLUTION_REASON.CAPABILITY_MISMATCH);
  if (!candidate.trusted) blockers.push(CAPABILITY_RESOLUTION_REASON.UNTRUSTED);
  if (!candidate.compatible) blockers.push(CAPABILITY_RESOLUTION_REASON.INCOMPATIBLE);
  if ((candidate.state === 'ready-local' || candidate.state === 'ready-remote') && !candidate.healthy) {
    blockers.push(CAPABILITY_RESOLUTION_REASON.UNHEALTHY);
  }
  if (!dataLocationAllowed(query, candidate)) blockers.push(CAPABILITY_RESOLUTION_REASON.DATA_LOCATION_DISALLOWED);
  if (query.requireUi && !candidate.supportsUi) blockers.push(CAPABILITY_RESOLUTION_REASON.UI_REQUIRED);
  if (query.requireOffline && (candidate.state !== 'ready-local' || !candidate.supportsOffline)) {
    blockers.push(CAPABILITY_RESOLUTION_REASON.OFFLINE_REQUIRED);
  }
  if (candidate.state === 'unavailable') blockers.push(CAPABILITY_RESOLUTION_REASON.SOURCE_UNAVAILABLE);

  const state: CapabilityCandidateState = blockers.length === 0 ? candidate.state : 'unavailable';
  const reasonCodes = [
    ...new Set([
      ...candidate.reasonCodes,
      ...blockers,
      ...(state === 'installable' ? [CAPABILITY_RESOLUTION_REASON.INSTALL_REVIEW_REQUIRED] : []),
    ]),
  ].toSorted();
  return { ...candidate, state, reasonCodes };
};

/**
 * Resolves candidates deterministically for a single governed Run step. Local
 * readiness wins over remote readiness; installation remains a non-selected,
 * reviewable state and must never be treated as an execution grant.
 */
export const resolveCapability = (
  query: CapabilityQuery,
  candidates: readonly CapabilityCandidate[],
  evaluatedAt: string = new Date().toISOString()
): CapabilityResolution => {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.candidateId)) throw new Error('Capability resolver candidate ids must be unique.');
    ids.add(candidate.candidateId);
  }
  const evaluated = candidates
    .map((candidate) => evaluateCapabilityCandidate(query, candidate))
    .toSorted((left, right) => {
      const rank = selectionRank[left.state] - selectionRank[right.state];
      return rank !== 0 ? rank : left.candidateId.localeCompare(right.candidateId);
    });
  const selected = evaluated.find(
    (candidate) => candidate.state === 'ready-local' || candidate.state === 'ready-remote'
  );
  return {
    schemaVersion: 1,
    queryId: query.queryId,
    candidates: evaluated,
    ...(selected ? { selectedCandidateId: selected.candidateId } : {}),
    evaluatedAt,
  };
};

/** Creates review metadata for an installable candidate; this function cannot perform installation or payment. */
export const createCapabilityActivationProposal = (
  resolution: CapabilityResolution,
  candidateId: string,
  input: Readonly<{ proposalId: string; requestedAt: string; requiresPurchase: boolean }>
): ActivationProposal => {
  const candidate = resolution.candidates.find((item) => item.candidateId === candidateId);
  if (!candidate || candidate.state !== 'installable') {
    throw new Error('Capability activation requires an installable candidate.');
  }
  if (!input.proposalId.trim() || !input.requestedAt.trim())
    throw new Error('Capability activation proposal identity is required.');
  return {
    schemaVersion: 1,
    proposalId: input.proposalId,
    queryId: resolution.queryId,
    candidate,
    requestedAt: input.requestedAt,
    requiresInstall: true,
    requiresPurchase: input.requiresPurchase,
    requiredConsent: [
      'install',
      'permissions',
      ...(input.requiresPurchase ? (['purchase'] as const) : []),
      ...(candidate.dataLocation === 'local-only' ? (['offline-data'] as const) : []),
    ],
  };
};
