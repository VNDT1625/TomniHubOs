import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createSecretContextServer, BUILTIN_SECRET_CONTEXT_NAME } from './server';
import { getSecretContextUseRouter } from './wiring';

const SSE_PATH = '/sse';
const MESSAGE_PATH = '/message';
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const MIN_IDLE_TIMEOUT_MS = 100;
const MAX_IDLE_TIMEOUT_MS = 30 * 60_000;
const MAX_LIVE_HOSTS = 64;

export type SecretContextMcpHostScope = Readonly<{
  id: string;
  surface: string;
  allowedTabIds?: readonly string[];
}>;

export type SecretContextMcpHostOptions = Readonly<{
  scope?: SecretContextMcpHostScope;
  idleTimeoutMs?: number;
}>;

export type SecretContextMcpHost = {
  url: string;
  port: number;
  headers: Array<{ name: string; value: string }>;
  scope?: Readonly<{ id: string; surface: string; allowedTabIds: readonly string[] }>;
  close: () => Promise<void>;
};

type NormalizedHostOptions = {
  key: string;
  signature: string;
  idleTimeoutMs: number;
  scope?: Readonly<{ id: string; surface: string; allowedTabIds: readonly string[] }>;
};

type ManagedSecretContextMcpHost = SecretContextMcpHost & {
  key: string;
  signature: string;
  closeRaw: () => Promise<void>;
};

const hosts = new Map<string, ManagedSecretContextMcpHost>();
const startups = new Map<string, { signature: string; promise: Promise<ManagedSecretContextMcpHost> }>();

const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const normalizeIdleTimeout = (value: number | undefined): number => {
  if (value === undefined) return DEFAULT_IDLE_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < MIN_IDLE_TIMEOUT_MS || value > MAX_IDLE_TIMEOUT_MS) {
    throw new Error(
      `Secret context MCP idle timeout must be between ${MIN_IDLE_TIMEOUT_MS} and ${MAX_IDLE_TIMEOUT_MS} milliseconds.`
    );
  }
  return value;
};

const normalizeHostOptions = (options: SecretContextMcpHostOptions): NormalizedHostOptions => {
  const idleTimeoutMs = normalizeIdleTimeout(options.idleTimeoutMs);
  if (!options.scope) {
    // Compatibility callers remain supported, but each receives an isolated bearer and endpoint.
    const key = `ephemeral:${randomUUID()}`;
    return { key, signature: key, idleTimeoutMs };
  }
  const id = options.scope.id.trim();
  const surface = options.scope.surface.trim();
  if (!id) throw new Error('Secret context MCP host scope id is required.');
  if (!surface) throw new Error('Secret context MCP host surface claim is required.');
  const allowedTabIds = [...new Set(options.scope.allowedTabIds?.map((tabId) => tabId.trim()).filter(Boolean) ?? [])]
    .toSorted()
    .slice(0, 64);
  const scope = Object.freeze({ id, surface, allowedTabIds: Object.freeze(allowedTabIds) });
  return {
    key: `scope:${id}`,
    signature: JSON.stringify([surface, allowedTabIds, idleTimeoutMs]),
    idleTimeoutMs,
    scope,
  };
};

const stopManagedHost = async (managed: ManagedSecretContextMcpHost): Promise<void> => {
  if (hosts.get(managed.key) === managed) hosts.delete(managed.key);
  await managed.closeRaw();
};

