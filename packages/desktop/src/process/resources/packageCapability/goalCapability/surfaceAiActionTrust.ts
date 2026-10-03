import type { TrustBroker } from '@/process/foundation/trustBroker';

export const C4_LOCAL_SURFACE_AI_ORIGIN = 'tomny://surface-ai-operation';

export type C4LocalSurfaceAiTarget = Readonly<{
  /** Main-discovered Foundation target, never an IPC model selector. */
  targetId: string;
  kind: 'local';
  /** A local model may expose a loopback API; public/cloud hosts are a C5 gate. */
  networkHost?: string;
}>;

export type C4LocalSurfaceAiTrustErrorCode =
  | 'C4_SURFACE_AI_TARGET_INVALID'
  | 'C4_SURFACE_AI_TARGET_EGRESS_INVALID'
  | 'C4_SURFACE_AI_POLICY_INVALID';

export class C4LocalSurfaceAiTrustError extends Error {
  public constructor(public readonly code: C4LocalSurfaceAiTrustErrorCode) {
    super(code);
    this.name = 'C4LocalSurfaceAiTrustError';
  }
}

/**
 * The C4 dispatcher accepts the broker identity supplied by the Main-owned
 * Foundation runtime. This is a transport shape, not a C4 policy factory.
 */
export type C4LocalSurfaceAiTrust = Readonly<{
  origin: typeof C4_LOCAL_SURFACE_AI_ORIGIN;
  trustBroker: TrustBroker;
}>;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]']);

const requireText = (value: string, code: C4LocalSurfaceAiTrustErrorCode): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) throw new C4LocalSurfaceAiTrustError(code);
  return normalized;
};

/**
 * Validates the Main-discovered target facts for the local-only C4 pilot.
 * The caller must use the already configured FoundationTrustRuntime for policy
 * and grants; this helper deliberately cannot create a parallel broker.
 */
export const assertC4LocalSurfaceAiTarget = (target: C4LocalSurfaceAiTarget): void => {
  const targetId = requireText(target.targetId, 'C4_SURFACE_AI_TARGET_INVALID');
  if (target.kind !== 'local') throw new C4LocalSurfaceAiTrustError('C4_SURFACE_AI_TARGET_INVALID');
  const networkHost =
    target.networkHost === undefined
      ? undefined
      : requireText(target.networkHost, 'C4_SURFACE_AI_TARGET_EGRESS_INVALID');
  if (networkHost !== undefined && !LOOPBACK_HOSTS.has(networkHost)) {
    throw new C4LocalSurfaceAiTrustError('C4_SURFACE_AI_TARGET_EGRESS_INVALID');
  }
  // Retain the target check even though the runtime does not store it: it makes
  // accidental empty IDs impossible before a run/receipt can be allocated.
  void targetId;
};
