import type { LocalInferenceBroker } from '@process/experimentalCore/adapters/sidecar/localInferenceBroker';

import { parseUserUnderstandingSignal, type UserUnderstandingSignal } from './userUnderstandingProposalAdapter';

export type LocalUserUnderstandingInput = Readonly<{
  requestId: string;
  userQuery: string;
  deadlineMs: number;
}>;

/**
 * Reads a v2 signal only from a user-authored query. This does not persist data,
 * influence a response, or receive tool, terminal, OCR, or source-code content.
 */
export const readLocalUserUnderstandingSignal = async (
  broker: LocalInferenceBroker,
  input: LocalUserUnderstandingInput,
  signal?: AbortSignal
): Promise<UserUnderstandingSignal | undefined> => {
  if (!input.requestId.trim() || !input.userQuery.trim() || !Number.isFinite(input.deadlineMs)) return undefined;
  const response = await broker.infer(
    {
      requestId: input.requestId,
      purpose: 'user-understanding',
      contractVersion: 'tomny.user-understanding.input.v2',
      priority: 'P2',
      deadlineMs: input.deadlineMs,
      payload: { schema: 'tomny.user-understanding.input.v2', userQuery: input.userQuery },
      fallback: 'abstain',
    },
    signal
  );
  return response.source === 'adapter' && response.validation === 'passed'
    ? parseUserUnderstandingSignal(response.value)
    : undefined;
};
