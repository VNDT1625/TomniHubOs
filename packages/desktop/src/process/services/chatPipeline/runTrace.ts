/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { redactForTrace } from './decisionSession';
import type { PipelineExecutionResult, PipelineModelCallTrace, PipelineRunTrace, PipelineStageTrace } from './types';

const MAX_EVIDENCE_ENTRIES = 12;
const MAX_EVIDENCE_STRING_CHARS = 200;
const MAX_MODEL_CALLS = 24;
const MAX_ANSWER_ITEMS = 16;
const MAX_TRACE_STAGES = 32;
const MAX_TRACE_BYTES = 64 * 1024;

/** Model answers are untrusted. Keep their shape useful to the inspector but bounded and masked. */
const safeAnswer = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return redactForTrace(value).slice(0, MAX_EVIDENCE_STRING_CHARS);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth >= 3) return null;
  if (Array.isArray(value)) return value.slice(0, MAX_ANSWER_ITEMS).map((item) => safeAnswer(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_ANSWER_ITEMS)
        .map(([key, item]) => [redactForTrace(key).slice(0, MAX_EVIDENCE_STRING_CHARS), safeAnswer(item, depth + 1)])
    );
  }
  return null;
};

const safeModelCall = (call: PipelineModelCallTrace): PipelineModelCallTrace => ({
  // Explicit projection: unexpected provider properties must never cross the IPC boundary.
  id: redactForTrace(call.id).slice(0, MAX_EVIDENCE_STRING_CHARS),
  bindingId: redactForTrace(call.bindingId).slice(0, MAX_EVIDENCE_STRING_CHARS),
  stageId: redactForTrace(call.stageId).slice(0, MAX_EVIDENCE_STRING_CHARS),
  taskIds: call.taskIds.slice(0, MAX_ANSWER_ITEMS),
  questionKeys: call.questionKeys
    .slice(0, MAX_ANSWER_ITEMS)
    .map((key) => redactForTrace(key).slice(0, MAX_EVIDENCE_STRING_CHARS)),
  input: redactForTrace(call.input),
  answers: safeAnswer(call.answers) as Record<string, unknown>,
  latencyMs: Number.isFinite(call.latencyMs) ? Math.max(0, call.latencyMs) : 0,
  cacheHit: Boolean(call.cacheHit),
  ...(call.errorCode ? { errorCode: call.errorCode } : {}),
  ...(call.sourceCallId ? { sourceCallId: redactForTrace(call.sourceCallId).slice(0, MAX_EVIDENCE_STRING_CHARS) } : {}),
  ...(call.error ? { error: redactForTrace(call.error).slice(0, MAX_EVIDENCE_STRING_CHARS) } : {}),
});

/**
 * Stage evidence is produced by third-party code, so only primitive values are kept and every string is
 * masked and clipped before it can reach the renderer.
 */
const sanitizeEvidence = (
  evidence: Record<string, unknown> | undefined
): Record<string, string | number | boolean> | undefined => {
  if (!evidence) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(evidence).slice(0, MAX_EVIDENCE_ENTRIES)) {
    const safeKey = redactForTrace(key).slice(0, MAX_EVIDENCE_STRING_CHARS);
    if (typeof value === 'number' || typeof value === 'boolean') out[safeKey] = value;
    else if (typeof value === 'string') out[safeKey] = redactForTrace(value).slice(0, MAX_EVIDENCE_STRING_CHARS);
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** Everything the inspector shows about one pipeline run. Safe to send to the renderer. */
export const buildRunTrace = (runId: string, result: PipelineExecutionResult, at = Date.now()): PipelineRunTrace => {
  const trace: PipelineRunTrace = {
    runId: redactForTrace(runId).slice(0, MAX_EVIDENCE_STRING_CHARS),
    at,
    status: result.status,
    ...(result.blockedReasonCode
      ? { blockedReasonCode: redactForTrace(result.blockedReasonCode).slice(0, MAX_EVIDENCE_STRING_CHARS) }
      : {}),
    finalQuery: redactForTrace(result.finalQuery).slice(0, 2_048),
    totalDurationMs: result.totalDurationMs,
    modelCalls: (result.modelCalls ?? []).slice(0, MAX_MODEL_CALLS).map(safeModelCall),
    stages: result.executedStages.slice(0, MAX_TRACE_STAGES).map((stage): PipelineStageTrace => ({
      stageId: redactForTrace(stage.stageId).slice(0, MAX_EVIDENCE_STRING_CHARS),
      stageRegistryId: redactForTrace(stage.stageRegistryId).slice(0, MAX_EVIDENCE_STRING_CHARS),
      decision: stage.decision,
      durationMs: stage.durationMs,
      ...(stage.error ? { error: redactForTrace(stage.error).slice(0, MAX_EVIDENCE_STRING_CHARS) } : {}),
      modelCallIds: (stage.modelCallIds ?? [])
        .slice(0, MAX_MODEL_CALLS)
        .map((id) => redactForTrace(id).slice(0, MAX_EVIDENCE_STRING_CHARS)),
      ...(sanitizeEvidence(stage.evidence) ? { evidence: sanitizeEvidence(stage.evidence) } : {}),
    })),
  };
  // A nested provider answer can fill a large number of short fields. Enforce a hard total IPC cap.
  let calls = [...trace.modelCalls];
  let stages = [...trace.stages];
  let bounded: PipelineRunTrace = { ...trace, modelCalls: calls, stages };
  while (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAX_TRACE_BYTES && calls.length > 0) {
    calls = calls.slice(0, -1);
    bounded = { ...bounded, modelCalls: calls };
  }
  while (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAX_TRACE_BYTES && stages.length > 0) {
    stages = stages.slice(0, -1);
    bounded = { ...bounded, stages };
  }
  return bounded;
};
