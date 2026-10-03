import type { PersonalLearningCoordinator } from '@process/agentRuntime/contextStore';
import type { ContextFact, ContextScope, PersonalLearningRecord } from '@process/agentRuntime/contextTypes';

export type UserUnderstandingSignal = Readonly<{
  hasMemorySignal: boolean;
  kind: 'preference' | 'fact' | 'decision' | 'habit' | 'none';
  scopeHint: 'workspace' | 'surface' | 'global' | 'none';
  confidence: number;
  reason: string;
  requiresUserConfirmation: boolean;
}>;

export type UserUnderstandingProposalInput = Readonly<{
  featureEnabled: boolean;
  source: 'user-query';
  userQuery: string;
  signal: unknown;
  value: string;
  key: string;
  surfaceId?: string;
  workspaceId?: string;
  provenance: string;
}>;

export type UserUnderstandingProposalResult =
  | Readonly<{ created: true; record: PersonalLearningRecord }>
  | Readonly<{ created: false; reasonCode: string }>;

const MIN_CONFIDENCE = 0.9;
const MAX_REASON_LENGTH = 240;
const MAX_VALUE_LENGTH = 500;
const sensitiveOrInjected =
  /-----BEGIN|\b(?:api[_-]?key|password|secret|token|ssn|social security|credit card|ignore (?:all |previous )?instructions|system prompt)\b/iu;
const temporaryInstruction = /\b(?:for this (?:message|turn|request)|temporar(?:y|ily)|just this once)\b/iu;

export const parseUserUnderstandingSignal = (value: unknown): UserUnderstandingSignal | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const signal = value as Partial<UserUnderstandingSignal>;
  const keys = Object.keys(signal);
  if (
    keys.length !== 6 ||
    !['hasMemorySignal', 'kind', 'scopeHint', 'confidence', 'reason', 'requiresUserConfirmation'].every((key) =>
      keys.includes(key)
    ) ||
    typeof signal.hasMemorySignal !== 'boolean' ||
    !['preference', 'fact', 'decision', 'habit', 'none'].includes(signal.kind ?? '') ||
    !['workspace', 'surface', 'global', 'none'].includes(signal.scopeHint ?? '') ||
    typeof signal.confidence !== 'number' ||
    !Number.isFinite(signal.confidence) ||
    signal.confidence < 0 ||
    signal.confidence > 1 ||
    typeof signal.reason !== 'string' ||
    signal.reason.length === 0 ||
    signal.reason.length > MAX_REASON_LENGTH ||
    sensitiveOrInjected.test(signal.reason) ||
    typeof signal.requiresUserConfirmation !== 'boolean' ||
    (signal.hasMemorySignal && (signal.kind === 'none' || signal.scopeHint === 'none')) ||
    (!signal.hasMemorySignal && (signal.kind !== 'none' || signal.scopeHint !== 'none'))
  ) {
    return undefined;
  }
  return signal as UserUnderstandingSignal;
};

const scopeFor = (signal: UserUnderstandingSignal, input: UserUnderstandingProposalInput): ContextScope | undefined => {
  if (signal.scopeHint === 'global') return { kind: 'global' };
  if (signal.scopeHint === 'workspace')
    return input.workspaceId?.trim() ? { kind: 'workspace', workspace: input.workspaceId.trim() } : undefined;
  return input.surfaceId?.trim() ? { kind: 'surface', surface: input.surfaceId.trim() } : undefined;
};

/** Main-only bridge: signals can create reviewable records but cannot change projections or Trust. */
export const createUserUnderstandingProposalAdapter = (coordinator: Pick<PersonalLearningCoordinator, 'propose'>) => ({
  async propose(input: UserUnderstandingProposalInput): Promise<UserUnderstandingProposalResult> {
    if (!input.featureEnabled) return { created: false, reasonCode: 'feature_disabled' };
    if (input.source !== 'user-query' || !input.userQuery.trim())
      return { created: false, reasonCode: 'non_user_authored' };
    if (sensitiveOrInjected.test(input.userQuery) || sensitiveOrInjected.test(input.value)) {
      return { created: false, reasonCode: 'sensitive_or_injected' };
    }
    if (temporaryInstruction.test(input.userQuery)) return { created: false, reasonCode: 'temporary_instruction' };
    const signal = parseUserUnderstandingSignal(input.signal);
    if (!signal) return { created: false, reasonCode: 'invalid_signal' };
    if (!signal.hasMemorySignal || signal.kind === 'none' || signal.scopeHint === 'none') {
      return { created: false, reasonCode: 'no_memory_signal' };
    }
    if (!signal.requiresUserConfirmation || signal.confidence < MIN_CONFIDENCE) {
      return { created: false, reasonCode: 'confirmation_or_confidence_required' };
    }
    const scope = scopeFor(signal, input);
    const key = input.key.trim();
    const value = input.value.trim();
    if (!scope || !key || value.length === 0 || value.length > MAX_VALUE_LENGTH || !input.provenance.trim()) {
      return { created: false, reasonCode: 'invalid_proposal_input' };
    }
    const collection = signal.kind === 'preference' ? 'preferences' : signal.kind === 'habit' ? 'habits' : 'facts';
    const fact: ContextFact = {
      key,
      value,
      confidence: signal.confidence,
      source: 'user',
      learnedAt: Date.now(),
      scope,
      sensitivity: 'normal',
      userLocked: false,
    };
    const explanation = 'User-confirmed proposal.';
    const record = await coordinator.propose({
      collection,
      fact,
      explanation,
      provenance: input.provenance,
      causal: {
        context: 'user-authored-query',
        origin: input.provenance,
        reason: explanation,
        reasonKnown: true,
        proposal: `Confirm ${signal.kind} for ${signal.scopeHint} scope`,
      },
    });
    return { created: true, record };
  },
});
