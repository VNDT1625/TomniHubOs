/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';

import { redactSecretText } from '@process/agentRuntime/agentMesh/security';
import type { DecisionTaskId, ModelCallErrorCode, PipelineModelCallTrace } from '@/common/types/pipeline';
import type { LayaAnswer, LayaPredictor, LayaQuestion } from '../security/layaSemanticEgressModel';
import { redactVietnameseCredentials } from '../security/vietnameseNormalizer';
import { DECISION_TASKS } from './decisionTasks';
import type { ChatStageInput } from './types';

const MAX_TRACE_INPUT_CHARS = 2_000;
const DEFAULT_STATE_KEY = 'body';
const DEFAULT_BINDING_ID = 'laya';
const MAX_ERROR_CHARS = 200;

/**
 * How long one model call may run. It belongs to the call, not to the stage that happened to start it: a stage
 * has its own short deadline and gives up on waiting, but the call keeps going so the next stage can use it.
 */
export const DEFAULT_CALL_DEADLINE_MS = 3_000;

export type DecisionAnswers = Readonly<Record<string, LayaAnswer>>;

/**
 * Per-run access to the shared decision model. Every stage that needs an answer asks for its task;
 * the first request asks the model for all tasks the pipeline plans to use, so the rest are served
 * from the same forward pass.
 */
export type DecisionSession = Readonly<{
  /** Answers for one task about `text`. Throws when the model is unavailable so the stage can fall back. */
  analyze: (taskId: DecisionTaskId, text: string, stageId: string, signal?: AbortSignal) => Promise<DecisionAnswers>;
  /** Declares that an answer computed for `from` still holds for `to` (for example after redaction). */
  alias: (from: string, to: string) => void;
  /** Every model call and cache hit of this run, in order. */
  calls: () => readonly PipelineModelCallTrace[];
}>;

export type DecisionSessionOptions = Readonly<{
  predictor?: LayaPredictor;
  /** Tasks the active pipeline will ask for; they are answered together by the first call. */
  plannedTasks?: readonly DecisionTaskId[];
  signal?: AbortSignal;
  bindingId?: string;
  stateKey?: string;
  callDeadlineMs?: number;
}>;

/**
 * The only form of model input that may reach the renderer: secrets are masked and the text is clipped.
 * Raw text stays in the Main process.
 */
export const redactForTrace = (text: string): string => {
  const masked = redactSecretText(redactVietnameseCredentials(text)).text;
  return masked.length > MAX_TRACE_INPUT_CHARS ? `${masked.slice(0, MAX_TRACE_INPUT_CHARS)}…` : masked;
};

const hashText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 24);

const pick = (answers: Readonly<Record<string, LayaAnswer>>, keys: readonly string[]): Record<string, LayaAnswer> => {
  const picked: Record<string, LayaAnswer> = {};
  for (const key of keys) {
    const answer = answers[key];
    if (answer !== undefined) picked[key] = answer;
  }
  return picked;
};

type CachedAnalysis = {
  answers: Record<string, LayaAnswer>;
  tasks: Set<DecisionTaskId>;
  callId: string;
};

type PendingCall = {
  promise: Promise<void>;
  tasks: Set<DecisionTaskId>;
  callId: string;
};

const classifyFailure = (error: unknown, abortedBy: 'timeout' | 'cancelled' | undefined): ModelCallErrorCode => {
  if (abortedBy === 'timeout') return 'timeout';
  if (abortedBy === 'cancelled') return 'cancelled';
  const message = error instanceof Error ? error.message : String(error);
  if (/DECISION_MODEL_UNAVAILABLE/u.test(message)) return 'unavailable';
  if (/still starting|not ready/iu.test(message)) return 'starting';
  return 'failed';
};

/** Waits for `promise` but gives up as soon as `signal` aborts, leaving the promise itself running. */
const waitUntilAborted = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('DECISION_STAGE_ABORTED'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
};

/**
 * Convenience for stages: answers from the shared session when the executor provided one, otherwise from a
 * one-off session over the stage's own predictor. Returns `undefined` (after a warning) when no model is
 * available or the call fails, so the stage can use its deterministic fallback.
 */
export const analyzeForStage = async (
  input: Pick<ChatStageInput, 'decision' | 'signal' | 'stageId'>,
  predictor: LayaPredictor | undefined,
  taskId: DecisionTaskId,
  text: string
): Promise<DecisionAnswers | undefined> => {
  const session =
    input.decision ??
    (predictor ? createDecisionSession({ predictor, plannedTasks: [taskId], signal: input.signal }) : undefined);
  if (!session) return undefined;
  try {
    return await session.analyze(taskId, text, input.stageId, input.signal);
  } catch (error) {
    console.warn(`[DecisionSession] ${taskId} analysis failed, using fallback:`, error);
    return undefined;
  }
};

