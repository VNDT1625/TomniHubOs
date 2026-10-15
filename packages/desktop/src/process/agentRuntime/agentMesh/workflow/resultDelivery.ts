/**
 * Model-facing workflow delivery is separate from tool outputs used by the DAG.
 * No tool output is silently JSON-truncated. Handles are scoped to one MCP
 * client session / Main-owned workflow host and expire after a short TTL.
 */
import { randomUUID } from 'node:crypto';
import type { WorkflowRunResult } from '../workflowEngine';

export type WorkflowDeliveryMode = 'smart' | 'full' | 'selected' | 'errorsOnly';
export type WorkflowSelection = Readonly<{ stepId: string; path: readonly string[] }>;
export type WorkflowDeliveryRequest = Readonly<{
  mode?: WorkflowDeliveryMode;
  select?: readonly WorkflowSelection[];
  maxChars?: number;
}>;

const MAX_STORED_CHARS = 8_000_000;
const MAX_RESULT_CHARS = 2_000_000;
const MAX_REFS = 128;
const RESULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_DELIVERY = 24_000;
const MAX_DELIVERY = 64_000;
const MAX_CHUNK_CHARS = 16_000;
const forbiddenPathPart = (part: string): boolean =>
  !part || part === '__proto__' || part === 'prototype' || part === 'constructor';

type StoredResult = { json: string; createdAt: number; stepId: string };

export const createWorkflowResultStore = (now: () => number = Date.now) => {
  const values = new Map<string, StoredResult>();
  let usedChars = 0;
  const expire = (): void => {
    for (const [ref, entry] of values) {
      if (now() - entry.createdAt > RESULT_TTL_MS) {
        usedChars -= entry.json.length;
        values.delete(ref);
      }
    }
  };
  return {
    put: (stepId: string, output: unknown): { ref: string; sizeChars: number } => {
      const json = JSON.stringify(output);
      if (json === undefined) throw new Error('WORKFLOW_OUTPUT_NOT_SERIALIZABLE');
      expire();
      if (json.length > MAX_RESULT_CHARS || values.size >= MAX_REFS || usedChars + json.length > MAX_STORED_CHARS) {
        throw new Error('WORKFLOW_RESULT_STORE_CAPACITY');
      }
      const ref = randomUUID();
      values.set(ref, { json, stepId, createdAt: now() });
      usedChars += json.length;
      return { ref, sizeChars: json.length };
    },
    get: (ref: string, offset = 0, limit = 4_000) => {
      expire();
      const entry = values.get(ref);
      if (!entry) throw new Error('WORKFLOW_RESULT_REFERENCE_UNAVAILABLE');
      if (!Number.isInteger(offset) || offset < 0 || offset > entry.json.length) {
        throw new Error('WORKFLOW_RESULT_OFFSET_INVALID');
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHUNK_CHARS) {
        throw new Error('WORKFLOW_RESULT_LIMIT_INVALID');
      }
      const end = Math.min(entry.json.length, offset + limit);
      return {
        stepId: entry.stepId,
        contentFormat: 'json',
        text: entry.json.slice(offset, end),
        offset,
        totalChars: entry.json.length,
        nextOffset: end < entry.json.length ? end : null,
      };
    },
    clear: (): void => {
      values.clear();
      usedChars = 0;
    },
    count: (): number => values.size,
  };
};

export type WorkflowResultStore = ReturnType<typeof createWorkflowResultStore>;

const atPath = (root: unknown, path: readonly string[]): { found: boolean; value?: unknown } => {
  let value = root;
  for (const part of path) {
    if (forbiddenPathPart(part) || !value || typeof value !== 'object') return { found: false };
    if (!Object.prototype.hasOwnProperty.call(value, part)) return { found: false };
    value = (value as Record<string, unknown>)[part];
  }
  return { found: true, value };
};

/**
 * Never synthesize a semantic summary: 'smart' means deterministic payload
 * selection and capped previews, not a potentially misleading LLM synopsis.
 * Every successful result has a separately retrievable opaque reference.
 */
export const deliverWorkflowResult = (
  result: WorkflowRunResult,
  store: WorkflowResultStore,
  request: WorkflowDeliveryRequest = {}
): Record<string, unknown> => {
  const mode = request.mode ?? 'smart';
  const maxChars = Math.min(MAX_DELIVERY, Math.max(8_000, request.maxChars ?? DEFAULT_MAX_DELIVERY));
  const perStep = Math.max(96, Math.min(4_000, Math.floor((maxChars - 6_000) / Math.max(1, result.steps.length))));
  const selections = request.select ?? [];
  const steps = result.steps.map((step) => {
    const { output, ...metadata } = step;
    if (output === undefined) return metadata;
    const saved = store.put(step.id, output);
    const serialized = JSON.stringify(output);
    const shared = { ...metadata, resultRef: saved.ref, outputChars: saved.sizeChars };
    if (mode === 'errorsOnly') return shared;
    if (mode === 'selected') {
      const selected: Record<string, unknown> = {};
      const notFound: string[] = [];
      for (const selection of selections) {
        if (selection.stepId !== step.id) continue;
        if (selection.path.length > 12 || selection.path.some(forbiddenPathPart)) {
          notFound.push(selection.path.join('.'));
          continue;
        }
        const match = atPath(output, selection.path);
        if (!match.found) {
          notFound.push(selection.path.join('.'));
          continue;
        }
        const encoded = JSON.stringify(match.value);
        if (encoded === undefined || encoded.length > perStep) {
          notFound.push(selection.path.join('.'));
          continue;
        }
        selected[selection.path.join('.')] = match.value;
      }
      return { ...shared, selected, ...(notFound.length ? { omittedPaths: notFound } : {}) };
    }
    if (mode === 'full') return { ...shared, output };
    if (serialized.length <= perStep) return { ...shared, output };
    return {
      ...shared,
      outputPreview: serialized.slice(0, Math.min(perStep, 600)),
      previewTruncated: true,
    };
  });
  const response = {
    status: result.status,
    deliveryMode: mode,
    steps,
    resultRetrievalTool: 'workflow_result_get',
  };
  const serialized = JSON.stringify(response);
  if (serialized.length > maxChars) {
    // Do not quietly truncate either a full response or requested fields.
    // The handles live on this session even if the requested projection exceeds
    // the model output budget.
    return {
      status: result.status,
      deliveryMode: mode,
      deliveryLimitExceeded: true,
      message: 'Requested workflow delivery exceeds maxChars; use workflow_result_get with the step refs.',
      steps: steps.map((step) => {
        const {
          output: _output,
          outputPreview: _preview,
          selected: _selected,
          ...metadata
        } = step as Record<string, unknown>;
        return metadata;
      }),
      resultRetrievalTool: 'workflow_result_get',
    };
  }
  return response;
};
