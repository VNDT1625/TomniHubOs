/**
 * Host-owned, model-independent DAG executor for multi-tool turns.
 * A workflow submits all dependency-ready steps concurrently. The global
 * ResourceCoordinator's lease queue determines how many can ACTUALLY run.
 *
 * This module does not grant capabilities: callers must resolve and authorize
 * each tool invocation through the existing governed tool boundary.
 */
import type { IResourceCoordinator } from '@process/resource/resourceCoordinator';
import type { LeaseOwner, TaskKind } from '@process/resource/leaseTypes';
import { evaluateWorkflowExpression, validateWorkflowExpression, type WorkflowExpression } from './workflowCondition';
import {
  evaluateCustomCondition,
  validateCustomCondition,
  type WorkflowCustomCondition,
} from './workflowCustomCondition';

export type WorkflowScalar = string | number | boolean | null;

export type WorkflowCondition = Readonly<{
  stepId: string;
  /** Read terminal status or compare a scalar result from an earlier step. */
  status?: 'succeeded' | 'failed' | 'skipped';
  path?: readonly string[];
  equals?: WorkflowScalar;
  /** Match the exact number of distinct paths returned by a successful tomny_glob. */
  fileCount?: number;
}>;

export type WorkflowOutputBinding = Readonly<{
  stepId: string;
  /** Ordinary bounded scalar binding from a previous result. */
  path?: readonly string[];
  /** Resolve the unique path from an earlier tomny_glob; refuse ambiguous or truncated results. */
  select?: 'singleFile';
  /** Optional generic adapter: decode one MCP text block, rather than guessing its shape. */
  decode?: 'mcpText' | 'mcpJson';
}>;

export type WorkflowToolStep = Readonly<{
  id: string;
  tool: string;
  input: Readonly<Record<string, unknown>>;
  /** Map top-level input fields to bounded scalar values from prerequisite tool results. */
  inputFrom?: Readonly<Record<string, WorkflowOutputBinding>>;
  dependsOn?: readonly string[];
  /** All conditions must hold after dependencies terminate. */
  when?: readonly WorkflowCondition[];
  /** Agent-authored compositional predicate over completed dependencies. */
  whenExpr?: WorkflowExpression;
  /** Agent-authored JS predicate in a short-lived isolated worker; never runs in Main. */
  whenScript?: WorkflowCustomCondition;
}>;

export type WorkflowToolResult = Readonly<{
  id: string;
  tool: string;
  status: 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  output?: unknown;
  /** Exact match count is only available for validated, non-truncated tomny_glob output. */
  fileMatchCount?: number;
  error?: string;
  queuedMs?: number;
  durationMs?: number;
}>;

export type WorkflowRunResult = Readonly<{
  status: 'completed' | 'failed' | 'cancelled';
  steps: readonly WorkflowToolResult[];
}>;

export type WorkflowToolExecutor = (
  step: WorkflowToolStep,
  options: {
    signal: AbortSignal;
    results: ReadonlyMap<string, WorkflowToolResult>;
  }
) => Promise<unknown>;

export type WorkflowAdmission = (
  step: WorkflowToolStep,
  signal: AbortSignal
) => Promise<{
  release: () => void;
  waitMs?: number;
}>;

export type WorkflowExecutionOptions = Readonly<{
  invoke: WorkflowToolExecutor;
  admit: WorkflowAdmission;
  /** Independent, Main-controlled resource gate for custom condition workers. */
  admitCondition?: WorkflowAdmission;
  signal: AbortSignal;
  now?: () => number;
  /** A nonblocking, host-owned event hook. Never starts another model turn. */
  onStepSettled?: (result: WorkflowToolResult) => void;
}>;

