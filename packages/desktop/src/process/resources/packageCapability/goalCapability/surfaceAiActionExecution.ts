import { randomUUID } from 'node:crypto';

import type { OutcomeReceipt } from '@/common/foundation/receiptTypes';
import type { RunBudget, RunIntent } from '@/common/foundation/runTypes';
import type { PackageListing, SurfacePlanningStep } from '@/common/packages';
import type { FoundationCoreRuntime } from '@/process/bridge/foundationBridge';
import type { FoundationTrustRuntime, RunKernel } from '@/process/foundation/runKernel';
import type { SurfaceAiOperationDispatcher } from '../surfaceAiAccessBroker';

import {
  prepareReadyLocalSurfaceAiAction,
  type SurfaceAiActionReadiness,
  type SurfaceAiActionReadinessDeps,
} from './surfaceAiActionReadiness';
import {
  assertC4LocalSurfaceAiTarget,
  C4_LOCAL_SURFACE_AI_ORIGIN,
  type C4LocalSurfaceAiTarget,
  type C4LocalSurfaceAiTrust,
} from './surfaceAiActionTrust';
import {
  executeSurfaceAiOperationRun,
  type SurfaceAiOperationRunDeps,
  type SurfaceAiOperationRunRequest,
} from './surfaceAiOperationRun';

const MAX_GOAL_BYTES = 10 * 1024;

export type SurfaceAiActionExecutionErrorCode =
  | 'SURFACE_AI_ACTION_GOAL_INVALID'
  | 'SURFACE_AI_ACTION_STEP_INVALID'
  | 'SURFACE_AI_ACTION_SURFACE_UNAVAILABLE'
  | 'SURFACE_AI_ACTION_TARGET_UNAVAILABLE'
  | 'SURFACE_AI_ACTION_RUN_INVALID';

export class SurfaceAiActionExecutionError extends Error {
  public constructor(public readonly code: SurfaceAiActionExecutionErrorCode) {
    super(code);
    this.name = 'SurfaceAiActionExecutionError';
  }
}

export type C4LocalSurfaceAiActionTarget = C4LocalSurfaceAiTarget &
  Readonly<{
    modelKey?: string;
  }>;

export type SurfaceAiActionExecutionRequest = Readonly<{
  /** Main-cached user task text. There is deliberately no renderer IPC schema for this object. */
  goal: string;
  /** Main-authored C3 plan step, never a model-selected operation. */
  planStep: SurfacePlanningStep;
  /** Main consent authority ID returned by the separate exact Surface consent flow. */
  consentId: string;
  /** Opaque Main receipt that pins planning to the account's selected model. */
  modelSelectionReceipt: string;
  signal?: AbortSignal;
}>;

export type SurfaceAiActionExecutionResult = Readonly<{
  receipt: OutcomeReceipt;
  targetId?: string;
}>;

type ExecuteC4Run = (
  deps: SurfaceAiOperationRunDeps,
  request: SurfaceAiOperationRunRequest
) => Promise<Readonly<{ receipt: OutcomeReceipt; targetId?: string }>>;

export type SurfaceAiActionExecutionDeps = Readonly<{
  /** Main authority returns the currently online account; no UI value is admitted. */
  accountId: () => string;
  /** Reads fresh signed Store lifecycle state immediately before the action. */
  getInstalledListing: (packageId: string) => Promise<PackageListing | undefined>;
  readiness: SurfaceAiActionReadinessDeps;
  /** Resolves the exact account-selected local model target; no provider fallback is permitted. */
  resolveLocalTarget: (
    input: Readonly<{ accountId: string; expectedSelectionReceipt: string; signal?: AbortSignal }>
  ) => Promise<C4LocalSurfaceAiActionTarget | undefined>;
  /** Builds a dispatcher whose broker is exactly the shared Foundation authority. */
  createDispatcher: (
    input: Readonly<{ readiness: SurfaceAiActionReadiness; trust: C4LocalSurfaceAiTrust }>
  ) => Promise<SurfaceAiOperationDispatcher>;
  kernel: RunKernel;
  /** Main bootstrap authority shared by C4 preflight, target execution, and child dispatch. */
  trustRuntime: FoundationTrustRuntime;
  runtime: FoundationCoreRuntime;
  workspaceScope: () => string;
  budget: RunBudget;
  createRunId?: () => string;
  now?: () => number;
  /** Test/composition seam; production uses the governed C4 run implementation. */
  executeRun?: ExecuteC4Run;
}>;

