import { randomUUID } from 'node:crypto';

import type { SurfacePermissionMode } from '../surfaceRegistry/types';
import { protectDurableAgentText } from './security';
import type { AgentId, AgentMeshEvent, AgentTaskContext, AgentTaskResult, AgentTaskStatus, TaskId } from './mesh';
import {
  createAgentMeshService,
  type AgentControllerMessageInput,
  type AgentDeliveryIntent,
  type AgentMeshService,
} from './service';

export type AgentJobKind = 'agent' | 'quick' | 'test';

export type AgentJobRequest = {
  jobId?: TaskId;
  agentId: AgentId;
  targetId?: string;
  modelId?: string;
  objective: string;
  kind?: AgentJobKind;
  workspace?: string;
  surface?: string;
  permissionMode?: SurfacePermissionMode;
  /** Opaque trusted-host scope for forwarding permission requests; never supplied by MCP callers. */
  executionScopeId?: string;
  /** Compact durable results used to restore continuity after a worker hibernates. */
  continuation?: string[];
  dependsOn?: TaskId[];
  estimatedTokens?: number;
  priority?: number;
};

export type AgentJob = Omit<AgentJobRequest, 'jobId' | 'kind'> & {
  jobId: TaskId;
  kind: AgentJobKind;
};

export type AgentJobOutcome =
  | { status: 'completed'; summary: string; tokensUsed?: number }
  | { status: 'failed'; error: string };

export type AgentJobView = AgentJob & {
  status: AgentTaskStatus;
  outcome?: AgentJobOutcome;
};

export type AgentTrackerEvent =
  | {
      cursor: number;
      timestamp: number;
      sessionId: string;
      type: 'status';
      jobId: TaskId;
      agentId: AgentId;
      status: AgentTaskStatus;
      detail?: string;
    }
  | {
      cursor: number;
      timestamp: number;
      sessionId: string;
      type: 'action';
      jobId: TaskId;
      name: string;
      status: 'started' | 'completed' | 'failed';
      detail?: string;
    }
  | {
      cursor: number;
      timestamp: number;
      sessionId: string;
      type: 'watchdog';
      agentId: AgentId;
      jobId?: TaskId;
      stuck: boolean;
      idleMs: number;
    };

export type SpawnAgentJobsInput = {
  sessionId?: string;
  jobs: AgentJobRequest[];
  maxConcurrent?: number;
  idempotencyKey?: string;
};

export type SpawnAgentJobsResult = {
  sessionId: string;
  jobIds: TaskId[];
  reused: boolean;
};

export type TrackAgentJobsInput = {
  sessionId: string;
  jobIds?: TaskId[];
  afterCursor?: number;
  limit?: number;
};

export type TrackAgentJobsResult = {
  sessionId: string;
  cursor: number;
  jobs: AgentJobView[];
  events: AgentTrackerEvent[];
  hasMore: boolean;
  truncated: boolean;
};

export type ResumeAgentInput = {
  sessionId: string;
  agentId: AgentId;
  objective: string;
  jobId?: TaskId;
  kind?: AgentJobKind;
  targetId?: string;
  modelId?: string;
  workspace?: string;
  surface?: string;
  permissionMode?: SurfacePermissionMode;
  estimatedTokens?: number;
  idempotencyKey?: string;
};

export type MessageAgentInput = {
  sessionId: string;
  agentId: AgentId;
  content: string;
  jobId?: TaskId;
  kind?: AgentControllerMessageInput['kind'];
  delivery?: AgentDeliveryIntent;
};

export type AgentJobDependencyResult = {
  jobId: TaskId;
  agentId: AgentId;
  summary: string;
  tokensUsed?: number;
};
export type AgentJobExecutorContext = AgentTaskContext & {
  sessionId: string;
  dependencyResults: AgentJobDependencyResult[];
};
export type AgentJobExecutor = (job: AgentJob, context: AgentJobExecutorContext) => Promise<AgentTaskResult>;

export type AgentJobSessionSnapshot = {
  schema: 'tomny.agent-orchestrator.session.v1';
  sessionId: string;
  maxConcurrent: number;
  cursor: number;
  lastActivityAt: number;
  events: AgentTrackerEvent[];
  jobs: AgentJob[];
  statuses: Array<[TaskId, AgentTaskStatus]>;
  outcomes: Array<[TaskId, AgentJobOutcome]>;
  idempotency: Array<[string, IdempotencyEntry]>;
};

export type AgentJobStateStore = {
  loadAll(): Promise<AgentJobSessionSnapshot[]>;
  save(snapshot: AgentJobSessionSnapshot): Promise<void>;
  remove(sessionId: string): Promise<void>;
};

export type AgentSessionView = {
  sessionId: string;
  maxConcurrent: number;
  jobCount: number;
  activeJobCount: number;
  cursor: number;
  lastActivityAt: number;
  state: 'active' | 'idle' | 'hibernated';
};

