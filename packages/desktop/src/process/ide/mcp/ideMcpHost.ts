/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * In-process MCP host for the IDE server — the bridge that lets an agent (a
 * company role, Claude Code over ACP, tomnyagentic, …) use the IDE / repo-intelligence
 * tools (list/read/search/find-definition/find-references/scan-repo).
 *
 * ## Why an in-process HTTP/SSE host (not a stdio child)
 *
 * The IDE service walks arbitrary folders with Node `fs` and reuses live
 * Main-process helpers. Like the Cron / Testing / Browser-Control hosts, it runs
 * the `McpServer` in the Main process on a loopback HTTP server using the MCP
 * SDK's {@link SSEServerTransport} and registers it in the catalog as an `sse`
 * server. This module mirrors `process/cron/cronMcpHost.ts` 1:1.
 *
 * Each SSE connection gets its own transport + a fresh {@link McpServer} bound to
 * the same fs-backed IDE service, so concurrent agent connections are isolated
 * at the transport level.
 *
 * Process boundary: Main-process (Node.js / Electron) module.
 */

import * as http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createStreamableHttpRouter } from '@process/omni-gateway/omniGatewayStreamableHttp';

import { BUILTIN_IDE_NAME } from './ideServer';

/** Path the SSE stream is established on (GET). */
const SSE_PATH = '/sse';

/** Path clients POST JSON-RPC messages to (POST), with `?sessionId=`. */
const MESSAGE_PATH = '/message';

/** A running in-process IDE MCP host. */
export type IdeMcpHost = {
  /** The loopback base URL of the SSE endpoint. */
  url: string;
  /** The loopback Streamable HTTP endpoint used by Codex app-server. */
  mcpUrl: string;
  /** The loopback base URL of the health endpoint. */
  healthUrl: string;
  /** The port the loopback server listens on. */
  port: number;
  /** Stop the host and close all connections. */
  close: () => Promise<void>;
};

export type IdeMcpHostOptions = {
  /** Optional fixed port. Defaults to 0 (ephemeral). */
  port?: number;
  /** Server factory supplied by the caller so every runtime can choose bundle-safe wiring. */
  buildServer: () => McpServer;
  /** Label included in logs and health output. */
  serverName?: string;
  /** Extra health metadata for standalone sidecars. */
  health?: Record<string, string | number | boolean | null>;
  /** Allow POST /shutdown for standalone sidecar stop commands. */
  allowShutdown?: boolean;
  /** Optional loopback JSON-RPC handler used by the browser Studio IDE. */
  handleUiRpc?: (request: { method: string; params?: Record<string, unknown> }) => Promise<unknown>;
  /** Browser origins allowed to call the local UI RPC endpoint. */
  allowedUiOrigins?: string[];
};

/** Module-level singleton so repeated bootstraps reuse one host. */
let host: IdeMcpHost | undefined;

/**
 * Start (once) the in-process IDE MCP host. Binds to an ephemeral loopback port.
 *
 * @returns The running host (url + port + close), reused on subsequent calls.
 */
export const startIdeMcpHost = async (options: IdeMcpHostOptions): Promise<IdeMcpHost> => {
  if (host) return host;

  const { buildServer } = options;
  const serverName = options.serverName ?? BUILTIN_IDE_NAME;
  const startedAt = new Date().toISOString();

  /** Active transports keyed by their session id, for routing POSTed messages. */
  const transports = new Map<string, SSEServerTransport>();
  const streamableHttp = createStreamableHttpRouter<void>({ buildMcpServer: () => buildServer() });

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/ui-rpc') {
      const origin = req.headers.origin;
      const allowedOrigins = options.allowedUiOrigins ?? [];
      const originAllowed = !origin || allowedOrigins.includes(origin);
      if (!originAllowed) {
        res
          .writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          .end('{"ok":false,"error":"Origin denied"}');
        return;
      }
      if (origin) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
      }
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type, x-tomni-local-rpc');
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
      if (req.method !== 'POST' || !options.handleUiRpc || req.headers['x-tomni-local-rpc'] !== '1') {
        res.writeHead(404).end();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > 2 * 1024 * 1024) throw new Error('Browser IDE request is too large.');
          chunks.push(buffer);
        }
        const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method: string;
          params?: Record<string, unknown>;
        };
        const data = await options.handleUiRpc(request);
        res
          .writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          .end(JSON.stringify({ ok: true, data }));
      } catch (error) {
        res
          .writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          .end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      const body = JSON.stringify(
        {
          ok: true,
          server: serverName,
          url: host?.url,
          mcpUrl: host?.mcpUrl,
          healthUrl: host?.healthUrl,
          port: host?.port,
          activeSessions: transports.size,
          startedAt,
          ...options.health,
        },
        null,
        2
      );
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(body);
      return;
    }

    if (options.allowShutdown && req.method === 'POST' && url.pathname === '/shutdown') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end('{"ok":true}');
      setTimeout(() => {
        void stopIdeMcpHost().then(() => process.exit(0));
      }, 20);
      return;
    }

    if (url.pathname === '/mcp') {
      await streamableHttp.handleRequest(req, res, undefined);
      return;
    }

    // GET /sse → open a new SSE stream + MCP server for this client.
    if (req.method === 'GET' && url.pathname === SSE_PATH) {
      const transport = new SSEServerTransport(MESSAGE_PATH, res);
      transports.set(transport.sessionId, transport);
      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };
      try {
        const mcp: McpServer = buildServer();
        await mcp.connect(transport);
      } catch (error) {
        transports.delete(transport.sessionId);
        console.error('[IdeMCP] Failed to build or connect SSE transport:', error);
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
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('[IdeMCP] Could not resolve the loopback port.'));
    });
  });

  const currentHost: IdeMcpHost = {
    url: `http://127.0.0.1:${port}${SSE_PATH}`,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    healthUrl: `http://127.0.0.1:${port}/health`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const transport of transports.values()) void transport.close();
        transports.clear();
        server.close(() => {
          if (host === currentHost) host = undefined;
          resolve();
        });
      }),
  };
  host = currentHost;
  console.log(
    `[IdeMCP] MCP host listening on ${currentHost.url} (server: ${serverName}, health: ${currentHost.healthUrl}).`
  );
  return currentHost;
};

/** Return the running host, if started. */
export const getIdeMcpHost = (): IdeMcpHost | undefined => host;

/** Stop the host (deterministic teardown). */
export const stopIdeMcpHost = async (): Promise<void> => {
  if (!host) return;
  await host.close();
  host = undefined;
};
