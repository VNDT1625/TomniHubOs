/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * In-process host for the Testing MCP server (Yêu cầu 2b — Agent plane, Task
 * 15.1).
 *
 * Unlike the standalone stdio servers (`imageGenServer`, `resourceServer`,
 * `companyServer`), the Testing MCP server drives a **live Main-process
 * singleton** ({@link ITestOrchestrator}, which owns `WebContentsView` test
 * tabs). It therefore cannot run in a separate `node` process. Instead we host
 * it **in the Main process** on a loopback HTTP server using the MCP SDK's
 * dependency-free {@link SSEServerTransport}, and register it in the MCP catalog
 * as an `sse` server pointing at the loopback URL — so tomnycore's agent reaches
 * it like any other MCP server (the design's "Agent plane").
 *
 * Both planes (this MCP host + the `testingBridge` UI plane) share the SAME
 * orchestrator instance, so an agent-run session shows up in the Testing page
 * and vice-versa (single source of truth).
 *
 * Security: the server binds to `127.0.0.1` only and requires a runtime-only
 * bearer token for both the SSE stream and JSON-RPC POSTs. The token is exposed
 * only through the live host contract and is never written to the MCP catalog.
 *
 * Process boundary: Main-process (Node.js) module — no DOM APIs.
 */

import * as http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTestingServer } from '../resources/builtinMcp/testingServer';
import { BUILTIN_TESTING_NAME } from '../resources/builtinMcp/testingServer';
import type { ITestOrchestrator } from './testOrchestrator';

/** Path the SSE stream is established on (GET). */
const SSE_PATH = '/sse';

/** Path clients POST JSON-RPC messages to (POST), with `?sessionId=`. */
const MESSAGE_PATH = '/message';

/** A running in-process MCP host. */
export type TestingMcpHost = {
  /** The loopback base URL of the SSE endpoint (e.g. `http://127.0.0.1:51234/sse`). */
  url: string;
  /** The port the loopback server listens on. */
  port: number;
  /** Runtime-only request headers. Values must never be persisted. */
  headers: Array<{ name: string; value: string }>;
  /** Stop the host and close all connections. */
  close: () => Promise<void>;
};

/** Module-level singleton so repeated bootstraps reuse one host. */
let host: TestingMcpHost | undefined;

const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

/**
 * Start (once) the in-process Testing MCP host bound to the shared orchestrator.
 *
 * The HTTP server binds to an ephemeral loopback port. Each SSE connection gets
 * its own {@link SSEServerTransport} + a fresh {@link McpServer} bound to the
 * same orchestrator, so concurrent agent connections are isolated at the
 * transport level while sharing test state.
 *
 * @param orchestrator The shared test orchestrator both planes drive.
 * @returns The running host (url + port + close), reused on subsequent calls.
 */
const createTestingMcpHost = async (orchestrator: ITestOrchestrator): Promise<TestingMcpHost> => {
  const authorization = `Bearer ${randomUUID()}`;

  /** Active transports keyed by their session id, for routing POSTed messages. */
  const transports = new Map<string, SSEServerTransport>();

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      console.error('[TestingMCP] Request handling failed.');
      if (!res.headersSent) res.writeHead(500).end('Internal server error.');
      else res.destroy();
    });
  });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (!secureEqual(req.headers.authorization ?? '', authorization)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized.');
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    // GET /sse → open a new SSE stream + MCP server for this client.
    if (req.method === 'GET' && url.pathname === SSE_PATH) {
      const transport = new SSEServerTransport(MESSAGE_PATH, res);
      transports.set(transport.sessionId, transport);
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK transport exposes onclose only.
      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };
      const mcp: McpServer = createTestingServer({ orchestrator });
      try {
        await mcp.connect(transport);
      } catch (error) {
        transports.delete(transport.sessionId);
        console.error('[TestingMCP] Failed to connect SSE transport:', error);
        if (!res.headersSent) res.writeHead(500).end();
      }
      return;
    }

    // POST /message?sessionId=... → deliver a JSON-RPC message to that session.
    if (req.method === 'POST' && url.pathname === MESSAGE_PATH) {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404).end('No active session for the given sessionId.');
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404).end();
  };

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('[TestingMCP] Could not resolve the loopback port.'));
    });
  });

  host = {
    url: `http://127.0.0.1:${port}${SSE_PATH}`,
    port,
    headers: [{ name: 'Authorization', value: authorization }],
    close: () =>
      new Promise<void>((resolve) => {
        for (const transport of transports.values()) void transport.close();
        transports.clear();
        server.close(() => resolve());
      }),
  };
  console.log(`[TestingMCP] In-process MCP host listening on ${host.url} (server: ${BUILTIN_TESTING_NAME}).`);
  return host;
};

let hostStartup: Promise<TestingMcpHost> | undefined;

/** Deduplicate concurrent startup from native bootstrap and lazy Core capability resolution. */
export const startTestingMcpHost = async (orchestrator: ITestOrchestrator): Promise<TestingMcpHost> => {
  if (host) return host;
  const startup = (hostStartup ??= createTestingMcpHost(orchestrator));
  try {
    return await startup;
  } finally {
    if (hostStartup === startup) hostStartup = undefined;
  }
};

/** Return the running host, if started. */
export const getTestingMcpHost = (): TestingMcpHost | undefined => host;

/** Stop the host (deterministic teardown). */
export const stopTestingMcpHost = async (): Promise<void> => {
  await hostStartup?.catch((): void => undefined);
  if (!host) return;
  await host.close();
  host = undefined;
};