export const createDecisionSession = (options: DecisionSessionOptions = {}): DecisionSession => {
  const bindingId = options.bindingId ?? DEFAULT_BINDING_ID;
  const stateKey = options.stateKey ?? DEFAULT_STATE_KEY;
  const planned = [...new Set(options.plannedTasks ?? [])];
  const analyses = new Map<string, CachedAnalysis>();
  const pendingByKey = new Map<string, PendingCall>();
  const callDeadlineMs = options.callDeadlineMs ?? DEFAULT_CALL_DEADLINE_MS;
  const aliases = new Map<string, string>();
  const traces: PipelineModelCallTrace[] = [];
  let sequence = 0;

  const resolveKey = (text: string): string => {
    let key = hashText(text);
    const seen = new Set<string>();
    while (aliases.has(key) && !seen.has(key)) {
      seen.add(key);
      key = aliases.get(key) ?? key;
    }
    return key;
  };

  const nextCallId = (): string => `call-${++sequence}`;

  const analyze = async (
    taskId: DecisionTaskId,
    text: string,
    stageId: string,
    signal?: AbortSignal
  ): Promise<DecisionAnswers> => {
    const task = DECISION_TASKS[taskId];
    const taskQuestionKeys = Object.keys(task.questions);
    const key = resolveKey(text);
    const cached = analyses.get(key);

    if (cached?.tasks.has(taskId)) {
      const answers = pick(cached.answers, taskQuestionKeys);
      traces.push({
        id: nextCallId(),
        bindingId,
        stageId,
        taskIds: [taskId],
        questionKeys: taskQuestionKeys,
        input: redactForTrace(text),
        answers,
        latencyMs: 0,
        cacheHit: true,
        sourceCallId: cached.callId,
      });
      return answers;
    }

    if (!options.predictor) throw new Error('DECISION_MODEL_UNAVAILABLE');

    // A call already on its way for this text that covers the task is joined, not repeated: when an earlier
    // stage gave up waiting, the answer still arrives for the stages after it.
    let pending = pendingByKey.get(key);
    const joined = pending?.tasks.has(taskId) === true;
    if (!pending || !joined) pending = launch(key, text, taskId, stageId, cached);

    await waitUntilAborted(pending.promise, signal);
    const answered = analyses.get(key);
    if (!answered?.tasks.has(taskId)) throw new Error('DECISION_CALL_FAILED');
    const answers = pick(answered.answers, taskQuestionKeys);
    if (joined) {
      traces.push({
        id: nextCallId(),
        bindingId,
        stageId,
        taskIds: [taskId],
        questionKeys: taskQuestionKeys,
        input: redactForTrace(text),
        answers,
        latencyMs: 0,
        cacheHit: true,
        sourceCallId: pending.callId,
      });
    }
    return answers;
  };

  /** Starts the model call for `taskId` plus every other planned task still unanswered for this text. */
  const launch = (
    key: string,
    text: string,
    taskId: DecisionTaskId,
    stageId: string,
    cached: CachedAnalysis | undefined
  ): PendingCall => {
    const wanted = [...new Set([taskId, ...planned])].filter((id) => !cached?.tasks.has(id));
    const questions: Record<string, LayaQuestion> = {};
    for (const id of wanted) Object.assign(questions, DECISION_TASKS[id].questions);
    const questionKeys = Object.keys(questions);
    const callId = nextCallId();
    const startedAt = Date.now();

    const controller = new AbortController();
    let abortedBy: 'timeout' | 'cancelled' | undefined;
    const timer = setTimeout(() => {
      abortedBy = 'timeout';
      controller.abort(new Error('LAYA_CALL_DEADLINE'));
    }, callDeadlineMs);
    const onRunAbort = (): void => {
      abortedBy = 'cancelled';
      controller.abort(new Error('LAYA_RUN_CANCELLED'));
    };
    if (options.signal?.aborted) onRunAbort();
    else options.signal?.addEventListener('abort', onRunAbort, { once: true });

    let call: PendingCall | undefined;
    let settled = false;
    const settle = (): void => {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onRunAbort);
      if (call && pendingByKey.get(key) === call) pendingByKey.delete(key);
    };

    const promise = (async (): Promise<void> => {
      try {
        const result = await options.predictor!({ [stateKey]: text }, questions, controller.signal);
        const raw = result?.answers;
        if (!raw) throw new Error('LAYA_PREDICTION_MALFORMED');
        const entry = analyses.get(key) ?? { answers: {}, tasks: new Set<DecisionTaskId>(), callId };
        Object.assign(entry.answers, raw);
        for (const id of wanted) entry.tasks.add(id);
        analyses.set(key, entry);
        traces.push({
          id: callId,
          bindingId,
          stageId,
          taskIds: wanted,
          questionKeys,
          input: redactForTrace(text),
          answers: pick(raw, questionKeys),
          latencyMs: Date.now() - startedAt,
          cacheHit: false,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        traces.push({
          id: callId,
          bindingId,
          stageId,
          taskIds: wanted,
          questionKeys,
          input: redactForTrace(text),
          answers: {},
          latencyMs: Date.now() - startedAt,
          cacheHit: false,
          error: detail.slice(0, MAX_ERROR_CHARS),
          errorCode: classifyFailure(error, abortedBy),
        });
        throw error;
      } finally {
        settle();
      }
    })();
    // Nobody may be waiting any more (every stage gave up); the failure is already recorded in the trace.
    promise.catch((): void => undefined);

    call = { promise, tasks: new Set(wanted), callId };
    // A call that already finished synchronously (a predictor that throws at once) is not kept for joining.
    if (!settled) pendingByKey.set(key, call);
    return call;
  };

  return {
    analyze,
    alias: (from, to) => {
      const target = resolveKey(from);
      const alias = hashText(to);
      if (alias !== target) aliases.set(alias, target);
    },
    calls: () => traces,
  };
};
