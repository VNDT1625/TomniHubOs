/**
 * Custom JavaScript conditions execute in a disposable, resource-capped worker.
 * They receive only JSON-cloned completed dependency outputs and return a
 * JSON-serializable { allow, values?, reason? } decision. No host objects,
 * Node globals, network, file access or tool invocation are passed inside.
 *
 * Node's vm alone is NOT a security boundary. The worker is short-lived,
 * resource-capped and terminated on timeout; deployment that processes truly
 * adversarial script must additionally use an OS-level sandbox/isolate.
 */
import { Worker } from 'node:worker_threads';

import type { WorkflowToolResult } from './workflowEngine';

export type WorkflowCustomCondition = Readonly<{
  language: 'javascript';
  source: string;
}>;

export type WorkflowCustomDecision = Readonly<{
  allow: boolean;
  values?: Record<string, string | number | boolean | null>;
  reason?: string;
}>;

const MAX_SCRIPT_CHARS = 4_096;
const MAX_INPUT_CHARS = 128_000;
const MAX_RESULT_CHARS = 8_000;
const TIMEOUT_MS = 250;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_:-]{0,95}$/u;

// A script that needs capabilities belongs in a separate, governed MCP tool step.
// Reject identifiers associated with dynamic code, host interfaces and prototypes.
// This is defense in depth, not the isolation mechanism.
const DENIED_IDENTIFIERS =
  /\b(?:eval|Function|constructor|__proto__|prototype|require|process|globalThis|global|Buffer|fetch|WebAssembly|importScripts|XMLHttpRequest|Worker|WebSocket|Deno|Bun)\b/u;

export const validateCustomCondition = (condition: WorkflowCustomCondition, dependencies: readonly string[]): void => {
  if (
    condition.language !== 'javascript' ||
    typeof condition.source !== 'string' ||
    !condition.source.trim() ||
    condition.source.length > MAX_SCRIPT_CHARS
  ) {
    throw new Error('WORKFLOW_CUSTOM_SCRIPT_INVALID');
  }
  if (DENIED_IDENTIFIERS.test(condition.source)) throw new Error('WORKFLOW_CUSTOM_FORBIDDEN_IDENTIFIER');
  if (!dependencies.every((id) => IDENTIFIER.test(id)) || dependencies.length > 64) {
    throw new Error('WORKFLOW_CUSTOM_DEPENDENCY_INVALID');
  }
};

// Hard-coded worker program; only condition.source is supplied as data and is
// evaluated in vm's isolated context, never as a worker module or Node script.
const WORKER_SCRIPT = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
function freeze(value, depth = 0) {
  if (depth > 30 || !value || typeof value !== 'object') return value;
  Object.values(value).forEach(child => freeze(child, depth + 1));
  return Object.freeze(value);
}
try {
  const data = freeze(JSON.parse(workerData.input));
  const context = Object.create(null);
  context.data = data;
  const code = '"use strict"; const evaluate = (' + workerData.source + '); evaluate(data)';
  const output = vm.runInNewContext(code, context, {
    timeout: workerData.timeout,
    contextCodeGeneration: { strings: false, wasm: false },
    breakOnSigint: false,
  });
  if (!output || typeof output !== 'object' || typeof output.allow !== 'boolean') {
    throw new Error('WORKFLOW_CUSTOM_RESULT_INVALID');
  }
  const serialized = JSON.stringify(output);
  if (!serialized || serialized.length > workerData.maxResult) throw new Error('WORKFLOW_CUSTOM_RESULT_TOO_LARGE');
  parentPort.postMessage({ ok: true, value: JSON.parse(serialized) });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e && e.message || e).slice(0, 400) });
}
`;

export const evaluateCustomCondition = async (
  condition: WorkflowCustomCondition,
  results: ReadonlyMap<string, WorkflowToolResult>,
  dependencies: readonly string[],
  signal?: AbortSignal
): Promise<WorkflowCustomDecision> => {
  validateCustomCondition(condition, dependencies);
  if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED');
  const snapshot: Record<string, WorkflowToolResult> = Object.create(null) as Record<string, WorkflowToolResult>;
  for (const id of dependencies) {
    const result = results.get(id);
    if (!result) throw new Error('WORKFLOW_CUSTOM_DEPENDENCY_UNAVAILABLE');
    snapshot[id] = result;
  }
  const input = JSON.stringify(snapshot);
  if (input.length > MAX_INPUT_CHARS) throw new Error('WORKFLOW_CUSTOM_INPUT_TOO_LARGE');
  return await new Promise<WorkflowCustomDecision>((resolve, reject) => {
    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: { source: condition.source, input, timeout: TIMEOUT_MS, maxResult: MAX_RESULT_CHARS },
      resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 8, stackSizeMb: 1 },
    });
    let finished = false;
    let watchdog: ReturnType<typeof setTimeout>;
    const settle = (error?: Error, value?: WorkflowCustomDecision): void => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      signal?.removeEventListener('abort', abort);
      worker.removeAllListeners();
      void worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = (): void => settle(new Error('WORKFLOW_CANCELLED'));
    watchdog = setTimeout(() => settle(new Error('WORKFLOW_CUSTOM_TIMEOUT')), TIMEOUT_MS + 500);
    watchdog.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: { ok: boolean; value?: WorkflowCustomDecision; error?: string }) => {
      if (!message.ok) {
        settle(new Error(message.error ?? 'WORKFLOW_CUSTOM_FAILED'));
        return;
      }
      const result = message.value;
      if (
        !result ||
        typeof result.allow !== 'boolean' ||
        (result.values !== undefined &&
          (typeof result.values !== 'object' ||
            Array.isArray(result.values) ||
            Object.values(result.values).some(
              (v) => v !== null && !['string', 'number', 'boolean'].includes(typeof v)
            ))) ||
        (result.reason !== undefined && typeof result.reason !== 'string')
      ) {
        settle(new Error('WORKFLOW_CUSTOM_RESULT_INVALID'));
        return;
      }
      settle(undefined, result);
    });
    worker.once('error', (error) => settle(new Error(`WORKFLOW_CUSTOM_WORKER_ERROR: ${error.message}`)));
    worker.once('exit', (code) => settle(new Error(`WORKFLOW_CUSTOM_WORKER_EXIT: ${code}`)));
    if (signal?.aborted) abort();
  });
};
