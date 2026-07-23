/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Automation workflow engine — a small **interpreter** over a node tree.
 *
 * The backbone is still a deterministic, ordered pipeline (each node's output
 * becomes the next node's `input`), but the engine now understands a handful of
 * `control.*` nodes that branch, loop, run sub-pipelines in parallel, catch
 * errors, filter, merge, or stop the run. Everything else is a *leaf* action
 * resolved through the injected {@link NodeExecutorMap}.
 *
 * Semantics:
 *  - Emits `run-start`, then per node `node-start` → `node-finish`, then
 *    `run-finish` (control nodes emit their own start/finish around their
 *    children so the run log reads naturally).
 *  - **Fail-fast** by default: a throwing node fails the run — UNLESS it sits
 *    inside a `control.tryCatch` `try` branch (routed to `catch`) or declares an
 *    `onError` policy with `continueOnError`/`retries`.
 *  - **Cooperative cancellation**: `signal.aborted` is checked before each node.
 *  - **control.stop** ends the run early and successfully.
 *
 * The executor table and the `emit` sink are injected so the engine is pure and
 * unit-testable (fake executors + captured events, no real IO).
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { randomUUID } from 'node:crypto';
import type { NodeExecutorMap } from './nodeExecutors';
import { conditionFromConfig, evaluateCondition, resolveValue } from './conditions';
import type {
  ApprovalDecision,
  ApprovalRequest,
  NodeAccessMode,
  NodeContext,
  NodeExecutionMode,
  RunEvent,
  Workflow,
  WorkflowCheckpointStore,
  WorkflowNode,
} from './automationTypes';

/** Options for a single {@link IWorkflowEngine.run}. */
export type RunOptions = {
  /** Cooperative cancellation; checked between nodes. */
  signal?: AbortSignal;
  /** Externally-assigned run id (so the returned id matches streamed events). */
  runId?: string;
  /** Seed value for the first node's `input` (e.g. a webhook/trigger payload). */
  input?: unknown;
  /** Resume this run from its latest persisted top-level checkpoint. */
  resume?: boolean;
};

/** Outcome of a workflow run. */
export type RunResult = {
  /** Id assigned to this run (also present on every emitted event). */
  runId: string;
  /** Whether the whole pipeline completed without an unhandled failure/abort. */
  ok: boolean;
  /** The final pipeline value (the last node's output). */
  output?: unknown;
};

/** Dependencies for {@link createWorkflowEngine}. */
export type WorkflowEngineDeps = {
  /** Executor table — one function per leaf node kind. */
  executors: NodeExecutorMap;
  /** Sink for streamed lifecycle events. */
  emit: (event: RunEvent) => void;
  /** Clock for event timestamps. Defaults to `Date.now`. Injectable for tests. */
  now?: () => number;
  /** Run-id generator. Defaults to `crypto.randomUUID`. Injectable for tests. */
  newRunId?: () => string;
  /** Max nesting depth for control-flow recursion (guards against cycles). Default 20. */
  maxDepth?: number;
  /** Max total leaf-node executions per run (guards runaway loops). Default 10000. */
  maxSteps?: number;
  /** Human approval provider used by `control.approval`. */
  requestApproval?: (request: ApprovalRequest, signal?: AbortSignal) => Promise<ApprovalDecision>;
  /** Agent Core execution route for nodes marked `agent` or hybrid fallbacks. */
  executeWithAgent?: (node: WorkflowNode, context: NodeContext, signal?: AbortSignal) => Promise<unknown>;
  /** Optional persistence adapter for resumable top-level workflow runs. */
  checkpointStore?: WorkflowCheckpointStore;
};

/** Public contract of the workflow engine. */
export type IWorkflowEngine = {
  /** Execute a workflow's node tree, emitting events; resolves with the outcome. */
  run(workflow: Workflow, options?: RunOptions): Promise<RunResult>;
};

/** Signal used internally to unwind the stack when `control.stop` runs. */
class StopRun extends Error {
  constructor() {
    super('control.stop');
    this.name = 'StopRun';
  }
}

/** The set of kinds the interpreter handles itself (not via the executor map). */
const CONTROL_KINDS = new Set<string>([
  'control.if',
  'control.switch',
  'control.loop',
  'control.parallel',
  'control.tryCatch',
  'control.filter',
  'control.merge',
  'control.approval',
  'control.stop',
]);

const numOf = (config: Record<string, unknown>, key: string, fallback: number): number =>
  typeof config[key] === 'number' && Number.isFinite(config[key]) ? (config[key] as number) : fallback;

/**
 * Create a workflow engine bound to an executor table and an event sink.
 */
export const createWorkflowEngine = (deps: WorkflowEngineDeps): IWorkflowEngine => {
  const now = deps.now ?? Date.now;
  const newRunId = deps.newRunId ?? randomUUID;
  const maxDepth = deps.maxDepth ?? 20;
  const maxSteps = deps.maxSteps ?? 10000;

  return {
    async run(workflow, options) {
      const runId = options?.runId ?? newRunId();
      const signal = options?.signal;
      deps.emit({ type: 'run-start', runId, at: now() });

      const checkpoint =
        options?.resume && deps.checkpointStore ? await deps.checkpointStore.load(workflow.id, runId) : null;
      const state = {
        steps: 0,
        agentSteps: checkpoint?.agentSteps ?? 0,
        estimatedTokens: checkpoint?.estimatedTokens ?? 0,
        completedNodeIds: checkpoint?.completedNodeIds ?? [],
      };
      if (checkpoint) {
        deps.emit({
          type: 'run-resumed',
          runId,
          nextNodeIndex: checkpoint.nextNodeIndex,
          completedNodeIds: checkpoint.completedNodeIds,
          at: now(),
        });
      }

      /** Run an ordered list of nodes, threading output→input. Returns last output. */
      const runPipeline = async (nodes: WorkflowNode[], seed: unknown, depth: number): Promise<unknown> => {
        if (depth > maxDepth) throw new Error(`Automation exceeded max nesting depth (${maxDepth}).`);
        let value = seed;
        for (const node of nodes) {
          if (signal?.aborted) throw new StopRun();
          value = await runNode(node, value, depth);
        }
        return value;
      };

      /** Run one node (control or leaf) and return its output. */
      const runNode = async (node: WorkflowNode, input: unknown, depth: number): Promise<unknown> => {
        if (CONTROL_KINDS.has(node.kind)) return runControl(node, input, depth);
        return runLeaf(node, input);
      };

      /** Run a leaf action via deterministic execution, Agent Core, or hybrid fallback. */
      const runLeaf = async (node: WorkflowNode, input: unknown): Promise<unknown> => {
        if (++state.steps > maxSteps) throw new Error(`Automation exceeded max steps (${maxSteps}).`);
        const mode = resolveExecutionMode(node);
        const access = resolveAccessMode(node);
        enforceSafeAccess(workflow, node, access);
        deps.emit({ type: 'node-routed', runId, nodeId: node.id, mode, access, at: now() });
        deps.emit({ type: 'node-start', runId, nodeId: node.id, name: node.name, at: now() });
        const ctx: NodeContext = { input };
        const retries = Math.max(0, node.onError?.retries ?? 0);
        const retryDelayMs = Math.max(0, node.onError?.retryDelayMs ?? 0);

        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            // Control kinds never reach here; cast narrows to a leaf executor key.
            const executor = deps.executors[node.kind as keyof NodeExecutorMap];
            let output: unknown;
            if (mode === 'agent') {
              if (!deps.executeWithAgent) throw new Error('Agent Core executor is not configured.');
              consumeAgentBudget(workflow, node, state);
              output = await deps.executeWithAgent(node, ctx, signal);
            } else if (mode === 'hybrid') {
              try {
                output = await executor(node, ctx, signal);
              } catch (error) {
                if (!deps.executeWithAgent) throw error;
                consumeAgentBudget(workflow, node, state);
                output = await deps.executeWithAgent(node, ctx, signal);
              }
            } else {
              output = await executor(node, ctx, signal);
            }
            deps.emit({ type: 'node-finish', runId, nodeId: node.id, ok: true, output, at: now() });
            return output;
          } catch (error) {
            lastError = error;
            if (attempt < retries) {
              if (retryDelayMs > 0) await delay(retryDelayMs, signal);
              continue;
            }
          }
        }
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        deps.emit({ type: 'node-finish', runId, nodeId: node.id, ok: false, error: message, at: now() });
        if (node.onError?.continueOnError) return null;
        throw lastError instanceof Error ? lastError : new Error(message);
      };

      /** Interpret a control-flow node, recursing into its branches. */
      const runControl = async (node: WorkflowNode, input: unknown, depth: number): Promise<unknown> => {
        const branches = node.branches ?? {};
        deps.emit({ type: 'node-start', runId, nodeId: node.id, name: node.name, at: now() });
        try {
          let output: unknown = input;
          switch (node.kind) {
            case 'control.if': {
              const taken = evaluateCondition(conditionFromConfig(node.config), input) ? 'then' : 'else';
              output = await runPipeline(branches[taken] ?? [], input, depth + 1);
              break;
            }
            case 'control.switch': {
              const value = resolveValue(
                typeof node.config.value === 'string' ? node.config.value : '{{input}}',
                input
              );
              const key = branches[`case:${value}`] ? `case:${value}` : 'default';
              output = await runPipeline(branches[key] ?? [], input, depth + 1);
              break;
            }
            case 'control.filter': {
              const pass = evaluateCondition(conditionFromConfig(node.config), input);
              if (!pass) throw new StopRun();
              output = input;
              break;
            }
            case 'control.loop': {
              output = await runLoop(node, input, depth + 1, branches.body ?? []);
              break;
            }
            case 'control.parallel': {
              const keys = Object.keys(branches)
                .filter((k) => k.startsWith('branch:'))
                .toSorted();
              const results = await Promise.all(keys.map((k) => runPipeline(branches[k], input, depth + 1)));
              output = { branches: results };
              break;
            }
            case 'control.tryCatch': {
              try {
                output = await runPipeline(branches.try ?? [], input, depth + 1);
              } catch (error) {
                if (error instanceof StopRun) throw error;
                const message = error instanceof Error ? error.message : String(error);
                output = await runPipeline(branches.catch ?? [], { error: message, input }, depth + 1);
              }
              break;
            }
            case 'control.merge': {
              // Merge mode: pass the input through (parallel already aggregated).
              output = input;
              break;
            }
            case 'control.approval': {
              if (!deps.requestApproval) throw new Error('Approval provider is not configured.');
              const rawMessage = typeof node.config.message === 'string' ? node.config.message : node.name;
              const message = rawMessage.replaceAll('{{input}}', stringifyInput(input));
              const timeoutMs =
                typeof node.config.timeoutMs === 'number' && Number.isFinite(node.config.timeoutMs)
                  ? Math.max(0, node.config.timeoutMs)
                  : undefined;
              deps.emit({ type: 'approval-requested', runId, nodeId: node.id, message, at: now() });
              const decision = await requestApprovalWithTimeout(
                deps.requestApproval,
                { runId, nodeId: node.id, name: node.name, message, input, timeoutMs },
                signal
              );
              deps.emit({
                type: 'approval-resolved',
                runId,
                nodeId: node.id,
                approved: decision.approved,
                reason: decision.reason,
                at: now(),
              });
              if (!decision.approved) throw new Error(decision.reason || 'Approval rejected.');
              output = input;
              break;
            }
            case 'control.stop': {
              deps.emit({ type: 'node-finish', runId, nodeId: node.id, ok: true, output: input, at: now() });
              throw new StopRun();
            }
            default:
              output = input;
          }
          deps.emit({ type: 'node-finish', runId, nodeId: node.id, ok: true, output, at: now() });
          return output;
        } catch (error) {
          if (error instanceof StopRun) throw error;
          const message = error instanceof Error ? error.message : String(error);
          deps.emit({ type: 'node-finish', runId, nodeId: node.id, ok: false, error: message, at: now() });
          throw error;
        }
      };

      /** Run a `control.loop` over an array (`forEach`) or a fixed count (`times`). */
      const runLoop = async (
        node: WorkflowNode,
        input: unknown,
        depth: number,
        body: WorkflowNode[]
      ): Promise<unknown> => {
        const mode = typeof node.config.mode === 'string' ? node.config.mode : 'forEach';
        const results: unknown[] = [];
        if (mode === 'times') {
          const times = Math.max(0, Math.floor(numOf(node.config, 'times', 1)));
          for (let i = 0; i < times; i++) {
            if (signal?.aborted) throw new StopRun();
            results.push(await runPipeline(body, { index: i, input }, depth));
          }
        } else {
          const items = Array.isArray(input)
            ? input
            : extractArray(input, typeof node.config.itemsPath === 'string' ? node.config.itemsPath : undefined);
          for (let i = 0; i < items.length; i++) {
            if (signal?.aborted) throw new StopRun();
            results.push(await runPipeline(body, { item: items[i], index: i }, depth));
          }
        }
        return { items: results, count: results.length };
      };

      // ---- run the top-level pipeline with resumable checkpoints ----
      let ok = true;
      let finalOutput: unknown = checkpoint?.output ?? options?.input;
      const startIndex = checkpoint?.nextNodeIndex ?? 0;
      try {
        for (let index = startIndex; index < workflow.nodes.length; index++) {
          if (signal?.aborted) throw new StopRun();
          const currentNode = workflow.nodes[index];
          finalOutput = await runNode(currentNode, finalOutput, 0);
          state.completedNodeIds.push(currentNode.id);
          if (deps.checkpointStore) {
            await deps.checkpointStore.save({
              workflowId: workflow.id,
              runId,
              nextNodeIndex: index + 1,
              output: finalOutput,
              completedNodeIds: [...state.completedNodeIds],
              agentSteps: state.agentSteps,
              estimatedTokens: state.estimatedTokens,
              updatedAt: now(),
            });
            deps.emit({ type: 'checkpoint-saved', runId, nextNodeIndex: index + 1, at: now() });
          }
        }
      } catch (error) {
        if (error instanceof StopRun) {
          ok = !signal?.aborted; // a deliberate stop is success; an abort is not.
        } else {
          ok = false;
        }
      }

      if (ok && deps.checkpointStore) await deps.checkpointStore.clear(workflow.id, runId);
      deps.emit({ type: 'run-finish', runId, ok, at: now() });
      return { runId, ok, output: finalOutput };
    },
  };
};

