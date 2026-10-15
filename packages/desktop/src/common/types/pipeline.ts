/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type StagePhase = 'pre_query' | 'retrieve' | 'pre_model' | 'post_model';

export type StageDecision = 'continue' | 'rewrite' | 'block' | 'skip' | 'direct_action';

/**
 * `guard` stages inspect the payload for security. They fail closed: a guard that errors or times
 * out blocks the turn instead of being skipped. Every other stage degrades gracefully.
 */
export type StageRole = 'guard' | 'standard';

/** Named forms of typed questions that the shared decision model answers in one forward pass. */
export type DecisionTaskId = 'security' | 'understand' | 'toolSchema';

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
  role?: StageRole;
  /** Decision tasks this stage asks the shared model; they are answered together in one call. */
  decisionTasks?: readonly DecisionTaskId[];
  /** True when Main recognises this guard as qualified to stand in for the built-in security stage. */
  authorizedGuard?: boolean;
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

/** Why a model call produced no answer, in terms a person can act on. */
export type ModelCallErrorCode = 'starting' | 'timeout' | 'cancelled' | 'unavailable' | 'failed';

/**
 * One call to (or cache hit on) the shared decision model. `input` is always masked and clipped in
 * Main before it is sent to the renderer; raw text never leaves the Main process.
 */
export type PipelineModelCallTrace = Readonly<{
  id: string;
  bindingId: string;
  stageId: string;
  taskIds: readonly DecisionTaskId[];
  questionKeys: readonly string[];
  input: string;
  answers: Readonly<Record<string, unknown>>;
  latencyMs: number;
  cacheHit: boolean;
  /** For a cache hit: the call that actually ran the model. */
  sourceCallId?: string;
  error?: string;
  /** Stable reason for `error`, so the inspector can explain it in the person's language. */
  errorCode?: ModelCallErrorCode;
}>;

export type PipelineStageTrace = Readonly<{
  stageId: string;
  stageRegistryId: string;
  decision: StageDecision;
  durationMs: number;
  error?: string;
  modelCallIds: readonly string[];
  /** Primitive evidence values only, masked and clipped in Main. */
  evidence?: Readonly<Record<string, string | number | boolean>>;
}>;

export type PipelineRunTrace = Readonly<{
  runId: string;
  at: number;
  status: 'completed' | 'blocked' | 'aborted' | 'direct_action';
  blockedReasonCode?: string;
  /** Masked: a query that still holds a secret is redacted before it reaches the renderer. */
  finalQuery: string;
  stages: readonly PipelineStageTrace[];
  modelCalls: readonly PipelineModelCallTrace[];
  totalDurationMs: number;
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
  /** Model calls the probe made, so the inspector can show them before any real turn has run. */
  modelCalls?: readonly PipelineModelCallTrace[];
}>;
