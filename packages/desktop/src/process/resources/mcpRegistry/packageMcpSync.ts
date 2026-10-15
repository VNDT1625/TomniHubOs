import type { IMcpServer, IMcpServerTransport } from '@/common/config/storage';
import type { PackageContributionSnapshot, PackageMcpServerContribution } from '@/common/packages';
import type { PackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';
import type { McpRegistry } from './mcpRegistry';

const PACKAGE_MCP_ID_PREFIX = 'package:';

export type PackageMcpSyncResult = Readonly<{
  added: string[];
  updated: string[];
  removed: string[];
  skipped: string[];
}>;

export const packageMcpServerId = (contributionKey: string): string => `${PACKAGE_MCP_ID_PREFIX}${contributionKey}`;

export const isPackageMcpServer = (server: Pick<IMcpServer, 'id'>): boolean =>
  server.id.startsWith(PACKAGE_MCP_ID_PREFIX);

const describe = (contribution: PackageMcpServerContribution): string | undefined => {
  const needs = contribution.envKeys?.length ? `Needs environment variables: ${contribution.envKeys.join(', ')}.` : '';
  const text = [contribution.description, needs].filter(Boolean).join(' ');
  return text.length > 0 ? text : undefined;
};

const sameLaunch = (server: IMcpServer, contribution: PackageMcpServerContribution): boolean =>
  server.transport.type === 'stdio' &&
  server.transport.command === contribution.command &&
  JSON.stringify(server.transport.args ?? []) === JSON.stringify(contribution.args);

/** Same stdio command and arguments. Names and ids are not compared: a connection and a legacy entry differ in both. */
const sameStdioLaunch = (left: IMcpServerTransport, right: IMcpServerTransport): boolean =>
  left.type === 'stdio' &&
  right.type === 'stdio' &&
  left.command === right.command &&
  JSON.stringify(left.args ?? []) === JSON.stringify(right.args ?? []);

/** Names compared without case, spaces or punctuation: Context Mode and context-mode are one server. */
const mcpNameKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const sameMcpName = (left: string, right: string): boolean =>
  mcpNameKey(left) !== '' && mcpNameKey(left) === mcpNameKey(right);

/** The package that declared a legacy `package:` server (`package:<packageId>/<contributionId>`); undefined for other ids. */
export const legacyPackageMcpOwner = (id: string): string | undefined => {
  if (!id.startsWith(PACKAGE_MCP_ID_PREFIX)) return undefined;
  const rest = id.slice(PACKAGE_MCP_ID_PREFIX.length);
  const slash = rest.indexOf('/');
  return slash > 0 ? rest.slice(0, slash) : undefined;
};

let queue: Promise<unknown> = Promise.resolve();

/** One registry change at a time, so two package events cannot interleave their reads and writes. */
const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
  const next = queue.then(run, run);
  queue = next.catch((): undefined => undefined);
  return next;
};

/**
 * Mirrors the MCP servers that installed packages declare into the MCP catalog.
 *
 * A package only names a launch command. The server is added disabled, so nothing runs until the user
 * enables it in the MCP settings, where the exact command is visible. A server whose launch command
 * changed in a package update is switched off again and has to be approved again. Servers of packages
 * that were removed or disabled are deleted; servers the user created themselves are never touched.
 *
 * A package whose MCP server is already a connection (`connectionOwnedPackages`) is not mirrored at all: the connection
 * is the one record, on while the connection is on and gone while it is off, so the catalog never holds a disabled copy.
 */