const resolveExecutionMode = (node: WorkflowNode): NodeExecutionMode =>
  node.execution?.mode ?? 'deterministic';

const resolveAccessMode = (node: WorkflowNode): NodeAccessMode => {
  if (node.execution?.access) return node.execution.access;
  if (node.kind === 'action.browser') return 'browser';
  if (node.kind === 'action.filesystem' || node.kind.startsWith('action.app.')) return 'local';
  if (node.kind === 'action.company' || node.kind === 'action.conversation') return 'mcp';
  return 'api';
};

const enforceSafeAccess = (workflow: Workflow, node: WorkflowNode, access: NodeAccessMode): void => {
  if (access !== 'browser' || !node.execution?.requiresWebsiteLogin) return;
  const loginPolicy = workflow.knowledge?.security?.websiteLogin ?? 'forbid';
  if (loginPolicy === 'allow') return;
  if (loginPolicy === 'approval-required') {
    throw new Error('Authenticated browser access requires an explicit approval step before this node.');
  }
  throw new Error('Authenticated browser access is forbidden; use a local, API, or MCP connector instead.');
};

type AgentBudgetState = { agentSteps: number; estimatedTokens: number };

const consumeAgentBudget = (workflow: Workflow, node: WorkflowNode, state: AgentBudgetState): void => {
  const tokenPolicy = workflow.knowledge?.tokenPolicy;
  const nextAgentSteps = state.agentSteps + 1;
  const estimatedTokens = Math.max(0, node.execution?.estimatedTokens ?? 0);
  const nextEstimatedTokens = state.estimatedTokens + estimatedTokens;
  if (tokenPolicy?.maxAgentSteps != null && nextAgentSteps > tokenPolicy.maxAgentSteps) {
    throw new Error(`Automation exceeded max Agent Core steps (${tokenPolicy.maxAgentSteps}).`);
  }
  if (tokenPolicy?.maxEstimatedTokens != null && nextEstimatedTokens > tokenPolicy.maxEstimatedTokens) {
    throw new Error(`Automation exceeded estimated token budget (${tokenPolicy.maxEstimatedTokens}).`);
  }
  state.agentSteps = nextAgentSteps;
  state.estimatedTokens = nextEstimatedTokens;
};

const stringifyInput = (input: unknown): string => {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
};

const requestApprovalWithTimeout = async (
  provider: (request: ApprovalRequest, signal?: AbortSignal) => Promise<ApprovalDecision>,
  request: ApprovalRequest,
  signal?: AbortSignal
): Promise<ApprovalDecision> => {
  if (!request.timeoutMs || request.timeoutMs <= 0) return provider(request, signal);
  return Promise.race([
    provider(request, signal),
    delay(request.timeoutMs, signal).then(() => ({ approved: false, reason: 'Approval timed out.' })),
  ]);
};

/** Pull an array out of an object by path (`a.b`) for `control.loop` forEach. */
const extractArray = (input: unknown, itemsPath?: string): unknown[] => {
  if (Array.isArray(input)) return input;
  if (itemsPath && input != null && typeof input === 'object') {
    let cur: unknown = input;
    for (const part of itemsPath.split('.').filter(Boolean)) {
      if (cur == null || typeof cur !== 'object') return [];
      cur = (cur as Record<string, unknown>)[part];
    }
    return Array.isArray(cur) ? cur : [];
  }
  return [];
};

/** A `setTimeout` that rejects promptly if the signal aborts. */
const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, ms)
    );
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
