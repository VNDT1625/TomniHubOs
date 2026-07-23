import * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CoreCapabilityPermissionRequest } from '@process/experimentalCore/adapters';
import { registerAgentExecutionPermissionScope } from './executionScope';
import {
  createAgentOrchestratorServer,
  BUILTIN_AGENT_ORCHESTRATOR_NAME,
  type AgentOrchestratorExecutionClaims,
} from './server';
import { flushAgentOrchestratorServices, getAgentOrchestratorServices } from './wiring';

const SSE_PATH = '/sse';
const MESSAGE_PATH = '/message';
const PUBLIC_HOST_KEY = 'public';
const MAX_SCOPED_HOSTS = 64;

export type AgentOrchestratorMcpHostScope = Readonly<{
  id: string;
  executionClaims: Omit<AgentOrchestratorExecutionClaims, 'executionScopeId'>;
  requestPermission?: (request: CoreCapabilityPermissionRequest) => Promise<boolean>;
}>;

export type AgentOrchestratorMcpHostOptions = Readonly<{
  scope?: AgentOrchestratorMcpHostScope;
}>;

export type AgentOrchestratorMcpHost = {
  url: string;
  port: number;
  headers: Array<{ name: string; value: string }>;
  close: () => Promise<void>;
};

type NormalizedHostOptions = {
  key: string;
  signature: string;
  scope?: {
    id: string;
    executionClaims: AgentOrchestratorExecutionClaims;
    requestPermission?: AgentOrchestratorMcpHostScope['requestPermission'];
  };
};

type ManagedAgentOrchestratorMcpHost = AgentOrchestratorMcpHost & {
  key: string;
  signature: string;
  closeRaw: () => Promise<void>;
  refreshPermissionScope: (requestPermission?: AgentOrchestratorMcpHostScope['requestPermission']) => void;
};

const hosts = new Map<string, ManagedAgentOrchestratorMcpHost>();
const startups = new Map<string, { signature: string; promise: Promise<ManagedAgentOrchestratorMcpHost> }>();

const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const normalizeHostOptions = (options: AgentOrchestratorMcpHostOptions = {}): NormalizedHostOptions => {
  if (!options.scope) return { key: PUBLIC_HOST_KEY, signature: PUBLIC_HOST_KEY };
  const id = options.scope.id.trim();
  if (!id) throw new Error('Agent orchestrator host scope id is required.');
  const workspace = options.scope.executionClaims.workspace?.trim() || undefined;
  const surface = options.scope.executionClaims.surface.trim();
  if (!surface) throw new Error('Agent orchestrator host surface claim is required.');
  const permissionMode = options.scope.executionClaims.permissionMode;
  if (permissionMode !== 'read-only' && permissionMode !== 'workspace-write' && permissionMode !== 'full-access') {
    throw new Error('Agent orchestrator host permission claim is invalid.');
  }
  const executionClaims: AgentOrchestratorExecutionClaims = Object.freeze({
    workspace,
    surface,
    permissionMode,
    executionScopeId: id,
  });
  return {
    key: `scope:${id}`,
    signature: JSON.stringify([workspace ?? null, surface, permissionMode]),
    scope: { id, executionClaims, requestPermission: options.scope.requestPermission },
  };
};

const stopManagedHost = async (managed: ManagedAgentOrchestratorMcpHost): Promise<void> => {
  if (hosts.get(managed.key) === managed) hosts.delete(managed.key);
  await managed.closeRaw();
};