const MAX_STEPS = 64;
const MAX_STEP_ID = 96;
const MAX_TOOL_NAME = 128;
const MAX_DEPENDENCIES = 64;
const MAX_CONDITIONS = 16;
const MAX_OUTPUT_CHARS = 2_000_000;
const MAX_ERROR_CHARS = 2_000;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_:-]*$/u;
const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const validateWorkflow = (steps: readonly WorkflowToolStep[]): void => {
  if (!steps.length || steps.length > MAX_STEPS) throw new Error('WORKFLOW_STEP_COUNT_INVALID');
  const ids = new Set<string>();
  for (const step of steps) {
    if (!SAFE_ID.test(step.id) || step.id.length > MAX_STEP_ID || ids.has(step.id)) {
      throw new Error('WORKFLOW_STEP_ID_INVALID');
    }
    if (!SAFE_ID.test(step.tool) || step.tool.length > MAX_TOOL_NAME) {
      throw new Error('WORKFLOW_TOOL_NAME_INVALID');
    }
    if (!step.input || Array.isArray(step.input) || typeof step.input !== 'object') {
      throw new Error('WORKFLOW_INPUT_INVALID');
    }
    if ((step.dependsOn?.length ?? 0) > MAX_DEPENDENCIES || (step.when?.length ?? 0) > MAX_CONDITIONS) {
      throw new Error('WORKFLOW_DEPENDENCIES_EXCEEDED');
    }
    ids.add(step.id);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const walk = (id: string): void => {
    if (visiting.has(id)) throw new Error('WORKFLOW_CYCLE');
    if (visited.has(id)) return;
    visiting.add(id);
    const step = byId.get(id)!;
    const dependencies = step.dependsOn ?? [];
    if (new Set(dependencies).size !== dependencies.length) throw new Error('WORKFLOW_DUPLICATE_DEPENDENCY');
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) throw new Error('WORKFLOW_DEPENDENCY_NOT_FOUND');
      walk(dependency);
    }
    for (const condition of step.when ?? []) {
      if (!dependencies.includes(condition.stepId)) throw new Error('WORKFLOW_CONDITION_NOT_DEPENDENCY');
      if (
        condition.fileCount !== undefined &&
        (!Number.isInteger(condition.fileCount) || condition.fileCount < 0 || condition.fileCount > 100)
      ) {
        throw new Error('WORKFLOW_FILE_COUNT_INVALID');
      }
      if (
        condition.path?.some((part) => !part || part === '__proto__' || part === 'constructor' || part === 'prototype')
      ) {
        throw new Error('WORKFLOW_CONDITION_PATH_INVALID');
      }
    }
    if (step.whenExpr) validateWorkflowExpression(step.whenExpr, dependencies);
    if (step.whenScript) validateCustomCondition(step.whenScript, dependencies);
    const bindings = Object.entries(step.inputFrom ?? {});
    if (bindings.length > 16) throw new Error('WORKFLOW_BINDING_COUNT_EXCEEDED');
    for (const [key, binding] of bindings) {
      if (!SAFE_ID.test(key) || key.length > 96 || !dependencies.includes(binding.stepId)) {
        throw new Error('WORKFLOW_BINDING_INVALID');
      }
      if (binding.decode && !['mcpText', 'mcpJson'].includes(binding.decode)) {
        throw new Error('WORKFLOW_BINDING_DECODER_INVALID');
      }
      if (binding.select && binding.decode) throw new Error('WORKFLOW_BINDING_MODE_INVALID');
      if ((binding.select === 'singleFile') === (binding.path !== undefined)) {
        throw new Error('WORKFLOW_BINDING_MODE_INVALID');
      }
      if (
        binding.path &&
        (binding.path.length > 12 ||
          binding.path.some((part) => !part || part === '__proto__' || part === 'constructor' || part === 'prototype'))
      )
        throw new Error('WORKFLOW_BINDING_PATH_INVALID');
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of steps) walk(step.id);
};

const boundedOutput = (value: unknown): unknown => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('WORKFLOW_OUTPUT_NOT_SERIALIZABLE');
  if (serialized.length > MAX_OUTPUT_CHARS) throw new Error('WORKFLOW_OUTPUT_EXCEEDS_STORAGE_LIMIT');
  // Do not mutate or JSON-truncate intermediate outputs: later conditions need real data.
  return value;
};

const scalarAtPath = (value: unknown, path: readonly string[]): { found: boolean; value?: WorkflowScalar } => {
  let current: unknown = value;
  for (const part of path) {
    if (Array.isArray(current) && /^(0|[1-9][0-9]*)$/u.test(part)) {
      if (!hasOwn(current as unknown as Record<string, unknown>, part)) return { found: false };
      current = current[Number(part)];
    } else if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      hasOwn(current as Record<string, unknown>, part)
    ) {
      current = (current as Record<string, unknown>)[part];
    } else return { found: false };
  }
  if (
    current === null ||
    typeof current === 'string' ||
    typeof current === 'boolean' ||
    (typeof current === 'number' && Number.isFinite(current))
  )
    return { found: true, value: current as WorkflowScalar };
  return { found: false };
};

