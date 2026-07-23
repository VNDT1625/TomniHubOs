import { bridge } from '@office-ai/platform';
import type {
  AgentMeshCanSendRequest,
  AgentMeshInspectRequest,
  AgentMeshQueueRemoveRequest,
  AgentMeshQueueReorderRequest,
  AgentMeshQueueUpdateRequest,
  AgentMeshResult,
  AgentMeshSendRequest,
  AgentMeshStopRequest,
} from '@process/agentRuntime/agentMesh/ipc';
import type {
  AgentMeshConcurrencyPolicy,
  AgentMeshOverview,
  AgentMeshSnapshot,
} from '@process/agentRuntime/agentMesh/service';
import type { AgentWorklogEntry } from '@process/agentRuntime/agentMesh/controller';
import type {
  AgentId,
  AgentInspection,
  AgentMessage,
  AgentMessageKind,
  MessageId,
  TaskId,
} from '@process/agentRuntime/agentMesh/mesh';

const CHANNELS = {
  create: 'agent-mesh.create',
  sessions: 'agent-mesh.sessions',
  overview: 'agent-mesh.overview',
  snapshot: 'agent-mesh.snapshot',
  concurrencyGet: 'agent-mesh.concurrency-get',
  concurrencySet: 'agent-mesh.concurrency-set',
  inspect: 'agent-mesh.inspect',
  worklog: 'agent-mesh.worklog',
  send: 'agent-mesh.send',
  queueUpdate: 'agent-mesh.queue-update',
  queueRemove: 'agent-mesh.queue-remove',
  queueReorder: 'agent-mesh.queue-reorder',
  stop: 'agent-mesh.stop',
  heartbeat: 'agent-mesh.heartbeat',
  watchdog: 'agent-mesh.watchdog',
  canSend: 'agent-mesh.can-send',
} as const;

const TIMEOUT_MS = 4000;

const invokeWithTimeout = <T>(call: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('[agentMeshClient] AgentMesh bridge timed out (not wired yet?).'));
    }, TIMEOUT_MS);
    call().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });

const channels = {
  create: bridge.buildProvider<AgentMeshResult<string>, { sessionId: string }>(CHANNELS.create),
  sessions: bridge.buildProvider<string[], void>(CHANNELS.sessions),
  overview: bridge.buildProvider<AgentMeshResult<AgentMeshOverview>, { sessionId: string }>(CHANNELS.overview),
  snapshot: bridge.buildProvider<AgentMeshResult<AgentMeshSnapshot>, { sessionId: string }>(CHANNELS.snapshot),
  concurrencyGet: bridge.buildProvider<AgentMeshResult<AgentMeshConcurrencyPolicy>, void>(CHANNELS.concurrencyGet),
  concurrencySet: bridge.buildProvider<AgentMeshResult<AgentMeshConcurrencyPolicy>, { maxConcurrent: number }>(
    CHANNELS.concurrencySet
  ),
  inspect: bridge.buildProvider<AgentMeshResult<AgentInspection>, AgentMeshInspectRequest>(CHANNELS.inspect),
  worklog: bridge.buildProvider<
    AgentMeshResult<AgentWorklogEntry[]>,
    { sessionId: string; agentId?: AgentId; limit?: number }
  >(CHANNELS.worklog),
  send: bridge.buildProvider<AgentMeshResult<AgentMessage>, AgentMeshSendRequest>(CHANNELS.send),
  queueUpdate: bridge.buildProvider<AgentMeshResult<AgentMessage | undefined>, AgentMeshQueueUpdateRequest>(
    CHANNELS.queueUpdate
  ),
  queueRemove: bridge.buildProvider<AgentMeshResult<AgentMessage | undefined>, AgentMeshQueueRemoveRequest>(
    CHANNELS.queueRemove
  ),
  queueReorder: bridge.buildProvider<AgentMeshResult<AgentMessage[]>, AgentMeshQueueReorderRequest>(
    CHANNELS.queueReorder
  ),
  stop: bridge.buildProvider<AgentMeshResult<void>, AgentMeshStopRequest>(CHANNELS.stop),
  heartbeat: bridge.buildProvider<AgentMeshResult<void>, { sessionId: string; agentId: AgentId }>(CHANNELS.heartbeat),
  watchdog: bridge.buildProvider<AgentMeshResult<AgentInspection[]>, { sessionId: string }>(CHANNELS.watchdog),
  canSend: bridge.buildProvider<AgentMeshResult<boolean>, AgentMeshCanSendRequest>(CHANNELS.canSend),
};

export const agentMeshClient = {
  create: (sessionId: string): Promise<AgentMeshResult<string>> =>
    invokeWithTimeout(() => channels.create.invoke({ sessionId })),
  sessions: (): Promise<string[]> => invokeWithTimeout(() => channels.sessions.invoke()),
  overview: (sessionId: string): Promise<AgentMeshResult<AgentMeshOverview>> =>
    invokeWithTimeout(() => channels.overview.invoke({ sessionId })),
  snapshot: (sessionId: string): Promise<AgentMeshResult<AgentMeshSnapshot>> =>
    invokeWithTimeout(() => channels.snapshot.invoke({ sessionId })),
  getConcurrencyPolicy: (): Promise<AgentMeshResult<AgentMeshConcurrencyPolicy>> =>
    invokeWithTimeout(() => channels.concurrencyGet.invoke()),
  setConcurrencyPolicy: (maxConcurrent: number): Promise<AgentMeshResult<AgentMeshConcurrencyPolicy>> =>
    invokeWithTimeout(() => channels.concurrencySet.invoke({ maxConcurrent })),
  inspect: (request: AgentMeshInspectRequest): Promise<AgentMeshResult<AgentInspection>> =>
    invokeWithTimeout(() => channels.inspect.invoke(request)),
  worklog: (sessionId: string, agentId?: AgentId, limit = 200): Promise<AgentMeshResult<AgentWorklogEntry[]>> =>
    invokeWithTimeout(() => channels.worklog.invoke({ sessionId, agentId, limit })),
  send: (request: AgentMeshSendRequest): Promise<AgentMeshResult<AgentMessage>> =>
    invokeWithTimeout(() => channels.send.invoke(request)),
  updateQueue: (request: AgentMeshQueueUpdateRequest): Promise<AgentMeshResult<AgentMessage | undefined>> =>
    invokeWithTimeout(() => channels.queueUpdate.invoke(request)),
  removeQueue: (request: AgentMeshQueueRemoveRequest): Promise<AgentMeshResult<AgentMessage | undefined>> =>
    invokeWithTimeout(() => channels.queueRemove.invoke(request)),
  reorderQueue: (request: AgentMeshQueueReorderRequest): Promise<AgentMeshResult<AgentMessage[]>> =>
    invokeWithTimeout(() => channels.queueReorder.invoke(request)),
  stop: (request: AgentMeshStopRequest): Promise<AgentMeshResult<void>> =>
    invokeWithTimeout(() => channels.stop.invoke(request)),
  heartbeat: (sessionId: string, agentId: AgentId): Promise<AgentMeshResult<void>> =>
    invokeWithTimeout(() => channels.heartbeat.invoke({ sessionId, agentId })),
  watchdog: (sessionId: string): Promise<AgentMeshResult<AgentInspection[]>> =>
    invokeWithTimeout(() => channels.watchdog.invoke({ sessionId })),
  canSend: (request: AgentMeshCanSendRequest): Promise<AgentMeshResult<boolean>> =>
    invokeWithTimeout(() => channels.canSend.invoke(request)),
};

export type { AgentId, AgentMessageKind, MessageId, TaskId };