export type AgentJobOrchestratorOptions = {
  executor: AgentJobExecutor;
  service?: AgentMeshService;
  now?: () => number;
  id?: (prefix: 'session' | 'job') => string;
  maxJobsPerBatch?: number;
  maxJobsPerSession?: number;
  maxSessions?: number;
  maxEventsPerSession?: number;
  /** Release idle in-memory controllers while retaining durable session results. Set false to disable. */
  idleHibernateMs?: number | false;
  stateStore?: AgentJobStateStore;
};

type SessionRuntime = {
  sessionId: string;
  maxConcurrent: number;
  cursor: number;
  lastActivityAt: number;
  events: AgentTrackerEvent[];
  jobs: Map<TaskId, AgentJob>;
  statuses: Map<TaskId, AgentTaskStatus>;
  outcomes: Map<TaskId, AgentJobOutcome>;
  hibernated: boolean;
};

export type IdempotencyEntry = {
  signature: string;
  result: SpawnAgentJobsResult;
};

const ORCHESTRATOR_AGENT_ID = '__tomny_orchestrator__';
const TERMINAL_STATUSES = new Set<AgentTaskStatus>(['completed', 'failed', 'cancelled', 'interrupted']);
const DEFAULT_MAX_JOBS_PER_BATCH = 16;
const DEFAULT_MAX_JOBS_PER_SESSION = 256;
const DEFAULT_MAX_SESSIONS = 64;
const MAX_CONCURRENT_JOBS = 8;
const DEFAULT_MAX_EVENTS_PER_SESSION = 2_000;
const DEFAULT_IDLE_HIBERNATE_MS = 5 * 60_000;
const DEFAULT_TRACK_LIMIT = 100;
const MAX_TRACK_LIMIT = 500;
const MAX_ID_CHARS = 256;
const MAX_OBJECTIVE_CHARS = 32_000;
const MAX_MESSAGE_CHARS = 16_000;
const MAX_WORKSPACE_CHARS = 4_096;
const MAX_CONTINUATION_ITEMS = 3;
const MAX_CONTINUATION_CHARS = 4_000;
const MAX_JOB_ID_FILTER = 16;
const MAX_OUTCOME_SUMMARY_CHARS = 64_000;
const MAX_ERROR_CHARS = 8_000;
const MAX_EVENT_DETAIL_CHARS = 4_000;

const requiredText = (value: string, label: string, maxCharacters = MAX_ID_CHARS): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxCharacters) throw new Error(`${label} cannot exceed ${maxCharacters} characters.`);
  return normalized;
};

const optionalText = (value: string | undefined, label: string, maxCharacters = MAX_ID_CHARS): string | undefined =>
  value === undefined ? undefined : requiredText(value, label, maxCharacters);

const truncateText = (value: string, maxCharacters: number): string =>
  value.length <= maxCharacters ? value : `${value.slice(0, maxCharacters - 1)}…`;

const compactText = (value: string, maxCharacters: number): string => truncateText(value.trim(), maxCharacters);

const normalizeOutcome = (outcome: AgentJobOutcome): AgentJobOutcome =>
  outcome.status === 'completed'
    ? {
        ...outcome,
        summary: truncateText(protectDurableAgentText(outcome.summary), MAX_OUTCOME_SUMMARY_CHARS),
      }
    : { status: 'failed', error: truncateText(protectDurableAgentText(outcome.error), MAX_ERROR_CHARS) };

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
};

const defaultId = (prefix: 'session' | 'job'): string => `${prefix}-${randomUUID()}`;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const compactContinuation = (value: string): string => compactText(value, MAX_CONTINUATION_CHARS);

const normalizeTrackerEvent = (event: AgentTrackerEvent): AgentTrackerEvent => {
  if (event.type === 'status') {
    return {
      ...event,
      detail: event.detail ? compactText(protectDurableAgentText(event.detail), MAX_EVENT_DETAIL_CHARS) : undefined,
    };
  }
  if (event.type === 'action') {
    return {
      ...event,
      detail: event.detail ? compactText(protectDurableAgentText(event.detail), MAX_EVENT_DETAIL_CHARS) : undefined,
    };
  }
  return { ...event };
};

const assertSpawnInputBounds = (input: SpawnAgentJobsInput): void => {
  optionalText(input.sessionId, 'sessionId');
  optionalText(input.idempotencyKey, 'idempotencyKey');
  for (const job of input.jobs) {
    optionalText(job.jobId, 'jobId');
    requiredText(job.agentId, 'agentId');
    optionalText(job.targetId, 'targetId');
    optionalText(job.modelId, 'modelId');
    requiredText(job.objective, 'objective', MAX_OBJECTIVE_CHARS);
    optionalText(job.workspace, 'workspace', MAX_WORKSPACE_CHARS);
    optionalText(job.surface, 'surface');
    optionalText(job.executionScopeId, 'executionScopeId');
    if ((job.dependsOn?.length ?? 0) > MAX_JOB_ID_FILTER) {
      throw new Error(`dependsOn cannot exceed ${MAX_JOB_ID_FILTER} entries.`);
    }
    for (const dependency of job.dependsOn ?? []) requiredText(dependency, 'dependency');
    if ((job.continuation?.length ?? 0) > MAX_CONTINUATION_ITEMS) {
      throw new Error(`continuation cannot exceed ${MAX_CONTINUATION_ITEMS} entries.`);
    }
    for (const entry of job.continuation ?? []) requiredText(entry, 'continuation', MAX_CONTINUATION_CHARS);
    if (job.priority !== undefined && !Number.isFinite(job.priority)) throw new Error('priority must be finite.');
  }
};

