import type { IMcpServer } from '@/common/config/storage';
import { isPackageOwnedMcpServer } from '@process/resources/mcpRegistry/packageMcpSync';

/**
 * Settings lists MCP servers the person connected or created from a repository. The loopback servers behind
 * in-app capabilities (`builtin`) are Tomny tools, named `tomny_*` and chosen by surface, so they are not shown
 * or toggled here as if they were connectors. A server a package made is not listed either: it belongs to the package's
 * plugin, which switches it, so this list never holds a second switch for the same server.
 */
export const selectExternalMcpServers = (servers: readonly IMcpServer[]): IMcpServer[] =>
  servers.filter((server) => server.builtin !== true && !isPackageOwnedMcpServer(server));
