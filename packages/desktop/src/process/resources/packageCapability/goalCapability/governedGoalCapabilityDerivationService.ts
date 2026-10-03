import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { parseCapabilityQuery, type CapabilityQuery, type PackageIdentity } from '@/common/packages';
import type { FoundationTrustRuntime, RunKernel } from '@/process/foundation/runKernel';
import { executeFoundationHubRun, type FoundationCoreRuntime } from '@/process/bridge/foundationBridge';
import type { ExperimentalCoreModel } from '@/process/experimentalCore/experimentalCoreProtocol';
import type { AccountSessionService } from '@/process/services/security/accountSession/accountSessionService';
import type {
  AccountHubModelSelection,
  AccountModelSelectionVault,
} from '@/process/services/security/accountSession/accountModelSelectionVault';
import type { GoalCapabilityDeriver } from '../goalSurfacePlanningCoordinator';

import {
  isCapabilityDerivationInput,
  MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES,
  parseCapabilityDerivationOutput,
  validateCapabilityDerivationOutput,
  type CapabilityDerivationRequirement,
} from '../capabilityDerivationContract';

const OPERATION_PURPOSE = 'capability-derivation';
/** Exact Main-only origin for sterile Hub capability derivation. */
export const GOAL_CAPABILITY_DERIVATION_ORIGIN = 'tomny://hub-capability-derivation';
const DEFAULT_DEADLINE_MS = 10_000;
const MAX_DEADLINE_MS = 30_000;
const MAX_ID_LENGTH = 200;

export type GovernedGoalCapabilityDerivationErrorCode =
  | 'GOAL_CAPABILITY_REQUEST_INVALID'
  | 'GOAL_CAPABILITY_TARGET_UNAVAILABLE'
  | 'GOAL_CAPABILITY_TARGET_DRIFT'
  | 'GOAL_CAPABILITY_EXECUTOR_FAILED'
  | 'GOAL_CAPABILITY_OUTPUT_INVALID'
  | 'GOAL_CAPABILITY_OUTPUT_ECHOED';

export class GovernedGoalCapabilityDerivationError extends Error {
  constructor(readonly code: GovernedGoalCapabilityDerivationErrorCode) {
    super(code);
    this.name = 'GovernedGoalCapabilityDerivationError';
  }
}

type MainGoalCapabilityDerivationInput = Readonly<{
  requestId: string;
  goal: string;
  requestedAt: string;
  accountId: string;
}>;

type PinnedDerivationTarget = Readonly<{
  targetId: string;
  modelId: string;
  selectionReceiptId: string;
}>;

type TargetExecutionResult = Readonly<{
  targetId: string;
  modelId: string;
  executionReceiptId: string;
  text: string;
}>;

export type GovernedGoalCapabilityDerivationResult = Readonly<{
  goalDigest: string;
  requirements: readonly CapabilityDerivationRequirement[];
  targetId: string;
  selectionReceiptId: string;
  executionReceiptId: string;
}>;

export type GovernedGoalCapabilityDerivationService = Readonly<{
  /** Only Main-created, exact-shape input is admitted at this private boundary. */
  derive: (input: unknown) => Promise<GovernedGoalCapabilityDerivationResult>;
}>;

export type GovernedGoalCapabilityDeriverOptions = Readonly<{
  /** Must obtain the already-validated Main account subject; renderer never provides it. */
  accountId: () => string;
  /** Fixed Hub identity; model output cannot supply the requester. */
  hubIdentity: PackageIdentity;
  createQueryId: (input: CapabilityDerivationInput, requirementIndex: number) => string;
  createIdempotencyKey: (input: CapabilityDerivationInput, requirementIndex: number) => string;
}>;

type CapabilityDerivationInput = Readonly<{
  requestId: string;
  goal: string;
  requestedAt: string;
}>;

