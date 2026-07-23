import { ipcBridge } from '@/common';


import { mcpService } from '@/common/adapter/ipcBridge';
import { configService } from '@/common/config/configService';
import type { IMcpServer, IMcpServerTransport, ISessionMcpServer } from '@/common/config/storage';

type McpCatalogPayload = {
  name: string;
  description?: string;
  transport: IMcpServerTransport;
  original_json: string;
  builtin?: boolean;
};

const isBuiltinServer = (server: IMcpServer) => server.builtin === true;

const normalizeServerName = (name: string) => name.trim().toLowerCase();

const getCatalogServerKey = (server: Pick<IMcpServer, 'id' | 'name' | 'builtin'>) => {
  const normalizedName = normalizeServerName(server.name);
  if (server.builtin === true) {
    return `builtin:${normalizedName || server.id}`;
  }
  return `user:${normalizedName || server.id}`;
};

const dedupeServers = (servers: IMcpServer[]) => {
  const seen = new Set<string>();
  const deduped: IMcpServer[] = [];

  for (const server of servers) {
    const key = getCatalogServerKey(server);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(server);
  }

  return deduped;
};


export const toBackendMcpPayload = (
  server: Pick<IMcpServer, 'name' | 'description' | 'transport' | 'original_json' | 'builtin'>
): McpCatalogPayload => ({
  name: server.name,
  description: server.description,
  transport: server.transport,
  original_json: server.original_json || '{}',
  builtin: Boolean(server.builtin),
});

export const toSessionMcpServer = (server: Pick<IMcpServer, 'id' | 'name' | 'transport'>): ISessionMcpServer => ({
  id: server.id,
  name: server.name,
  transport: server.transport,
});


/** Merge the live Browser-Control server into a conversation session snapshot. */
export const mergeBrowserControlSessionServer = (
  servers: ISessionMcpServer[],
  browserServer: ISessionMcpServer
): ISessionMcpServer[] => [...servers.filter((server) => server.name !== browserServer.name), browserServer];

/** Return the session snapshot update needed for a live Browser-Control server. */
export const buildBrowserControlSessionUpdate = (
  servers: ISessionMcpServer[],
  browserServer: ISessionMcpServer,
  attachIfMissing = false
): ISessionMcpServer[] | null => {
  const current = servers.find((server) => server.name === browserServer.name);
  if (!current && !attachIfMissing) return null;
  if (current && JSON.stringify(current) === JSON.stringify(browserServer)) return null;
  return mergeBrowserControlSessionServer(servers, browserServer);
};

/**
 * Refresh the Browser-Control MCP snapshot for an existing chat.
 * Custom MCP entries are preserved; missing browser entries remain opt-in via
 * the Super toggle (or by passing `attachIfMissing: true`).
 */
export const ensureBrowserControlSession = async (
  conversationId: string,
  options: { attachIfMissing?: boolean } = {}
): Promise<boolean> => {
  const [{ allServers }, conversation] = await Promise.all([
    ensureBackendMcpCatalog(),
    ipcBridge.conversation.get.invoke({ id: conversationId }),
  ]);
  const live = allServers.find((server) => server.name === 'aionui-browser-control');
  if (!live || !conversation) return false;
  const extra = (conversation.extra ?? {}) as { session_mcp_servers?: ISessionMcpServer[] };
  const existing = Array.isArray(extra.session_mcp_servers) ? extra.session_mcp_servers : [];
  const update = buildBrowserControlSessionUpdate(existing, toSessionMcpServer(live), options.attachIfMissing === true);
  if (!update) return existing.some((server) => server.name === live.name);
  const ok = await ipcBridge.conversation.update.invoke({
    id: conversationId,
    updates: { session_mcp_servers: update } as never,
    merge_extra: true,
  });
  return Boolean(ok);
};

export const ensureNativeMcpCatalog = async (): Promise<{
  userServers: IMcpServer[];
  builtinServers: IMcpServer[];
  allServers: IMcpServer[];
}> => {
  const allServers = dedupeServers(await mcpService.listServers.invoke());
  const builtinServers = allServers.filter(isBuiltinServer);
  const userServers = allServers.filter((server) => !isBuiltinServer(server));
  configService.setLocal('mcp.config', allServers);
  return { userServers, builtinServers, allServers };
};

/** @deprecated Compatibility name; the catalog is owned by the native Tomni registry. */
export const ensureBackendMcpCatalog = ensureNativeMcpCatalog;
