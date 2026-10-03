/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChatPipelineDefinition,
  ChatPipelineStageRef,
  ChatStageMetadata,
  PipelineSimulationResult,
  PipelineStageMetric,
  StageDecision,
  StagePhase,
} from '@/common/types/pipeline';

export type {
  ChatPipelineDefinition,
  ChatPipelineStageRef,
  ChatStageMetadata,
  PipelineSimulationResult,
  PipelineStageMetric,
  StageDecision,
  StagePhase,
};

export type ChatStageInput = Readonly<{
  schemaVersion: 1;
  runId: string;
  stageId: string;
  query: string;
  context?: string;
  grounding?: Record<string, unknown>;
  artifacts?: readonly string[];
  config?: Record<string, unknown>;
  signal?: AbortSignal;
  isDryRun?: boolean;
}>;

export type ChatStageOutput = Readonly<{
  decision: StageDecision;
  query?: string;
  context?: string;
  grounding?: Record<string, unknown>;
  artifacts?: readonly string[];
  evidence?: Record<string, unknown>;
  reasonCode?: string;
}>;

export interface IChatStage {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly phase: StagePhase;
  readonly icon?: string;
  readonly defaultEnabled: boolean;
  readonly defaultTimeoutMs?: number;
  execute(input: ChatStageInput): Promise<ChatStageOutput>;
}

export type StageExecutionTelemetry = Readonly<{
  stageId: string;
  stageRegistryId: string;
  decision: StageDecision;
  durationMs: number;
  evidence?: Record<string, unknown>;
  error?: string;
}>;

export type PipelineExecutionResult = Readonly<{
  status: 'completed' | 'blocked' | 'aborted' | 'direct_action';
  directActionPayload?: Record<string, unknown>;
  finalQuery: string;
  finalContext?: string;
  grounding?: Record<string, unknown>;
  artifacts?: readonly string[];
  executedStages: readonly StageExecutionTelemetry[];
  blockedReasonCode?: string;
  totalDurationMs: number;
}>;

export type SimulatePipelineParams = Readonly<{
  definition: ChatPipelineDefinition;
  probeQuery?: string;
  initialContext?: string;
  signal?: AbortSignal;
}>;