export type GovernedGoalCapabilityDerivationServiceDeps = Readonly<{
  /**
   * The Foundation/Trust target-selection seam. It is composed from desktop
   * bootstrap only; renderer and package code cannot construct or replace it.
   */
  resolveTarget: (
    input: Readonly<{
      accountId: string;
      purpose: typeof OPERATION_PURPOSE;
      deadlineAt: number;
      maxOutputBytes: typeof MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES;
      /** Aborts at the Main-owned deadline; resolver must not continue selection. */
      signal?: AbortSignal;
    }>
  ) => Promise<PinnedDerivationTarget | undefined>;
  /**
   * The eventual Foundation/Trust execution seam. It receives a pinned target
   * and an intentionally sterile prompt; it has no capability, package,
   * secret, profile, history, install, purchase, or execution authority.
   */
  execute: (
    input: Readonly<{
      target: PinnedDerivationTarget;
      prompt: string;
      purpose: typeof OPERATION_PURPOSE;
      deadlineAt: number;
      maxOutputBytes: typeof MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES;
      /** Aborts at the Main-owned deadline; executor must release its Run lease. */
      signal?: AbortSignal;
    }>
  ) => Promise<TargetExecutionResult>;
  now?: () => number;
  deadlineMs?: number;
}>;

const isPlainDataObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) && Object.getOwnPropertySymbols(value).length === 0;
  } catch {
    return false;
  }
};

const hasExactDataKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  try {
    const actual = Object.getOwnPropertyNames(value);
    return (
      actual.length === expected.length &&
      actual.every((key) => expected.includes(key)) &&
      actual.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
      })
    );
  } catch {
    return false;
  }
};

const isBoundedText = (value: unknown, maximum = MAX_ID_LENGTH): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

const parseMainInput = (value: unknown): MainGoalCapabilityDerivationInput => {
  if (!isPlainDataObject(value) || !hasExactDataKeys(value, ['requestId', 'goal', 'requestedAt', 'accountId'])) {
    throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_REQUEST_INVALID');
  }
  if (
    !isBoundedText(value.requestId) ||
    !isBoundedText(value.accountId) ||
    !isBoundedText(value.goal, 10_000) ||
    !isBoundedText(value.requestedAt, 64) ||
    !Number.isFinite(Date.parse(value.requestedAt))
  ) {
    throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_REQUEST_INVALID');
  }
  return {
    requestId: value.requestId,
    goal: value.goal,
    requestedAt: value.requestedAt,
    accountId: value.accountId,
  };
};

const isPinnedTarget = (value: unknown): value is PinnedDerivationTarget =>
  isPlainDataObject(value) &&
  hasExactDataKeys(value, ['targetId', 'modelId', 'selectionReceiptId']) &&
  isBoundedText(value.targetId) &&
  isBoundedText(value.modelId) &&
  isBoundedText(value.selectionReceiptId);

const isTargetExecutionResult = (value: unknown): value is TargetExecutionResult =>
  isPlainDataObject(value) &&
  hasExactDataKeys(value, ['targetId', 'modelId', 'executionReceiptId', 'text']) &&
  isBoundedText(value.targetId) &&
  isBoundedText(value.modelId) &&
  isBoundedText(value.executionReceiptId) &&
  typeof value.text === 'string';

const createSterilePrompt = (goal: string): string =>
  JSON.stringify({
    instruction:
      'Derive the minimum capability requirements for the goal. Return exactly one JSON object matching tomny.capability-derivation.output.v1. Do not explain, quote, restate, or preserve the goal.',
    outputSchema: {
      schema: 'tomny.capability-derivation.output.v1',
      requirements: [
        {
          capability: 'bounded capability identifier',
          dataLocation: 'local-only | region-bound | remote-allowed',
          requireUi: 'boolean',
          requireOffline: 'boolean',
        },
      ],
    },
    goal,
  });