export const syncPackageMcpServers = (
  registry: McpRegistry,
  snapshot: Pick<PackageContributionSnapshot, 'mcpServers'>,
  options: Readonly<{ connectionOwnedPackages?: ReadonlySet<string> }> = {}
): Promise<PackageMcpSyncResult> => {
  const run = async (): Promise<PackageMcpSyncResult> => {
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const skipped: string[] = [];
    const current = await registry.list();
    // A server that a connection of the same package already runs (same name or same launch) is not mirrored.
    const connections = current.flatMap((server) => {
      const owner = parsePackageConnectionMcpId(server.id);
      return owner === undefined
        ? []
        : [{ packageId: owner.packageId, transport: server.transport, title: server.extension?.displayName ?? server.name }];
    });
    const coveredByConnection = (contribution: PackageContributionSnapshot['mcpServers'][number]): boolean =>
      connections.some(
        (connection) =>
          connection.packageId === contribution.packageId &&
          (sameMcpName(connection.title, contribution.title) ||
            sameStdioLaunch(connection.transport, {
              type: 'stdio',
              command: contribution.command,
              args: contribution.args,
            }))
      );
    const wanted = new Map(
      snapshot.mcpServers
        .filter((entry) => !coveredByConnection(entry) && !options.connectionOwnedPackages?.has(entry.packageId))
        .map((entry) => [packageMcpServerId(entry.key), entry])
    );
    const byId = new Map(current.map((server) => [server.id, server]));

    for (const server of current) {
      if (isPackageMcpServer(server) && !wanted.has(server.id)) {
        await registry.remove(server.id);
        removed.push(server.id);
      }
    }

    const fresh: Array<Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'>> = [];
    for (const [id, contribution] of wanted) {
      const transport = { type: 'stdio' as const, command: contribution.command, args: [...contribution.args] };
      const existing = byId.get(id);
      if (!existing) {
        fresh.push({ id, name: contribution.title, description: describe(contribution), enabled: false, transport });
        continue;
      }
      if (!sameLaunch(existing, contribution)) {
        await registry.update(id, {
          description: describe(contribution),
          transport,
          original_json: JSON.stringify({ mcpServers: { [existing.name]: transport } }, null, 2),
        });
        if (existing.enabled) await registry.toggle(id);
        updated.push(id);
      }
    }
    if (fresh.length > 0) {
      const imported = await registry.importMany(fresh);
      const importedIds = new Set(imported.map((server) => server.id));
      for (const entry of fresh) (importedIds.has(entry.id ?? '') ? added : skipped).push(entry.id ?? entry.name);
    }
    return { added, updated, removed, skipped };
  };
  return enqueue(run);
};

/*
 * Servers of connections (docs/platform/repotopackage-design.md section 10.2). The connection host `mcp` owns them:
 * turning a connection on adds one entry, turning it off or removing the package takes it out. They live under their
 * own id prefix, so the snapshot sync above (which deletes every `package:` entry it no longer lists) never touches them.
 */

const CONNECTION_MCP_ID_PREFIX = 'pkgconn:';
const CONNECTION_MCP_ID = /^pkgconn:([a-z0-9][a-z0-9._-]*):([a-z0-9][a-z0-9._-]*)$/;

export const packageConnectionMcpId = (packageId: string, connectionId: string): string =>
  `${CONNECTION_MCP_ID_PREFIX}${packageId}:${connectionId}`;

/** Splits the id of a connection server; `undefined` when the server was not made by the connection host. */
export const parsePackageConnectionMcpId = (id: string): { packageId: string; connectionId: string } | undefined => {
  const match = CONNECTION_MCP_ID.exec(id);
  return match?.[1] && match[2] ? { packageId: match[1], connectionId: match[2] } : undefined;
};

/** The package that made a catalog entry: a connection server (`pkgconn:`) or a legacy mirror (`package:`). */
export const packageOwnerOfMcpServer = (server: Pick<IMcpServer, 'id'>): string | undefined =>
  parsePackageConnectionMcpId(server.id)?.packageId ?? legacyPackageMcpOwner(server.id);

/**
 * True for every catalog entry a package made. Such an entry is switched by its package (the connection or the
 * package's plugin), so the plain MCP list does not show it as a standalone server.
 */
export const isPackageOwnedMcpServer = (server: Pick<IMcpServer, 'id'>): boolean =>
  server.id.startsWith(CONNECTION_MCP_ID_PREFIX) || isPackageMcpServer(server);

