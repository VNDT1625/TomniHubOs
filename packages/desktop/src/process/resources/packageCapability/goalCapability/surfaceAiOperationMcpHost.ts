import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import type { CoreMcpServer } from '@/process/experimentalCore/adapters/coreAdapter';
import {
  createSurfaceAiOperationMcpServer,
  PACKAGE_SURFACE_OPERATION_SERVER_NAME,
  type SurfaceAiOperationMcpServerDeps,
} from './surfaceAiOperationMcpServer';

const SSE_PATH = '/sse';
const MESSAGE_PATH = '/message';

export type SurfaceAiOperationMcpHost = Readonly<{
  server: CoreMcpServer;
  close: () => Promise<void>;
}>;

const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

/**
 * Opens a non-shared authenticated loopback MCP host for exactly one C4 tool
 * session. It is deliberately never cached: its bearer credential and bound
 * consent must disappear with its parent governed Run.
 */
export const startSurfaceAiOperationMcpHost = async (
  deps: SurfaceAiOperationMcpServerDeps
): Promise<SurfaceAiOperationMcpHost> => {
  const authorization = `Bearer ${randomUUID()}`;
  const transports = new Map<string, SSEServerTransport>();
  const server = http.createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500).end('Internal server error.');
      else response.destroy();
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
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP transport exposes onclose only.
      transport.onclose = () => transports.delete(transport.sessionId);
      await createSurfaceAiOperationMcpServer(deps).connect(transport);
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
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('SURFACE_AI_MCP_HOST_START_FAILED'));
    });
  });
  return {
    server: {
      name: PACKAGE_SURFACE_OPERATION_SERVER_NAME,
      url: `http://127.0.0.1:${port}${SSE_PATH}`,
      headers: [{ name: 'Authorization', value: authorization }],
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const transport of transports.values()) void transport.close();
        transports.clear();
        server.close(() => resolve());
      }),
  };
};
