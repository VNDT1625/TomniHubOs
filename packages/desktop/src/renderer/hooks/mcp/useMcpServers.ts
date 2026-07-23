import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import type { IMcpServer } from '@/common/config/storage';
import { ensureBackendMcpCatalog } from './catalog';

/**
 * MCP server state hook.
 * Combines backend-managed user servers with extension-contributed servers.
 */
export const useMcpServers = () => {
  const [mcpServers, setMcpServers] = useState<IMcpServer[]>([]);
  const [extensionMcpServers, setExtensionMcpServers] = useState<IMcpServer[]>([]);
  const [isMcpServersLoading, setIsMcpServersLoading] = useState(true);

  useEffect(() => {
    void ensureBackendMcpCatalog()
      .then(({ allServers }) => {
        setMcpServers(allServers);
      })
      .catch((error) => {
        console.error('[useMcpServers] Failed to load MCP catalog:', error);
        setMcpServers(configService.get('mcp.config') ?? []);
      })
      .finally(() => {
        setIsMcpServersLoading(false);
      });

    void ipcBridge.mcpService.listExtensionServers
      .invoke()
      .then((extServers) => {
        if (!extServers || extServers.length === 0) {
          setExtensionMcpServers([]);
          return;
        }

        setExtensionMcpServers(extServers);
      })
      .catch((error) => {
        console.error('[useMcpServers] Failed to load extension MCP servers:', error);
        setExtensionMcpServers([]);
      });
  }, []);

  const saveMcpServers = useCallback(
    async (serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])): Promise<void> => {
      setMcpServers((prevServers) => {
        const nextServers = typeof serversOrUpdater === 'function' ? serversOrUpdater(prevServers) : serversOrUpdater;

        // The Main-process MCP registry already persisted the mutation. Keep
        // only the renderer cache in sync; configService.set() would call the
        // retired /api/settings/client route and report a false failure in
        // native-only mode.
        configService.setLocal('mcp.config', nextServers);
        return nextServers;
      });
    },
    []
  );

  return {
    mcpServers,
    isMcpServersLoading,
    allMcpServers: [
      ...mcpServers,
      ...extensionMcpServers.filter(
        (extensionServer) =>
          !mcpServers.some((server) => server.name.trim().toLowerCase() === extensionServer.name.trim().toLowerCase())
      ),
    ],
    extensionMcpServers,
    setMcpServers,
    saveMcpServers,
  };
};
