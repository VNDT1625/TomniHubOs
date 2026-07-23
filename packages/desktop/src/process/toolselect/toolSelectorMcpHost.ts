import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { ToolSelectorServerDeps } from '@process/resources/builtinMcp/toolSelectorServer';
import { BUILTIN_TOOL_SELECTOR_NAME, createToolSelectorServer } from '@process/resources/builtinMcp/toolSelectorServer';

const SSE_PATH = '/sse';
const MESSAGE_PATH = '/message';

export type ToolSelectorMcpHost = {
  url: string;
  headers: Array<{ name: string; value: string }>;
  close: () => Promise<void>;
};

let host: ToolSelectorMcpHost | undefined;
let startup: Promise<ToolSelectorMcpHost> | undefined;

const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const createHost = async (deps: ToolSelectorServerDeps): Promise<ToolSelectorMcpHost> => {
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
      await createToolSelectorServer(deps).connect(transport);
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
      else reject(new Error('Could not resolve the Skill Workflow MCP port.'));
    });
  });
  host = {
    url: `http://127.0.0.1:${port}${SSE_PATH}`,
    headers: [{ name: 'Authorization', value: authorization }],
    close: () =>
      new Promise<void>((resolve) => {
        for (const transport of transports.values()) void transport.close();
        transports.clear();
        server.close(() => resolve());
      }),
  };
  console.log(`[SkillWorkflowMCP] ${BUILTIN_TOOL_SELECTOR_NAME} listening on ${host.url}.`);
  return host;
};

/** Start one authenticated loopback host; each SSE connection gets isolated selection state. */
export const startToolSelectorMcpHost = async (deps: ToolSelectorServerDeps): Promise<ToolSelectorMcpHost> => {
  if (host) return host;
  const current = (startup ??= createHost(deps));
  try {
    return await current;
  } finally {
    if (startup === current) startup = undefined;
  }
};
