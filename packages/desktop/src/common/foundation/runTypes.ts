export const FOUNDATION_SCHEMA_VERSION = 1 as const;

export type RunIntent = {
  runId: string;
  rootTaskId: string;
  surface: string;
  goal: string;
  constraints: readonly string[];
  successCriteria: readonly string[];
  workspaceScope: string;
  userId: string;
  createdAt: number;
  correlationId: string;
  policyVersion: string;
  parentRunId?: string;
  capabilityGrant?: readonly string[];
  budget?: RunBudget;
};

export type RunBudget = {
  maxEstimatedCostMB: number;
  maxSteps: number;
};

export type TaskRef = {
  taskId: string;
  runId: string;
  parentTaskId?: string;
  idempotencyKey: string;
};

export type AttemptRef = {
  attemptId: string;
  taskId: string;
  ordinal: number;
  idempotencyKey: string;
};

const NON_EMPTY = /^[^\s].*$/;

export const assertRunIntent = (intent: RunIntent): RunIntent => {
  const required = [
    ['runId', intent.runId],
    ['rootTaskId', intent.rootTaskId],
    ['surface', intent.surface],
    ['goal', intent.goal],
    ['workspaceScope', intent.workspaceScope],
    ['userId', intent.userId],
    ['correlationId', intent.correlationId],
    ['policyVersion', intent.policyVersion],
  ] as const;
  for (const [name, value] of required) {
    if (!NON_EMPTY.test(value)) throw new Error(`Invalid RunIntent ${name}.`);
  }
  if (!Number.isSafeInteger(intent.createdAt) || intent.createdAt < 0) {
    throw new Error('Invalid RunIntent createdAt.');
  }
  if (intent.parentRunId !== undefined && !NON_EMPTY.test(intent.parentRunId)) {
    throw new Error('Invalid RunIntent parentRunId.');
  }
  if (
    intent.capabilityGrant !== undefined &&
    intent.capabilityGrant.some((capability) => !NON_EMPTY.test(capability))
  ) {
    throw new Error('Invalid RunIntent capabilityGrant.');
  }
  if (intent.budget !== undefined) {
    if (!Number.isSafeInteger(intent.budget.maxEstimatedCostMB) || intent.budget.maxEstimatedCostMB < 1) {
      throw new Error('Invalid RunIntent budget maxEstimatedCostMB.');
    }
    if (!Number.isSafeInteger(intent.budget.maxSteps) || intent.budget.maxSteps < 1) {
      throw new Error('Invalid RunIntent budget maxSteps.');
    }
  }
  return intent;
};

/** Rejects a child run that could expand its parent's authority or budget. */
export const assertDelegatedRunIntent = (parent: RunIntent, child: RunIntent): RunIntent => {
  assertRunIntent(parent);
  assertRunIntent(child);
  if (child.parentRunId !== parent.runId) throw new Error('Delegated run must identify its parent run.');
  if (parent.capabilityGrant === undefined || child.capabilityGrant === undefined) {
    throw new Error('Delegated runs require explicit capability grants.');
  }
  if (parent.budget === undefined || child.budget === undefined) {
    throw new Error('Delegated runs require explicit budgets.');
  }
  const parentCapabilities = new Set(parent.capabilityGrant);
  if (child.capabilityGrant.some((capability) => !parentCapabilities.has(capability))) {
    throw new Error('Delegated run cannot amplify capabilities.');
  }
  if (
    child.budget.maxEstimatedCostMB > parent.budget.maxEstimatedCostMB ||
    child.budget.maxSteps > parent.budget.maxSteps
  ) {
    throw new Error('Delegated run cannot amplify budget.');
  }
  return child;
};

export const createIdempotencyKey = (runId: string, taskId: string, ordinal: number): string => {
  if (!NON_EMPTY.test(runId) || !NON_EMPTY.test(taskId) || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new Error('Invalid idempotency key input.');
  }
  return `${runId}:${taskId}:${ordinal}`;
};
