import type { PersonalLearningCoordinator } from '@process/agentRuntime/contextStore';
import type { LocalInferenceBroker } from '@process/experimentalCore/adapters/sidecar/localInferenceBroker';

import { readLocalUserUnderstandingSignal } from './localUserUnderstandingSignal';
import { createUserUnderstandingProposalAdapter } from './userUnderstandingProposalAdapter';

export type UserUnderstandingObservation = Readonly<{
  requestId: string;
  userQuery: string;
  workspaceId?: string;
  surfaceId?: string;
  provenance: string;
}>;

export type UserUnderstandingConsumer = Readonly<{
  observe(input: UserUnderstandingObservation): void;
}>;

export type UserUnderstandingConsumerOptions = Readonly<{
  broker: LocalInferenceBroker;
  getLearningCoordinator: () => Promise<PersonalLearningCoordinator>;
  enabled: () => boolean;
  now?: () => number;
  onError?: (error: unknown) => void;
}>;

type ExplicitPreference = Readonly<{ key: 'response-language'; value: 'English' | 'Vietnamese' }>;

const unsafeQuery =
  /-----BEGIN|\b(?:api[_-]?key|password|secret|token|ssn|social security|credit card|ignore (?:all |previous )?instructions|system prompt)\b/iu;
const temporaryInstruction = /\b(?:for this (?:message|turn|request)|temporar(?:y|ily)|just this once)\b/iu;

// The model identifies a candidate; Main derives this bounded value without retaining the prompt.
const explicitLanguagePreference = (query: string): ExplicitPreference | undefined => {
  const normalized = query.trim();
  if (!/(?:answer|reply|respond|write|trả lời|phản hồi|viết)/iu.test(normalized)) return undefined;
  if (/\b(?:english|tiếng anh)\b/iu.test(normalized)) return { key: 'response-language', value: 'English' };
  if (/\b(?:vietnamese|tiếng việt)\b/iu.test(normalized)) return { key: 'response-language', value: 'Vietnamese' };
  return undefined;
};

/**
 * Runs after the chat response starts and receives only the original user query.
 * It cannot affect execution, Trust, provider egress, or the response itself.
 */
export const createUserUnderstandingConsumer = (
  options: UserUnderstandingConsumerOptions
): UserUnderstandingConsumer => {
  const now = options.now ?? Date.now;
  return {
    observe(input): void {
      if (!options.enabled()) return;
      if (unsafeQuery.test(input.userQuery) || temporaryInstruction.test(input.userQuery)) return;
      void (async () => {
        const preference = explicitLanguagePreference(input.userQuery);
        if (!preference) return;
        const signal = await readLocalUserUnderstandingSignal(options.broker, {
          requestId: input.requestId,
          userQuery: input.userQuery,
          deadlineMs: now() + 30_000,
        });
        if (!signal) return;
        if (signal.kind !== 'preference') return;
        const adapter = createUserUnderstandingProposalAdapter(await options.getLearningCoordinator());
        await adapter.propose({
          featureEnabled: options.enabled(),
          source: 'user-query',
          userQuery: input.userQuery,
          signal,
          key: preference.key,
          value: preference.value,
          workspaceId: input.workspaceId,
          surfaceId: input.surfaceId,
          provenance: input.provenance,
        });
      })().catch((error: unknown) => options.onError?.(error));
    },
  };
};
