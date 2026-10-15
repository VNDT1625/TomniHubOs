/**
 * Session-owned Workflow Mailbox with one early error checkpoint, ordered
 * events and resumable repair subplans. Events never spawn model turns.
 * Scope is enforced at the Main runtime's per-session MCP host boundary.
 */
import type { WorkflowRunResult, WorkflowToolResult } from '../workflowEngine';
import type { WorkflowResultStore } from './resultDelivery';

const MAX_JOBS = 16;
const MAX_EVENTS = 160;
const TTL_MS = 10 * 60_000;

export type WorkflowMailboxEvent = Readonly<{
  sequence: number;
  stepId: string;
  tool: string;
  status: WorkflowToolResult['status'];
  timestamp: number;
  error?: string;
  resultRef?: string;
  outputChars?: number;
  retrievalError?: string;
}>;

export type WorkflowMailboxSnapshot = Readonly<{
  workflowId: string;
  status: 'running' | 'needs_agent' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  cursor: number;
  events: WorkflowMailboxEvent[];
  hasMore: boolean;
  startedAt: number;
  finishedAt?: number;
}>;

type LiveJob = {
  id: string;
  status: WorkflowMailboxSnapshot['status'];
  cursor: number;
  ackCursor: number;
  events: WorkflowMailboxEvent[];
  knownSteps: Set<string>;
  owners: Set<string>;
  repaired: boolean;
  startedAt: number;
  finishedAt?: number;
  firstError?: (value: WorkflowMailboxSnapshot) => void;
  terminals: Promise<void>[];
  activeRuns: number;
  hasErrors: boolean;
  cancelled: boolean;
};

const snapshot = (job: LiveJob, after = 0, limit = 40): WorkflowMailboxSnapshot => {
  if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 80) {
    throw new Error('WORKFLOW_MAILBOX_CURSOR_INVALID');
  }
  const newer = job.events.filter((event) => event.sequence > after);
  const events = newer.slice(0, limit);
  return {
    workflowId: job.id,
    status: job.status,
    cursor: events.at(-1)?.sequence ?? after,
    events,
    hasMore: newer.length > events.length,
    startedAt: job.startedAt,
    ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
  };
};