const awaitUntilDeadline = async <Value>(
  operation: Promise<Value>,
  deadlineAt: number,
  code: GovernedGoalCapabilityDerivationErrorCode,
  now: () => number
): Promise<Value> => {
  const remainingMs = deadlineAt - now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) throw new GovernedGoalCapabilityDerivationError(code);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new GovernedGoalCapabilityDerivationError(code)), remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const withDeadlineSignal = async <Value>(
  deadlineAt: number,
  now: () => number,
  operation: (signal: AbortSignal) => Promise<Value>
): Promise<Value> => {
  const remainingMs = deadlineAt - now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_EXECUTOR_FAILED');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remainingMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * C3's Main-only, side-effect-free derivation boundary. It chooses no target,
 * does not fall back between local/cloud targets, and cannot execute/install/
 * purchase anything. Foundation and Trust must inject the already-governed
 * resolver and executor when this atom is production-wired in a later step.
 */
export const createGovernedGoalCapabilityDerivationService = (
  deps: GovernedGoalCapabilityDerivationServiceDeps
): GovernedGoalCapabilityDerivationService => {
  const now = deps.now ?? Date.now;
  const deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_DEADLINE_MS) {
    throw new Error('GOAL_CAPABILITY_SERVICE_CONFIGURATION_INVALID');
  }

  return {
    derive: async (rawInput) => {
      const input = parseMainInput(rawInput);
      const deadlineAt = now() + deadlineMs;
      return withDeadlineSignal(deadlineAt, now, async (signal) => {
        let target: PinnedDerivationTarget | undefined;
        try {
          target = await awaitUntilDeadline(
            deps.resolveTarget({
              accountId: input.accountId,
              purpose: OPERATION_PURPOSE,
              deadlineAt,
              maxOutputBytes: MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES,
              signal,
            }),
            deadlineAt,
            'GOAL_CAPABILITY_TARGET_UNAVAILABLE',
            now
          );
        } catch {
          throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_TARGET_UNAVAILABLE');
        }
        if (!isPinnedTarget(target))
          throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_TARGET_UNAVAILABLE');

        let execution: TargetExecutionResult;
        try {
          execution = await awaitUntilDeadline(
            deps.execute({
              target,
              prompt: createSterilePrompt(input.goal),
              purpose: OPERATION_PURPOSE,
              deadlineAt,
              maxOutputBytes: MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES,
              signal,
            }),
            deadlineAt,
            'GOAL_CAPABILITY_EXECUTOR_FAILED',
            now
          );
        } catch {
          throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_EXECUTOR_FAILED');
        }
        if (!isTargetExecutionResult(execution)) {
          throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_EXECUTOR_FAILED');
        }
        if (execution.targetId !== target.targetId || execution.modelId !== target.modelId) {
          throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_TARGET_DRIFT');
        }
        if (Buffer.byteLength(execution.text, 'utf8') > MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES) {
          throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_OUTPUT_INVALID');
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(execution.text) as unknown;
        } catch {
          throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_OUTPUT_INVALID');
        }
        if (!parseCapabilityDerivationOutput(parsed)) {
          throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_OUTPUT_INVALID');
        }
        const validated = validateCapabilityDerivationOutput(parsed, {
          goal: input.goal,
          maxOutputBytes: MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES,
        });
        if (!validated) throw new GovernedGoalCapabilityDerivationError('GOAL_CAPABILITY_OUTPUT_ECHOED');

        return {
          goalDigest: `sha256-${createHash('sha256').update(input.goal, 'utf8').digest('hex')}`,
          requirements: validated.requirements,
          targetId: target.targetId,
          selectionReceiptId: target.selectionReceiptId,
          executionReceiptId: execution.executionReceiptId,
        };
      });
    },
  };
};

/**
 * Adapts the governed service to the existing Store-planning coordinator. It
 * only produces Main-owned queries; it cannot perform any Package mutation.
 */
export const createGovernedGoalCapabilityDeriver = (
  service: GovernedGoalCapabilityDerivationService,
  options: GovernedGoalCapabilityDeriverOptions
): GoalCapabilityDeriver => ({
  async derive(input): Promise<unknown> {
    if (!isCapabilityDerivationInput(input)) return [];
    const accountId = options.accountId();
    if (!isBoundedText(accountId)) return [];
    try {
      const result = await service.derive({ ...input, accountId });
      return result.requirements.map(
        (requirement, requirementIndex): CapabilityQuery =>
          parseCapabilityQuery({
            schemaVersion: 1,
            queryId: options.createQueryId(input, requirementIndex),
            requester: options.hubIdentity,
            capability: requirement.capability,
            purpose: `Capability requirement: ${requirement.capability}`,
            dataLocation: requirement.dataLocation,
            requireUi: requirement.requireUi,
            requireOffline: requirement.requireOffline,
            idempotencyKey: options.createIdempotencyKey(input, requirementIndex),
          })
      );
    } catch {
      return [];
    }
  },
});

type SelectedGoalCapabilityRuntime = FoundationCoreRuntime & {
  listModels: (targetId: string, workspace: string) => Promise<readonly ExperimentalCoreModel[]>;
};

