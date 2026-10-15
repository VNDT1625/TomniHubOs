/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import {
  BUILTIN_CORE_WORKSPACE_NAME,
  createCoreWorkspaceServer,
} from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';

const SSE_PATH = '/sse';
const MESSAGE_PATH = '/message';
/** A host is kept per workspace; the oldest is closed beyond this many so long sessions do not pile up servers. */
const MAX_HOSTS = 8;

export type CoreWorkspaceMcpHost = {
  url: string;
  headers: Array<{ name: string; value: string }>;
  close: () => Promise<void>;
};

const hosts = new Map<string, Promise<CoreWorkspaceMcpHost>>();

const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const createHost = async (workspace: string, focusedFileToolsOnly = false): Promise<CoreWorkspaceMcpHost> => {
  const authorization = `Bearer ${randomUUID()}`;
  const transports = new Map<string, SSEServerTransport>();

  const handle = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    if (!secureEqual(request.headers.authorization ?? '', authorization)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized.');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === SSE_PATH) {
      const transport = new SSEServerTransport(MESSAGE_PATH, response);
      transports.set(transport.sessionId, transport);
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP transport exposes onclose only.
      transport.onclose = () => transports.delete(transport.sessionId);
      // Reading only: writing, editing and commands belong to the surfaces that govern them.
      await createCoreWorkspaceServer({ workspace, readOnly: true, focusedFileToolsOnly }).connect(transport);
      return;
    }
    if (request.method === 'POST' && url.pathname === MESSAGE_PATH) {
      const transport = transports.get(url.searchParams.get('sessionId') ?? '');
      if (!transport) {
        response.writeHead(404).end('No active MCP session.');
        return;
      }
      await transport.handlePostMessage(request, response);
      return;
    }
    response.writeHead(404).end();
  };

  const server = http.createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500).end('Internal server error.');
      else response.destroy();
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Could not resolve the Core workspace MCP port.'));
    });
  });
  return {
    url: `http://127.0.0.1:${port}${SSE_PATH}`,
    headers: [{ name: 'Authorization', value: authorization }],
    close: () =>
      new Promise<void>((resolve) => {
        for (const transport of transports.values()) void transport.close();
        transports.clear();
        server.close(() => resolve());
      }),
  };
};

/** One authenticated loopback host per workspace, serving the read-only Core workspace tools. */
export const startCoreWorkspaceReadHost = (workspace: string, focusedFileToolsOnly = false): Promise<CoreWorkspaceMcpHost> => {
  const key = `${workspace}:${focusedFileToolsOnly ? 'file-tools' : 'all'}`;
  const existing = hosts.get(key);
  if (existing) return existing;
      const started = createHost(workspace, focusedFileToolsOnly).catch((error: unknown) => {
    hosts.delete(key);
    throw error;
  });
      hosts.set(key, started);
  if (hosts.size > MAX_HOSTS) {
    const oldest = hosts.keys().next().value;
            if (oldest !== undefined && oldest !== key) {
      const evicted = hosts.get(oldest);
      hosts.delete(oldest);
      void evicted?.then((host) => host.close()).catch((): void => undefined);
    }
  }
      return started;
};

/** Focused eager host: only tomny_read and tomny_search; no mutations or shell. */
export const startAttachedFileToolsHost = (workspace: string): Promise<CoreWorkspaceMcpHost> =>
  startCoreWorkspaceReadHost(workspace, true);

export const stopCoreWorkspaceReadHosts = async (): Promise<void> => {
  const running = [...hosts.values()];
  hosts.clear();
  await Promise.all(running.map((host) => host.then((started) => started.close()).catch((): void => undefined)));
};

export { BUILTIN_CORE_WORKSPACE_NAME };