/** Start one authenticated loopback MCP host bound to immutable parent execution claims. */
const createAgentOrchestratorMcpHost = async (
  normalized: NormalizedHostOptions
): Promise<ManagedAgentOrchestratorMcpHost> => {
  const deps = await getAgentOrchestratorServices();
  const token = crypto.randomUUID();
  const authorization = `Bearer ${token}`;
  const transports = new Map<string, SSEServerTransport>();
  let releasePermissionScope: (() => void) | undefined;
  const refreshPermissionScope = (
    requestPermission: AgentOrchestratorMcpHostScope['requestPermission'] | undefined
  ): void => {
    releasePermissionScope?.();
    releasePermissionScope =
      normalized.scope && requestPermission
        ? registerAgentExecutionPermissionScope(normalized.scope.id, requestPermission)
        : undefined;
  };

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error('[AgentOrchestratorMCP] Request failed:', error);
      if (!response.headersSent) response.writeHead(500).end('Agent orchestrator MCP request failed.');
      else response.end();
    });
  });

  const handle = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    if (!secureEqual(request.headers.authorization ?? '', authorization)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized.');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === SSE_PATH) {
      const transport = new SSEServerTransport(MESSAGE_PATH, response);
      transports.set(transport.sessionId, transport);
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK transport exposes onclose only.
      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };
      const mcp: McpServer = createAgentOrchestratorServer({
        ...deps,
        executionClaims: normalized.scope?.executionClaims,
      });
      try {
        await mcp.connect(transport);
      } catch (error) {
        transports.delete(transport.sessionId);
        throw error;
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === MESSAGE_PATH) {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = transports.get(sessionId);
      if (!transport) {
        response.writeHead(404).end('No active MCP transport for the given session id.');
        return;
      }
      await transport.handlePostMessage(request, response);
      return;
    }
    response.writeHead(404).end();
  };

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Could not resolve the agent orchestrator MCP loopback port.'));
    });
  });

  refreshPermissionScope(normalized.scope?.requestPermission);
  let managed!: ManagedAgentOrchestratorMcpHost;
  managed = {
    key: normalized.key,
    signature: normalized.signature,
    url: `http://127.0.0.1:${port}${SSE_PATH}`,
    port,
    headers: [{ name: 'Authorization', value: authorization }],
    refreshPermissionScope,
    close: () => stopManagedHost(managed),
    closeRaw: () =>
      new Promise<void>((resolve) => {
        releasePermissionScope?.();
        releasePermissionScope = undefined;
        for (const transport of transports.values()) void transport.close();
        transports.clear();
        server.close(() => resolve());
      }),
  };
  console.log(
    `[AgentOrchestratorMCP] Listening on ${managed.url} (server: ${BUILTIN_AGENT_ORCHESTRATOR_NAME}, scope: ${normalized.key}).`
  );
  return managed;
};

/** Deduplicate startup per parent scope while rotating endpoint/token whenever immutable claims change. */
export const startAgentOrchestratorMcpHost = async (
  options: AgentOrchestratorMcpHostOptions = {}
): Promise<AgentOrchestratorMcpHost> => {
  const normalized = normalizeHostOptions(options);
  const existing = hosts.get(normalized.key);
  if (existing?.signature === normalized.signature) {
    if (normalized.scope?.requestPermission) {
      existing.refreshPermissionScope(normalized.scope.requestPermission);
    }
    return existing;
  }
  if (existing) await stopManagedHost(existing);

  const pending = startups.get(normalized.key);
  if (pending) {
    const started = await pending.promise;
    if (pending.signature === normalized.signature) {
      if (normalized.scope?.requestPermission) {
        started.refreshPermissionScope(normalized.scope.requestPermission);
      }
      return started;
    }
    await stopManagedHost(started);
    return startAgentOrchestratorMcpHost(options);
  }
  if (
    normalized.key !== PUBLIC_HOST_KEY &&
    [...hosts.keys()].filter((key) => key !== PUBLIC_HOST_KEY).length >= MAX_SCOPED_HOSTS
  ) {
    throw new Error(`Agent orchestrator scoped host limit of ${MAX_SCOPED_HOSTS} reached.`);
  }

  const promise = createAgentOrchestratorMcpHost(normalized);
  startups.set(normalized.key, { signature: normalized.signature, promise });
  try {
    const started = await promise;
    hosts.set(normalized.key, started);
    return started;
  } finally {
    if (startups.get(normalized.key)?.promise === promise) startups.delete(normalized.key);
  }
};

export const getAgentOrchestratorMcpHost = (scopeId?: string): AgentOrchestratorMcpHost | undefined =>
  hosts.get(scopeId ? `scope:${scopeId.trim()}` : PUBLIC_HOST_KEY);

/** Stop one scoped host, or every host when no scope is supplied. Durable job results remain intact. */
export const stopAgentOrchestratorMcpHost = async (scopeId?: string): Promise<void> => {
  if (scopeId) {
    const key = `scope:${scopeId.trim()}`;
    const pending = startups.get(key);
    if (pending) await pending.promise.catch((): void => undefined);
    const scoped = hosts.get(key);
    if (scoped) await stopManagedHost(scoped);
  } else {
    await Promise.allSettled([...startups.values()].map((entry) => entry.promise));
    await Promise.all([...hosts.values()].map(stopManagedHost));
  }
  await flushAgentOrchestratorServices();
};
