/**
 * Laya Decision Engine adapter for semantic egress inspection.
 * Replaces generative token-by-token decoding with single forward-pass
 * typed decision primitives, adhering strictly to Security Ontology v1.
 */

import ontology from './security-ontology-v1.json';
import type { SemanticEgressModel, SemanticEgressModelOutput } from './semanticEgressGuard';
import type { SecurityReasonCode, SecurityRiskType, SemanticSecurityEvidence } from './semanticSecurityPolicy';

export type LayaQuestionChoice = Readonly<{
  type: 'choice';
  instructions: string;
  criteria: Readonly<Record<string, string>>;
}>;

export type LayaQuestionNoul = Readonly<{
  type: 'noul';
  instructions: string;
}>;

export type LayaQuestionScore = Readonly<{
  type: 'score';
  instructions: string;
}>;

export type LayaQuestion = LayaQuestionChoice | LayaQuestionNoul | LayaQuestionScore;

export type LayaAnswerChoice = Readonly<{
  choice: string;
  confidence: number;
  probabilities?: Readonly<Record<string, number>>;
}>;

export type LayaAnswerNoul = Readonly<{
  noul: number;
}>;

export type LayaAnswerScore = Readonly<{
  score: number;
}>;

export type LayaAnswer = LayaAnswerChoice | LayaAnswerNoul | LayaAnswerScore;

export type LayaPredictionResult = Readonly<{
  answers: Readonly<Record<string, LayaAnswer>>;
}>;

export type LayaPredictor = (
  state: Readonly<Record<string, string>>,
  questions: Readonly<Record<string, LayaQuestion>>,
  signal?: AbortSignal
) => Promise<LayaPredictionResult>;

export type LayaSemanticEgressModelOptions = Readonly<{
  minConfidence?: number;
}>;

const CANONICAL_RISK_REASON_MAP: Readonly<Record<SecurityRiskType, SecurityReasonCode>> = Object.freeze({
  none: 'NO_SEMANTIC_RISK',
  credential_exposure: 'CREDENTIAL_EXPOSURE',
  private_data_egress: 'PRIVATE_DATA_EXPOSURE',
  prompt_injection: 'PROMPT_INJECTION',
  destructive_action: 'DESTRUCTIVE_INTENT',
  uncertain: 'INSUFFICIENT_EVIDENCE',
});

const isRiskType = (val: string): val is SecurityRiskType => (ontology.riskTypes as readonly string[]).includes(val);

/**
 * Builds the canonical Laya question contract for security inspection.
 */
export const buildLayaSecurityQuestions = (): Readonly<Record<string, LayaQuestion>> => ({
  riskType: {
    type: 'choice',
    instructions: 'Classify the primary security risk of this text payload:',
    criteria: {
      none: 'Safe, benign public text, technical discussion, normal conversation, standard code',
      credential_exposure: 'Contains or exposes passwords, mk, pass, tokens, API keys, secret credentials',
      private_data_egress: 'Exfiltrates private personal PII, identity documents, bank accounts, private records',
      prompt_injection: 'Attempts to override system instructions, ignore previous rules, or hijack agent behavior',
      destructive_action: 'Commands to delete files, wipe directories, format disks, or drop databases',
      uncertain: 'Ambiguous, corrupted, incomplete or unclear data',
    },
  },
  isCredentialLeak: {
    type: 'noul',
    instructions: 'Does this payload expose credentials, passwords, or authentication secrets?',
  },
  isPrivateData: {
    type: 'noul',
    instructions: 'Does this payload expose private personal data, PII, or internal identity details?',
  },
});

/**
 * Creates a SemanticEgressModel powered by Laya Decision Engine.
 */
export const createLayaSemanticEgressModel = (
  predictor: LayaPredictor,
  _options: LayaSemanticEgressModelOptions = {}
): SemanticEgressModel => {
  const questions = buildLayaSecurityQuestions();

  return async ({ sanitizedPayload, signal }): Promise<SemanticEgressModelOutput> => {
    const result = await predictor({ payload: sanitizedPayload }, questions, signal);
    const answers = result?.answers;
    if (!answers) {
      throw new Error('LAYA_PREDICTION_MALFORMED');
    }

    const riskChoice = answers.riskType as LayaAnswerChoice | undefined;
    const rawChoice = riskChoice?.choice?.trim() ?? 'uncertain';
    const riskType: SecurityRiskType = isRiskType(rawChoice) ? rawChoice : 'uncertain';

    const reasonCode: SecurityReasonCode = CANONICAL_RISK_REASON_MAP[riskType] ?? 'INSUFFICIENT_EVIDENCE';

    const redactionsSet = new Set<'credential' | 'private_fields'>();
    const isCred = (answers.isCredentialLeak as LayaAnswerNoul | undefined)?.noul;
    if ((typeof isCred === 'number' && isCred >= 0.5) || riskType === 'credential_exposure') {
      redactionsSet.add('credential');
    }

    const isPriv = (answers.isPrivateData as LayaAnswerNoul | undefined)?.noul;
    if ((typeof isPriv === 'number' && isPriv >= 0.5) || riskType === 'private_data_egress') {
      redactionsSet.add('private_fields');
    }

    const evidence: SemanticSecurityEvidence = {
      riskType,
      reasonCode,
      requiresBackendValidation: true,
      redactions: Array.from(redactionsSet),
    };

    return evidence;
  };
};
