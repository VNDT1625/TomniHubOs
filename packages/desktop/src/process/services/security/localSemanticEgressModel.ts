import type { LocalInferenceBroker } from '@process/experimentalCore/adapters/sidecar/localInferenceBroker';

import type { SemanticEgressModel, SemanticEgressModelOutput } from './semanticEgressGuard';
import type { SemanticSecurityEvidence } from './semanticSecurityPolicy';

type LegacySecurityModelOutput = Readonly<{
  action: 'allow' | 'ask' | 'local_only' | 'block';
  confidence: number;
  reasonCode: string;
  riskType?: string;
  requiresBackendValidation?: boolean;
  redactions?: readonly string[];
}>;

export type LocalSemanticEgressModelOptions = Readonly<{
  now?: () => number;
  contractVersion?: string;
  deadlineMs?: number;
}>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const securityOutputOf = (value: unknown): LegacySecurityModelOutput | SemanticSecurityEvidence | undefined => {
  if (!isObject(value)) return undefined;
  const candidate = isObject(value.security) ? value.security : value;
  if (!isObject(candidate) || typeof candidate.reasonCode !== 'string' || typeof candidate.riskType !== 'string')
    return undefined;
  if (
    candidate.requiresBackendValidation === true &&
    Array.isArray(candidate.redactions) &&
    candidate.redactions.every((item) => item === 'credential' || item === 'private_fields') &&
    !('action' in candidate)
  )
    return candidate as unknown as SemanticSecurityEvidence;
  if (
    (candidate.action === 'allow' ||
      candidate.action === 'ask' ||
      candidate.action === 'local_only' ||
      candidate.action === 'block') &&
    typeof candidate.confidence === 'number' &&
    Number.isFinite(candidate.confidence) &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1 &&
    candidate.requiresBackendValidation === true &&
    Array.isArray(candidate.redactions) &&
    candidate.redactions.every((item) => item === 'credential' || item === 'private_fields')
  )
    return candidate as unknown as LegacySecurityModelOutput;
  return undefined;
};

/**
 * Legacy local inference broker adapter for V2 semantic evidence.
 * @deprecated Production standard is LayaSemanticEgressModel (layaSemanticEgressModel.ts).
 * Preserved for backward-compatibility with experimental sidecar harnesses.
 */
export const createLocalSemanticEgressModel = (
  broker: LocalInferenceBroker,
  options: LocalSemanticEgressModelOptions = {}
): SemanticEgressModel => {
  const now = options.now ?? Date.now;
  const contractVersion = options.contractVersion ?? 'tomny.security.input.v1';
  const deadlineMs = options.deadlineMs ?? 30_000;
  return async ({ sanitizedPayload, contentHash, signal }): Promise<SemanticEgressModelOutput> => {
    const response = await broker.infer(
      {
        requestId: `semantic-egress:${contentHash}`,
        purpose: 'security',
        contractVersion,
        priority: 'P0',
        deadlineMs: now() + deadlineMs,
        payload: {
          schema: contractVersion,
          contentHash,
          payload: sanitizedPayload,
          task: 'classify-final-external-egress',
        },
        fallback: 'abstain',
      },
      signal
    );
    const output =
      response.source === 'adapter' && response.validation === 'passed' ? securityOutputOf(response.value) : undefined;
    if (!output) throw new Error('LOCAL_SEMANTIC_SECURITY_UNAVAILABLE');
    return {
      riskType: output.riskType as SemanticEgressModelOutput['riskType'],
      reasonCode: output.reasonCode as SemanticEgressModelOutput['reasonCode'],
      requiresBackendValidation: true,
      redactions: (output.redactions ?? []) as SemanticEgressModelOutput['redactions'],
    };
  };
};
