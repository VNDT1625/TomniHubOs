import type {
  AgentId,
  AgentInspection,
  AgentMeshAgent,
  AgentMeshTask,
  AgentMessage,
  AgentMessageKind,
  AgentTaskExecutor,
  MessageId,
  TaskId,
} from './mesh';
import {
  createAgentMeshController,
  type AgentControllerMessageInput,
  type AgentDeliveryIntent,
  type AgentMeshController,
  type AgentMeshControllerOptions,
} from './controller';
import type { DurableEventStore } from '@process/services/agentChat/durability';

export type AgentMeshSnapshot = {
  sessionId: string;
  agents: AgentMeshAgent[];
  inspections: AgentInspection[];
  tasks: Array<{ task: AgentMeshTask; status: string }>;
  messages: AgentMessage[];
  tokenUsage: { spentTokens: number; reservedTokens: number; budget?: number };
};

export type AgentMeshOverview = {
  sessionId: string;
  agents: Array<{
    agentId: AgentId;
    parentAgentId?: AgentId;
    status: string;
    stuck: boolean;
    objective?: string;
    currentAction?: { name: string; detail?: string };
    queuedMessages: number;
  }>;
  tokenUsage: { spentTokens: number; reservedTokens: number; budget?: number };
};

export type AgentMeshConcurrencyPolicy = {
  configuredMaxConcurrent: number;
  minimum: number;
  maximum: number;
};

export type AgentMeshMessageHandler = (
  input: AgentControllerMessageInput,
  message: AgentMessage
) => void | Promise<void>;

export const DEFAULT_AGENT_MESH_MAX_CONCURRENT = 4;
export const MAX_AGENT_MESH_MAX_CONCURRENT = 8;
const MAX_OVERVIEW_DETAIL_CHARS = 240;
const MAX_SNAPSHOT_MESSAGES = 200;
const DEFAULT_WORKLOG_LIMIT = 200;
const MAX_WORKLOG_LIMIT = 1000;

const normalizeMaxConcurrent = (value: number): number =>
  Math.max(1, Math.min(MAX_AGENT_MESH_MAX_CONCURRENT, Math.trunc(value || DEFAULT_AGENT_MESH_MAX_CONCURRENT)));

export type AgentMeshServiceOptions = {
  /** Optional persistent journal factory; one event stream is kept per session. */
  eventStoreFactory?: (sessionId: string) => DurableEventStore;
  /** Enumerate journal-backed sessions so a fresh Main process can rebuild the registry. */
  listPersistedSessionIds?: () => Promise<string[]>;
  /** Override controller creation when the host needs custom executors/watchdog policy. */
  createController?: (sessionId: string) => AgentMeshController;
  /** User-facing cap. ResourceCoordinator may reduce the effective value per run. */
  defaultMaxConcurrent?: number;
};

/** Durable-session registry for Team/Company orchestration. No the legacy core dependency. */
export class AgentMeshService {
  private readonly sessions = new Map<string, AgentMeshController>();
  private readonly messageHandlers = new Map<string, AgentMeshMessageHandler>();
  private readonly createController: (sessionId: string) => AgentMeshController;
  private readonly eventStoreFactory?: (sessionId: string) => DurableEventStore;
  private readonly listPersistedSessionIds?: () => Promise<string[]>;
  private discovery: Promise<void> | undefined;
  private configuredMaxConcurrent: number;

  constructor(options: AgentMeshServiceOptions = {}) {
    this.eventStoreFactory = options.eventStoreFactory;
    this.listPersistedSessionIds = options.listPersistedSessionIds;
    this.configuredMaxConcurrent = normalizeMaxConcurrent(
      options.defaultMaxConcurrent ?? DEFAULT_AGENT_MESH_MAX_CONCURRENT
    );
    this.createController =
      options.createController ??
      ((sessionId) => createAgentMeshController({ sessionId, eventStore: options.eventStoreFactory?.(sessionId) }));
  }

  register(sessionId: string, controller: AgentMeshController): void {
    const id = sessionId.trim();
    if (!id) throw new Error('AgentMesh sessionId is required.');
    if (this.sessions.has(id)) throw new Error(`AgentMesh session already exists: ${id}`);
    this.sessions.set(id, controller);
  }

