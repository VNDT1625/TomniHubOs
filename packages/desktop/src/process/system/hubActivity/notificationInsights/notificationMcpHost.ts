/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createNotificationMcpServer, type NotificationReadPort } from './notificationMcpServer';

const SSE_PATH = '/sse';
const MESSAGE_PATH = '/message';
const MAX_SESSIONS = 32;

export type NotificationMcpHost = {
  url: string;
  headers: Array<{ name: string; value: string }>;
  close: () => Promise<void>;
};

let host: Promise<NotificationMcpHost> | undefined;

const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const createHost = async (read: NotificationReadPort): Promise<NotificationMcpHost> => {
  const authorization = `Bearer ${randomUUID()}`;
  const transports = new Map<string, SSEServerTransport>();

  const handle = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    if (!secureEqual(request.headers.authorization ?? '', authorization)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized.');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === SSE_PATH) {
      if (transports.size >= MAX_SESSIONS) {
        response.writeHead(503).end('Too many sessions.');
        return;
      }
      const transport = new SSEServerTransport(MESSAGE_PATH, response);
      transports.set(transport.sessionId, transport);
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP transport exposes onclose only.
      transport.onclose = () => transports.delete(transport.sessionId);
      await createNotificationMcpServer(read).connect(transport);
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
      else reject(new Error('Could not resolve the notification MCP port.'));
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

/** One authenticated loopback host, bound to 127.0.0.1, serving the read-only notification tools. */
export const startNotificationMcpHost = (read: NotificationReadPort): Promise<NotificationMcpHost> => {
  host ??= createHost(read).catch((error: unknown) => {
    host = undefined;
    throw error;
  });
  return host;
};

export const stopNotificationMcpHost = async (): Promise<void> => {
  const running = host;
  host = undefined;
  await running?.then((started) => started.close()).catch((): void => undefined);
};