const requestSignature = (input: SpawnAgentJobsInput): string =>
  JSON.stringify({
    sessionId: input.sessionId?.trim() || null,
    maxConcurrent: input.maxConcurrent ?? null,
    jobs: input.jobs.map((job) => ({
      jobId: job.jobId?.trim() || null,
      agentId: job.agentId.trim(),
      targetId: job.targetId?.trim() || null,
      modelId: job.modelId?.trim() || null,
      objective: job.objective.trim(),
      kind: job.kind ?? 'agent',
      workspace: job.workspace?.trim() || null,
      surface: job.surface?.trim() || null,
      permissionMode: job.permissionMode ?? null,
      executionScopeId: job.executionScopeId?.trim() || null,
      continuation: job.continuation?.map((entry) => entry.trim()) ?? [],
      dependsOn: job.dependsOn?.map((dependency) => dependency.trim()) ?? [],
      estimatedTokens: job.estimatedTokens ?? null,
      priority: job.priority ?? null,
    })),
  });

const assertAcyclic = (jobs: AgentJob[]): void => {
  const ids = new Set(jobs.map((job) => job.jobId));
  const byId = new Map(jobs.map((job) => [job.jobId, job]));
  const visiting = new Set<TaskId>();
  const visited = new Set<TaskId>();

  const visit = (jobId: TaskId): void => {
    if (visited.has(jobId)) return;
    if (visiting.has(jobId)) throw new Error(`Agent job dependency cycle detected at ${jobId}.`);
    visiting.add(jobId);
    for (const dependency of byId.get(jobId)?.dependsOn ?? []) {
      if (ids.has(dependency)) visit(dependency);
    }
    visiting.delete(jobId);
    visited.add(jobId);
  };

  for (const job of jobs) visit(job.jobId);
};

/**
 * MCP-neutral facade over AgentMesh. It owns no transport or surface registration,
 * so callers can stabilize job/session behavior before exposing tools publicly.
 */
export class AgentJobOrchestrator {
  private readonly executor: AgentJobExecutor;
  private readonly service: AgentMeshService;
  private readonly now: () => number;
  private readonly id: (prefix: 'session' | 'job') => string;
  private readonly maxJobsPerBatch: number;
  private readonly maxJobsPerSession: number;
  private readonly maxSessions: number;
  private readonly maxEventsPerSession: number;
  private readonly idleHibernateMs?: number;
  private readonly stateStore?: AgentJobStateStore;
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly pendingPersistence = new Map<string, Promise<void>>();
  private readonly persistenceErrors = new Map<string, unknown>();
  private readonly hibernationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private initialization?: Promise<void>;

  constructor(options: AgentJobOrchestratorOptions) {
    this.executor = options.executor;
    this.service = options.service ?? createAgentMeshService();
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
    this.maxJobsPerBatch = positiveInteger(options.maxJobsPerBatch ?? DEFAULT_MAX_JOBS_PER_BATCH, 'maxJobsPerBatch');
    this.maxJobsPerSession = positiveInteger(
      options.maxJobsPerSession ?? DEFAULT_MAX_JOBS_PER_SESSION,
      'maxJobsPerSession'
    );
    this.maxSessions = positiveInteger(options.maxSessions ?? DEFAULT_MAX_SESSIONS, 'maxSessions');
    this.maxEventsPerSession = positiveInteger(
      options.maxEventsPerSession ?? DEFAULT_MAX_EVENTS_PER_SESSION,
      'maxEventsPerSession'
    );
    this.idleHibernateMs =
      options.idleHibernateMs === false
        ? undefined
        : positiveInteger(options.idleHibernateMs ?? DEFAULT_IDLE_HIBERNATE_MS, 'idleHibernateMs');
    this.stateStore = options.stateStore;
  }

  async initialize(): Promise<void> {
    if (!this.stateStore) return;
    this.initialization ??= this.restorePersistedSessions();
    await this.initialization;
  }