  create(
    sessionId: string,
    options: Omit<AgentMeshControllerOptions, 'sessionId' | 'eventStore'> = {}
  ): AgentMeshController {
    const id = sessionId.trim();
    if (!id) throw new Error('AgentMesh sessionId is required.');
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const controller =
      Object.keys(options).length === 0
        ? this.createController(id)
        : createAgentMeshController({
            ...options,
            sessionId: id,
            eventStore: this.eventStoreFactory?.(id),
          });
    this.sessions.set(id, controller);
    return controller;
  }

  /** Rebuild a durable session before exposing it to Team/Company callers. */
  async recover(
    sessionId: string,
    options: Omit<AgentMeshControllerOptions, 'sessionId' | 'eventStore'> = {}
  ): Promise<AgentMeshController> {
    const id = sessionId.trim();
    if (!id) throw new Error('AgentMesh sessionId is required.');
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const controller = this.create(id, options);
    try {
      await controller.rehydrate();
      return controller;
    } catch (error) {
      this.sessions.delete(id);
      await controller.dispose();
      throw error;
    }
  }

  get(sessionId: string): AgentMeshController {
    const id = sessionId.trim();
    if (!id) throw new Error('AgentMesh sessionId is required.');
    const controller = this.sessions.get(id);
    if (!controller) throw new Error(`Unknown AgentMesh session: ${id}`);
    return controller;
  }

  listSessions(): string[] {
    return [...this.sessions.keys()];
  }

  /** Discover durable sessions once per process and rehydrate them before returning ids to the renderer. */
  async discoverSessions(): Promise<string[]> {
    this.discovery ??= (async () => {
      const ids = await this.listPersistedSessionIds?.();
      const pendingIds = [...new Set((ids ?? []).map((value) => value.trim()))].filter(
        (id) => id && !this.sessions.has(id)
      );
      await Promise.all(
        pendingIds.map(async (id) => {
          try {
            await this.recover(id);
          } catch (error) {
            console.warn(`[AgentMeshService] Failed to recover persisted session "${id}":`, error);
          }
        })
      );
    })();
    await this.discovery;
    return this.listSessions();
  }

  getConcurrencyPolicy(): AgentMeshConcurrencyPolicy {
    return {
      configuredMaxConcurrent: this.configuredMaxConcurrent,
      minimum: 1,
      maximum: MAX_AGENT_MESH_MAX_CONCURRENT,
    };
  }

  setConfiguredMaxConcurrent(value: number): AgentMeshConcurrencyPolicy {
    this.configuredMaxConcurrent = normalizeMaxConcurrent(value);
    return this.getConcurrencyPolicy();
  }

  /** Resolve a run cap from the proposal, user preference and live machine budget. */
  resolveMaxConcurrent(requested: number, resourceLimit?: number): number {
    const limits = [normalizeMaxConcurrent(requested), this.configuredMaxConcurrent];
    if (Number.isFinite(resourceLimit) && (resourceLimit ?? 0) > 0) limits.push(Math.trunc(resourceLimit!));
    return Math.max(1, Math.min(...limits));
  }

  overview(sessionId: string): AgentMeshOverview {
    const controller = this.get(sessionId);
    const agents = controller.listAgents();
    return {
      sessionId,
      agents: agents.map((agent) => {
        const inspection = controller.inspect(agent.agentId);
        const detail = inspection.currentAction?.detail?.slice(0, MAX_OVERVIEW_DETAIL_CHARS);
        return {
          agentId: agent.agentId,
          parentAgentId: agent.parentAgentId,
          status: inspection.status,
          stuck: inspection.stuck,
          objective: inspection.task?.objective,
          currentAction: inspection.currentAction
            ? {
                name: inspection.currentAction.name,
                detail,
              }
            : undefined,
          queuedMessages: inspection.queue.filter((message) => message.status === 'queued').length,
        };
      }),
      tokenUsage: controller.getTokenUsage(),
    };
  }