/** Parse only the documented Core workspace glob result: one MCP text block of newline-delimited paths.
 * Any truncation, unexpected response or unsafe path makes automatic Read ineligible.
 */
const safeFileMatches = (tool: string, output: unknown): string[] | undefined => {
  if (tool !== 'tomny_glob' || !Array.isArray(output) || output.length !== 1) return undefined;
  const block: unknown = output[0];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return undefined;
  const value = block as Record<string, unknown>;
  if (value.type !== 'text' || typeof value.text !== 'string') return undefined;
  const body = value.text;
  if (body === 'No files match the pattern.') return [];
  if (!body || body.includes('...[truncated]') || body.length > MAX_OUTPUT_CHARS) return undefined;
  const matches = body.split(/\r?\n/u);
  if (matches.length > 100 || new Set(matches).size !== matches.length) return undefined;
  if (
    matches.some(
      (file) =>
        !file ||
        file !== file.trim() ||
        file.startsWith('/') ||
        file.startsWith('\\') ||
        /^[A-Za-z]:/u.test(file) ||
        file.split(/[\\/]/u).some((part) => part === '..' || part === '.' || !part) ||
        Array.from(file).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
  )
    return undefined;
  return matches;
};

const matchesCondition = (condition: WorkflowCondition, result: WorkflowToolResult): boolean => {
  if (condition.status && condition.status !== result.status) return false;
  if (condition.fileCount !== undefined && result.fileMatchCount !== condition.fileCount) return false;
  if (!condition.path) return true;
  const selected = scalarAtPath(result.output, condition.path);
  return selected.found && selected.value === condition.equals;
};

/**
 * Execute each dependency layer without returning to the model between steps.
 * There is NO hard-coded concurrency number here. All ready steps enter the
 * trusted coordinator queue; each receives a lease only when the device fits.
 */
export const executeToolWorkflow = async (
  steps: readonly WorkflowToolStep[],
  options: WorkflowExecutionOptions
): Promise<WorkflowRunResult> => {
  validateWorkflow(steps);
  const now = options.now ?? Date.now;
  const results = new Map<string, WorkflowToolResult>();
  const snapshot = (): WorkflowRunResult => {
    const ordered = steps.map((step) => results.get(step.id)!);
    return {
      status: options.signal.aborted
        ? 'cancelled'
        : ordered.some((result) => result.status === 'failed')
          ? 'failed'
          : 'completed',
      steps: ordered,
    };
  };
  const scheduled = new Set<string>();
  return new Promise<WorkflowRunResult>((resolve) => {
    const scheduleReady = (): void => {
      // Work-conserving: a dependent step is admitted as soon as ITS prerequisites
      // finish, even if unrelated branches are still running or queued.
      for (const step of steps) {
        if (scheduled.has(step.id) || !(step.dependsOn ?? []).every((id) => results.has(id))) continue;
        scheduled.add(step.id);
        const prior = new Map(results);
        const run = async (): Promise<WorkflowToolResult> => {
          const base = { id: step.id, tool: step.tool };
          if (options.signal.aborted) return { ...base, status: 'cancelled' };
          const dependencies = (step.dependsOn ?? []).map((id) => prior.get(id)!);
          const legacyAllowed =
            (step.when?.length ?? 0) > 0
              ? step.when!.every((condition) => matchesCondition(condition, prior.get(condition.stepId)!))
              : step.whenExpr || step.whenScript
                ? true
                : dependencies.every((dependency) => dependency.status === 'succeeded');
          const allowed = legacyAllowed && (!step.whenExpr || evaluateWorkflowExpression(step.whenExpr, prior));
          if (!allowed) return { ...base, status: 'skipped' };
          const queuedAt = now();
          let release: (() => void) | undefined;
          try {
            let decision: Awaited<ReturnType<typeof evaluateCustomCondition>> | undefined;
            if (step.whenScript) {
              const conditionLease = await options.admitCondition?.(step, options.signal);
              try {
                decision = await evaluateCustomCondition(step.whenScript, prior, step.dependsOn ?? [], options.signal);
              } finally {
                conditionLease?.release();
              }
            }
            if (decision && !decision.allow) return { ...base, status: 'skipped' };
            const resolvedInput: Record<string, unknown> = { ...step.input };
            for (const [key, value] of Object.entries(decision?.values ?? {})) {
              if (!SAFE_ID.test(key) || key.length > 96 || (typeof value === 'string' && value.length > 4_096)) {
                throw new Error('WORKFLOW_CUSTOM_VALUE_INVALID');
              }
              resolvedInput[key] = value;
            }
            for (const [key, binding] of Object.entries(step.inputFrom ?? {})) {
              const previous = prior.get(binding.stepId);
              if (binding.select === 'singleFile') {
                const matches = previous && safeFileMatches(previous.tool, previous.output);
                if (!matches || matches.length !== 1) throw new Error('WORKFLOW_UNIQUE_FILE_UNAVAILABLE');
                resolvedInput[key] = matches[0];
              } else {
                let source = previous?.output;
                if (binding.decode) {
                  if (
                    Array.isArray(source) &&
                    source.length === 1 &&
                    source[0]?.type === 'text' &&
                    typeof source[0]?.text === 'string'
                  ) {
                    source = source[0].text;
                    if (binding.decode === 'mcpJson') {
                      try {
                        source = JSON.parse(source as string);
                      } catch {
                        source = undefined;
                      }
                    }
                  } else source = undefined;
                }
                const selected = scalarAtPath(source, binding.path ?? []);
                if (!selected?.found || (typeof selected.value === 'string' && selected.value.length > 4_096)) {
                  throw new Error('WORKFLOW_BINDING_VALUE_UNAVAILABLE');
                }
                resolvedInput[key] = selected.value;
              }
            }
            const readyStep: WorkflowToolStep = { ...step, input: resolvedInput };
            const admitted = await options.admit(readyStep, options.signal);
            release = admitted.release;
            if (options.signal.aborted) return { ...base, status: 'cancelled' };
            const began = now();
            const output = boundedOutput(await options.invoke(readyStep, { signal: options.signal, results: prior }));
            const matchingFiles = safeFileMatches(step.tool, output);
            return {
              ...base,
              status: 'succeeded',
              output,
              ...(matchingFiles ? { fileMatchCount: matchingFiles.length } : {}),
              queuedMs: admitted.waitMs ?? began - queuedAt,
              durationMs: now() - began,
            };
          } catch (error) {
            return {
              ...base,
              status: options.signal.aborted ? 'cancelled' : 'failed',
              error: (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS),
            };
          } finally {
            release?.();
          }
        };
        void run().then((result) => {
          results.set(step.id, result);
          try {
            options.onStepSettled?.(result);
          } catch {
            // Observability must never block sibling DAG branches.
          }
          if (results.size === steps.length) resolve(snapshot());
          else scheduleReady();
        });
      }
    };
    scheduleReady();
  });
};

export type WorkflowToolResourceProfile = Readonly<{ kind: TaskKind; costMB: number; priority?: number }>;

/**
 * ResourceCoordinator adapter. Profiles are selected by TRUSTED host code,
 * not by tool/model input. The owning runtime must not hold a conflicting
 * same-kind lease while awaiting nested steps (avoid lease self-deadlock).
 */
export const createWorkflowCoordinatorAdmission =
  (
    coordinator: Pick<IResourceCoordinator, 'requestLease' | 'releaseLease'>,
    profileForTool: (tool: string) => WorkflowToolResourceProfile,
    owner: LeaseOwner
  ): WorkflowAdmission =>
  async (step, signal) => {
    const profile = profileForTool(step.tool);
    if (!Number.isFinite(profile.costMB) || profile.costMB <= 0) throw new Error('WORKFLOW_RESOURCE_PROFILE_INVALID');
    const lease = await coordinator.requestLease(
      {
        kind: profile.kind,
        estCostMB: profile.costMB,
        priority: profile.priority,
        owner,
      },
      { signal }
    );
    return { waitMs: lease.waitMs, release: () => coordinator.releaseLease(lease.id) };
  };
