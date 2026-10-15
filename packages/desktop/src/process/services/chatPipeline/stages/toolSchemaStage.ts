/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderToolNameGuide } from '../../../toolselect/builtinToolCatalog';
import type { LayaAnswerNoul, LayaPredictor } from '../../security/layaSemanticEgressModel';
import { TOOL_GROUPS, type IntentKind } from '../decisionTasks';
import { analyzeForStage } from '../decisionSession';
import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';
import {
  capabilitiesFromCues,
  classifyIntentByPattern,
  isGreeting,
  MIN_INTENT_CONFIDENCE,
  type UnderstoodIntent,
} from './understandStage';

/** What this turn needs loaded, as Surface capability ids. The runtime can only narrow, never widen, what the Surface allows. */
export type ToolSchemaSelection = Readonly<{
  capabilityIds: readonly string[];
  scores: Readonly<Record<string, number>>;
  method: 'laya_neural' | 'pattern_fallback';
  /** False when the stage is configured as advisory only: the choice is shown but not applied. */
  applied: boolean;
}>;

export type ToolSchemaStageConfig = Readonly<{ apply?: boolean }>;

const MAX_SELECTED_CAPABILITIES = 16;

/** The capability ids the pipeline wants loaded this turn, or undefined when nothing should be narrowed. */
export const readToolSelection = (grounding: Record<string, unknown> | undefined): readonly string[] | undefined => {
  const value = grounding?.['toolSchema'] as Partial<ToolSchemaSelection> | undefined;
  if (!value || value.applied === false || !Array.isArray(value.capabilityIds)) return undefined;
  return value.capabilityIds
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 120)
    .slice(0, MAX_SELECTED_CAPABILITIES);
};

const INTENT_CAPABILITY: Readonly<Partial<Record<IntentKind, string>>> = {
  code: 'surface.ide',
  web: 'surface.browser',
  documents: 'surface.office',
  orchestration: 'core.agent-orchestrator',
};

/**
 * A group the wording does not point at is loaded only when the model is nearly certain. Scores below this were
 * seen on plain questions (a browser group at 0.78 for a question about a repository), so they are shown but not obeyed.
 */
const SELECT_THRESHOLD = 0.85;

const readIntent = (grounding: Record<string, unknown> | undefined): UnderstoodIntent | undefined => {
  const value = grounding?.['intent'];
  return value && typeof value === 'object' ? (value as UnderstoodIntent) : undefined;
};

/**
 * Chooses which tool groups this turn most likely needs. Groups are Surface capability ids. The choice
 * does not remove anything: every tool the Surface allows stays findable by name, so a wrong choice costs one
 * step to load the right tool. The questions share one model call with security and understand.
 */
export class ToolSchemaStage implements IChatStage {
  public readonly id = 'builtin:tool-schema';
  public readonly displayName = 'Tool Schema Selector';
  public readonly description = 'Chọn nhóm công cụ cần nạp schema cho lượt chat này (Laya), phần còn lại nạp khi cần';
  public readonly phase = 'pre_model' as const;
  public readonly icon = 'Wrench';
  public readonly defaultEnabled = true;
  public readonly defaultTimeoutMs = 1_000;
  public readonly role = 'standard' as const;
  public readonly decisionTasks = ['toolSchema'] as const;

  public constructor(private readonly predictor?: LayaPredictor) {}

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    const startTime = Date.now();
    const intent = readIntent(input.grounding) ?? classifyIntentByPattern(input.query);
    const scores: Record<string, number> = {};
    // What the sentence itself points at is always loaded, however the model scored it.
    const cues = capabilitiesFromCues(input.query);
    const selected = new Set<string>(cues);
    let method: ToolSchemaSelection['method'] = 'pattern_fallback';

    // A plain greeting loads nothing beyond the always-on tool search. Any other sentence is asked about, even
    // when its wording alone said "chat": that is the default for a sentence with no cue, not a finding.
    const answers = isGreeting(input.query)
      ? undefined
      : await analyzeForStage(input, this.predictor, 'toolSchema', input.query);

    if (answers) {
      method = 'laya_neural';
      for (const group of TOOL_GROUPS) {
        const score = (answers[group.key] as LayaAnswerNoul | undefined)?.noul;
        if (typeof score !== 'number') continue;
        scores[group.capabilityId] = score;
        if (score >= SELECT_THRESHOLD) selected.add(group.capabilityId);
      }
    }

    // The understood intent backs up the model, unless the intent itself was a near-guess.
    const intentCapability = INTENT_CAPABILITY[intent.kind];
    const intentTrusted = intent.confidence === null || intent.confidence >= MIN_INTENT_CONFIDENCE;
    if (intentCapability && (intentTrusted || selected.size === 0)) selected.add(intentCapability);
    // Project tools and the file tools overlap: a surface that has no project tools still reads files.
    if (selected.has('surface.ide')) selected.add('core.workspace-read');

    const config = (input.config ?? {}) as ToolSchemaStageConfig;
    const selection: ToolSchemaSelection = {
      capabilityIds: [...selected],
      scores,
      method,
      applied: config.apply !== false,
    };
    // What was chosen is passed on as exact names, so the model loads them in one step. Every tool the surface
    // allows stays findable: a wrong or empty choice costs a step, never the tool. The system prompt's tool guide
    // lists every allowed tool anyway, so nothing is added when nothing was chosen.
    const guide = selected.size > 0 ? renderToolNameGuide([...selected]) : '';
    const hint = guide
      ? `Tools this request likely needs (load them with one ToolSearch, names separated by spaces; use only those in your tool guide):\n${guide}`
      : '';
    return {
      decision: 'continue',
      ...(hint ? { context: [input.context, hint].filter(Boolean).join('\n\n') } : {}),
      grounding: { toolSchema: selection },
      evidence: {
        latencyMs: Date.now() - startTime,
        method,
        capabilities: selection.capabilityIds.join(',') || 'none',
        applied: selection.applied,
        cues: cues.join(',') || 'none',
        hint: hint.length > 0,
      },
    };
  }
}
