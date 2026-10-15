/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection host for `mcp` (docs/platform/repotopackage-design.md sections 9.3, 10.2, 15.1).
 *
 * - Enabling adds one server to the application's MCP catalog (through `packageMcpSync`); disabling, removing the
 *   package or `reconcile` takes it out. A server of a package that is not installed (quarantined, failed or removed)
 *   is never kept, so the catalog lists only what the Settings list of installed packages shows.
 * - A source-backed server runs from a copy under the app data folder; setup runs there too, never in the signed folder. Alternatives in one `group` are switched off by the registry, which calls
 *   `disable` on the others; this host does not look at groups.
 * - stdio servers that need nothing from the package folder (npx, uvx, docker, python, uv, bun with literal
 *   arguments) are supported. A server that runs from source (`cwd`, `setup`, `node`, arguments below `source/`)
 *   needs the process runtime of design section 13 and is reported as not runnable yet, never started half-way.
 * - http/sse servers must be a public https endpoint (no user info, no loopback, private or link-local literal, no
 *   local-only name). DNS answers are not resolved here, so a public name that points inside is not caught by this host.
 * - Secrets: headers and variables are written to the catalog as placeholders. The value is read from the package
 *   secret store in Main by `resolvePackageMcpTransport` when a connection is made, so neither the catalog (which
 *   the renderer lists) nor an approval line, error or log ever holds one. `describe` shows names only.
 * - The approval covers the command line, URL, headers' and variables' names and the package files that appear as
 *   arguments, so a change to any of them needs a new approval.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import type { IMcpServerTransport } from '@/common/config/storage';
import {
  createSourceMcpRuntime,
  sourceMcpFiles,
  type SourceMcpRuntime,
} from '@process/integrations/runtime/mcpSourceRuntime';
import type { McpRegistry } from '@process/resources/mcpRegistry/mcpRegistry';
import {
  availablePackageSecretNames,
  packageConnectionMcpId,
  packageSecretPlaceholder,
  removeOrphanPackageConnectionMcp,
  removePackageConnectionMcp,
  upsertPackageConnectionMcp,
} from '@process/resources/mcpRegistry/packageMcpSync';
import { getPackageSecretPort, type PackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ApprovalSubject,
  type ConnectionOf,
  type HostCheck,
  type HostContext,
} from '../../core/types';

type McpConnection = ConnectionOf<'mcp'>;

export type McpHostDeps = Readonly<{
  /** The application's MCP catalog. Defaults to the real one (legacy servers imported first). */
  registry?: () => Promise<McpRegistry>;
  /** The secret store of one package; only the names of its variables are read here. */
  secretPort?: (packageId: string) => Pick<PackageSecretPort, 'list'>;
  /** Whether a program can be found on this machine. Defaults to a PATH search. */
  commandExists?: (command: string) => Promise<boolean>;
  /** Source-backed MCP: the checked entrypoint, bounded setup and Electron Node runtime. */
  sourceRuntime?: SourceMcpRuntime;
}>;

/** Programs a catalog server may use without the package folder. `node` always needs the source runtime. */
const CATALOG_COMMANDS: ReadonlySet<string> = new Set(['npx', 'uvx', 'docker', 'python', 'uv', 'bun']);
const PACKAGE_FILE_ARGUMENT = /^(?:source|adapter)\//;
const SOURCE_INTERPRETERS = new Set(['node', 'python', 'bun']);
const RESERVED_VARIABLES = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
  'PATH',
  'PATHEXT',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
]);

const defaultRegistry = async (): Promise<McpRegistry> => {
  const bridge = await import('@process/resources/mcpRegistry/mcpRegistryBridge');
  const registry = bridge.getMcpRegistry();
  await bridge.ensureLegacyMcpImported(registry);
  return registry;
};

const defaultCommandExists = async (command: string): Promise<boolean> => {
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter((entry) => entry !== '');
  const extensions =
    process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  const found = await Promise.all(
    directories.flatMap((directory) =>
      extensions.map((extension) =>
        access(path.join(directory, `${command}${extension}`)).then(
          () => true,
          () => false
        )
      )
    )
  );
  return found.some(Boolean);
};

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split('.').map(Number);
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

