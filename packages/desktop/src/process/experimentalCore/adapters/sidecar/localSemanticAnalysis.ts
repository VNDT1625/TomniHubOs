import type { LocalInferenceBroker } from './localInferenceBroker';

import {
  parseUserUnderstandingSignal,
  type UserUnderstandingSignal,
} from '@process/userUnderstanding/userUnderstandingProposalAdapter';

export type LocalSemanticAnalysisInput = Readonly<{
  requestId: string;
  securityPayload: string;
  userAuthoredQuery: string;
  deadlineMs: number;
}>;

type SecurityOutput = Readonly<{
  action: 'allow' | 'ask' | 'local_only' | 'block';
  confidence: number;
  reasonCode: string;
}>;

export type LocalSemanticAnalysis = Readonly<{
  security: SecurityOutput | undefined;
  userUnderstanding: UserUnderstandingSignal | undefined;
}>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const securityOutputOf = (value: unknown): SecurityOutput | undefined => {
  if (!isObject(value)) return undefined;
  const security = value.security;
  if (!isObject(security)) return undefined;
  if (!['allow', 'ask', 'local_only', 'block'].includes(String(security.action))) return undefined;
  if (typeof security.confidence !== 'number' || !Number.isFinite(security.confidence)) return undefined;
  if (typeof security.reasonCode !== 'string' || !security.reasonCode || security.reasonCode.length > 128)
    return undefined;
  return security as SecurityOutput;
};

/**
 * Uses the combined adapter once, only when Main already holds both independently
 * bounded inputs. It never derives a memory signal from the egress payload.
 */
export const readLocalSemanticAnalysis = async (
  broker: LocalInferenceBroker,
  input: LocalSemanticAnalysisInput,
  signal?: AbortSignal
): Promise<LocalSemanticAnalysis | undefined> => {
  if (
    !input.requestId.trim() ||
    !input.securityPayload.trim() ||
    !input.userAuthoredQuery.trim() ||
    !Number.isFinite(input.deadlineMs)
  ) {
    return undefined;
  }
  const response = await broker.infer(
    {
      requestId: input.requestId,
      purpose: 'semantic-analysis',
      contractVersion: 'tomny.semantic-analysis.input.v1',
      priority: 'P0',
      deadlineMs: input.deadlineMs,
      payload: {
        schema: 'tomny.semantic-analysis.input.v1',
        securityPayload: input.securityPayload,
        userAuthoredQuery: input.userAuthoredQuery,
      },
      fallback: 'abstain',
    },
    signal
  );
  if (response.source !== 'adapter' || response.validation !== 'passed' || !isObject(response.value)) return undefined;
  const keys = Object.keys(response.value);
  if (keys.length !== 2 || !keys.includes('security') || !keys.includes('userUnderstanding')) return undefined;
  const userUnderstanding = response.value.userUnderstanding;
  return {
    security: securityOutputOf(response.value),
    userUnderstanding: userUnderstanding === null ? undefined : parseUserUnderstandingSignal(userUnderstanding),
  };
};
