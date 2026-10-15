import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { toolNameAllowed } from '@process/toolselect/builtinToolCatalog';
import type { CoreMcpServer } from '@process/experimentalCore/adapters/coreAdapter';

/** A run's tool set is resolved by the Surface Registry BEFORE this dispatcher is constructed. */
export type WorkflowDispatchDeps = Readonly<{
  servers: readonly CoreMcpServer[];
  patterns: readonly string[];
}>;

export type WorkflowToolDispatcher = Readonly<{
  invoke: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  describe: (tool: string) => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
}>;

/** Do not permit recursion, tool-grant discovery, or credential-control through a child workflow. */
const forbidden = (name: string): boolean =>
  name.startsWith('workflow_') ||
  name === 'tools_search' ||
  name === 'tools_recall' ||
  name === 'tools_guide' ||
  name.startsWith('agent_') ||
  name.startsWith('tomny_secret_');

const loopbackEndpoint = (server: CoreMcpServer): URL => {
  if (!('url' in server)) throw new Error('WORKFLOW_UNSUPPORTED_TOOL_TRANSPORT');
  const url = new URL(server.url);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '[::1]') ||
    url.username ||
    url.password
  )
    throw new Error('WORKFLOW_REMOTE_HOST_NOT_ALLOWED');
  return url;
};

const connect = async (server: CoreMcpServer): Promise<Client> => {
  const url = loopbackEndpoint(server);
  const headers =
    'headers' in server ? Object.fromEntries((server.headers ?? []).map(({ name, value }) => [name, value])) : {};
  const transport = new SSEClientTransport(url, {
    requestInit: { headers, redirect: 'error' },
    eventSourceInit: {
      // Node EventSource needs a fetch implementation that forwards the loopback auth header.
      fetch: (input, init) => {
        const address = typeof input === 'string' ? input : input.href;
        const target = new URL(address);
        if (
          (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost' && target.hostname !== '[::1]') ||
          (target.protocol !== 'http:' && target.protocol !== 'https:')
        )
          throw new Error('WORKFLOW_REDIRECT_BLOCKED');
        return fetch(input, {
          ...init,
          redirect: 'error',
          headers: { ...(init?.headers as Record<string, string>), ...headers },
        });
      },
    },
  });
  const client = new Client({ name: 'tomny-workflow-child', version: '1.0.0' });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close().catch((): void => undefined);
    throw error;
  }
};

/**
 * Only Main-resolved local MCP servers may be contacted. Each name is verified
 * against the exact Surface tool patterns AND live server tool enumeration.
 */
export const createWorkflowToolDispatcher = (deps: WorkflowDispatchDeps): WorkflowToolDispatcher => {
  const clients = new Set<Client>();
  const unique = new Map<string, CoreMcpServer>();
  for (const server of deps.servers) {
    if (server.name !== 'tomny-workflow' && !unique.has(server.name)) unique.set(server.name, server);
  }
  let closed = false;
  let toolMapPromise: Promise<Map<string, Client>> | undefined;
  const descriptions = new Map<string, Record<string, unknown>>();
  const mapTools = (): Promise<Map<string, Client>> => {
    toolMapPromise ??= (async () => {
      const tools = new Map<string, Client>();
      for (const server of unique.values()) {
        // A remote or stdio-only MCP host cannot be silently promoted into a new
        // subprocess or network egress by a workflow. It remains directly callable.
        if (!('url' in server)) continue;
        let endpoint: URL;
        try {
          endpoint = loopbackEndpoint(server);
        } catch {
          continue;
        }
        if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') continue;
        // oxlint-disable-next-line no-await-in-loop -- deterministic first-authorized host wins a colliding tool name.
        const client = await connect(server);
        clients.add(client);
        // oxlint-disable-next-line no-await-in-loop -- list only after connecting this same scoped host.
        const listed = await client.listTools();
        for (const tool of listed.tools) {
          if (!forbidden(tool.name) && toolNameAllowed(tool.name, deps.patterns) && !tools.has(tool.name)) {
            tools.set(tool.name, client);
            descriptions.set(tool.name, {
              tool: tool.name,
              description: tool.description?.slice(0, 600) ?? '',
              inputSchema: tool.inputSchema,
              ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
              outputAdapters: {
                raw: 'Native MCP content array',
                mcpText: 'The text of exactly one MCP text content block',
                mcpJson: 'Parsed JSON from exactly one MCP text content block (fails closed if not JSON)',
              },
              resultReferences: 'Use workflow whenExpr operands (kind=step) and inputFrom bindings',
            });
          }
        }
      }
      return tools;
    })();
    return toolMapPromise;
  };
  return {
    describe: async (tool) => {
      if (closed || forbidden(tool) || !toolNameAllowed(tool, deps.patterns)) {
        throw new Error('WORKFLOW_TOOL_NOT_GRANTED');
      }
      await mapTools();
      const descriptor = descriptions.get(tool);
      if (!descriptor) throw new Error('WORKFLOW_TOOL_NOT_AVAILABLE');
      const serialized = JSON.stringify(descriptor);
      if (serialized.length > 12_000)
        return {
          tool,
          description: descriptor.description,
          outputAdapters: descriptor.outputAdapters,
          schemaOmitted: true,
          reason: 'Adapter schema exceeds its response budget',
        };
      return descriptor;
    },
    invoke: async (tool, input, signal) => {
      if (closed || signal.aborted) throw new Error('WORKFLOW_CANCELLED');
      if (forbidden(tool) || !toolNameAllowed(tool, deps.patterns)) throw new Error('WORKFLOW_TOOL_NOT_GRANTED');
      const client = (await mapTools()).get(tool);
      if (!client) throw new Error('WORKFLOW_TOOL_NOT_AVAILABLE');
      if (signal.aborted || closed) throw new Error('WORKFLOW_CANCELLED');
      const reply = await client.callTool({ name: tool, arguments: input }, undefined, { signal, timeout: 60_000 });
      if (reply.isError) {
        throw new Error(JSON.stringify(reply.content).slice(0, 2_000));
      }
      return reply.content;
    },
    close: async () => {
      closed = true;
      await Promise.all([...clients].map((client) => client.close().catch((): void => undefined)));
      clients.clear();
    },
  };
};