const requireText = (value: unknown, code: SurfaceAiActionExecutionErrorCode, maximum = 200): string => {
  if (typeof value !== 'string') throw new SurfaceAiActionExecutionError(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new SurfaceAiActionExecutionError(code);
  return normalized;
};

const requireGoal = (value: unknown): string => {
  const goal = requireText(value, 'SURFACE_AI_ACTION_GOAL_INVALID', MAX_GOAL_BYTES);
  if (Buffer.byteLength(goal, 'utf8') > MAX_GOAL_BYTES)
    throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_GOAL_INVALID');
  return goal;
};

const selectedPackageId = (step: SurfacePlanningStep): string => {
  if (step.kind !== 'execute-local') throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_STEP_INVALID');
  return requireText(step.candidate.package.packageId, 'SURFACE_AI_ACTION_STEP_INVALID');
};

const createParentIntent = (
  input: Readonly<{
    runId: string;
    goal: string;
    accountId: string;
    targetId: string;
    workspaceScope: string;
    policyVersion: string;
    budget: RunBudget;
    readiness: SurfaceAiActionReadiness;
    createdAt: number;
  }>
): RunIntent => {
  const capability = `surface.ai:${input.readiness.selection.surface.packageId}:${input.readiness.selection.operation.id}`;
  return {
    runId: input.runId,
    rootTaskId: `surface-ai:${input.runId}`,
    surface: 'hub-surface-ai-action',
    goal: input.goal,
    constraints: ['offline_only', 'private_only', `target:${input.targetId}`],
    successCriteria: ['one verified declared local Surface operation completes'],
    workspaceScope: input.workspaceScope,
    userId: input.accountId,
    createdAt: input.createdAt,
    correlationId: input.runId,
    policyVersion: input.policyVersion,
    capabilityGrant: ['target.execute', capability],
    budget: input.budget,
  };
};

/**
 * Main-only C4 action composition. It has no IPC registration: a future
 * account-gated action controller must supply a cached C3 step and an exact
 * consent ID. This boundary never installs, purchases, selects a package,
 * accepts a renderer model target, or enables a cloud Surface placement.
 */
export const executeReadyLocalSurfaceAiAction = async (
  deps: SurfaceAiActionExecutionDeps,
  request: SurfaceAiActionExecutionRequest
): Promise<SurfaceAiActionExecutionResult> => {
  const goal = requireGoal(request.goal);
  if (request.signal?.aborted) throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_RUN_INVALID');
  const accountId = requireText(deps.accountId(), 'SURFACE_AI_ACTION_RUN_INVALID');
  const packageId = selectedPackageId(request.planStep);
  const listing = await deps.getInstalledListing(packageId);
  if (listing === undefined) throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_SURFACE_UNAVAILABLE');

  const readiness = await prepareReadyLocalSurfaceAiAction(deps.readiness, {
    planStep: request.planStep,
    installedListing: listing,
    accountId,
    consentId: requireText(request.consentId, 'SURFACE_AI_ACTION_RUN_INVALID'),
  });
  const target = await deps.resolveLocalTarget({
    accountId,
    expectedSelectionReceipt: requireText(request.modelSelectionReceipt, 'SURFACE_AI_ACTION_TARGET_UNAVAILABLE'),
    signal: request.signal,
  });
  if (target === undefined || target.kind !== 'local' || request.signal?.aborted) {
    throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_TARGET_UNAVAILABLE');
  }
  try {
    assertC4LocalSurfaceAiTarget(target);
  } catch {
    throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_TARGET_UNAVAILABLE');
  }

  const runId = requireText(deps.createRunId?.() ?? `surface-ai:${randomUUID()}`, 'SURFACE_AI_ACTION_RUN_INVALID');
  const policyVersion = requireText(deps.trustRuntime.policyVersion, 'SURFACE_AI_ACTION_RUN_INVALID');
  const workspaceScope = requireText(deps.workspaceScope(), 'SURFACE_AI_ACTION_RUN_INVALID', MAX_GOAL_BYTES);
  const createdAt = deps.now?.() ?? Date.now();
  if (!Number.isSafeInteger(createdAt) || createdAt < 0)
    throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_RUN_INVALID');

  const parentIntent = createParentIntent({
    runId,
    goal,
    accountId,
    targetId: target.targetId,
    workspaceScope,
    policyVersion,
    budget: deps.budget,
    readiness,
    createdAt,
  });
  // The runtime's broker is shared by preflight, the outer target, and the one
  // exact Surface child. C4 cannot construct a parallel compatibility broker.
  const trust: C4LocalSurfaceAiTrust = Object.freeze({
    origin: C4_LOCAL_SURFACE_AI_ORIGIN,
    trustBroker: deps.trustRuntime.trustBroker,
  });
  const dispatcher = await deps.createDispatcher({ readiness, trust });
  const executeRun = deps.executeRun ?? executeSurfaceAiOperationRun;
  const terminal = await executeRun(
    { kernel: deps.kernel, runtime: deps.runtime, dispatcher, trustRuntime: deps.trustRuntime },
    {
      targetId: target.targetId,
      ...(target.modelKey === undefined ? {} : { modelKey: target.modelKey }),
      signal: request.signal,
      session: {
        operation: {
          consentId: readiness.consent.consentId,
          accountId,
          surface: readiness.selection.surface,
          runtime: { ownerId: readiness.runtime.ownerId, runtimeId: readiness.runtime.runtimeId },
          placement: 'local',
          operationId: readiness.selection.operation.id,
          dataClasses: readiness.selection.operation.dataClasses,
          destinationIds: readiness.selection.operation.destinationIds,
          secretUse: false,
          parentIntent,
          budget: deps.budget,
        },
      },
    }
  );
  return Object.freeze({
    receipt: terminal.receipt,
    ...(terminal.targetId === undefined ? {} : { targetId: terminal.targetId }),
  });
};
