import { bridge } from '@office-ai/platform';
import type { AgentId, AgentMessage, AgentMessageKind, MessageId, TaskId } from './mesh';
import type { AgentControllerMessageInput } from './controller';
import type { AgentMeshService } from './service';

export const AGENT_MESH_CHANNELS = {
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

type SessionRequest = { sessionId: string };
type CreateSessionRequest = SessionRequest;
export type AgentMeshResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type AgentMeshSendRequest = SessionRequest & AgentControllerMessageInput;
export type AgentMeshQueueUpdateRequest = SessionRequest & {
  actorId: AgentId;
  targetId: AgentId;
  messageId: MessageId;
  patch: Partial<Pick<AgentMessage, 'content' | 'deliveryMode'>>;
};
export type AgentMeshQueueRemoveRequest = Omit<AgentMeshQueueUpdateRequest, 'patch'>;
export type AgentMeshQueueReorderRequest = Omit<AgentMeshQueueUpdateRequest, 'patch'> & { beforeMessageId?: MessageId };
export type AgentMeshStopRequest = SessionRequest & {
  actorId: AgentId;
  taskId: TaskId;
  mode: 'graceful' | 'interrupt' | 'cancel';
};
export type AgentMeshInspectRequest = SessionRequest & { agentId: AgentId };
export type AgentMeshCanSendRequest = SessionRequest & {
  fromAgentId: AgentId;
  toAgentId: AgentId;
  kind: AgentMessageKind;
};

export type AgentMeshBridgeOptions = {
  /** Main-owned account authority. It is intentionally not derived from renderer input. */
  requireAuthenticatedAccount?: () => void;
};

const safe =
  <Req, Res>(label: string, requireAuthenticatedAccount: () => void, handler: (request: Req) => Res | Promise<Res>) =>
  async (request: Req): Promise<AgentMeshResult<Res>> => {
    try {
      requireAuthenticatedAccount();
      return { ok: true, data: await handler(request) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[AgentMeshBridge] ${label} failed:`, error);
      return { ok: false, error: message };
    }
  };

/** Register the provider-neutral AgentMesh IPC contract. Bootstrap owns the service lifecycle. */
export const registerAgentMeshBridge = (
  service: AgentMeshService,
  { requireAuthenticatedAccount = () => undefined }: AgentMeshBridgeOptions = {}
): void => {
  bridge.buildProvider<AgentMeshResult<string>, CreateSessionRequest>(AGENT_MESH_CHANNELS.create).provider(
    safe('create', requireAuthenticatedAccount, ({ sessionId }) => {
      service.create(sessionId);
      return sessionId;
    })
  );
  bridge.buildProvider<string[], void>(AGENT_MESH_CHANNELS.sessions).provider(async () => {
    requireAuthenticatedAccount();
    return service.discoverSessions();
  });
  bridge
    .buildProvider<AgentMeshResult<ReturnType<AgentMeshService['overview']>>, SessionRequest>(
      AGENT_MESH_CHANNELS.overview
    )
    .provider(safe('overview', requireAuthenticatedAccount, ({ sessionId }) => service.overview(sessionId)));
  bridge
    .buildProvider<AgentMeshResult<ReturnType<AgentMeshService['snapshot']>>, SessionRequest>(
      AGENT_MESH_CHANNELS.snapshot
    )
    .provider(safe('snapshot', requireAuthenticatedAccount, ({ sessionId }) => service.snapshot(sessionId)));
  bridge
    .buildProvider<AgentMeshResult<ReturnType<AgentMeshService['getConcurrencyPolicy']>>, void>(
      AGENT_MESH_CHANNELS.concurrencyGet
    )
    .provider(safe('concurrency-get', requireAuthenticatedAccount, () => service.getConcurrencyPolicy()));
  bridge
    .buildProvider<
      AgentMeshResult<ReturnType<AgentMeshService['setConfiguredMaxConcurrent']>>,
      { maxConcurrent: number }
    >(AGENT_MESH_CHANNELS.concurrencySet)
    .provider(
      safe('concurrency-set', requireAuthenticatedAccount, ({ maxConcurrent }) =>
        service.setConfiguredMaxConcurrent(maxConcurrent)
      )
    );
  bridge
    .buildProvider<AgentMeshResult<ReturnType<AgentMeshService['inspect']>>, AgentMeshInspectRequest>(
      AGENT_MESH_CHANNELS.inspect
    )
    .provider(
      safe('inspect', requireAuthenticatedAccount, ({ sessionId, agentId }) => service.inspect(sessionId, agentId))
    );
  bridge
    .buildProvider<
      AgentMeshResult<ReturnType<AgentMeshService['getWorklog']>>,
      SessionRequest & { agentId?: AgentId; limit?: number }
    >(AGENT_MESH_CHANNELS.worklog)
    .provider(
      safe('worklog', requireAuthenticatedAccount, ({ sessionId, agentId, limit }) =>
        service.getWorklog(sessionId, agentId, limit)
      )
    );
  bridge
    .buildProvider<AgentMeshResult<AgentMessage>, AgentMeshSendRequest>(AGENT_MESH_CHANNELS.send)
    .provider(safe('send', requireAuthenticatedAccount, ({ sessionId, ...input }) => service.send(sessionId, input)));
  bridge
    .buildProvider<AgentMeshResult<AgentMessage | undefined>, AgentMeshQueueUpdateRequest>(
      AGENT_MESH_CHANNELS.queueUpdate
    )
    .provider(
      safe('queue-update', requireAuthenticatedAccount, ({ sessionId, actorId, targetId, messageId, patch }) =>
        service.updateQueue(sessionId, actorId, targetId, messageId, patch)
      )
    );
  bridge
    .buildProvider<AgentMeshResult<AgentMessage | undefined>, AgentMeshQueueRemoveRequest>(
      AGENT_MESH_CHANNELS.queueRemove
    )
    .provider(
      safe('queue-remove', requireAuthenticatedAccount, ({ sessionId, actorId, targetId, messageId }) =>
        service.removeQueue(sessionId, actorId, targetId, messageId)
      )
    );
  bridge
    .buildProvider<AgentMeshResult<AgentMessage[]>, AgentMeshQueueReorderRequest>(AGENT_MESH_CHANNELS.queueReorder)
    .provider(
      safe(
        'queue-reorder',
        requireAuthenticatedAccount,
        ({ sessionId, actorId, targetId, messageId, beforeMessageId }) =>
          service.reorderQueue(sessionId, actorId, targetId, messageId, beforeMessageId)
      )
    );
  bridge
    .buildProvider<AgentMeshResult<void>, AgentMeshStopRequest>(AGENT_MESH_CHANNELS.stop)
    .provider(
      safe('stop', requireAuthenticatedAccount, ({ sessionId, actorId, taskId, mode }) =>
        service.stop(sessionId, actorId, taskId, mode)
      )
    );
  bridge
    .buildProvider<AgentMeshResult<void>, SessionRequest & { agentId: AgentId }>(AGENT_MESH_CHANNELS.heartbeat)
    .provider(
      safe('heartbeat', requireAuthenticatedAccount, ({ sessionId, agentId }) => service.heartbeat(sessionId, agentId))
    );
  bridge
    .buildProvider<AgentMeshResult<ReturnType<AgentMeshService['watchdog']>>, SessionRequest>(
      AGENT_MESH_CHANNELS.watchdog
    )
    .provider(safe('watchdog', requireAuthenticatedAccount, ({ sessionId }) => service.watchdog(sessionId)));
  bridge
    .buildProvider<AgentMeshResult<boolean>, AgentMeshCanSendRequest>(AGENT_MESH_CHANNELS.canSend)
    .provider(
      safe('can-send', requireAuthenticatedAccount, ({ sessionId, fromAgentId, toAgentId, kind }) =>
        service.canSend(sessionId, fromAgentId, toAgentId, kind)
      )
    );
};