const createSecretContextMcpHost = async (normalized: NormalizedHostOptions): Promise<ManagedSecretContextMcpHost> => {
  const authorization = `Bearer ${randomUUID()}`;
  const transports = new Map<string, SSEServerTransport>();
  let activeRequests = 0;
  let closed = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let managed!: ManagedSecretContextMcpHost;

  const clearIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const scheduleIdleTeardown = (): void => {
    clearIdleTimer();
    if (closed || activeRequests > 0) return;
    idleTimer = setTimeout(() => {
      void stopManagedHost(managed).catch(() => {
        console.error('[SecretContextMCP] Idle teardown failed.');
      });
    }, normalized.idleTimeoutMs);
    idleTimer.unref?.();
  };

  const server = http.createServer((request, response) => {
    void handle(request, response).catch(() => {
      console.error('[SecretContextMCP] Request failed.');
      if (!response.headersSent) response.writeHead(500).end('Secret context MCP request failed.');
      else response.end();
    });
  });

  const handle = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    if (!secureEqual(request.headers.authorization ?? '', authorization)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized.');
      return;
    }
    activeRequests += 1;
    clearIdleTimer();
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === SSE_PATH) {
        const transport = new SSEServerTransport(MESSAGE_PATH, response);
        transports.set(transport.sessionId, transport);
        // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK transport exposes onclose only.
        transport.onclose = () => {
          transports.delete(transport.sessionId);
          scheduleIdleTeardown();
        };
        const authority = normalized.scope
          ? {
              scopeId: normalized.scope.id,
              surface: normalized.scope.surface,
              allowedTabIds:
                normalized.scope.allowedTabIds.length > 0 ? new Set(normalized.scope.allowedTabIds) : undefined,
            }
          : undefined;
        const mcp: McpServer = createSecretContextServer({ router: getSecretContextUseRouter(), authority });
        try {
          await mcp.connect(transport);
        } catch (error) {
          transports.delete(transport.sessionId);
          throw error;
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === MESSAGE_PATH) {
        const transport = transports.get(url.searchParams.get('sessionId') ?? '');
        if (!transport) {
          response.writeHead(404).end('No active MCP transport for the given session id.');
          return;
        }
        await transport.handlePostMessage(request, response);
        return;
      }
      response.writeHead(404).end();
    } finally {
      activeRequests -= 1;
      scheduleIdleTeardown();
    }
  };

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Could not resolve the secret context MCP loopback port.'));
    });
  });

  managed = {
    key: normalized.key,
    signature: normalized.signature,
    url: `http://127.0.0.1:${port}${SSE_PATH}`,
    port,
    headers: [{ name: 'Authorization', value: authorization }],
    scope: normalized.scope,
    close: () => stopManagedHost(managed),
    closeRaw: async () => {
      if (closed) return;
      closed = true;
      clearIdleTimer();
      const closing = [...transports.values()].map((transport) => transport.close());
      transports.clear();
      await Promise.allSettled(closing);
      await new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
  hosts.set(normalized.key, managed);
  scheduleIdleTeardown();
  console.log(
    `[SecretContextMCP] Listening on loopback (server: ${BUILTIN_SECRET_CONTEXT_NAME}, authority: ${normalized.scope ? 'scoped' : 'ephemeral'}).`
  );
  return managed;
};

/** Start an authenticated host. Scoped hosts are reused only inside the same immutable session authority. */
export const startSecretContextMcpHost = async (
  options: SecretContextMcpHostOptions = {}
): Promise<SecretContextMcpHost> => {
  const normalized = normalizeHostOptions(options);
  const existing = hosts.get(normalized.key);
  if (existing?.signature === normalized.signature) return existing;
  if (existing) await stopManagedHost(existing);

  const pending = startups.get(normalized.key);
  if (pending) {
    const started = await pending.promise;
    if (pending.signature === normalized.signature) return started;
    await stopManagedHost(started);
    return startSecretContextMcpHost(options);
  }
  if (hosts.size + startups.size >= MAX_LIVE_HOSTS) {
    throw new Error(`Secret context MCP live host limit of ${MAX_LIVE_HOSTS} reached.`);
  }

  const promise = createSecretContextMcpHost(normalized);
  startups.set(normalized.key, { signature: normalized.signature, promise });
  try {
    return await promise;
  } finally {
    if (startups.get(normalized.key)?.promise === promise) startups.delete(normalized.key);
  }
};

/** Resolve only a named scoped host. Ephemeral compatibility hosts are intentionally undiscoverable. */
export const getSecretContextMcpHost = (scopeId?: string): SecretContextMcpHost | undefined =>
  scopeId ? hosts.get(`scope:${scopeId.trim()}`) : undefined;

/** Stop one scoped host, or every scoped/ephemeral host when no scope is supplied. */
export const stopSecretContextMcpHost = async (scopeId?: string): Promise<void> => {
  if (scopeId) {
    const key = `scope:${scopeId.trim()}`;
    const pending = startups.get(key);
    if (pending) await pending.promise.catch((): void => undefined);
    const scoped = hosts.get(key);
    if (scoped) await stopManagedHost(scoped);
    return;
  }
  await Promise.allSettled([...startups.values()].map((entry) => entry.promise));
  await Promise.all([...hosts.values()].map(stopManagedHost));
};
