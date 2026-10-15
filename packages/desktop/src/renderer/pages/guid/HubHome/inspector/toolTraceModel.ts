/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TMessage } from '@/common/chat/chatLib';

/** Values are redacted BEFORE being copied into the rendered Inspector DOM. */
const SECRET_FIELD =
  /(?:password|passphrase|secret|token|authorization|credential|cookie|api[_-]?key|private[_-]?key|client[_-]?secret)/i;
const SECRET_VALUE =
  /\b(?:Bearer\s+|sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|xox[baprs]-[a-zA-Z0-9-]{12,})\S*/g;
const MAX_TEXT = 3000;

export const redactToolValue = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return '[Nested content omitted]';
  if (typeof value === 'string') return value.slice(0, MAX_TEXT).replace(SECRET_VALUE, '[REDACTED]');
  if (Array.isArray(value)) return value.slice(0, 60).map((entry) => redactToolValue(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 60)
        .map(([key, entry]) => [key, SECRET_FIELD.test(key) ? '[REDACTED]' : redactToolValue(entry, depth + 1)])
    );
  }
  return value;
};

export const displayToolValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  const redacted = redactToolValue(value);
  try {
    return (typeof redacted === 'string' ? redacted : JSON.stringify(redacted, null, 2)).slice(0, 8000);
  } catch {
    return '[Unable to display result]';
  }
};

export type ToolTraceRow = {
  id: string;
  name: string;
  description: string;
  status: 'running' | 'done' | 'error';
  input?: unknown;
  output?: unknown;
    durationMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
    createdAt?: number;
  workflowId?: string;
  workflowStepId?: string;
};

const boundedDuration = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 86_400_000
    ? Math.round(value)
    : undefined;

export const extractToolTraceRows = (messages: readonly TMessage[]): ToolTraceRow[] => {
  const rows = new Map<string, ToolTraceRow>();
  for (const message of messages) {
    if (message.hidden) continue;
    if (message.type === 'tool_group') {
      for (const call of message.content) {
        if (!call.call_id || call.name === 'ToolMap') continue;
        const raw = call as unknown as Record<string, unknown>;
        const previous = rows.get(call.call_id);
        rows.set(call.call_id, {
          id: call.call_id,
          name: call.name,
          description: call.description || call.name,
          status:
            call.status === 'Success'
              ? 'done'
              : call.status === 'Error' || call.status === 'Canceled'
                ? 'error'
                : 'running',
          input: call.input ?? previous?.input,
          output: call.result_display ?? previous?.output,
                    durationMs: boundedDuration(raw.duration_ms ?? raw.durationMs) ?? previous?.durationMs,
          startedAtMs: typeof raw.started_at_ms === 'number' ? raw.started_at_ms : previous?.startedAtMs,
          finishedAtMs: typeof raw.finished_at_ms === 'number' ? raw.finished_at_ms : previous?.finishedAtMs,
          createdAt: message.created_at,
        });
      }
    } else if (message.type === 'tool_call' && message.content.call_id) {
      const call = message.content;
      const raw = call as unknown as Record<string, unknown>;
      const previous = rows.get(call.call_id);
      rows.set(call.call_id, {
        id: call.call_id,
        name: call.name,
        description: call.description || call.name,
        status: call.status === 'completed' ? 'done' : call.status === 'error' ? 'error' : 'running',
        input: call.input ?? call.args ?? previous?.input,
        output: call.output ?? call.error ?? previous?.output,
        durationMs: boundedDuration(raw.duration_ms ?? raw.durationMs) ?? previous?.durationMs,
        createdAt: message.created_at,
      });
    } else if (message.type === 'acp_tool_call' && message.content.update?.tool_call_id) {
      // ACP agents (e.g. Codex/Claude/Qwen) report a different schema from
      // native tool_group calls; both belong to the same Execution Trace.
      const update = message.content.update;
      const raw = update as unknown as Record<string, unknown>;
      const previous = rows.get(update.tool_call_id);
      const output = update.content
        ?.map((entry) =>
          entry.type === 'diff'
            ? { path: entry.path, old_text: entry.old_text, new_text: entry.new_text }
            : entry.content?.type === 'text'
              ? entry.content.text
              : undefined
        )
        .filter((entry) => entry !== undefined);
      rows.set(update.tool_call_id, {
        id: update.tool_call_id,
        name: update.kind || previous?.name || 'acp_tool_call',
        description: update.title || previous?.description || update.kind,
        status: update.status === 'completed' ? 'done' : update.status === 'failed' ? 'error' : 'running',
        input: update.rawInput ?? previous?.input,
        output: output?.length ? output : previous?.output,
        durationMs: boundedDuration(raw.duration_ms ?? raw.durationMs) ?? previous?.durationMs,
        createdAt: message.created_at,
      });
    }
  }
  return [...rows.values()].slice(-40);
};
