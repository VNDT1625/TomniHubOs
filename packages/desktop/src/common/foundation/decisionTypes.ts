import type { RunIntent, TaskRef } from './runTypes';

export type PolicyDecision = {
  decision: 'allow' | 'deny' | 'approval_required';
  runId: string;
  taskId: string;
  targetId?: string;
  capabilities: readonly string[];
  expiresAt?: number;
  reasonCode: string;
  receiptId: string;
};

export type ContextProjection = {
  runId: string;
  surface: string;
  text: string;
  sourceRefs: readonly string[];
  maxChars: number;
  sensitivity: 'normal' | 'restricted';
};

export type WorkGraphProjection = {
  runId: string;
  task: TaskRef;
  goal: string;
  constraints: readonly string[];
  successCriteria: readonly string[];
  artifactRefs: readonly string[];
};

export type CandidateFactor = Readonly<Record<string, number>>;
export type SelectionCandidate = { id: string; factors: CandidateFactor };
export type SelectionDecision = {
  runId: string;
  taskId: string;
  selectedId?: string;
  candidates: readonly SelectionCandidate[];
  filtered: readonly { id: string; reasonCode: string }[];
  explanation: string;
  retryable: boolean;
  receiptId: string;
};

export type ExecutionPlan = {
  runId: string;
  taskId: string;
  candidateId: string;
  resourceKind: string;
  estimatedCostMB: number;
  priority: number;
};

export const createRunIntentProjection = (intent: RunIntent): Pick<RunIntent, 'runId' | 'surface' | 'goal'> => ({
  runId: intent.runId,
  surface: intent.surface,
  goal: intent.goal,
});

export const isPolicyAllowed = (decision: PolicyDecision): boolean => decision.decision === 'allow';

export const validateExecutionPlan = (plan: ExecutionPlan): ExecutionPlan => {
  if (!plan.runId || !plan.taskId || !plan.candidateId || !plan.resourceKind) {
    throw new Error('Execution plan is missing required identity.');
  }
  if (!Number.isFinite(plan.estimatedCostMB) || plan.estimatedCostMB < 0) {
    throw new Error('Execution plan has invalid estimated cost.');
  }
  if (!Number.isFinite(plan.priority)) throw new Error('Execution plan has invalid priority.');
  return plan;
};
