/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatStageRegistry } from './stageRegistry';
import type {
  ChatPipelineDefinition,
  ChatStageInput,
  ChatStageOutput,
  PipelineExecutionResult,
  PipelineSimulationResult,
  PipelineStageMetric,
  SimulatePipelineParams,
  StageExecutionTelemetry,
} from './types';

const DEFAULT_STAGE_TIMEOUT_MS = 5_000;
const MAX_STAGES_LIMIT = 32;

const getByteLength = (str: string): number => new TextEncoder().encode(str).length;

export type ExecutePipelineParams = Readonly<{
  runId: string;
  query: string;
  context?: string;
  grounding?: Record<string, unknown>;
  artifacts?: readonly string[];
  definition?: ChatPipelineDefinition;
  signal?: AbortSignal;
}>;

export class ChatPipelineExecutor {
  public constructor(private readonly registry: ChatStageRegistry) {}

  public async execute(params: ExecutePipelineParams): Promise<PipelineExecutionResult> {
    const startTime = Date.now();
    const definition = params.definition ?? this.registry.createDefaultDefinition();

    if (!definition.enabled) {
      return {
        status: 'completed',
        finalQuery: params.query,
        finalContext: params.context,
        grounding: params.grounding,
        artifacts: params.artifacts,
        executedStages: [],
        totalDurationMs: Date.now() - startTime,
      };
    }

    let currentQuery = params.query;
    let currentContext = params.context;
    let currentGrounding = params.grounding ? { ...params.grounding } : undefined;
    let currentArtifacts = params.artifacts ? [...params.artifacts] : undefined;

    const executedStages: StageExecutionTelemetry[] = [];
    const maxStages = definition.limits?.maxStages ?? MAX_STAGES_LIMIT;
    const stagesToRun = definition.stages.slice(0, maxStages);

    for (const stageRef of stagesToRun) {
      if (params.signal?.aborted) {
        return {
          status: 'aborted',
          finalQuery: currentQuery,
          finalContext: currentContext,
          grounding: currentGrounding,
          artifacts: currentArtifacts,
          executedStages,
          totalDurationMs: Date.now() - startTime,
        };
      }

      if (!stageRef.enabled) {
        continue;
      }

      const stage = this.registry.getStage(stageRef.stageRegistryId);
      if (!stage) {
        executedStages.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          decision: 'skip',
          durationMs: 0,
          error: 'STAGE_NOT_FOUND',
        });
        continue;
      }

      const stageTimeoutMs = stage.defaultTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
      const stageStart = Date.now();