export type PackageConnectionMcpEntry = Readonly<{
  packageId: string;
  packageVersion: string;
  connectionId: string;
  title: string;
  description?: string;
  /** May carry secret placeholders (see `packageSecretPlaceholder`), never a secret value. */
  transport: IMcpServerTransport;
}>;

/**
 * Adds the server of an enabled connection, or refreshes and re-enables it when it is already there (idempotent).
 * Returns the catalog id. A name used by a different server is made unique with the package id; if that is taken
 * too, it fails instead of overwriting the other server.
 */
export const upsertPackageConnectionMcp = (registry: McpRegistry, entry: PackageConnectionMcpEntry): Promise<string> =>
  enqueue(async () => {
    const id = packageConnectionMcpId(entry.packageId, entry.connectionId);
    const listed = await registry.list();
    // The connection replaces the legacy entry of the same package (same launch or same name): listed once.
    const duplicates = listed.filter(
      (server) =>
        legacyPackageMcpOwner(server.id) === entry.packageId &&
        (sameStdioLaunch(server.transport, entry.transport) || sameMcpName(server.name, entry.title))
    );
    for (const duplicate of duplicates) {
      // oxlint-disable-next-line no-await-in-loop -- registry writes run one at a time
      await registry.remove(duplicate.id);
    }
    const servers = listed.filter((server) => !duplicates.includes(server));
    const existing = servers.find((server) => server.id === id);
    const taken = (name: string): boolean =>
      servers.some((server) => server.id !== id && server.name.trim().toLowerCase() === name.toLowerCase());
    const name = taken(entry.title) ? `${entry.title} (${entry.packageId})` : entry.title;
    if (taken(name)) throw new Error(`An MCP server named "${name}" already exists.`);
    const original_json = JSON.stringify({ mcpServers: { [name]: entry.transport } }, null, 2);
    if (existing) {
      await registry.update(id, { name, description: entry.description, transport: entry.transport, original_json });
      if (!existing.enabled) await registry.toggle(id);
      return id;
    }
    const imported = await registry.importMany([
      {
        id,
        name,
        description: entry.description,
        enabled: true,
        transport: entry.transport,
        original_json,
        extension: { name: `package:${entry.packageId}`, displayName: entry.title, version: entry.packageVersion },
      },
    ]);
    if (imported.length === 0) throw new Error(`The MCP server "${name}" could not be added.`);
    return id;
  });

/** Takes connection servers out of the catalog. Ids that are not connection servers are ignored. */
export const removePackageConnectionMcp = (registry: McpRegistry, ids: readonly string[]): Promise<string[]> =>
  enqueue(async () => {
    const present = new Set((await registry.list()).map((server) => server.id));
    const removed: string[] = [];
    for (const id of new Set(ids)) {
      if (parsePackageConnectionMcpId(id) === undefined || !present.has(id)) continue;
      // oxlint-disable-next-line no-await-in-loop -- registry writes run one at a time
      await registry.remove(id);
      removed.push(id);
    }
    return removed;
  });

/** Removes every connection server for which `keep` says no (orphans of removed or disabled connections). */
export const removeOrphanPackageConnectionMcp = (
  registry: McpRegistry,
  keep: (owner: { packageId: string; connectionId: string }) => boolean
): Promise<string[]> =>
  enqueue(async () => {
    const removed: string[] = [];
    for (const server of await registry.list()) {
      const owner = parsePackageConnectionMcpId(server.id);
      if (!owner || keep(owner)) continue;
      // oxlint-disable-next-line no-await-in-loop -- registry writes run one at a time
      await registry.remove(server.id);
      removed.push(server.id);
    }
    return removed;
  });

/*
 * Secret values of a connection server. The catalog (which the renderer reads) holds a placeholder per header or
 * variable; the value is read from the package's secret store, in Main, by `resolvePackageMcpTransport`, only when a
 * connection is about to be made. Nothing here logs, and errors name the variable, never its value.
 */

