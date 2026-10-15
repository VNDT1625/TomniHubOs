/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayaAnswerChoice, LayaAnswerNoul, LayaPredictor } from '../../security/layaSemanticEgressModel';
import { INTENT_KINDS, type IntentKind } from '../decisionTasks';
import { analyzeForStage } from '../decisionSession';
import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

/** What the user is asking for, shared with later stages through `grounding.intent`. */
export type UnderstoodIntent = Readonly<{
  kind: IntentKind;
  needsFreshDocs: boolean;
  confidence: number | null;
  method: 'laya_neural' | 'pattern_fallback';
}>;

const GREETING =
  /^(?:hello(?:\s+there)?|hi(?:\s+there)?|xin chào(?:\s+bạn)?|chào(?:\s+bạn)?|alo|hey|good\s+(?:morning|evening|afternoon))[!.,\s]*$/iu;
const CODE =
  /(?:\bcode\b|viết code|debug|\bbug\b|python|typescript|javascript|\bgit\b|function|lập trình|\brepo\b|refactor)/iu;
const WEB = /(?:browser|trang web|\burl\b|https?:\/\/|\bweb\b|tìm kiếm|google|lướt web|mở trang)/iu;
const DOCUMENTS = /(?:\.docx?\b|\.xlsx?\b|\.pptx?\b|\bword\b|\bexcel\b|powerpoint|slide|bảng tính|tài liệu)/iu;
const ORCHESTRATION = /(?:sub-?agent|\bagents?\b|\bteam\b|workflow|\bcron\b|lịch trình|tự động hóa)/iu;
const TESTING = /(?:\bunit tests?\b|\btests?\b|vitest|\bjest\b|kiểm thử|chạy test)/iu;
const FRESH_DOCS = /(?:latest|mới nhất|phiên bản mới|\bsdk\b|\bapi\b|documentation|\bdocs?\b)/iu;

/** A plain greeting needs no tools and no question to the model. */
export const isGreeting = (query: string): boolean => GREETING.test(query.trim());

/** Deterministic classification used when the model is unavailable. */
export const classifyIntentByPattern = (query: string): UnderstoodIntent => {
  const text = query.trim();
  let kind: IntentKind = 'chat';
  if (GREETING.test(text)) kind = 'chat';
  else if (ORCHESTRATION.test(text)) kind = 'orchestration';
  else if (DOCUMENTS.test(text)) kind = 'documents';
  else if (CODE.test(text)) kind = 'code';
  else if (WEB.test(text)) kind = 'web';
  return { kind, needsFreshDocs: FRESH_DOCS.test(text), confidence: null, method: 'pattern_fallback' };
};

/**
 * Tool groups the wording points at, whatever any model says: a repository, a web page, an Office file, a team of
 * agents or a test run. These are cues a person can read in the sentence, so they are trusted over a weak score.
 */
export const capabilitiesFromCues = (query: string): string[] => {
  const text = query.trim();
  if (GREETING.test(text)) return [];
  const found: string[] = [];
  if (CODE.test(text)) found.push('surface.ide');
  if (WEB.test(text)) found.push('surface.browser');
  if (DOCUMENTS.test(text)) found.push('surface.office');
  if (ORCHESTRATION.test(text)) found.push('core.agent-orchestrator');
  if (TESTING.test(text)) found.push('core.testing');
  return found;
};

/** Below this the model is close to guessing among the intent kinds (six kinds: chance is about 17%). */
export const MIN_INTENT_CONFIDENCE = 0.4;

const isIntentKind = (value: unknown): value is IntentKind =>
  typeof value === 'string' && (INTENT_KINDS as readonly string[]).includes(value);

/**
 * Reads what the user is asking for once, so retrieval and tool stages can use the answer instead of
 * guessing again. The question shares one model call with the other planned tasks.
 */
export class UnderstandStage implements IChatStage {
  public readonly id = 'builtin:understand';
  public readonly displayName = 'Understand';
  public readonly description = 'Hiểu người dùng đang yêu cầu gì, một lần duy nhất, rồi chia sẻ cho các chặng sau';
  public readonly phase = 'pre_query' as const;
  public readonly icon = 'Brain';
  public readonly defaultEnabled = true;
  public readonly defaultTimeoutMs = 1_000;
  public readonly role = 'standard' as const;
  public readonly decisionTasks = ['understand'] as const;

  public constructor(private readonly predictor?: LayaPredictor) {}

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    const startTime = Date.now();
    const answers = await analyzeForStage(input, this.predictor, 'understand', input.query);

    let intent: UnderstoodIntent;
    const intentAnswer = answers?.['intent'] as LayaAnswerChoice | undefined;
    const byPattern = classifyIntentByPattern(input.query);
    if (intentAnswer && isIntentKind(intentAnswer.choice)) {
      const fresh = answers?.['needsFreshDocs'] as LayaAnswerNoul | undefined;
      const confidence = typeof intentAnswer.confidence === 'number' ? intentAnswer.confidence : null;
      // A near-guess from the model does not outweigh wording that says what the person wants.
      const guessing = confidence !== null && confidence < MIN_INTENT_CONFIDENCE && byPattern.kind !== 'chat';
      intent = guessing
        ? { ...byPattern, needsFreshDocs: byPattern.needsFreshDocs || (fresh !== undefined && fresh.noul >= 0.5) }
        : {
            kind: intentAnswer.choice,
            needsFreshDocs: fresh !== undefined && fresh.noul >= 0.5,
            confidence,
            method: 'laya_neural',
          };
    } else {
      intent = byPattern;
    }

    return {
      decision: 'continue',
      grounding: { intent },
      evidence: {
        latencyMs: Date.now() - startTime,
        intent: intent.kind,
        needsFreshDocs: intent.needsFreshDocs,
        method: intent.method,
      },
    };
  }
}
