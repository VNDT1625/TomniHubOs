import type { IMcpServerTransport } from '@/common/config/storage';
import type { CoreMcpServer } from '@process/experimentalCore/adapters/coreAdapter';
import type { McpRegistry } from './mcpRegistry';
import { resolvePackageMcpTransport, type PackageMcpSecretPort } from './packageMcpSync';

/*
 * The moment a connection server is actually launched (docs/platform/repotopackage-design.md sections 10.2 and 15).
 * The catalog, the renderer and the conversation record only ever hold `package-secret://` placeholders. These
 * helpers fill in the real values inside Main, for the process that opens the connection, and for nothing else:
 * nothing here logs, stores or returns a value to a caller that is not about to connect. A failure is an error that
 * names the server or the variable, never a value, and the server is not launched.
 */

export type PackageMcpLaunchDeps = Readonly<{
  registry: Pick<McpRegistry, 'list'>;
  portFor: (packageId: string) => PackageMcpSecretPort;
}>;

/** Main's own wiring, loaded on first use so that importing this module pulls in neither Electron nor the vault. */
const mainDeps = async (): Promise<PackageMcpLaunchDeps> => {
  const [{ getMcpRegistry }, { getPackageSecretPort }] = await Promise.all([
    import('./mcpRegistryBridge'),
    import('@process/resources/packageSecrets/packageSecretPort'),
  ]);
  return { registry: getMcpRegistry(), portFor: (packageId) => getPackageSecretPort(packageId) };
};

const valuesOf = (transport: IMcpServerTransport): Record<string, string> =>
  (transport.type === 'stdio' ? transport.env : transport.headers) ?? {};

/** The values that resolution filled in; used only to scrub them out of a later error message. */
const filledValues = (before: IMcpServerTransport, after: IMcpServerTransport): string[] => {
  const original = valuesOf(before);
  return Object.entries(valuesOf(after)).flatMap(([key, value]) => (original[key] === value || !value ? [] : [value]));
};

/** Replaces every filled-in secret value in `text`, so a remote that echoes a header cannot carry it onward. */
export const redactResolvedSecrets = (text: string, secrets: readonly string[]): string =>
  [...secrets]
    .toSorted((left, right) => right.length - left.length)
    .reduce((acc, secret) => acc.split(secret).join('[redacted]'), text);

export type ResolvedCatalogTransport = Readonly<{ transport: IMcpServerTransport; secrets: string[] }>;

/**
 * For a catalog server about to be probed or connected: the transport with secret placeholders filled in, plus the
 * values that were filled (to scrub errors). A server that is not a connection server comes back unchanged.
 */
export const resolveCatalogTransport = async (
  server: Readonly<{ name: string; transport: IMcpServerTransport }>,
  deps?: PackageMcpLaunchDeps
): Promise<ResolvedCatalogTransport> => {
  const { registry, portFor } = deps ?? (await mainDeps());
  const transport = await resolvePackageMcpTransport(registry, server, portFor);
  return { transport, secrets: filledValues(server.transport, transport) };
};

type Shape = Readonly<{
  kind: 'stdio' | 'sse' | 'http';
  target: string;
  cwd?: string;
  args: readonly string[];
  pairs: string;
}>;

const pairsKey = (pairs: ReadonlyArray<readonly [string, string]>): string =>
  JSON.stringify(pairs.toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));

const shapeOfCatalog = (transport: IMcpServerTransport): Shape =>
  transport.type === 'stdio'
    ? {
        kind: 'stdio',
        target: transport.command,
        cwd: transport.cwd,
        args: transport.args ?? [],
        pairs: pairsKey(Object.entries(transport.env ?? {})),
      }
    : {
        kind: transport.type === 'sse' ? 'sse' : 'http',
        target: transport.url,
        args: [],
        pairs: pairsKey(Object.entries(transport.headers ?? {})),
      };

const shapeOfCore = (server: CoreMcpServer): Shape =>
  server.transport === 'stdio'
    ? {
        kind: 'stdio',
        target: server.command,
        cwd: server.cwd,
        args: server.args ?? [],
        pairs: pairsKey((server.env ?? []).map((item) => [item.name, item.value] as const)),
      }
    : {
        kind: server.transport === 'sse' || server.transport === undefined ? 'sse' : 'http',
        target: server.url,
        args: [],
        pairs: pairsKey((server.headers ?? []).map((item) => [item.name, item.value] as const)),
      };

const sameShape = (left: Shape, right: Shape): boolean =>
  left.kind === right.kind &&
  left.target === right.target &&
  left.cwd === right.cwd &&
  left.pairs === right.pairs &&
  JSON.stringify(left.args) === JSON.stringify(right.args);

const withValues = (
  items: ReadonlyArray<{ name: string; value: string }> | undefined,
  filled: Record<string, string> | undefined
): Array<{ name: string; value: string }> =>
  (items ?? []).map((item) => ({ name: item.name, value: filled?.[item.name] ?? item.value }));

/**
 * Fills the secret placeholders of the connection servers among `servers`, for the agent run that is about to launch
 * them. Servers that are not connection servers pass through untouched. A connection server whose launch differs from
 * the catalog's own entry is refused, so a conversation snapshot cannot aim a secret at another URL or command.
 */
export const resolveCoreMcpServers = async (
  servers: readonly CoreMcpServer[],
  deps?: PackageMcpLaunchDeps
): Promise<CoreMcpServer[]> => {
  if (servers.length === 0) return [];
  const { registry, portFor } = deps ?? (await mainDeps());
  const catalog = await registry.list();
  const result: CoreMcpServer[] = [];
  for (const server of servers) {
    const wanted = server.name.trim().toLowerCase();
    const entry = catalog.find((item) => item.name.trim().toLowerCase() === wanted);
    if (!entry || !entry.id.startsWith('pkgconn:')) {
      result.push(server);
      continue;
    }
    if (!sameShape(shapeOfCore(server), shapeOfCatalog(entry.transport))) {
      throw new Error(`The connection of "${entry.name}" differs from the catalog.`);
    }
    // oxlint-disable-next-line no-await-in-loop -- a handful of servers, resolved one at a time
    const resolved = await resolvePackageMcpTransport(
      registry,
      { name: entry.name, transport: entry.transport },
      portFor
    );
    result.push(
      resolved.type === 'stdio' && server.transport === 'stdio'
        ? { ...server, cwd: resolved.cwd, env: withValues(server.env, resolved.env) }
        : resolved.type !== 'stdio' && server.transport !== 'stdio'
          ? { ...server, headers: withValues(server.headers, resolved.headers) }
          : server
    );
  }
  return result;
};