  spawnJobs(input: SpawnAgentJobsInput): SpawnAgentJobsResult {
    if (!Array.isArray(input.jobs) || input.jobs.length === 0) throw new Error('At least one agent job is required.');
    if (input.jobs.length > this.maxJobsPerBatch) {
      throw new Error(`Agent job batch exceeds the limit of ${this.maxJobsPerBatch}.`);
    }

    assertSpawnInputBounds(input);
    const key = input.idempotencyKey?.trim();
    const signature = requestSignature(input);
    if (key) {
      const previous = this.idempotency.get(key);
      if (previous) {
        if (previous.signature !== signature)
          throw new Error(`Idempotency key was reused with different input: ${key}`);
        return { ...previous.result, reused: true };
      }
    }

    const sessionId = input.sessionId ? requiredText(input.sessionId, 'sessionId') : this.id('session');
    const existingRuntime = this.sessions.get(sessionId);
    if (!existingRuntime && this.sessions.size >= this.maxSessions) {
      throw new Error(`Agent session limit of ${this.maxSessions} reached; close a session before creating another.`);
    }
    if ((existingRuntime?.jobs.size ?? 0) + input.jobs.length > this.maxJobsPerSession) {
      throw new Error(`Agent session job limit of ${this.maxJobsPerSession} reached.`);
    }
    const requestedConcurrency =
      input.maxConcurrent === undefined ? undefined : positiveInteger(input.maxConcurrent, 'maxConcurrent');
    if (requestedConcurrency !== undefined && requestedConcurrency > MAX_CONCURRENT_JOBS) {
      throw new Error(`maxConcurrent cannot exceed ${MAX_CONCURRENT_JOBS}.`);
    }
    if (
      existingRuntime &&
      requestedConcurrency !== undefined &&
      requestedConcurrency !== existingRuntime.maxConcurrent
    ) {
      throw new Error(`Session ${sessionId} already uses maxConcurrent=${existingRuntime.maxConcurrent}.`);
    }
    const maxConcurrent = existingRuntime?.maxConcurrent ?? requestedConcurrency ?? Math.min(4, input.jobs.length);
    const existingTaskIds = new Set(existingRuntime?.jobs.keys() ?? []);
    const jobs = input.jobs.map((request): AgentJob => {
      const agentId = requiredText(request.agentId, 'agentId');
      if (agentId === ORCHESTRATOR_AGENT_ID) throw new Error(`Agent id ${ORCHESTRATOR_AGENT_ID} is reserved.`);
      const jobId = request.jobId ? requiredText(request.jobId, 'jobId') : this.id('job');
      const dependsOn = request.dependsOn?.map((dependency) => requiredText(dependency, 'dependency'));
      if (
        request.estimatedTokens !== undefined &&
        (!Number.isSafeInteger(request.estimatedTokens) || request.estimatedTokens < 0)
      ) {
        throw new Error('estimatedTokens must be a non-negative integer.');
      }
      return {
        jobId,
        agentId,
        targetId: request.targetId ? requiredText(request.targetId, 'targetId') : undefined,
        modelId: optionalText(request.modelId, 'modelId'),
        objective: requiredText(request.objective, 'objective', MAX_OBJECTIVE_CHARS),
        kind: request.kind ?? 'agent',
        workspace: optionalText(request.workspace, 'workspace', MAX_WORKSPACE_CHARS),
        surface: optionalText(request.surface, 'surface'),
        permissionMode: request.permissionMode,
        executionScopeId: optionalText(request.executionScopeId, 'executionScopeId'),
        continuation: request.continuation?.map((entry) => requiredText(entry, 'continuation', MAX_CONTINUATION_CHARS)),
        dependsOn,
        estimatedTokens: request.estimatedTokens,
        priority: request.priority,
      };
    });

    const batchIds = new Set<TaskId>();
    for (const job of jobs) {
      if (existingTaskIds.has(job.jobId) || batchIds.has(job.jobId))
        throw new Error(`Duplicate agent job: ${job.jobId}`);
      batchIds.add(job.jobId);
    }
    for (const job of jobs) {
      for (const dependency of job.dependsOn ?? []) {
        if (!existingTaskIds.has(dependency) && !batchIds.has(dependency)) {
          throw new Error(`Unknown dependency ${dependency} for agent job ${job.jobId}.`);
        }
        if (existingTaskIds.has(dependency) && existingRuntime?.statuses.get(dependency) !== 'completed') {
          throw new Error(`Dependency ${dependency} for agent job ${job.jobId} did not complete successfully.`);
        }
      }
    }
    assertAcyclic(jobs);

    const runtime = existingRuntime ?? this.createSession(sessionId, maxConcurrent);
    const controller = this.ensureSessionController(runtime);
    const registered = new Set(controller.listAgents().map((agent) => agent.agentId));
    for (const job of jobs) {
      if (!registered.has(job.agentId)) {
        controller.registerAgent({ agentId: job.agentId });
        registered.add(job.agentId);
      }
      runtime.jobs.set(job.jobId, structuredClone(job));
      runtime.statuses.set(job.jobId, 'queued');
      controller.submitTask(
        {
          taskId: job.jobId,
          agentId: job.agentId,
          objective: job.objective,
          dependsOn: job.dependsOn?.filter((dependency) => !existingTaskIds.has(dependency)),
          estimatedTokens: job.estimatedTokens,
          priority: job.priority,
        },
        async (_task, context) => {
          try {
            const dependencyResults = (job.dependsOn ?? []).flatMap((dependencyId) => {
              const dependencyJob = runtime.jobs.get(dependencyId);
              const dependencyOutcome = runtime.outcomes.get(dependencyId);
              return dependencyJob && dependencyOutcome?.status === 'completed'
                ? [
                    {
                      jobId: dependencyId,
                      agentId: dependencyJob.agentId,
                      summary: dependencyOutcome.summary,
                      tokensUsed: dependencyOutcome.tokensUsed,
                    },
                  ]
                : [];
            });
            const result = await this.executor(structuredClone(job), {
              ...context,
              sessionId,
              dependencyResults,
            });
            const boundedResult = {
              ...result,
              summary: truncateText(protectDurableAgentText(result.summary), MAX_OUTCOME_SUMMARY_CHARS),
            };
            runtime.outcomes.set(
              job.jobId,
              normalizeOutcome({
                status: 'completed',
                summary: boundedResult.summary,
                tokensUsed: boundedResult.tokensUsed,
              })
            );
            return boundedResult;
          } catch (error) {
            const boundedError = truncateText(protectDurableAgentText(errorMessage(error)), MAX_ERROR_CHARS);
            if (!context.signal.aborted) {
              runtime.outcomes.set(job.jobId, { status: 'failed', error: boundedError });
            }
            // oxlint-disable-next-line preserve-caught-error -- The raw cause may retain unbounded or secret-bearing data.
            throw new Error(boundedError);
          }
        }
      );
    }

    const result: SpawnAgentJobsResult = { sessionId, jobIds: jobs.map((job) => job.jobId), reused: false };
    if (key) this.idempotency.set(key, { signature, result });
    this.schedulePersist(runtime);
    return result;
  }

