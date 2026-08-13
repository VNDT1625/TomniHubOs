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
  return intent;
};

export const createIdempotencyKey = (runId: string, taskId: string, ordinal: number): string => {
  if (!NON_EMPTY.test(runId) || !NON_EMPTY.test(taskId) || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new Error('Invalid idempotency key input.');
  }
  return `${runId}:${taskId}:${ordinal}`;
};
