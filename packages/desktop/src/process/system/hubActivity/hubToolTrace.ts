/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import { redactSensitiveText } from '@process/agentRuntime/agentMesh/security';
import type { HubActivityToolTrace } from '@/common/types/agent/hubActivity';

const SENSITIVE_KEY =
  /(?:password|passphrase|secret|token|authorization|credential|cookie|api[_-]?key|private[_-]?key|client[_-]?secret|session[_-]?key|access[_-]?key)/i;
const MAX_DEPTH = 5;
const MAX_ENTRIES = 40;
const MAX_INPUT_CHARS = 2_000;
const MAX_OUTPUT_CHARS = 3_000;

/** Minimize, recursively redact known secret fields, then run the main-process
 * credential firewall. This is diagnostic metadata, not a lossless tool log.
 * Raw arguments/results must never be added to the persisted Hub grid.
 */
const redactedValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) return '[Nested value omitted]';
  if (typeof value === 'string') return redactSensitiveText(value.slice(0, MAX_OUTPUT_CHARS)).text;
  if (Array.isArray(value)) return value.slice(0, MAX_ENTRIES).map((entry) => redactedValue(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ENTRIES)
        .map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactedValue(entry, depth + 1)])
    );
  }
  return typeof value === 'number' || typeof value === 'boolean' || value === null ? value : undefined;
};

const safeText = (value: unknown, maxChars: number): string | undefined => {
  if (value === undefined || value === null) return undefined;
  try {
    const safe = redactedValue(value);
    const formatted = typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2);
    return formatted ? redactSensitiveText(formatted.slice(0, maxChars)).text : undefined;
  } catch {
    return '[Content unavailable]';
  }
};

const ms = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000
    ? Math.round(value)
    : undefined;

const timestamp = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 1_500_000_000_000 && value < 4_000_000_000_000
    ? Math.round(value)
    : undefined;

const asText = (value: unknown, max = 120): string =>
  typeof value === 'string' ? redactSensitiveText(value.slice(0, max)).text : '';

/** Accept only explicit lifecycle fields from native tool_group frames. */
export const projectHubToolTrace = (raw: unknown): HubActivityToolTrace | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const call = raw as Record<string, unknown>;
  const id = typeof call.call_id === 'string' ? call.call_id.slice(0, 200) : '';
  const name = asText(call.name, 100);
  if (!id || !name || name === 'ToolMap') return undefined;
  const status =
    call.status === 'Success' ? 'done' : call.status === 'Error' || call.status === 'Canceled' ? 'error' : 'running';
  return {
        id,
    name,
    ...(typeof call.workflow_id === 'string' && /^[a-z0-9-]{1,64}$/i.test(call.workflow_id)
      ? { workflowId: call.workflow_id } : {}),
        ...(typeof call.workflow_step_id === 'string' && /^[a-z][a-z0-9_:-]{0,95}$/i.test(call.workflow_step_id)
      ? { workflowStepId: call.workflow_step_id } : {}),
    ...(typeof call.workflow_stage === 'number' && Number.isInteger(call.workflow_stage) &&
      call.workflow_stage >= 0 && call.workflow_stage <= 64
      ? { workflowStage: call.workflow_stage } : {}),
    description: asText(call.description) || name,
    status,
    input: safeText(call.input, MAX_INPUT_CHARS),
    output: safeText(call.result_display, MAX_OUTPUT_CHARS),
    durationMs: ms(call.duration_ms),
    startedAtMs: timestamp(call.started_at_ms),
    finishedAtMs: timestamp(call.finished_at_ms),
  };
};