  resumeAgent(
    input: ResumeAgentInput,
    executionClaims?: Readonly<{
      workspace?: string;
      surface?: string;
      permissionMode?: SurfacePermissionMode;
      executionScopeId?: string;
    }>
  ): SpawnAgentJobsResult {
    const runtime = this.requireSession(input.sessionId);
    const previous = [...runtime.jobs.values()].toReversed().find((job) => job.agentId === input.agentId);
    const continuation = [...runtime.jobs.values()]
      .filter((job) => job.agentId === input.agentId)
      .map((job) => runtime.outcomes.get(job.jobId))
      .filter((outcome): outcome is AgentJobOutcome => outcome !== undefined)
      .slice(-3)
      .map((outcome) =>
        compactContinuation(outcome.status === 'completed' ? outcome.summary : `Previous error: ${outcome.error}`)
      );
    return this.spawnJobs({
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      jobs: [
        {
          jobId: input.jobId,
          agentId: input.agentId,
          targetId: input.targetId ?? previous?.targetId,
          modelId: input.modelId ?? previous?.modelId,
          objective: input.objective,
          kind: input.kind ?? previous?.kind,
          workspace: executionClaims ? executionClaims.workspace : (input.workspace ?? previous?.workspace),
          surface: executionClaims ? executionClaims.surface : (input.surface ?? previous?.surface),
          permissionMode: executionClaims
            ? executionClaims.permissionMode
            : (input.permissionMode ?? previous?.permissionMode),
          executionScopeId: executionClaims ? executionClaims.executionScopeId : previous?.executionScopeId,
          continuation,
          estimatedTokens: input.estimatedTokens,
        },
      ],
    });
  }

  messageAgent(input: MessageAgentInput) {
    const runtime = this.requireSession(input.sessionId);
    if (![...runtime.jobs.values()].some((job) => job.agentId === input.agentId)) {
      throw new Error(`Unknown agent ${input.agentId} in session ${input.sessionId}.`);
    }
    const controller = this.ensureSessionController(runtime);
    if (!controller.listAgents().some((agent) => agent.agentId === input.agentId)) {
      controller.registerAgent({ agentId: input.agentId });
    }
    return this.service.send(input.sessionId, {
      taskId: input.jobId,
      fromAgentId: ORCHESTRATOR_AGENT_ID,
      toAgentId: input.agentId,
      kind: input.kind ?? 'control',
      content: compactText(
        protectDurableAgentText(requiredText(input.content, 'content', MAX_MESSAGE_CHARS)),
        MAX_MESSAGE_CHARS
      ),
      delivery: input.delivery ?? 'enqueue-after-task',
    });
  }

  trackJobs(input: TrackAgentJobsInput): TrackAgentJobsResult {
    const runtime = this.requireSession(input.sessionId);
    const afterCursor = input.afterCursor ?? 0;
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0)
      throw new Error('afterCursor must be a non-negative integer.');
    const limit = input.limit ?? DEFAULT_TRACK_LIMIT;
    positiveInteger(limit, 'limit');
    if (limit > MAX_TRACK_LIMIT) throw new Error(`limit cannot exceed ${MAX_TRACK_LIMIT}.`);

    if ((input.jobIds?.length ?? 0) > MAX_JOB_ID_FILTER) {
      throw new Error(`jobIds cannot exceed ${MAX_JOB_ID_FILTER} entries.`);
    }
    const selectedIds = input.jobIds ? new Set(input.jobIds.map((jobId) => requiredText(jobId, 'jobId'))) : undefined;
    if (selectedIds) {
      for (const jobId of selectedIds) {
        if (!runtime.jobs.has(jobId)) throw new Error(`Unknown agent job ${jobId} in session ${input.sessionId}.`);
      }
    }
    const matchesSelection = (event: AgentTrackerEvent): boolean => {
      if (!selectedIds) return true;
      if (event.type === 'watchdog') return event.jobId === undefined || selectedIds.has(event.jobId);
      return selectedIds.has(event.jobId);
    };
    const allMatchingEvents = runtime.events.filter((event) => event.cursor > afterCursor && matchesSelection(event));
    const events = allMatchingEvents.slice(0, limit).map((event) => structuredClone(event));
    const hasMore = allMatchingEvents.length > events.length;
    const oldestCursor = runtime.events[0]?.cursor ?? runtime.cursor + 1;
    const cursor = hasMore ? (events.at(-1)?.cursor ?? afterCursor) : runtime.cursor;