/** Why a remote URL is not accepted, or `undefined` when it names a public https endpoint. */
const remoteProblem = (value: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'The server address is not a valid URL.';
  }
  if (url.protocol !== 'https:') return 'The server address must use https.';
  if (url.username !== '' || url.password !== '') return 'The server address must not contain a user name or password.';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    (!host.includes('.') && !host.startsWith('['));
  const ipv6 = host.startsWith('[')
    ? /^\[(?:::1?|f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*|::ffff:.*)\]$/.test(host)
    : false;
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && isPrivateIpv4(host);
  return local || ipv6 || ipv4 ? 'The server address must be a public host, not a local or private one.' : undefined;
};

type McpStdio = Extract<McpConnection, { args?: unknown }>;

// A remote (http/sse) connection is the one that has a `url`. A predicate narrows the union with or without strict
// null checks (under the root tsconfig the members' discriminating fields are optional, so `in` and `===` do not).
const isStdio = (connection: McpConnection): connection is McpStdio => !('url' in connection);

const packageFileArguments = (connection: McpConnection): string[] =>
  !isStdio(connection) ? [] : [...new Set(connection.args.filter((arg) => PACKAGE_FILE_ARGUMENT.test(arg)))];

/** Why a stdio server cannot be started from the catalog yet, or `undefined`. */
const sourceRuntimeProblem = (connection: McpConnection): string | undefined => {
  if (!isStdio(connection)) return undefined;
  if (connection.cwd !== undefined || (connection.setup?.length ?? 0) > 0) {
    return 'This server runs from the package source and needs the process runtime, which is not available yet.';
  }
  if (!CATALOG_COMMANDS.has(connection.command) || packageFileArguments(connection).length > 0) {
    return 'This server runs a file from the package and needs the process runtime, which is not available yet.';
  }
  return undefined;
};

const subjectOf = (context: HostContext, connection: McpConnection): ApprovalSubject => {
  if (!isStdio(connection)) {
    const host = new URL(connection.url).host;
    return {
      kind: 'mcp',
      title: connection.title,
      lines: [
        { label: 'Type', value: `MCP server (${connection.transport})` },
        { label: 'URL', value: connection.url },
        { label: 'Connects to', value: host },
        {
          label: 'Headers',
          value:
            (connection.headers ?? []).map((header) => `${header.name} (from secret ${header.fromEnv})`).join(', ') ||
            'none',
        },
      ],
      files: [],
    };
  }
  const folder = connection.cwd === undefined ? 'not set' : path.join(context.packageDirectory, connection.cwd);
  const setup = (connection.setup ?? []).map((argv) => argv.join(' '));
  return {
    kind: 'mcp',
    title: connection.title,
    lines: [
      { label: 'Type', value: 'MCP server (stdio, a local program)' },
      { label: 'Command', value: [connection.command, ...connection.args].join(' ') },
      { label: 'Working folder', value: folder },
      ...(setup.length > 0 ? [{ label: 'Setup commands', value: setup.join(' ; ') }] : []),
      {
        label: 'Variables (from the package secret store)',
        value:
          (connection.env ?? []).map((item) => `${item.name}${item.required ? '' : ' (optional)'}`).join(', ') ||
          'none',
      },
    ],
    files: packageFileArguments(connection),
  };
};

