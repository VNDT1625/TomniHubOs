/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChatPipelineDefinition,
  ChatPipelineStageRef,
  ChatStageMetadata,
  PipelineModelCallTrace,
} from '@/common/types/pipeline';

/** i18n suffix for the built-in stages; a stage not listed here shows the name its package gave it. */
const BUILTIN_STAGE_TEXT: Readonly<Record<string, string>> = {
  'builtin:laya-security': 'security',
  'builtin:understand': 'understand',
  'builtin:direct-action': 'directAction',
  'builtin:tool-schema': 'toolSchema',
  'builtin:tool-router': 'toolSchema',
  'builtin:rtk-knowledge': 'rtk',
  'builtin:model-router': 'modelRouter',
};

export const builtinStageTextKey = (registryId: string): string | undefined => BUILTIN_STAGE_TEXT[registryId];

export const TOOL_SCHEMA_STAGE_IDS: ReadonlySet<string> = new Set(['builtin:tool-schema', 'builtin:tool-router']);
export const SECURITY_STAGE_ID = 'builtin:laya-security';

let counter = 0;
const uniqueId = (registryId: string, now: number): string => `stage-${registryId}-${now}-${counter++}`;

export const newStageRef = (meta: ChatStageMetadata, now = Date.now()): ChatPipelineStageRef => ({
  id: uniqueId(meta.id, now),
  stageRegistryId: meta.id,
  phase: meta.phase,
  enabled: true,
  ...(meta.defaultConfig ? { config: meta.defaultConfig } : {}),
});

/** The pipeline a conversation starts with: every stage that is on by default, in registry order. */
export const defaultStageRefs = (available: readonly ChatStageMetadata[]): ChatPipelineStageRef[] =>
  available
    .filter((meta) => meta.defaultEnabled)
    .map((meta) => ({
      id: `stage-${meta.id}`,
      stageRegistryId: meta.id,
      phase: meta.phase,
      enabled: true,
      ...(meta.defaultConfig ? { config: meta.defaultConfig } : {}),
    }));

export const withStages = (
  definition: ChatPipelineDefinition,
  stages: readonly ChatPipelineStageRef[]
): ChatPipelineDefinition => ({ ...definition, stages });

export const moveStage = (
  stages: readonly ChatPipelineStageRef[],
  index: number,
  delta: -1 | 1
): ChatPipelineStageRef[] => {
  const target = index + delta;
  if (index < 0 || index >= stages.length || target < 0 || target >= stages.length) return [...stages];
  const next = [...stages];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

export const removeStage = (stages: readonly ChatPipelineStageRef[], index: number): ChatPipelineStageRef[] =>
  stages.filter((_, i) => i !== index);

/** Inserts a copy right after the original, so the same stage can run again later in the chain. */
export const duplicateStage = (
  stages: readonly ChatPipelineStageRef[],
  index: number,
  now = Date.now()
): ChatPipelineStageRef[] => {
  const original = stages[index];
  if (!original) return [...stages];
  const copy: ChatPipelineStageRef = {
    ...original,
    id: uniqueId(original.stageRegistryId, now),
    ...(original.config ? { config: { ...original.config } } : {}),
  };
  return [...stages.slice(0, index + 1), copy, ...stages.slice(index + 1)];
};

export const setStageEnabled = (
  stages: readonly ChatPipelineStageRef[],
  id: string,
  enabled: boolean
): ChatPipelineStageRef[] => stages.map((stage) => (stage.id === id ? { ...stage, enabled } : stage));

export const patchStageConfig = (
  stages: readonly ChatPipelineStageRef[],
  id: string,
  patch: Record<string, unknown>
): ChatPipelineStageRef[] =>
  stages.map((stage) => (stage.id === id ? { ...stage, config: { ...stage.config, ...patch } } : stage));

export type PipelineWarning =
  | Readonly<{ kind: 'unguardedRetrieve'; stageId: string; registryId: string }>
  | Readonly<{ kind: 'noGuard' }>;

/**
 * Shape checks shown as hints, never as errors: the pipeline is the user's to arrange. The send step
 * still scans every payload before it leaves for a cloud model, so these describe gaps in the user's own
 * chain, not an unprotected send.
 */
export const pipelineWarnings = (
  stages: readonly ChatPipelineStageRef[],
  metaById: ReadonlyMap<string, ChatStageMetadata>
): PipelineWarning[] => {
  const active = stages.filter((stage) => stage.enabled);
  const warnings: PipelineWarning[] = [];

  active.forEach((stage, index) => {
    const meta = metaById.get(stage.stageRegistryId);
    if (meta?.phase !== 'retrieve') return;
    const guardedAfter = active.slice(index + 1).some((later) => metaById.get(later.stageRegistryId)?.role === 'guard');
    if (!guardedAfter)
      warnings.push({ kind: 'unguardedRetrieve', stageId: stage.id, registryId: stage.stageRegistryId });
  });

  const hasAuthorizedGuard = active.some((stage) => {
    const meta = metaById.get(stage.stageRegistryId);
    return meta?.role === 'guard' && meta.authorizedGuard === true;
  });
  if (!hasAuthorizedGuard) warnings.push({ kind: 'noGuard' });
  return warnings;
};

export const callsForStage = (
  calls: readonly PipelineModelCallTrace[] | undefined,
  stageId: string
): PipelineModelCallTrace[] => (calls ?? []).filter((call) => call.stageId === stageId);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One-line rendering of a model answer: `code (91%)` for a choice, `0.12` for a score. */
export const formatAnswer = (answer: unknown): string => {
  if (!isRecord(answer)) return String(answer);
  if (typeof answer['choice'] === 'string') {
    const confidence = typeof answer['confidence'] === 'number' ? ` (${Math.round(answer['confidence'] * 100)}%)` : '';
    return `${answer['choice']}${confidence}`;
  }
  if (typeof answer['noul'] === 'number') return answer['noul'].toFixed(2);
  if (typeof answer['score'] === 'number') return answer['score'].toFixed(2);
  return JSON.stringify(answer);
};