    const jobs = [...runtime.jobs.values()]
      .filter((job) => !selectedIds || selectedIds.has(job.jobId))
      .map(
        (job): AgentJobView =>
          Object.assign(structuredClone(job), {
            status: runtime.statuses.get(job.jobId) ?? 'queued',
            outcome: runtime.outcomes.get(job.jobId) ? structuredClone(runtime.outcomes.get(job.jobId)) : undefined,
          })
      );

    return {
      sessionId: input.sessionId,
      cursor,
      jobs,
      events,
      hasMore,
      truncated: afterCursor + 1 < oldestCursor,
    };
  }

  getResult(sessionId: string, jobId: TaskId): AgentJobView {
    const tracked = this.trackJobs({ sessionId, jobIds: [jobId], limit: 1 });
    const job = tracked.jobs[0];
    if (!job) throw new Error(`Unknown agent job ${jobId} in session ${sessionId}.`);
    return job;
  }

  cancelJobs(sessionId: string, jobIds: TaskId[]): TaskId[] {
    const runtime = this.requireSession(sessionId);
    if (jobIds.length === 0) throw new Error('At least one agent job is required for cancellation.');
    if (jobIds.length > MAX_JOB_ID_FILTER) {
      throw new Error(`jobIds cannot exceed ${MAX_JOB_ID_FILTER} entries.`);
    }
    const unique = [...new Set(jobIds.map((jobId) => requiredText(jobId, 'jobId')))];
    for (const jobId of unique) {
      if (!runtime.jobs.has(jobId)) throw new Error(`Unknown agent job ${jobId} in session ${sessionId}.`);
    }

    for (const jobId of unique) {
      const status = runtime.statuses.get(jobId);
      if (status && !TERMINAL_STATUSES.has(status)) {
        this.service.stop(sessionId, ORCHESTRATOR_AGENT_ID, jobId, 'cancel');
      }
    }
    return unique;
  }

  listSessions(): string[] {
    return [...this.sessions.keys()];
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId.trim());
  }

  listSessionViews(): AgentSessionView[] {
    return [...this.sessions.values()]
      .map((runtime) => {
        const activeJobCount = [...runtime.statuses.values()].filter((status) => !TERMINAL_STATUSES.has(status)).length;
        return {
          sessionId: runtime.sessionId,
          maxConcurrent: runtime.maxConcurrent,
          jobCount: runtime.jobs.size,
          activeJobCount,
          cursor: runtime.cursor,
          lastActivityAt: runtime.lastActivityAt,
          state:
            activeJobCount > 0 ? ('active' as const) : runtime.hibernated ? ('hibernated' as const) : ('idle' as const),
        };
      })
      .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt);
  }

  async waitForIdle(sessionId: string): Promise<void> {
    const runtime = this.requireSession(sessionId);
    if (runtime.hibernated) return;
    await this.service.get(sessionId).waitForIdle();
  }

  /** Release an idle controller without deleting its session capability or durable results. */
  async hibernateSession(sessionId: string): Promise<boolean> {
    const runtime = this.sessions.get(requiredText(sessionId, 'sessionId'));
    if (!runtime || runtime.hibernated) return false;
    if ([...runtime.statuses.values()].some((status) => !TERMINAL_STATUSES.has(status))) return false;
    this.clearHibernationTimer(runtime.sessionId);
    runtime.hibernated = true;
    await this.service.dispose(runtime.sessionId);
    return true;
  }

  /** Opportunistically hibernate every session that has remained idle for at least the supplied duration. */
  async hibernateIdleSessions(idleMs = this.idleHibernateMs): Promise<string[]> {
    if (idleMs === undefined) return [];
    positiveInteger(idleMs, 'idleMs');
    const cutoff = this.now() - idleMs;
    const candidates = [...this.sessions.values()].filter(
      (runtime) =>
        !runtime.hibernated &&
        runtime.lastActivityAt <= cutoff &&
        ![...runtime.statuses.values()].some((status) => !TERMINAL_STATUSES.has(status))
    );
    const results = await Promise.all(candidates.map((runtime) => this.hibernateSession(runtime.sessionId)));
    return candidates.filter((_, index) => results[index]).map((runtime) => runtime.sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    const activeJobs = [...runtime.statuses]
      .filter(([, status]) => !TERMINAL_STATUSES.has(status))
      .map(([jobId]) => jobId);
    if (activeJobs.length > 0) this.cancelJobs(sessionId, activeJobs);
    this.clearHibernationTimer(sessionId);
    if (!runtime.hibernated) await this.service.get(sessionId).waitForIdle();
    await this.flush(sessionId);
    if (!runtime.hibernated) await this.service.dispose(sessionId);
    this.sessions.delete(sessionId);
    for (const [key, entry] of this.idempotency) {
      if (entry.result.sessionId === sessionId) this.idempotency.delete(key);
    }
    this.pendingPersistence.delete(sessionId);
    this.persistenceErrors.delete(sessionId);
    await this.stateStore?.remove(sessionId);
  }

  async flush(sessionId?: string): Promise<void> {
    const pending = sessionId
      ? [this.pendingPersistence.get(sessionId)].filter((value): value is Promise<void> => Boolean(value))
      : [...this.pendingPersistence.values()];
    await Promise.allSettled(pending);
    const errors = sessionId
      ? [this.persistenceErrors.get(sessionId)].filter((value): value is unknown => value !== undefined)
      : [...this.persistenceErrors.values()];
    if (errors.length > 0) throw new AggregateError(errors, 'Agent orchestrator state persistence failed.');
  }

  private createSession(sessionId: string, maxConcurrent: number): SessionRuntime {
    const runtime: SessionRuntime = {
      sessionId,
      maxConcurrent,
      cursor: 0,
      lastActivityAt: this.now(),
      events: [],
      jobs: new Map(),
      statuses: new Map(),
      outcomes: new Map(),
      hibernated: false,
    };
    this.createSessionController(runtime);
    this.sessions.set(sessionId, runtime);
    this.schedulePersist(runtime);
    this.scheduleHibernation(runtime);
    return runtime;
  }

  private captureEvent(runtime: SessionRuntime, event: AgentMeshEvent): void {
    const base = { cursor: ++runtime.cursor, timestamp: this.now(), sessionId: runtime.sessionId };
    runtime.lastActivityAt = base.timestamp;
    if (event.type === 'task-status') {
      runtime.statuses.set(event.task.taskId, event.status);
      runtime.events.push({
        ...base,
        type: 'status',
        jobId: event.task.taskId,
        agentId: event.task.agentId,
        status: event.status,
        detail: event.detail ? compactText(protectDurableAgentText(event.detail), MAX_EVENT_DETAIL_CHARS) : undefined,
      });
    } else if (event.type === 'action') {
      runtime.events.push({
        ...base,
        type: 'action',
        jobId: event.action.taskId,
        name: event.action.name,
        status: event.action.status,
        detail: event.action.detail
          ? compactText(protectDurableAgentText(event.action.detail), MAX_EVENT_DETAIL_CHARS)
          : undefined,
      });
    } else if (event.type === 'watchdog') {
      runtime.events.push({
        ...base,
        type: 'watchdog',
        agentId: event.agentId,
        jobId: event.taskId,
        stuck: event.stuck,
        idleMs: event.idleMs,
      });
    } else {
      runtime.cursor -= 1;
      return;
    }
    if (runtime.events.length > this.maxEventsPerSession) {
      runtime.events.splice(0, runtime.events.length - this.maxEventsPerSession);
    }
    this.schedulePersist(runtime);
    this.scheduleHibernation(runtime);
  }

  private createSessionController(runtime: SessionRuntime) {
    const controller = this.service.create(runtime.sessionId, {
      maxConcurrent: runtime.maxConcurrent,
      onEvent: (event) => this.captureEvent(runtime, event),
    });
    controller.registerAgent({
      agentId: ORCHESTRATOR_AGENT_ID,
      grants: [
        {
          fromAgentId: ORCHESTRATOR_AGENT_ID,
          toAgentId: '*',
          actions: ['task', 'question', 'progress', 'result', 'handoff', 'control'],
        },
      ],
    });
    for (const job of runtime.jobs.values()) {
      if (!controller.listAgents().some((agent) => agent.agentId === job.agentId)) {
        controller.registerAgent({ agentId: job.agentId });
      }
    }
    return controller;
  }

  private ensureSessionController(runtime: SessionRuntime) {
    if (!runtime.hibernated) return this.service.get(runtime.sessionId);
    const controller = this.createSessionController(runtime);
    runtime.hibernated = false;
    runtime.lastActivityAt = this.now();
    this.schedulePersist(runtime);
    this.scheduleHibernation(runtime);
    return controller;
  }

  private scheduleHibernation(runtime: SessionRuntime): void {
    this.clearHibernationTimer(runtime.sessionId);
    if (this.idleHibernateMs === undefined || runtime.hibernated) return;
    const delay = Math.max(1, runtime.lastActivityAt + this.idleHibernateMs - this.now());
    const timer = setTimeout(() => {
      this.hibernationTimers.delete(runtime.sessionId);
      void this.hibernateSession(runtime.sessionId).then(
        (hibernated) => {
          if (!hibernated && this.sessions.has(runtime.sessionId)) this.scheduleHibernation(runtime);
        },
        (error: unknown) => {
          this.persistenceErrors.set(runtime.sessionId, error);
        }
      );
    }, delay);
    timer.unref?.();
    this.hibernationTimers.set(runtime.sessionId, timer);
  }

  private clearHibernationTimer(sessionId: string): void {
    const timer = this.hibernationTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.hibernationTimers.delete(sessionId);
  }

  private schedulePersist(runtime: SessionRuntime): void {
    if (!this.stateStore) return;
    const snapshot = this.snapshot(runtime);
    const previous = this.pendingPersistence.get(runtime.sessionId) ?? Promise.resolve();
    const pending = previous
      .catch((): void => undefined)
      .then(() => this.stateStore!.save(snapshot))
      .then(
        () => {
          this.persistenceErrors.delete(runtime.sessionId);
        },
        (error: unknown) => {
          this.persistenceErrors.set(runtime.sessionId, error);
        }
      );
    this.pendingPersistence.set(runtime.sessionId, pending);
  }

  private snapshot(runtime: SessionRuntime): AgentJobSessionSnapshot {
    return {
      schema: 'tomny.agent-orchestrator.session.v1',
      sessionId: runtime.sessionId,
      maxConcurrent: runtime.maxConcurrent,
      cursor: runtime.cursor,
      lastActivityAt: runtime.lastActivityAt,
      events: structuredClone(runtime.events),
      jobs: structuredClone([...runtime.jobs.values()]).map((job) => ({
        ...job,
        objective: protectDurableAgentText(job.objective),
        continuation: job.continuation?.map(protectDurableAgentText),
      })),
      statuses: structuredClone([...runtime.statuses]),
      outcomes: structuredClone([...runtime.outcomes]),
      idempotency: structuredClone(
        [...this.idempotency].filter(([, entry]) => entry.result.sessionId === runtime.sessionId)
      ),
    };
  }

  private async restorePersistedSessions(): Promise<void> {
    const snapshots = await this.stateStore!.loadAll();
    if (snapshots.length > this.maxSessions) {
      throw new Error(
        `Persisted agent session count ${snapshots.length} exceeds the configured limit of ${this.maxSessions}.`
      );
    }
    for (const snapshot of snapshots) {
      if (this.sessions.has(snapshot.sessionId)) continue;
      if (snapshot.jobs.length > this.maxJobsPerSession) {
        throw new Error(
          `Persisted agent session ${snapshot.sessionId} exceeds the job limit of ${this.maxJobsPerSession}.`
        );
      }
      assertSpawnInputBounds({ sessionId: snapshot.sessionId, jobs: snapshot.jobs });
      const restoredConcurrency = positiveInteger(snapshot.maxConcurrent, 'maxConcurrent');
      if (restoredConcurrency > MAX_CONCURRENT_JOBS) {
        throw new Error(`Persisted maxConcurrent cannot exceed ${MAX_CONCURRENT_JOBS}.`);
      }
      const runtime: SessionRuntime = {
        sessionId: snapshot.sessionId,
        maxConcurrent: restoredConcurrency,
        cursor: snapshot.cursor,
        lastActivityAt: snapshot.lastActivityAt,
        events: snapshot.events.slice(-this.maxEventsPerSession).map(normalizeTrackerEvent),
        jobs: new Map(
          structuredClone(snapshot.jobs).map((job) => [
            job.jobId,
            {
              ...job,
              objective: protectDurableAgentText(job.objective),
              continuation: job.continuation?.map(protectDurableAgentText),
            },
          ])
        ),
        statuses: new Map(structuredClone(snapshot.statuses)),
        outcomes: new Map(
          structuredClone(snapshot.outcomes).map(([jobId, outcome]) => [jobId, normalizeOutcome(outcome)])
        ),
        hibernated: true,
      };
      for (const job of runtime.jobs.values()) {
        const status = runtime.statuses.get(job.jobId);
        if (status && !TERMINAL_STATUSES.has(status)) {
          const timestamp = this.now();
          runtime.statuses.set(job.jobId, 'interrupted');
          runtime.outcomes.set(job.jobId, {
            status: 'failed',
            error: 'Agent job was interrupted by application restart. Resume the agent to continue.',
          });
          runtime.lastActivityAt = timestamp;
          runtime.events.push({
            cursor: ++runtime.cursor,
            timestamp,
            sessionId: runtime.sessionId,
            type: 'status',
            jobId: job.jobId,
            agentId: job.agentId,
            status: 'interrupted',
            detail: 'Application restarted; the durable result remains available.',
          });
        }
      }
      if (runtime.events.length > this.maxEventsPerSession) {
        runtime.events.splice(0, runtime.events.length - this.maxEventsPerSession);
      }
      for (const [key, entry] of snapshot.idempotency) this.idempotency.set(key, structuredClone(entry));
      this.sessions.set(runtime.sessionId, runtime);
      this.schedulePersist(runtime);
    }
  }

  private requireSession(sessionId: string): SessionRuntime {
    const id = requiredText(sessionId, 'sessionId');
    const runtime = this.sessions.get(id);
    if (!runtime) throw new Error(`Unknown agent session: ${id}`);
    return runtime;
  }
}

export const createAgentJobOrchestrator = (options: AgentJobOrchestratorOptions): AgentJobOrchestrator =>
  new AgentJobOrchestrator(options);