export const createWorkflowMailbox = (store: WorkflowResultStore, now: () => number = Date.now) => {
  const jobs = new Map<string, LiveJob>();
  const cleanup = (): void => {
    for (const [id, job] of jobs) {
      if (job.finishedAt !== undefined && now() - job.finishedAt > TTL_MS) jobs.delete(id);
    }
  };
  const get = (id: string): LiveJob => {
    cleanup();
    const job = jobs.get(id);
    if (!job) throw new Error('WORKFLOW_MAILBOX_NOT_FOUND');
    return job;
  };
  const createHandle = (job: LiveJob) => ({
    reserveSteps: (ids: readonly string[]): void => {
      const unique = new Set(ids);
      if (unique.size !== ids.length || ids.some((id) => job.knownSteps.has(id))) {
        throw new Error('WORKFLOW_RESUME_STEP_CONFLICT');
      }
      ids.forEach((id) => job.knownSteps.add(id));
    },
    onStepSettled: (result: WorkflowToolResult): void => {
      if (job.cancelled) return;
      let resultRef: string | undefined;
      let outputChars: number | undefined;
      let retrievalError: string | undefined;
      if (result.output !== undefined) {
        try {
          const ref = store.put(`${job.id}:${result.id}`, result.output);
          resultRef = ref.ref;
          outputChars = ref.sizeChars;
        } catch (error) {
          retrievalError = error instanceof Error ? error.message : 'WORKFLOW_RESULT_STORE_FAILED';
        }
      }
      const event: WorkflowMailboxEvent = {
        sequence: ++job.cursor,
        stepId: result.id,
        tool: result.tool,
        status: result.status,
        timestamp: now(),
        ...(result.error ? { error: result.error.slice(0, 800) } : {}),
        ...(resultRef ? { resultRef, outputChars } : {}),
        ...(retrievalError ? { retrievalError } : {}),
      };
      job.events.push(event);
      if (job.events.length > MAX_EVENTS) job.events.shift();
      if (result.status === 'failed') {
        job.hasErrors = true;
        if (job.status === 'running') {
          job.status = 'needs_agent';
          job.firstError?.(snapshot(job));
          job.firstError = undefined;
        }
      }
    },
    checkpoint: (): Promise<WorkflowMailboxSnapshot> =>
      job.status !== 'running'
        ? Promise.resolve(snapshot(job))
        : new Promise((resolve) => {
            job.firstError = resolve;
          }),
    complete: (result: WorkflowRunResult, isRepair = false): void => {
      if (isRepair && result.status === 'completed') job.repaired = true;
      job.activeRuns = Math.max(0, job.activeRuns - 1);
      if (job.cancelled || result.status === 'cancelled') job.status = 'cancelled';
      else if (result.status === 'failed') {
        job.hasErrors = true;
        job.status = job.repaired && job.activeRuns === 0 ? 'completed_with_errors' : 'needs_agent';
      } else if (job.activeRuns > 0) {
        job.status = job.hasErrors ? 'needs_agent' : 'running';
      } else job.status = job.hasErrors ? 'completed_with_errors' : 'completed';
      if (job.activeRuns === 0) job.finishedAt = now();
      job.firstError?.(snapshot(job));
      job.firstError = undefined;
    },
    cancel: (): void => {
      job.activeRuns = Math.max(0, job.activeRuns - 1);
      job.cancelled = true;
      job.status = 'cancelled';
      job.finishedAt = now();
      job.firstError?.(snapshot(job));
      job.firstError = undefined;
    },
    setTerminal: (promise: Promise<void>): void => {
      job.terminals.push(promise);
    },
  });
  return {
    create: (id: string, owner = 'local') => {
      cleanup();
      if (jobs.has(id)) throw new Error('WORKFLOW_JOB_DUPLICATE');
      if (jobs.size >= MAX_JOBS) throw new Error('WORKFLOW_JOB_CAPACITY');
      const job: LiveJob = {
        id,
        status: 'running',
        cursor: 0,
        ackCursor: 0,
        events: [],
        knownSteps: new Set(),
        owners: new Set([owner]),
        repaired: false,
        startedAt: now(),
        cancelled: false,
        activeRuns: 1,
        hasErrors: false,
        terminals: [],
      };
      jobs.set(id, job);
      return createHandle(job);
    },
    resume: (id: string, ids: readonly string[], owner = 'local') => {
      const job = get(id);
      if (job.cancelled || job.activeRuns > 3) throw new Error('WORKFLOW_RESUME_UNAVAILABLE');
      if (new Set(ids).size !== ids.length || ids.some((stepId) => job.knownSteps.has(stepId))) {
        throw new Error('WORKFLOW_RESUME_STEP_CONFLICT');
      }
      ids.forEach((stepId) => job.knownSteps.add(stepId));
      job.owners.add(owner);
      job.activeRuns += 1;
      job.finishedAt = undefined;
      job.status = 'running';
      return createHandle(job);
    },
    peek: (id: string, after = 0, limit = 40): WorkflowMailboxSnapshot => snapshot(get(id), after, limit),
    read: (id: string, after = 0, limit = 40): WorkflowMailboxSnapshot => {
      const job = get(id);
      const result = snapshot(job, after, limit);
      job.ackCursor = Math.max(job.ackCursor, result.cursor);
      return result;
    },
    list: (): Array<{ workflowId: string; status: string; cursor: number; unread: number }> => {
      cleanup();
      return [...jobs.values()].map(({ id, status, cursor, ackCursor }) => ({
        workflowId: id,
        status,
        cursor,
        unread: cursor - ackCursor,
      }));
    },
    activeCount: (): number => [...jobs.values()].filter((job) => job.activeRuns > 0).length,
    whenIdle: async (): Promise<void> => {
      await Promise.all([...jobs.values()].flatMap((job) => job.terminals));
    },
    abortByOwner: (owner: string): void => {
      for (const job of jobs.values()) {
        if (job.activeRuns > 0 && job.owners.has(owner)) {
          job.cancelled = true;
          job.status = 'cancelled';
          job.finishedAt = now();
          job.firstError?.(snapshot(job));
        }
      }
    },
    clear: (): void => {
      jobs.clear();
    },
  };
};

export type WorkflowMailbox = ReturnType<typeof createWorkflowMailbox>;