export type AccountSelectedGoalCapabilityExecutorDeps = Readonly<{
  /** Main-owned online identity; callers cannot provide or replace this account. */
  accountSession: Pick<AccountSessionService, 'requireOnlineSession'>;
  selectionVault: Pick<AccountModelSelectionVault, 'load'>;
  runtime: SelectedGoalCapabilityRuntime;
  workspace: () => string;
  /** Shared Main composition; no derivation-specific broker or fallback is allowed. */
  trustRuntime: FoundationTrustRuntime;
  /** Durable kernel already bound to `trustRuntime` by Main bootstrap. */
  kernel: RunKernel;
  createRunId?: () => string;
  now?: () => number;
}>;

export const accountModelSelectionReceipt = (selection: AccountHubModelSelection): string =>
  `model-selection:sha256-${createHash('sha256')
    .update(
      `${selection.accountId}\u0000${selection.targetId}\u0000${selection.modelKey}\u0000${selection.updatedAt}`,
      'utf8'
    )
    .digest('hex')}`;

const selectionMatchesTarget = (
  selection: AccountHubModelSelection | undefined,
  accountId: string,
  target: PinnedDerivationTarget
): selection is AccountHubModelSelection =>
  selection !== undefined &&
  selection.accountId === accountId &&
  selection.targetId === target.targetId &&
  selection.modelKey === target.modelId &&
  accountModelSelectionReceipt(selection) === target.selectionReceiptId;

export type AccountSelectedLocalSurfaceAiTarget = Readonly<{
  targetId: string;
  kind: 'local';
  modelKey: string;
  networkHost?: string;
}>;

export type AccountSelectedLocalSurfaceAiTargetResolver = (
  input: Readonly<{ accountId: string; expectedSelectionReceipt: string; signal?: AbortSignal }>
) => Promise<AccountSelectedLocalSurfaceAiTarget | undefined>;

/**
 * Resolves the same Main-owned account selection for C4, but only if it still
 * names one available local target and the cached planning receipt matches.
 * It never falls back to a cloud/CLI target or lets a renderer choose a model.
 */
export const createAccountSelectedLocalSurfaceAiTargetResolver = (
  deps: Pick<AccountSelectedGoalCapabilityExecutorDeps, 'accountSession' | 'selectionVault' | 'runtime' | 'workspace'>
): AccountSelectedLocalSurfaceAiTargetResolver => {
  const workspace = deps.workspace();
  if (!path.isAbsolute(workspace)) throw new Error('SURFACE_AI_ACTION_WORKSPACE_INVALID');
  return async ({ accountId, expectedSelectionReceipt, signal }) => {
    const session = deps.accountSession.requireOnlineSession();
    if (session.accountId !== accountId || signal?.aborted) return undefined;
    const selection = await deps.selectionVault.load(session.accountId);
    if (
      selection === undefined ||
      accountModelSelectionReceipt(selection) !== expectedSelectionReceipt ||
      signal?.aborted
    ) {
      return undefined;
    }
    const targets = await deps.runtime.listTargets();
    const target = targets.find((candidate) => candidate.id === selection.targetId && candidate.available);
    if (target === undefined || target.kind !== 'local' || signal?.aborted) return undefined;
    const models = await deps.runtime.listModels(target.id, workspace);
    if (!models.some((model) => model.key === selection.modelKey) || signal?.aborted) return undefined;
    const networkHost = await deps.runtime.resolveNetworkHost?.(target.id, selection.modelKey);
    if (signal?.aborted) return undefined;
    return Object.freeze({
      targetId: target.id,
      kind: 'local' as const,
      modelKey: selection.modelKey,
      ...(networkHost === undefined ? {} : { networkHost }),
    });
  };
};

/**
 * Creates the Main-only Foundation/Trust executor for the model that the
 * authenticated account previously selected. It never picks a provider,
 * accepts a renderer target/model, loads user context, or falls back to a
 * different model. The caller still owns the narrow goal-planning IPC.
 */