      try {
        // Stages execute strictly sequentially per user-defined pipeline order
        // eslint-disable-next-line no-await-in-loop
        const stageOutput = await this.executeWithTimeout(
          stage,
          {
            schemaVersion: 1,
            runId: params.runId,
            stageId: stageRef.id,
            query: currentQuery,
            context: currentContext,
            grounding: currentGrounding,
            artifacts: currentArtifacts,
            config: stageRef.config,
            signal: params.signal,
          },
          stageTimeoutMs,
          params.signal
        );

        const durationMs = Date.now() - stageStart;
        executedStages.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          decision: stageOutput.decision,
          durationMs,
          evidence: stageOutput.evidence,
        });

        if (stageOutput.decision === 'block') {
          return {
            status: 'blocked',
            finalQuery: currentQuery,
            finalContext: currentContext,
            grounding: currentGrounding,
            artifacts: currentArtifacts,
            executedStages,
            blockedReasonCode: stageOutput.reasonCode ?? 'STAGE_BLOCKED',
            totalDurationMs: Date.now() - startTime,
          };
        }

        if (stageOutput.decision === 'direct_action') {
          if (stageOutput.grounding) {
            currentGrounding = Object.assign(currentGrounding ?? {}, stageOutput.grounding);
          }
          return {
            status: 'direct_action',
            finalQuery: currentQuery,
            finalContext: currentContext,
            grounding: currentGrounding,
            artifacts: currentArtifacts,
            executedStages,
            directActionPayload:
              (stageOutput.grounding?.directAction as Record<string, unknown> | undefined) ??
              (stageOutput.evidence as Record<string, unknown> | undefined),
            totalDurationMs: Date.now() - startTime,
          };
        }

        if (stageOutput.decision === 'rewrite') {
          if (stageOutput.query !== undefined) {
            currentQuery = stageOutput.query;
          }
          if (stageOutput.context !== undefined) {
            currentContext = stageOutput.context;
          }
          if (stageOutput.grounding) {
            currentGrounding = Object.assign(currentGrounding ?? {}, stageOutput.grounding);
          }
          if (stageOutput.artifacts) {
            currentArtifacts = (currentArtifacts ?? []).concat(stageOutput.artifacts);
          }
        } else if (stageOutput.decision === 'continue') {
          if (stageOutput.context !== undefined) {
            currentContext = stageOutput.context;
          }
          if (stageOutput.grounding) {
            currentGrounding = Object.assign(currentGrounding ?? {}, stageOutput.grounding);
          }
          if (stageOutput.artifacts) {
            currentArtifacts = (currentArtifacts ?? []).concat(stageOutput.artifacts);
          }
        }
      } catch (error) {
        const durationMs = Date.now() - stageStart;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Fail closed only if it's a security preflight stage
        if (stage.phase === 'pre_query' && stage.id.includes('security')) {
          executedStages.push({
            stageId: stageRef.id,
            stageRegistryId: stageRef.stageRegistryId,
            decision: 'block',
            durationMs,
            error: errorMessage,
          });
          return {
            status: 'blocked',
            finalQuery: currentQuery,
            finalContext: currentContext,
            grounding: currentGrounding,
            artifacts: currentArtifacts,
            executedStages,
            blockedReasonCode: 'SECURITY_STAGE_ERROR',
            totalDurationMs: Date.now() - startTime,
          };
        }

        // Otherwise graceful degradation: skip this stage and continue
        executedStages.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          decision: 'skip',
          durationMs,
          error: errorMessage,
        });
      }
    }

    return {
      status: 'completed',
      finalQuery: currentQuery,
      finalContext: currentContext,
      grounding: currentGrounding,
      artifacts: currentArtifacts,
      executedStages,
      totalDurationMs: Date.now() - startTime,
    };
  }

  public async simulate(params: SimulatePipelineParams): Promise<PipelineSimulationResult> {
    const startTime = Date.now();
    const definition = params.definition ?? this.registry.createDefaultDefinition();

    const probeQuery = params.probeQuery ?? 'Dry-run preflight probe query: ping health check';
    const initialContext = params.initialContext ?? '';
    const initialContextBytes = getByteLength(initialContext);

    if (!definition.enabled) {
      return {
        success: true,
        totalDurationMs: Date.now() - startTime,
        initialContextBytes,
        finalContextBytes: initialContextBytes,
        addedContextBytes: 0,
        finalQuery: probeQuery,
        stageMetrics: [],
      };
    }

    let currentQuery = probeQuery;
    let currentContext = initialContext;
    let currentGrounding: Record<string, unknown> | undefined = undefined;
    let currentArtifacts: string[] | undefined = undefined;

    const stageMetrics: PipelineStageMetric[] = [];
    const maxStages = definition.limits?.maxStages ?? MAX_STAGES_LIMIT;
    const stagesToRun = definition.stages.slice(0, maxStages);

    for (const stageRef of stagesToRun) {
      if (params.signal?.aborted) {
        const finalContextBytes = getByteLength(currentContext);
        return {
          success: false,
          totalDurationMs: Date.now() - startTime,
          initialContextBytes,
          finalContextBytes,
          addedContextBytes: Math.max(0, finalContextBytes - initialContextBytes),
          finalQuery: currentQuery,
          stageMetrics,
          failedStageId: stageRef.id,
          errorMessage: 'SIMULATION_ABORTED',
        };
      }

      if (!stageRef.enabled) {
        stageMetrics.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          durationMs: 0,
          addedContextBytes: 0,
          decision: 'skip',
          status: 'ok',
        });
        continue;
      }

      const stage = this.registry.getStage(stageRef.stageRegistryId);
      if (!stage) {
        stageMetrics.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          durationMs: 0,
          addedContextBytes: 0,
          decision: 'skip',
          status: 'error',
          error: 'STAGE_NOT_FOUND',
        });
        const finalContextBytes = getByteLength(currentContext);
        return {
          success: false,
          totalDurationMs: Date.now() - startTime,
          initialContextBytes,
          finalContextBytes,
          addedContextBytes: Math.max(0, finalContextBytes - initialContextBytes),
          finalQuery: currentQuery,
          stageMetrics,
          failedStageId: stageRef.id,
          errorMessage: `Stage '${stageRef.stageRegistryId}' không tồn tại trong hệ thống.`,
        };
      }

      const stageTimeoutMs = stage.defaultTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
      const stageStart = Date.now();
      const prevBytes = getByteLength(currentContext);

      try {
        const stageOutput = await this.executeWithTimeout(
          stage,
          {
            schemaVersion: 1,
            runId: `sim-${Date.now()}`,
            stageId: stageRef.id,
            query: currentQuery,
            context: currentContext,
            grounding: currentGrounding,
            artifacts: currentArtifacts,
            config: stageRef.config,
            signal: params.signal,
            isDryRun: true,
          },
          stageTimeoutMs,
          params.signal
        );

        const durationMs = Date.now() - stageStart;

        if (stageOutput.decision === 'rewrite') {
          if (stageOutput.query !== undefined) {
            currentQuery = stageOutput.query;
          }
          if (stageOutput.context !== undefined) {
            currentContext = stageOutput.context;
          }
          if (stageOutput.grounding) {
            currentGrounding = Object.assign(currentGrounding ?? {}, stageOutput.grounding);
          }
          if (stageOutput.artifacts) {
            currentArtifacts = (currentArtifacts ?? []).concat(stageOutput.artifacts);
          }
        } else if (stageOutput.decision === 'continue') {
          if (stageOutput.context !== undefined) {
            currentContext = stageOutput.context;
          }
          if (stageOutput.grounding) {
            currentGrounding = Object.assign(currentGrounding ?? {}, stageOutput.grounding);
          }
          if (stageOutput.artifacts) {
            currentArtifacts = (currentArtifacts ?? []).concat(stageOutput.artifacts);
          }
        }

        const nextBytes = getByteLength(currentContext);
        const addedBytes = Math.max(0, nextBytes - prevBytes);

        stageMetrics.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          durationMs,
          addedContextBytes: addedBytes,
          decision: stageOutput.decision,
          status: 'ok',
        });

        if (stageOutput.decision === 'block') {
          const finalContextBytes = getByteLength(currentContext);
          return {
            success: false,
            totalDurationMs: Date.now() - startTime,
            initialContextBytes,
            finalContextBytes,
            addedContextBytes: Math.max(0, finalContextBytes - initialContextBytes),
            finalQuery: currentQuery,
            stageMetrics,
            failedStageId: stageRef.id,
            errorMessage: `Chặng '${stage.displayName}' chặn truy vấn kiểm thử (${stageOutput.reasonCode ?? 'STAGE_BLOCKED'}).`,
          };
        }
      } catch (error) {
        const durationMs = Date.now() - stageStart;
        const errorMessage = error instanceof Error ? error.message : String(error);

        stageMetrics.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          durationMs,
          addedContextBytes: 0,
          decision: 'skip',
          status: 'error',
          error: errorMessage,
        });

        const finalContextBytes = getByteLength(currentContext);
        return {
          success: false,
          totalDurationMs: Date.now() - startTime,
          initialContextBytes,
          finalContextBytes,
          addedContextBytes: Math.max(0, finalContextBytes - initialContextBytes),
          finalQuery: currentQuery,
          stageMetrics,
          failedStageId: stageRef.id,
          errorMessage: `Chặng '${stage.displayName}' gặp sự cố trong kiểm thử ngầm: ${errorMessage}`,
        };
      }
    }

    const finalContextBytes = getByteLength(currentContext);
    return {
      success: true,
      totalDurationMs: Date.now() - startTime,
      initialContextBytes,
      finalContextBytes,
      addedContextBytes: Math.max(0, finalContextBytes - initialContextBytes),
      finalQuery: currentQuery,
      stageMetrics,
    };
  }

  private async executeWithTimeout(
    stage: { execute(input: ChatStageInput): Promise<ChatStageOutput> },
    input: ChatStageInput,
    timeoutMs: number,
    parentSignal?: AbortSignal
  ): Promise<ChatStageOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`STAGE_TIMEOUT_${timeoutMs}MS`)), timeoutMs);

    const abortHandler = () => controller.abort(parentSignal?.reason ?? new Error('EXECUTION_ABORTED'));
    parentSignal?.addEventListener('abort', abortHandler, { once: true });

    try {
      return await stage.execute({ ...input, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortHandler);
    }
  }
}
