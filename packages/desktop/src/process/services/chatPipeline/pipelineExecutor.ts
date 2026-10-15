/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayaPredictor } from '../security/layaSemanticEgressModel';
import { createDecisionSession, type DecisionSession } from './decisionSession';
import type { ChatStageRegistry } from './stageRegistry';
import type {
  DecisionTaskId,
  IChatStage,
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
const MAX_STAGE_TIMEOUT_MS = 5_000;
const DEFAULT_RUN_TIMEOUT_MS = 30_000;
const MAX_RUN_TIMEOUT_MS = 30_000;
const MAX_STAGES_LIMIT = 32;
const MAX_QUERY_BYTES = 128_000;
const DEFAULT_CONTEXT_BYTES = 256_000;
const MAX_CONTEXT_BYTES = 4_000_000;

const getByteLength = (str: string): number => new TextEncoder().encode(str).length;

type PipelineDirectionOptions = Readonly<{
  /** Input is the default. Output runs only post_model stages; query/finalQuery carry assistant text. */
  direction?: 'input' | 'output';
}>;

type DirectionalSimulationParams = SimulatePipelineParams & PipelineDirectionOptions;

export type ExecutePipelineParams = Readonly<{
  direction?: PipelineDirectionOptions['direction'];
  runId: string;
  query: string;
  context?: string;
  grounding?: Record<string, unknown>;
  artifacts?: readonly string[];
  definition?: ChatPipelineDefinition;
  signal?: AbortSignal;
}>;

export type ChatPipelineExecutorOptions = Readonly<{
  /** The shared decision model (Laya). Without one, stages use their deterministic fallbacks. */
  predictor?: LayaPredictor;
}>;

/** Stages that inspect security. They fail closed; the legacy id check keeps older security stages safe. */
const isGuard = (stage: IChatStage): boolean =>
  stage.role === 'guard' || (stage.phase === 'pre_query' && stage.id.includes('security'));

export class ChatPipelineExecutor {
  public constructor(
    private readonly registry: ChatStageRegistry,
    private readonly options: ChatPipelineExecutorOptions = {}
  ) {}

  /** One session per run: the first model request answers every task the active stages plan to ask. */
  private createSession(definition: ChatPipelineDefinition, signal?: AbortSignal): DecisionSession {
    const planned = new Set<DecisionTaskId>();
    for (const ref of definition.stages) {
      if (!ref.enabled) continue;
      for (const task of this.registry.getStage(ref.stageRegistryId)?.decisionTasks ?? []) planned.add(task);
    }
    return createDecisionSession({ predictor: this.options.predictor, plannedTasks: [...planned], signal });
  }

  /** Validate enabled references before filtering, so relabelling cannot bypass a stage. */
  private prepare(
    definition: ChatPipelineDefinition,
    direction: 'input' | 'output'
  ): {
    invalid: ChatPipelineDefinition['stages'][number] | undefined;
    error: 'STAGE_NOT_FOUND' | 'STAGE_PHASE_MISMATCH' | undefined;
    definition: ChatPipelineDefinition;
  } {
    // A running turn must not observe later edits to the mutable definition or its stage configs.
    const snapshot = structuredClone(definition);
    const invalid = snapshot.enabled
      ? snapshot.stages.find((ref) => {
          const stage = this.registry.getStage(ref.stageRegistryId);
          return ref.enabled && (!stage || stage.phase !== ref.phase);
        })
      : undefined;
    return {
      invalid,
      error: invalid
        ? this.registry.getStage(invalid.stageRegistryId)
          ? 'STAGE_PHASE_MISMATCH'
          : 'STAGE_NOT_FOUND'
        : undefined,
      definition: {
        ...snapshot,
        stages: snapshot.stages.filter((ref) =>
          direction === 'output' ? ref.phase === 'post_model' : ref.phase !== 'post_model'
        ),
      },
    };
  }

  public async execute(params: ExecutePipelineParams): Promise<PipelineExecutionResult> {
    const prepared = this.prepare(
      params.definition ?? this.registry.createDefaultDefinition(),
      params.direction ?? 'input'
    );
    if (params.signal?.aborted || prepared.invalid) {
      return {
        status: params.signal?.aborted ? 'aborted' : 'blocked',
        finalQuery: params.query,
        finalContext: params.context,
        grounding: params.grounding,
        artifacts: params.artifacts,
        executedStages: [],
        blockedReasonCode: params.signal?.aborted ? undefined : prepared.error,
        totalDurationMs: 0,
        modelCalls: [],
      };
    }
    const definition = prepared.definition;
    const contextLimit = Math.min(definition.limits?.maxContextBytes ?? DEFAULT_CONTEXT_BYTES, MAX_CONTEXT_BYTES);
    if (getByteLength(params.query) > MAX_QUERY_BYTES || getByteLength(params.context ?? '') > contextLimit) {
      return {
        status: 'blocked',
        finalQuery: params.query,
        finalContext: params.context,
        executedStages: [],
        blockedReasonCode: 'PIPELINE_INPUT_TOO_LARGE',
        totalDurationMs: 0,
        modelCalls: [],
      };
    }
    const session = this.createSession(definition, params.signal);
    const result = await this.executeWithSession(params, definition, session);
    return { ...result, modelCalls: session.calls() };
  }

  private async executeWithSession(
    params: ExecutePipelineParams,
    definition: ChatPipelineDefinition,
    session: DecisionSession
  ): Promise<PipelineExecutionResult> {
    const startTime = Date.now();

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
    const configuredBudget = definition.limits?.maxTotalTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const runBudgetMs = Number.isFinite(configuredBudget)
      ? Math.max(1, Math.min(configuredBudget, MAX_RUN_TIMEOUT_MS))
      : DEFAULT_RUN_TIMEOUT_MS;
    const deadline = startTime + runBudgetMs;
    const contextLimit = Math.min(definition.limits?.maxContextBytes ?? DEFAULT_CONTEXT_BYTES, MAX_CONTEXT_BYTES);

    for (const stageRef of stagesToRun) {
      if (Date.now() >= deadline && !params.signal?.aborted) {
        return {
          status: 'blocked',
          finalQuery: currentQuery,
          finalContext: currentContext,
          grounding: currentGrounding,
          artifacts: currentArtifacts,
          executedStages,
          blockedReasonCode: 'PIPELINE_BUDGET_EXHAUSTED',
          totalDurationMs: Date.now() - startTime,
        };
      }
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
      if (!stage || stage.phase !== stageRef.phase) {
        const error = stage ? 'STAGE_PHASE_MISMATCH' : 'STAGE_NOT_FOUND';
        executedStages.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          decision: 'block',
          durationMs: 0,
          error,
        });
        return {
          status: 'blocked',
          finalQuery: currentQuery,
          finalContext: currentContext,
          grounding: currentGrounding,
          artifacts: currentArtifacts,
          executedStages,
          blockedReasonCode: error,
          totalDurationMs: Date.now() - startTime,
        };
      }

      const stageTimeoutMs = Math.max(
        1,
        Math.min(stage.defaultTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS, MAX_STAGE_TIMEOUT_MS, deadline - Date.now())
      );
      const stageStart = Date.now();
      const callsBefore = session.calls().length;
      const modelCallIdsSince = (): string[] =>
        session
          .calls()
          .slice(callsBefore)
          .map((call) => call.id);

      try {
        // Retry is opt-in only for Main-vetted builtin, idempotent read-only stages.
        // Policy denials, guard failures, cancellations and arbitrary package side effects are never retried.
        const maxAttempts = stage.retrySafe && this.registry.isBuiltinStage(stage.id) && !isGuard(stage) ? 2 : 1;
        let attempts = 0;
        let stageOutput: ChatStageOutput | undefined;
        while (attempts < maxAttempts) {
          attempts += 1;
          try {
            // Stages execute strictly sequentially per user-defined pipeline order.
            // eslint-disable-next-line no-await-in-loop
            stageOutput = await this.executeWithTimeout(
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
                decision: session,
              },
              Math.max(1, Math.min(stageTimeoutMs, deadline - Date.now())),
              params.signal
            );
            break;
          } catch (error) {
            const code = error instanceof Error ? error.message : '';
            if (
              attempts >= maxAttempts ||
              !/^PIPELINE_TRANSIENT_[A-Z0-9_]+$/.test(code) ||
              params.signal?.aborted ||
              deadline - Date.now() < 30
            )
              throw error;
            // eslint-disable-next-line no-await-in-loop
            await this.retryBackoff(Math.min(25, deadline - Date.now()), params.signal);
          }
        }
        if (!stageOutput) throw new Error('PIPELINE_STAGE_NO_RESULT');
        params.signal?.throwIfAborted();
        const durationMs = Date.now() - stageStart;
        executedStages.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          decision: stageOutput.decision,
          durationMs,
          evidence: attempts > 1 ? { ...stageOutput.evidence, attempts } : stageOutput.evidence,
          modelCallIds: modelCallIdsSince(),
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
        // Prevent a rewrite or retrieved context from expanding the next stage's input without bound.
        if (getByteLength(currentQuery) > MAX_QUERY_BYTES || getByteLength(currentContext ?? '') > contextLimit) {
          return {
            status: 'blocked',
            finalQuery: currentQuery,
            finalContext: currentContext,
            grounding: currentGrounding,
            artifacts: currentArtifacts,
            executedStages,
            blockedReasonCode: 'PIPELINE_OUTPUT_TOO_LARGE',
            totalDurationMs: Date.now() - startTime,
          };
        }
      } catch (error) {
        const durationMs = Date.now() - stageStart;
        const errorMessage = error instanceof Error ? error.message : String(error);

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

        // Guards fail closed: a security stage that errors blocks the turn instead of being skipped.
        if (isGuard(stage)) {
          executedStages.push({
            stageId: stageRef.id,
            stageRegistryId: stageRef.stageRegistryId,
            decision: 'block',
            durationMs,
            error: errorMessage,
            modelCallIds: modelCallIdsSince(),
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
          modelCallIds: modelCallIdsSince(),
        });
      }
    }

    return {
      status: params.signal?.aborted ? 'aborted' : Date.now() >= deadline ? 'blocked' : 'completed',
      finalQuery: currentQuery,
      finalContext: currentContext,
      grounding: currentGrounding,
      artifacts: currentArtifacts,
      executedStages,
      ...(Date.now() >= deadline && !params.signal?.aborted ? { blockedReasonCode: 'PIPELINE_BUDGET_EXHAUSTED' } : {}),
      totalDurationMs: Date.now() - startTime,
    };
  }

  public async simulate(params: DirectionalSimulationParams): Promise<PipelineSimulationResult> {
    const prepared = this.prepare(
      params.definition ?? this.registry.createDefaultDefinition(),
      params.direction ?? 'input'
    );
    if (params.signal?.aborted || prepared.invalid) {
      const bytes = getByteLength(params.initialContext ?? '');
      return {
        success: false,
        totalDurationMs: 0,
        initialContextBytes: bytes,
        finalContextBytes: bytes,
        addedContextBytes: 0,
        finalQuery: params.probeQuery ?? 'Dry-run preflight probe query: ping health check',
        stageMetrics:
          prepared.invalid && !params.signal?.aborted
            ? [
                {
                  stageId: prepared.invalid.id,
                  stageRegistryId: prepared.invalid.stageRegistryId,
                  durationMs: 0,
                  addedContextBytes: 0,
                  decision: 'block',
                  status: 'error',
                  error: prepared.error,
                },
              ]
            : [],
        failedStageId: prepared.invalid?.id,
        errorMessage: params.signal?.aborted ? 'SIMULATION_ABORTED' : prepared.error,
        modelCalls: [],
      };
    }
    const definition = prepared.definition;
    const session = this.createSession(definition, params.signal);
    const result = await this.simulateWithSession(params, definition, session);
    return { ...result, modelCalls: session.calls() };
  }

  private async simulateWithSession(
    params: DirectionalSimulationParams,
    definition: ChatPipelineDefinition,
    session: DecisionSession
  ): Promise<PipelineSimulationResult> {
    const startTime = Date.now();

    const probeQuery = params.probeQuery ?? 'Dry-run preflight probe query: ping health check';
    const initialContext = params.initialContext ?? '';
    const initialContextBytes = getByteLength(initialContext);
    const contextLimit = Math.min(definition.limits?.maxContextBytes ?? DEFAULT_CONTEXT_BYTES, MAX_CONTEXT_BYTES);
    const configuredBudget = definition.limits?.maxTotalTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const runBudgetMs = Number.isFinite(configuredBudget)
      ? Math.max(1, Math.min(configuredBudget, MAX_RUN_TIMEOUT_MS))
      : DEFAULT_RUN_TIMEOUT_MS;
    const deadline = startTime + runBudgetMs;
    if (getByteLength(probeQuery) > MAX_QUERY_BYTES || initialContextBytes > contextLimit) {
      return {
        success: false,
        totalDurationMs: Date.now() - startTime,
        initialContextBytes,
        finalContextBytes: initialContextBytes,
        addedContextBytes: 0,
        finalQuery: probeQuery.slice(0, 2_048),
        stageMetrics: [],
        errorMessage: 'PIPELINE_INPUT_TOO_LARGE',
      };
    }

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
      if (Date.now() >= deadline && !params.signal?.aborted) {
        return {
          success: false,
          totalDurationMs: Date.now() - startTime,
          initialContextBytes,
          finalContextBytes: getByteLength(currentContext),
          addedContextBytes: Math.max(0, getByteLength(currentContext) - initialContextBytes),
          finalQuery: currentQuery,
          stageMetrics,
          failedStageId: stageRef.id,
          errorMessage: 'PIPELINE_BUDGET_EXHAUSTED',
        };
      }
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
      if (!stage || stage.phase !== stageRef.phase) {
        const error = stage ? 'STAGE_PHASE_MISMATCH' : 'STAGE_NOT_FOUND';
        stageMetrics.push({
          stageId: stageRef.id,
          stageRegistryId: stageRef.stageRegistryId,
          durationMs: 0,
          addedContextBytes: 0,
          decision: 'skip',
          status: 'error',
          error,
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
          errorMessage: error,
        };
      }

      const stageTimeoutMs = Math.max(
        1,
        Math.min(stage.defaultTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS, MAX_STAGE_TIMEOUT_MS, deadline - Date.now())
      );
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
            decision: session,
          },
          stageTimeoutMs,
          params.signal
        );

        params.signal?.throwIfAborted();
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
        if (getByteLength(currentQuery) > MAX_QUERY_BYTES || nextBytes > contextLimit) {
          return {
            success: false,
            totalDurationMs: Date.now() - startTime,
            initialContextBytes,
            finalContextBytes: nextBytes,
            addedContextBytes: Math.max(0, nextBytes - initialContextBytes),
            finalQuery: currentQuery.slice(0, 2_048),
            stageMetrics,
            failedStageId: stageRef.id,
            errorMessage: 'PIPELINE_OUTPUT_TOO_LARGE',
          };
        }

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
          errorMessage: params.signal?.aborted
            ? 'SIMULATION_ABORTED'
            : `Chặng '${stage.displayName}' gặp sự cố trong kiểm thử ngầm: ${errorMessage}`,
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

  private async retryBackoff(delayMs: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason ?? new Error('PIPELINE_RETRY_CANCELLED'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  private async executeWithTimeout(
    stage: { execute(input: ChatStageInput): Promise<ChatStageOutput> },
    input: ChatStageInput,
    timeoutMs: number,
    parentSignal?: AbortSignal
  ): Promise<ChatStageOutput> {
    parentSignal?.throwIfAborted();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`STAGE_TIMEOUT_${timeoutMs}MS`)), timeoutMs);

    const abortHandler = () => controller.abort(parentSignal?.reason ?? new Error('EXECUTION_ABORTED'));
    parentSignal?.addEventListener('abort', abortHandler, { once: true });

    let onAbort: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason ?? new Error('STAGE_ABORTED'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      // AbortSignal is advisory to third-party code; race it so an uncooperative stage cannot hang the run.
      return await Promise.race([stage.execute({ ...input, signal: controller.signal }), interrupted]);
    } finally {
      clearTimeout(timeout);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      parentSignal?.removeEventListener('abort', abortHandler);
    }
  }
}
