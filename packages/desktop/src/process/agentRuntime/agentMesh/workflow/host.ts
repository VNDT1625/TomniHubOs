import * as http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import type { CoreMcpServer } from '@process/experimentalCore/adapters/coreAdapter';
import type { IResourceCoordinator } from '@process/resource/resourceCoordinator';
import { createWorkflowMcpServer, BUILTIN_WORKFLOW_NAME } from './server';
import { createWorkflowToolDispatcher } from './dispatcher';
import { createWorkflowResultStore, type WorkflowResultStore } from './resultDelivery';
import { createWorkflowMailbox, type WorkflowMailbox } from './mailbox';

const MAX_HOSTS = 32;
const HOST_LIFETIME_MS = 60 * 60_000;
const activeHosts = new Set<WorkflowMcpHost>();

export type WorkflowHostOptions = Readonly<{
  requestId: string;
  servers: readonly CoreMcpServer[];
  patterns: readonly string[];
  coordinator: Pick<IResourceCoordinator, 'requestLease' | 'releaseLease'>;
  resultStore?: WorkflowResultStore;
  mailbox?: WorkflowMailbox;
  authorize: (tool: string, input: Record<string, unknown>) => Promise<boolean>;
  onStep?: (event: {
    tool: string;
    id: string;
    workflowId: string;
    workflowStage: number;
    phase: 'running' | 'success' | 'error';
    input: Record<string, unknown>;
    output?: unknown;
  }) => void | Promise<void>;
  signal: AbortSignal;
}>;

export type WorkflowMcpHost = Readonly<{
  name: typeof BUILTIN_WORKFLOW_NAME;
  url: string;
  headers: Array<{ name: string; value: string }>;
  close: () => Promise<void>;
}>;

const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Each governed run receives a distinct localhost bearer token, never the credential of another run. */
export const startWorkflowMcpHost = async (options: WorkflowHostOptions): Promise<WorkflowMcpHost> => {
  if (!options.requestId.trim() || options.signal.aborted) throw new Error('WORKFLOW_RUN_NOT_ACTIVE');
  if (activeHosts.size >= MAX_HOSTS) throw new Error('WORKFLOW_HOST_CAPACITY_EXCEEDED');
  const dispatcher = createWorkflowToolDispatcher({ servers: options.servers, patterns: options.patterns });
  const resultStore = options.resultStore ?? createWorkflowResultStore();
  const mailbox = options.mailbox ?? createWorkflowMailbox(resultStore);
  const authorization = `Bearer ${randomUUID()}`;
  const transports = new Map<string, SSEServerTransport>();
  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end('Workflow host error');
      else res.end();
    });
  });
  let closed = false;
  let host!: WorkflowMcpHost;
  let expiry: ReturnType<typeof setTimeout>;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    activeHosts.delete(host);
    clearTimeout(expiry);
    options.signal.removeEventListener('abort', onAbort);
    await Promise.all([...transports.values()].map((transport) => transport.close().catch((): void => undefined)));
    transports.clear();
    // The HTTP token is revoked now. In-flight, already-authorized sibling
    // tool calls may finish in the background; no new tool call can enter.
    void mailbox
      .whenIdle()
      .then(() => dispatcher.close())
      .catch((): void => undefined);
    if (!options.resultStore)
      void mailbox
        .whenIdle()
        .then(() => resultStore.clear())
        .catch((): void => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  const onAbort = (): void => {
    mailbox.abortByOwner(options.requestId);
    void close();
  };
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (closed || options.signal.aborted || !equal(req.headers.authorization ?? '', authorization)) {
      res.writeHead(401).end('Unauthorized');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      transports.set(transport.sessionId, transport);
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK uses onclose.
      transport.onclose = (): void => {
        transports.delete(transport.sessionId);
      };
      const mcp = createWorkflowMcpServer({
        coordinator: options.coordinator,
        resultStore,
        mailbox,
        owner: { processKind: 'main', serviceId: 'workflow', taskId: options.requestId },
        invoke: (tool, input, signal) => dispatcher.invoke(tool, input, signal),
        describe: (tool) => dispatcher.describe(tool),
        authorize: options.authorize,
        onStep: options.onStep,
        signal: options.signal,
      });
      await mcp.connect(transport);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/message') {
      const transport = transports.get(url.searchParams.get('sessionId') ?? '');
      if (!transport) {
        res.writeHead(404).end('Unknown MCP session');
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }
    res.writeHead(404).end();
  };
  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') reject(new Error('WORKFLOW_BIND_FAILED'));
        else resolve(address.port);
      });
    });
    host = {
      name: BUILTIN_WORKFLOW_NAME,
      url: `http://127.0.0.1:${port}/sse`,
      headers: [{ name: 'Authorization', value: authorization }],
      close,
    };
    activeHosts.add(host);
    expiry = setTimeout(() => {
      void close();
    }, HOST_LIFETIME_MS);
    expiry.unref?.();
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) await close();
    return host;
  } catch (error) {
    await dispatcher.close();
    if (!options.resultStore) resultStore.clear();
    server.close();
    throw error;
  }
};