  snapshot(sessionId: string): AgentMeshSnapshot {
    const controller = this.get(sessionId);
    const agents = controller.listAgents();
    const inspections = agents.map((agent) => controller.inspect(agent.agentId));
    return {
      sessionId,
      agents,
      inspections,
      tasks: controller.listTasks(),
      messages: inspections
        .flatMap((inspection) => inspection.queue)
        .toSorted((left, right) => left.sequence - right.sequence)
        .slice(-MAX_SNAPSHOT_MESSAGES),
      tokenUsage: controller.getTokenUsage(),
    };
  }

  registerAgent(sessionId: string, agent: AgentMeshAgent): void {
    this.get(sessionId).registerAgent(agent);
  }

  submitTask(sessionId: string, task: AgentMeshTask, executor: AgentTaskExecutor): TaskId {
    return this.get(sessionId).submitTask(task, executor);
  }

  setMessageHandler(sessionId: string, handler: AgentMeshMessageHandler | undefined): void {
    const id = sessionId.trim();
    if (!id) throw new Error('AgentMesh sessionId is required.');
    if (handler) this.messageHandlers.set(id, handler);
    else this.messageHandlers.delete(id);
  }

  send(sessionId: string, input: AgentControllerMessageInput): AgentMessage {
    const message = this.get(sessionId).sendMessage(input);
    const handler = this.messageHandlers.get(sessionId.trim());
    if (handler) {
      void Promise.resolve(handler(input, message)).catch((error) =>
        console.error('[AgentMeshService] Message handler failed:', error)
      );
    }
    return message;
  }

  updateQueue(
    sessionId: string,
    actorId: AgentId,
    targetId: AgentId,
    messageId: MessageId,
    patch: Partial<Pick<AgentMessage, 'content' | 'deliveryMode'>>
  ): AgentMessage | undefined {
    return this.get(sessionId).updateQueuedMessage(actorId, targetId, messageId, patch);
  }

  removeQueue(sessionId: string, actorId: AgentId, targetId: AgentId, messageId: MessageId): AgentMessage | undefined {
    return this.get(sessionId).removeQueuedMessage(actorId, targetId, messageId);
  }

  reorderQueue(
    sessionId: string,
    actorId: AgentId,
    targetId: AgentId,
    messageId: MessageId,
    beforeMessageId?: MessageId
  ): AgentMessage[] {
    return this.get(sessionId).reorderQueuedMessage(actorId, targetId, messageId, beforeMessageId);
  }

  stop(sessionId: string, actorId: AgentId, taskId: TaskId, mode: 'graceful' | 'interrupt' | 'cancel'): void {
    this.get(sessionId).stopTask(actorId, taskId, mode);
  }

  heartbeat(sessionId: string, agentId: AgentId): void {
    this.get(sessionId).heartbeat(agentId);
  }

  inspect(sessionId: string, agentId: AgentId): AgentInspection {
    return this.get(sessionId).inspect(agentId);
  }

  getWorklog(sessionId: string, agentId?: AgentId, limit = DEFAULT_WORKLOG_LIMIT) {
    const boundedLimit = Math.max(1, Math.min(MAX_WORKLOG_LIMIT, Math.trunc(limit)));
    return this.get(sessionId).getWorklog(agentId).slice(-boundedLimit);
  }

  canSend(sessionId: string, fromAgentId: AgentId, toAgentId: AgentId, kind: AgentMessageKind): boolean {
    return this.get(sessionId).canSend(fromAgentId, toAgentId, kind);
  }

  watchdog(sessionId: string): AgentInspection[] {
    return this.get(sessionId).runWatchdogCheck();
  }

  async dispose(sessionId: string): Promise<void> {
    const controller = this.sessions.get(sessionId);
    if (!controller) return;
    this.sessions.delete(sessionId);
    this.messageHandlers.delete(sessionId);
    await controller.dispose();
  }

  async disposeAll(): Promise<void> {
    const ids = this.listSessions();
    await Promise.all(ids.map((id) => this.dispose(id)));
  }
}

export const createAgentMeshService = (options?: AgentMeshServiceOptions): AgentMeshService =>
  new AgentMeshService(options);

export type { AgentControllerMessageInput, AgentDeliveryIntent };