export const createMcpHost = (deps: McpHostDeps = {}): AnyConnectionHost => {
  const registryOf = deps.registry ?? defaultRegistry;
  const portOf = deps.secretPort ?? ((packageId: string) => getPackageSecretPort(packageId));
  const commandExists = deps.commandExists ?? defaultCommandExists;
  const runtimeOf = async (): Promise<SourceMcpRuntime> => {
    if (deps.sourceRuntime) return deps.sourceRuntime;
    const { app } = await import('electron');
    if (!app || typeof app.getPath !== 'function') throw new Error('Native Electron runtime unavailable.');
    const userData = app.getPath('userData');
    return createSourceMcpRuntime({
      markerDirectory: path.join(userData, 'mcp-source-setup'),
      runtimeDirectory: path.join(userData, 'mcp-source-runtime'),
    });
  };
  const isSource = (connection: McpConnection): boolean =>
    isStdio(connection) &&
    (connection.cwd !== undefined ||
      (connection.setup?.length ?? 0) > 0 ||
      connection.command === 'node' ||
      packageFileArguments(connection).length > 0);

  const check = async (context: HostContext, connection: McpConnection): Promise<HostCheck> => {
    if (!isStdio(connection)) {
      const problem = remoteProblem(connection.url);
      return problem === undefined ? { ok: true } : { ok: false, reason: problem };
    }
    if ((connection.env ?? []).some((item) => RESERVED_VARIABLES.has(item.name.toUpperCase()))) {
      return { ok: false, reason: 'The MCP server requests a reserved environment variable.' };
    }
    if (isSource(connection)) {
      if (!SOURCE_INTERPRETERS.has(connection.command)) {
        return { ok: false, reason: 'This MCP source runtime supports Node, Python and Bun scripts only.' };
      }
      if (connection.command !== 'node' && !(await commandExists(connection.command))) {
        return { ok: false, reason: `"${connection.command}" is not installed or not on PATH on this machine.` };
      }
      try {
        return await (await runtimeOf()).check(context, connection as never);
      } catch {
        return { ok: false, reason: 'Native Electron runtime unavailable.' };
      }
    }
    const problem = sourceRuntimeProblem(connection);
    if (problem !== undefined) return { ok: false, reason: problem };
    if (!(await commandExists(connection.command))) {
      return { ok: false, reason: `"${connection.command}" is not installed or not on PATH on this machine.` };
    }
    return { ok: true };
  };

  /** The catalog transport: placeholders for secrets, and only for names the package can actually read. */
  const transportOf = async (context: HostContext, connection: McpConnection): Promise<IMcpServerTransport> => {
    const available = await availablePackageSecretNames(portOf(context.packageId));
    const placeholder = (name: string): string => packageSecretPlaceholder(context.packageId, name);
    if (!isStdio(connection)) {
      const headers = connection.headers ?? [];
      const missing = headers.filter((header) => !available.has(header.fromEnv)).map((header) => header.fromEnv);
      if (missing.length > 0) throw new Error(`Missing secret values: ${[...new Set(missing)].join(', ')}.`);
      return {
        type: connection.transport === 'sse' ? 'sse' : 'streamable_http',
        url: connection.url,
        ...(headers.length > 0
          ? { headers: Object.fromEntries(headers.map((header) => [header.name, placeholder(header.fromEnv)])) }
          : {}),
      };
    }
    const variables = connection.env ?? [];
    const missing = variables.filter((item) => item.required && !available.has(item.name)).map((item) => item.name);
    if (missing.length > 0) throw new Error(`Missing secret values: ${missing.join(', ')}.`);
    const present = variables.filter((item) => available.has(item.name));
    const launch = isSource(connection)
      ? await (await runtimeOf()).prepare(context, connection as never)
      : { type: 'stdio' as const, command: connection.command, args: [...connection.args] };
    return {
      ...launch,
      ...(present.length > 0
        ? { env: { ...launch.env, ...Object.fromEntries(present.map((item) => [item.name, placeholder(item.name)])) } }
        : {}),
    };
  };

  return defineConnectionHost({
    kind: 'mcp',
    check,
    describe: async (context, connection: McpConnection) => {
      const subject = subjectOf(context, connection);
      if (!isStdio(connection) || !isSource(connection)) return subject;
      const files = sourceMcpFiles(connection as never);
      return { ...subject, files: [...new Set([...subject.files, ...files])].toSorted() };
    },
    enable: async (context, connection: McpConnection) => {
      const checked = await check(context, connection);
      if (checked.ok === false) throw new Error(checked.reason);
      const transport = await transportOf(context, connection);
      const id = await upsertPackageConnectionMcp(await registryOf(), {
        packageId: context.packageId,
        packageVersion: context.packageVersion,
        connectionId: connection.id,
        title: connection.title,
        ...(connection.description === undefined ? {} : { description: connection.description }),
        transport,
      });
      return { installed: [id] };
    },
    // Only the server of this very package and connection; what the state recorded is the same id.
    disable: async (context, connection: McpConnection, _installed) => {
      await removePackageConnectionMcp(await registryOf(), [packageConnectionMcpId(context.packageId, connection.id)]);
    },
    reconcile: async ({ keep }) => {
      await removeOrphanPackageConnectionMcp(await registryOf(), ({ packageId, connectionId }) =>
        keep.has(`${packageId}\u0000mcp:${connectionId}`)
      );
    },
  });
};
