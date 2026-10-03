/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type StagePhase = 'pre_query' | 'retrieve' | 'pre_model' | 'post_model';

export type StageDecision = 'continue' | 'rewrite' | 'block' | 'skip' | 'direct_action';

export type ChatPipelineStageRef = Readonly<{
  id: string;
  stageRegistryId: string;
  phase: StagePhase;
  enabled: boolean;
  config?: Record<string, unknown>;
}>;

export type ChatPipelineDefinition = Readonly<{
  schemaVersion: 1;
  id: string;
  name: string;
  stages: readonly ChatPipelineStageRef[];
  limits?: Readonly<{
    maxStages?: number;
    maxTotalTimeoutMs?: number;
    maxContextBytes?: number;
  }>;
  enabled: boolean;
}>;

export type ChatStageMetadata = Readonly<{
  id: string;
  displayName: string;
  description: string;
  phase: StagePhase;
  icon?: string;
  defaultEnabled: boolean;
  defaultTimeoutMs?: number;
  isBuiltin: boolean;
  packageId?: string;
  defaultConfig?: Record<string, unknown>;
}>;

export type PipelineStageMetric = Readonly<{
  stageId: string;
  stageRegistryId: string;
  durationMs: number;
  addedContextBytes: number;
  decision: StageDecision;
  status: 'ok' | 'error';
  error?: string;
}>;

export type PipelineSimulationResult = Readonly<{
  success: boolean;
  totalDurationMs: number;
  initialContextBytes: number;
  finalContextBytes: number;
  addedContextBytes: number;
  finalQuery: string;
  stageMetrics: readonly PipelineStageMetric[];
  failedStageId?: string;
  errorMessage?: string;
}>;