export const createAccountSelectedGoalCapabilityExecutor = (
  deps: AccountSelectedGoalCapabilityExecutorDeps
): Pick<GovernedGoalCapabilityDerivationServiceDeps, 'resolveTarget' | 'execute'> => {
  const now = deps.now ?? Date.now;
  const workspace = deps.workspace();
  if (!path.isAbsolute(workspace)) throw new Error('GOAL_CAPABILITY_WORKSPACE_INVALID');

  const resolveTarget: GovernedGoalCapabilityDerivationServiceDeps['resolveTarget'] = async (input) => {
    const session = deps.accountSession.requireOnlineSession();
    if (session.accountId !== input.accountId || input.signal?.aborted) return undefined;
    const selection = await deps.selectionVault.load(session.accountId);
    if (selection === undefined || input.signal?.aborted) return undefined;
    const targets = await deps.runtime.listTargets();
    const target = targets.find((candidate) => candidate.id === selection.targetId && candidate.available);
    if (target === undefined || input.signal?.aborted) return undefined;
    const models = await deps.runtime.listModels(target.id, workspace);
    if (!models.some((model) => model.key === selection.modelKey) || input.signal?.aborted) return undefined;
    return {
      targetId: target.id,
      modelId: selection.modelKey,
      selectionReceiptId: accountModelSelectionReceipt(selection),
    };
  };

  const execute: GovernedGoalCapabilityDerivationServiceDeps['execute'] = async (input) => {
    const session = deps.accountSession.requireOnlineSession();
    if (input.signal?.aborted) throw new Error('GOAL_CAPABILITY_EXECUTION_ABORTED');
    const selection = await deps.selectionVault.load(session.accountId);
    if (!selectionMatchesTarget(selection, session.accountId, input.target) || input.signal?.aborted) {
      throw new Error('GOAL_CAPABILITY_SELECTION_CHANGED');
    }
    // Resolution and execution are separate awaited operations. Re-check the exact
    // target/model and encrypted account selection immediately before opening the
    // Foundation Run so a stale selection can never silently fall through.
    const targets = await deps.runtime.listTargets();
    const activeTarget = targets.find((candidate) => candidate.id === input.target.targetId && candidate.available);
    if (activeTarget === undefined || input.signal?.aborted) {
      throw new Error('GOAL_CAPABILITY_TARGET_CHANGED');
    }
    const models = await deps.runtime.listModels(activeTarget.id, workspace);
    if (!models.some((model) => model.key === input.target.modelId) || input.signal?.aborted) {
      throw new Error('GOAL_CAPABILITY_MODEL_CHANGED');
    }
    const currentSession = deps.accountSession.requireOnlineSession();
    const currentSelection = await deps.selectionVault.load(currentSession.accountId);
    if (
      currentSession.accountId !== session.accountId ||
      !selectionMatchesTarget(currentSelection, currentSession.accountId, input.target) ||
      input.signal?.aborted
    ) {
      throw new Error('GOAL_CAPABILITY_SELECTION_CHANGED');
    }
    const runId = deps.createRunId?.() ?? `goal-capability:${randomUUID()}`;
    const terminal = await executeFoundationHubRun(
      deps.kernel,
      deps.runtime,
      {
        runId,
        rootTaskId: `goal-capability:${runId}`,
        surface: 'hub-capability-derivation',
        goal: input.prompt,
        constraints: [`target:${input.target.targetId}`, 'derivation.no-tools', 'derivation.no-personal-context'],
        successCriteria: ['strict capability-derivation JSON'],
        workspaceScope: workspace,
        userId: session.accountId,
        createdAt: now(),
        correlationId: runId,
        // Policy comes only from the shared Main runtime; it is never renderer-selected.
        policyVersion: deps.trustRuntime.policyVersion,
        capabilityGrant: ['target.execute'],
        budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
      },
      GOAL_CAPABILITY_DERIVATION_ORIGIN,
      input.signal,
      {
        trustRuntime: deps.trustRuntime,
        requestId: runId,
        modelKey: input.target.modelId,
        allowedTargetIds: [input.target.targetId],
        permissionMode: 'read-only',
        contextIdentity: {
          surface: 'hub-capability-derivation',
          agentId: 'tomny',
          sterile: true,
        },
      }
    );
    if (
      terminal.receipt.status !== 'verified' ||
      terminal.targetId !== input.target.targetId ||
      typeof terminal.text !== 'string'
    ) {
      throw new Error('GOAL_CAPABILITY_EXECUTION_NOT_VERIFIED');
    }
    return {
      targetId: input.target.targetId,
      modelId: input.target.modelId,
      executionReceiptId: terminal.receipt.receiptId,
      text: terminal.text,
    };
  };
  return { resolveTarget, execute };
};