const SECRET_PLACEHOLDER = /^package-secret:\/\/([a-z0-9][a-z0-9._-]*)\/([A-Z][A-Z0-9_]*)$/;

export const packageSecretPlaceholder = (packageId: string, name: string): string =>
  `package-secret://${packageId}/${name}`;

export const parsePackageSecretPlaceholder = (value: string): { packageId: string; name: string } | undefined => {
  const match = SECRET_PLACEHOLDER.exec(value);
  return match?.[1] && match[2] ? { packageId: match[1], name: match[2] } : undefined;
};

export type PackageMcpSecretPort = Pick<PackageSecretPort, 'list' | 'resolve'>;

/** The variable names the package can read right now (names only, never values). */
export const availablePackageSecretNames = async (port: Pick<PackageSecretPort, 'list'>): Promise<Set<string>> =>
  new Set((await port.list()).flatMap((item) => item.fields));

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/** Own sets first, then the newest: the set a variable is read from when several hold the same name. */
const handleFor = async (port: PackageMcpSecretPort, name: string): Promise<string | undefined> => {
  const candidates = (await port.list())
    .filter((item) => item.fields.includes(name))
    .toSorted((left, right) =>
      left.origin === right.origin ? right.updatedAt - left.updatedAt : left.origin === 'own' ? -1 : 1
    );
  return candidates[0]?.handle;
};

/**
 * Returns the transport of a catalog server with its secret placeholders replaced by the real values, for Main to
 * hand to the MCP client and to nothing else. The caller names a server and the transport it believes it has; both
 * must match the catalog's own entry, and a placeholder must belong to the package that owns the entry. So a
 * renderer-supplied snapshot cannot point a secret at another URL or another package's variables. A server that is
 * not a connection server is returned as it is (its text is never read as a placeholder).
 */
export const resolvePackageMcpTransport = async (
  registry: Pick<McpRegistry, 'list'>,
  candidate: Readonly<{ name: string; transport: IMcpServerTransport }>,
  portFor: (packageId: string) => PackageMcpSecretPort
): Promise<IMcpServerTransport> => {
  const wanted = candidate.name.trim().toLowerCase();
  const entry = (await registry.list()).find((server) => server.name.trim().toLowerCase() === wanted);
  const owner = entry ? parsePackageConnectionMcpId(entry.id) : undefined;
  if (!entry || !owner) return candidate.transport;
  if (stable(entry.transport) !== stable(candidate.transport)) {
    throw new Error(`The connection of "${entry.name}" differs from the catalog.`);
  }
  const port = portFor(owner.packageId);
  const fill = async (values: Record<string, string> | undefined): Promise<Record<string, string> | undefined> => {
    if (!values) return undefined;
    const filled: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      const placeholder = parsePackageSecretPlaceholder(value);
      if (!placeholder) {
        filled[key] = value;
        continue;
      }
      if (placeholder.packageId !== owner.packageId) {
        throw new Error(`"${entry.name}" may not read secrets of another package.`);
      }
      const missing = `Secret ${placeholder.name} is not available for ${owner.packageId}.`;
      // oxlint-disable-next-line no-await-in-loop -- a handful of values, resolved one at a time
      const handle = await handleFor(port, placeholder.name);
      if (!handle) throw new Error(missing);
      // oxlint-disable-next-line no-await-in-loop -- see above
      const resolved = await port.resolve(handle, [placeholder.name]);
      const secret = resolved[placeholder.name];
      if (secret === undefined) throw new Error(missing);
      filled[key] = secret;
    }
    return filled;
  };
  const transport = entry.transport;
  if (transport.type === 'stdio') {
    const env = await fill(transport.env);
    return { ...transport, ...(env ? { env } : {}) };
  }
  const headers = await fill(transport.headers);
  return { ...transport, ...(headers ? { headers } : {}) };
};
