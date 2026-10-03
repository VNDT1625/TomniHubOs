import * as http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createStreamableHttpRouter } from '@process/omni-gateway/omniGatewayStreamableHttp';

const HOST_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const SSE_PATH = '/sse';
const MESSAGE_PATH = '/message';

/** A neutral, Main-owned loopback endpoint for an admitted package contribution. */
export type PackageLoopbackMcpHost = Readonly<{
  url: string;
  mcpUrl: string;
  healthUrl: string;
  port: number;
  close: () => Promise<void>;
}>;

export type PackageLoopbackMcpHostOptions = Readonly<{
  hostKey: string;
  serverName: string;
  buildServer: () => McpServer;
  health?: Readonly<Record<string, string | number | boolean | null>>;
  port?: number;
}>;

const hosts = new Map<string, PackageLoopbackMcpHost>();

const requireHostKey = (value: string): string => {
  if (!HOST_KEY_PATTERN.test(value)) throw new Error('PACKAGE_LOOPBACK_MCP_INVALID_HOST_KEY');
  return value;
};

/**
 * Starts a schema-bounded local MCP endpoint. Package code selects neither a
 * listener address nor an arbitrary request handler; Core owns loopback binding,
 * transport shutdown, and per-session server construction.
 */
export const startPackageLoopbackMcpHost = async (
  options: PackageLoopbackMcpHostOptions
): Promise<PackageLoopbackMcpHost> => {
  const hostKey = requireHostKey(options.hostKey);
  const existing = hosts.get(hostKey);
  if (existing) return existing;

  const transports = new Map<string, SSEServerTransport>();
  const startedAt = new Date().toISOString();
  const streamableHttp = createStreamableHttpRouter<void>({ buildMcpServer: () => options.buildServer() });
  let currentHost: PackageLoopbackMcpHost | undefined;

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(
        JSON.stringify({
          ok: true,
          server: options.serverName,
          url: currentHost?.url,
          mcpUrl: currentHost?.mcpUrl,
          healthUrl: currentHost?.healthUrl,
          port: currentHost?.port,
          activeSessions: transports.size,
          startedAt,
          ...options.health,
        })
      );
      return;
    }
    if (url.pathname === '/mcp') {
      await streamableHttp.handleRequest(req, res, undefined);
      return;
    }
    if (req.method === 'GET' && url.pathname === SSE_PATH) {
      const transport = new SSEServerTransport(MESSAGE_PATH, res);
      transports.set(transport.sessionId, transport);
      transport.onclose = () => transports.delete(transport.sessionId);
      try {
        await options.buildServer().connect(transport);
      } catch (error) {
        transports.delete(transport.sessionId);
        console.error('[PackageLoopbackMcpHost] Failed to create SSE session:', error);
        if (!res.headersSent) res.writeHead(500).end();
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === MESSAGE_PATH) {
      const transport = transports.get(url.searchParams.get('sessionId') ?? '');
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
      else reject(new Error('PACKAGE_LOOPBACK_MCP_PORT_UNAVAILABLE'));
    });
  });

  currentHost = Object.freeze({
    url: `http://127.0.0.1:${port}${SSE_PATH}`,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    healthUrl: `http://127.0.0.1:${port}/health`,
    port,
    close: async () => {
      for (const transport of transports.values()) void transport.close();
      transports.clear();
      await streamableHttp.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (hosts.get(hostKey) === currentHost) hosts.delete(hostKey);
    },
  });
  hosts.set(hostKey, currentHost);
  return currentHost;
};
