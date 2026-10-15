import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runMtuiInRoot } from '@process/resources/nativeFile/mtuiBridge';

export const BUILTIN_CORE_WORKSPACE_NAME = 'tomny-core-workspace';

const MAX_FILE_BYTES = 2_000_000;
const DEFAULT_READ_BYTES = 40_000;
const MAX_READ_LINES = 20_000;
const MAX_RESULTS = 200;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const MAX_CLI_ARGUMENTS = 24;
const MAX_CLI_ARGUMENT_CHARS = 200;
const MAX_TOOL_TEXT_CHARS = 60_000;

/** Runs one MTUI command with the workspace as its project root. */
export type CoreMtuiRunner = (args: string[], rootPath: string) => Promise<Record<string, unknown>>;

/** Outcome of a guarded mutation; `message` is written for the model to act on. */
export type CoreMutationOutcome = Readonly<{ ok: boolean; message: string }>;

/**
 * Guarded file mutation composed by the host. Implementations must serialize writers with a
 * lease (so agents sharing a workspace never overwrite each other) and persist through MTUI
 * (so every change is backed up and undoable). The core server never writes files itself.
 */
export type CoreWorkspaceMutationPort = Readonly<{
  write: (
    input: Readonly<{ workspace: string; agentId: string; relPath: string; content: string }>
  ) => Promise<CoreMutationOutcome>;
  editReplace: (
    input: Readonly<{ workspace: string; agentId: string; relPath: string; oldText: string; newText: string }>
  ) => Promise<CoreMutationOutcome>;
}>;

export type CoreWorkspaceServerDeps = Readonly<{
  workspace: string;
  /** MTUI runner; defaults to the bundled MTUI binary. */
  mtui?: CoreMtuiRunner;
  /** Guarded mutation port; defaults to the one the host registered, if any. */
  mutation?: CoreWorkspaceMutationPort;
  /** Package CLI port; defaults to the one the host registered, if any. */
  packageCli?: CorePackageCliPort;

  /** Library search port; defaults to the one the host registered, if any. */
  librarySearch?: CoreLibrarySearchPort;

  /** Stable writer identity for leases; defaults to a fresh id per server instance. */
  agentId?: string;
    /** Offer only read, search and glob. */
  readOnly?: boolean;
  /** Eager read/search tools only for validated oversized attachments. */
  focusedFileToolsOnly?: boolean;
}>;

let registeredMutationPort: CoreWorkspaceMutationPort | undefined;

/** Composes (or clears) the guarded mutation port used by every core workspace server. */
export const registerCoreWorkspaceMutationPort = (port: CoreWorkspaceMutationPort | undefined): void => {
  registeredMutationPort = port;
};

/**
 * Runs, or lists, the package CLIs and tools the person turned on (docs/platform/repotopackage-design.md section 10.10).
 * Composed by the host in Main; the core server knows no package code. The port validates the arguments, runs the
 * program without a shell, caps and scrubs the output. Permission is asked by the host's normal tool permission path
 * before this tool is called. Without a port the tool stays unavailable.
 */
export type CorePackageCliPort = Readonly<{
  run: (
    input: Readonly<{
      workspace: string;
      packageId?: string;
      connectionId?: string;
      args: readonly string[];
      timeoutSeconds?: number;
      signal?: AbortSignal;
    }>
  ) => Promise<CoreMutationOutcome>;
}>;

let registeredPackageCliPort: CorePackageCliPort | undefined;

/** Composes (or clears) the package CLI port used by every core workspace server. */
export const registerCoreWorkspacePackageCliPort = (port: CorePackageCliPort | undefined): void => {
  registeredPackageCliPort = port;
};

/**
 * Searches the Library of documents that installed packages brought and the person turned on
 * (docs/platform/repotopackage-design.md section 10.7). Read-only: the tool takes a query and a count and no path. The
 * port is composed by the host in Main, which also caps and inspects the answer; the core server knows no package code.
 * Without a port the tool stays unavailable.
 */
export type CoreLibrarySearchPort = Readonly<{
  search: (input: Readonly<{ query: string; limit?: number; signal?: AbortSignal }>) => Promise<CoreMutationOutcome>;
}>;

let registeredLibrarySearchPort: CoreLibrarySearchPort | undefined;

/** Composes (or clears) the Library search port used by every core workspace server. */
export const registerCoreWorkspaceLibrarySearchPort = (port: CoreLibrarySearchPort | undefined): void => {
  registeredLibrarySearchPort = port;
};

type TextToolResult = { content: [{ type: 'text'; text: string }]; isError?: true };

const text = (value: string, isError = false): TextToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError: true as const } : {}),
});

const isWithin = (root: string, candidate: string): boolean => {
  const pathRelative = relative(root, candidate);
  return pathRelative === '' || (!pathRelative.startsWith('..') && !isAbsolute(pathRelative));
};

const bounded = (value: number | undefined, fallback: number, maximum: number): number =>
  Math.min(Math.max(Math.trunc(value ?? fallback), 1), maximum);

const ensureWorkspace = async (workspace: string): Promise<string> => {
  const resolved = await realpath(workspace);
  if (!(await stat(resolved)).isDirectory()) throw new Error('The granted workspace is not a directory.');
  return resolved;
};

const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** Resolve an existing path and prove, after symlink resolution, that it stays inside the workspace. */
const resolveWorkspacePath = async (root: string, input: string): Promise<string> => {
  const candidate = resolve(root, input);
  if (!isWithin(root, candidate)) throw new Error('Path is outside the granted workspace.');
  const resolved = await realpath(candidate);
  if (!isWithin(root, resolved)) throw new Error('Resolved path is outside the granted workspace.');
  return resolved;
};

/** Like {@link resolveWorkspacePath} for a file that may not exist yet: its nearest existing ancestor is checked. */
const resolveMutationTarget = async (root: string, input: string): Promise<string> => {
  const candidate = resolve(root, input);
  if (!isWithin(root, candidate)) throw new Error('Path is outside the granted workspace.');
  let existing = candidate;
  for (;;) {
    try {
      const resolved = await realpath(existing);
      if (!isWithin(root, resolved)) throw new Error('Resolved path is outside the granted workspace.');
      return candidate;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(existing);
      if (parent === existing) throw new Error('Path is outside the granted workspace.');
      existing = parent;
    }
  }
};

const toWorkspaceRelative = (root: string, absolute: string): string =>
  relative(root, absolute).replaceAll('\\', '/') || '.';

/**
 * MTUI resolves its project root from the nearest `.mtui` or `.git` above the working directory.
 * Without a marker here that could be a far-away parent, so the workspace claims its own root.
 */
const ensureMtuiRoot = async (root: string): Promise<void> => {
  if (existsSync(join(root, '.mtui')) || existsSync(join(root, '.git'))) return;
  await mkdir(join(root, '.mtui'), { recursive: true });
};

const guarded = async (operation: () => Promise<string>): Promise<TextToolResult> => {
  try {
    return text(await operation());
  } catch (error) {
    return text(error instanceof Error ? error.message : 'Workspace operation failed.', true);
  }
};

const rejectUngovernedMutation = (): never => {
  throw new Error('CORE_WORKSPACE_MUTATION_GOVERNANCE_REQUIRED');
};

const rejectUngovernedCommand = (): never => {
  throw new Error('CORE_WORKSPACE_COMMAND_GOVERNANCE_REQUIRED');
};

const rejectUngovernedPackageCli = (): never => {
  throw new Error('CORE_WORKSPACE_PACKAGE_CLI_GOVERNANCE_REQUIRED');
};

/** A refused mutation becomes a tool error whose message tells the model what to do next. */
const renderOutcome = (outcome: CoreMutationOutcome): string => {
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.message;
};

const stringField = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === 'string' ? record[key] : '';

const clip = (value: string): string =>
  value.length > MAX_TOOL_TEXT_CHARS ? `${value.slice(0, MAX_TOOL_TEXT_CHARS)}\n...[truncated]` : value;

/** The readable part of an MTUI answer: its `text` when it has one, otherwise its data without the envelope. */
const renderPayload = (result: Record<string, unknown>): string => {
  const readable = stringField(result, 'text');
  if (readable) return clip(readable);
  const { ok: _ok, schema_version: _schema, mtui_version: _version, command: _command, warnings: _warnings, ...data } = result;
  return clip(JSON.stringify(data, null, 2));
};

/** MTUI prints Windows extended paths; the model should see plain ones. */
const plainPath = (value: string): string => (value.startsWith('\\\\?\\') ? value.slice(4) : value);

/**
 * Creates the neutral workspace primitives available to Hub runs. The server is
 * scoped to one already-authorized workspace and intentionally excludes IDE
 * navigation, memory, browser, and secret-context capabilities.
 *
 * Reads, searches, and globs run through MTUI. Writes and edits are delegated to the host's
 * guarded mutation port and stay disabled until one is composed. Commands stay disabled.
 */
export const createCoreWorkspaceServer = (deps: CoreWorkspaceServerDeps): McpServer => {
  const server = new McpServer({ name: BUILTIN_CORE_WORKSPACE_NAME, version: '1.0.0' });
  const mtui = deps.mtui ?? runMtuiInRoot;
  const agentId = deps.agentId ?? `core-${randomUUID().slice(0, 8)}`;

  const workspaceRoot = async (): Promise<string> => {
    const root = await ensureWorkspace(deps.workspace);
    await ensureMtuiRoot(root);
    return root;
  };

  const runMtui = async (root: string, args: string[]): Promise<Record<string, unknown>> => {
    const result = await mtui(['--json', ...args], root);
    if (result['ok'] !== true) {
      throw new Error(stringField(result, 'message') || 'MTUI command failed.');
    }
    return result;
  };

  server.tool(
    'tomny_read',
    'Read a text file inside the granted workspace (MTUI). Optional from/to are 1-based inclusive lines.',
    {
      filePath: z.string().min(1),
      from: z.number().int().positive().optional(),
      to: z.number().int().positive().optional(),
      maxBytes: z.number().int().positive().max(MAX_FILE_BYTES).optional(),
      lineNumbers: z.boolean().optional(),
    },
    ({ filePath, from, to, maxBytes, lineNumbers }) =>
      guarded(async () => {
        const root = await workspaceRoot();
        const target = await resolveWorkspacePath(root, filePath);
        if (from !== undefined && to !== undefined && to < from) {
          throw new Error('to must be greater than or equal to from.');
        }
        const args = [
          'read',
          '--max-chars',
          String(bounded(maxBytes, DEFAULT_READ_BYTES, MAX_FILE_BYTES)),
          '--max-lines',
          String(MAX_READ_LINES),
        ];
        if (from !== undefined) args.push('--from', String(from));
        if (to !== undefined) args.push('--to', String(to));
        if (lineNumbers === false) args.push('--no-line-numbers');
        args.push('--', toWorkspaceRelative(root, target));
        const result = await runMtui(root, args);
        return `${stringField(result, 'text')}${result['truncated'] === true ? '\n...[truncated]' : ''}`;
      })
  );

      if (!deps.focusedFileToolsOnly) server.tool(
    'tomny_glob',
    'Find files by glob pattern inside the granted workspace (MTUI). The pattern is relative to dir; results are workspace-relative paths.',
    {
      dir: z.string().min(1).optional(),
      pattern: z.string().min(1).max(512),
      maxResults: z.number().int().positive().max(MAX_RESULTS).optional(),
    },
    ({ dir, pattern, maxResults }) =>
      guarded(async () => {
        const root = await workspaceRoot();
        const start = await resolveWorkspacePath(root, dir ?? root);
        const result = await runMtui(root, [
          'glob',
          '--dir',
          toWorkspaceRelative(root, start),
          '--limit',
          String(bounded(maxResults, MAX_RESULTS, MAX_RESULTS)),
          '--',
          pattern.replaceAll('\\', '/'),
        ]);
        const files = Array.isArray(result['files']) ? result['files'].filter((f) => typeof f === 'string') : [];
        if (files.length === 0) return 'No files match the pattern.';
        return `${files.join('\n')}${result['truncated'] === true ? '\n...[truncated]' : ''}`;
      })
  );

  server.tool(
    'tomny_search',
    'Perform a bounded literal text search inside the granted workspace (MTUI). Results are file:line:text.',
    {
      rootPath: z.string().min(1).optional(),
      query: z.string().min(1).max(512).optional(),
      pattern: z.string().min(1).max(512).optional(),
      glob: z.string().min(1).max(512).optional(),
      regex: z.boolean().optional(),
      caseSensitive: z.boolean().optional(),
      maxResults: z.number().int().positive().max(MAX_RESULTS).optional(),
    },
    ({ rootPath, query, pattern, glob, regex, caseSensitive, maxResults }) =>
      guarded(async () => {
        if (regex) throw new Error('Regular-expression search is not enabled by the Core workspace capability.');
        const needle = query ?? pattern;
        if (!needle) throw new Error('query or pattern is required.');
        const root = await workspaceRoot();
        const start = await resolveWorkspacePath(root, rootPath ?? root);
        const args = ['search', '--limit', String(bounded(maxResults, MAX_RESULTS, MAX_RESULTS))];
        if (!caseSensitive) args.push('--ignore-case');
        if (glob) args.push('--glob', glob.replaceAll('\\', '/'));
        args.push('--', toWorkspaceRelative(root, start), needle);
        const result = await runMtui(root, args);
        const matches = Array.isArray(result['matches']) ? (result['matches'] as Record<string, unknown>[]) : [];
        if (matches.length === 0) return 'No matches found.';
        const lines = matches.map(
          (match) => `${stringField(match, 'file')}:${String(match['line'] ?? '')}:${stringField(match, 'preview')}`
        );
        return `${lines.join('\n')}${result['truncated'] === true ? '\n...[truncated]' : ''}`;
      })
  );

      if (deps.focusedFileToolsOnly) return server;

  server.tool(
    'tomny_wiki',
    'Ask the shared project Wiki (MTUI) how the repository is organised or why something works the way it does; returns the matching sections. Fast way to understand an unfamiliar repository. When the Wiki has not been built it answers from the code graph (Understand) instead, and says so.',
    {
      query: z.string().min(1).max(512),
      limit: z.number().int().positive().max(10).optional(),
    },
    ({ query, limit }) =>
      guarded(async () => {
        const root = await workspaceRoot();
        const count = bounded(limit, 5, 10);
        const wiki = await mtui(['--json', 'wiki', '--limit', String(count), '--', query], root);
        if (wiki['ok'] === true) return renderPayload(wiki);
        // No Wiki yet (it is built in Tomny Studio): the code graph can still point at the files that matter.
        if (!/wiki not found/iu.test(stringField(wiki, 'message'))) {
          throw new Error(stringField(wiki, 'message') || 'MTUI command failed.');
        }
        const graph = await mtui(['--json', 'context', '--limit', String(count), '--', query], root);
        if (graph['ok'] === true) {
          return `The project Wiki has not been built, so this answer comes from the code graph (Understand) instead: the files most relevant to your question.\n${renderPayload(graph)}`;
        }
        throw new Error(
          'Neither the project Wiki nor the Understand code graph exists for this workspace. Build one first: ask the user to build the Wiki in Tomny Studio, or run `mtui understand build`. Until then use tomny_search and tomny_glob.'
        );
      })
  );

  server.tool(
    'tomny_compass',
    'Read a large source file in a compressed, code-aware way (MTUI): the parts that matter for an optional query, with the omitted line ranges listed so you can read them next. Cheaper than tomny_read for big files.',
    {
      filePath: z.string().min(1),
      query: z.string().min(1).max(512).optional(),
      maxLines: z.number().int().positive().max(MAX_READ_LINES).optional(),
      page: z.number().int().positive().max(1000).optional(),
    },
    ({ filePath, query, maxLines, page }) =>
      guarded(async () => {
        const root = await workspaceRoot();
        const target = await resolveWorkspacePath(root, filePath);
        const args = ['compass', 'read', '--max-lines', String(bounded(maxLines, 120, MAX_READ_LINES))];
        if (query) args.push('--query', query);
        if (page !== undefined) args.push('--page', String(page));
        args.push('--', toWorkspaceRelative(root, target));
        const result = await runMtui(root, args);
        const next = Array.isArray(result['next_read_commands'])
          ? result['next_read_commands'].filter((item): item is string => typeof item === 'string').slice(0, 5)
          : [];
        return `${renderPayload(result)}${next.length > 0 ? `\nOmitted ranges, read with: ${next.join(' ; ')}` : ''}`;
      })
  );

  server.tool(
    'tomny_diff',
    'Show the diff of one MTUI file operation (operationId) or of the most recent one (last=true): what an edit, write or patch actually changed.',
    {
      operationId: z.string().min(1).max(200).optional(),
      last: z.boolean().optional(),
    },
    ({ operationId, last }) =>
      guarded(async () => {
        if (Boolean(operationId) === (last === true)) throw new Error('Give exactly one of operationId or last=true.');
        const root = await workspaceRoot();
        const result = await runMtui(root, ['diff', ...(operationId ? ['--operation', operationId] : ['--last'])]);
        const files = Array.isArray(result['files']) ? (result['files'] as Record<string, unknown>[]) : [];
        if (files.length === 0) return 'That operation changed no files.';
        return clip(
          files
            .map((file) => `${plainPath(stringField(file, 'file'))} (+${String(file['insertions'] ?? 0)} -${String(file['deletions'] ?? 0)})\n${stringField(file, 'diff')}`)
            .join('\n\n')
        );
      })
  );

  server.tool(
    'tomny_compact',
    'Shrink a large log or command output that is saved in a file inside the workspace (MTUI): repeated noise is collapsed and errors are kept. Use it before reading a long build, test or tool log. profile picks the log format.',
    {
      filePath: z.string().min(1),
      profile: z.enum(['auto', 'generic', 'json', 'python', 'vitest', 'tsc', 'cargo', 'pytest']).optional(),
      maxLines: z.number().int().positive().max(2000).optional(),
    },
    ({ filePath, profile, maxLines }) =>
      guarded(async () => {
        const root = await workspaceRoot();
        const target = await resolveWorkspacePath(root, filePath);
        const result = await runMtui(root, [
          'compact',
          '--file',
          toWorkspaceRelative(root, target),
          '--profile',
          profile ?? 'auto',
          '--max-lines',
          String(bounded(maxLines, 80, 2000)),
        ]);
        return renderPayload(result);
      })
  );

  server.tool(
    'tomny_library_search',
    'Search the Library: documents that installed packages brought and the person turned on (guides, notes, reference lists). Read-only. Give a few plain words; the answer lists the best matches with their package, path and a short passage, capped in size. It returns nothing when no knowledge package is turned on.',
    {
      query: z.string().min(1).max(512),
      limit: z.number().int().positive().max(20).optional(),
    },
    ({ query, limit }, extra) =>
      guarded(async () => {
        const port = deps.librarySearch ?? registeredLibrarySearchPort;
        if (port === undefined) throw new Error('CORE_WORKSPACE_LIBRARY_UNAVAILABLE');
        return renderOutcome(
          await port.search({
            query,
            ...(limit === undefined ? {} : { limit }),
            signal: extra.signal,
          })
        );
      })
  );

  // The read-only variant stops here: write, edit and command are for surfaces that govern them.
  if (!deps.readOnly) {
    server.tool(
      'tomny_command',
      'Unavailable until a governed command executor is composed.',
      {
        command: z.string().min(1).max(16_000),
        cwd: z.string().min(1).optional(),
        timeoutMs: z.number().int().positive().max(MAX_COMMAND_TIMEOUT_MS).optional(),
      },
      (_input) => guarded(async () => rejectUngovernedCommand())
    );

    const mutationPort = (): CoreWorkspaceMutationPort =>
      deps.mutation ?? registeredMutationPort ?? rejectUngovernedMutation();

    server.tool(
      'tomny_write',
      'Replace a whole file (creates it if missing). Guarded by a team lease so agents sharing the workspace never overwrite each other, and saved through MTUI (backed up, undoable). Prefer tomny_edit for partial changes.',
      { filePath: z.string().min(1), content: z.string().max(MAX_FILE_BYTES) },
      ({ filePath, content }) =>
        guarded(async () => {
          const port = mutationPort();
          const root = await workspaceRoot();
          const target = await resolveMutationTarget(root, filePath);
          return renderOutcome(
            await port.write({ workspace: root, agentId, relPath: toWorkspaceRelative(root, target), content })
          );
        })
    );

    server.tool(
      'tomny_edit',
      'Replace one exact piece of text in a file. Safe for several agents on the same file: only the named region changes, a stale or ambiguous anchor is refused, and the file lease is respected. Saved through MTUI.',
      { filePath: z.string().min(1), oldText: z.string().min(1), newText: z.string().max(MAX_FILE_BYTES) },
      ({ filePath, oldText, newText }) =>
        guarded(async () => {
          const port = mutationPort();
          const root = await workspaceRoot();
          const target = await resolveWorkspacePath(root, filePath);
          return renderOutcome(
            await port.editReplace({
              workspace: root,
              agentId,
              relPath: toWorkspaceRelative(root, target),
              oldText,
              newText,
            })
          );
        })
    );

    server.tool(
      'tomny_package_cli',
      'Run a command-line program that an installed package offered and the person turned on; call it without packageId and connectionId to list what is available. args are plain-token arguments appended to the fixed ones of the program: no shell, and a path must stay inside the workspace. It runs in the granted workspace, stops after at most 120 seconds and returns capped output with secrets scrubbed. The person is asked before it runs.',
      {
        packageId: z.string().min(1).max(128).optional(),
        connectionId: z.string().min(1).max(64).optional(),
        args: z.array(z.string().min(1).max(MAX_CLI_ARGUMENT_CHARS)).max(MAX_CLI_ARGUMENTS).optional(),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(MAX_COMMAND_TIMEOUT_MS / 1000)
          .optional(),
      },
      ({ packageId, connectionId, args, timeoutSeconds }, extra) =>
        guarded(async () => {
          const port = deps.packageCli ?? registeredPackageCliPort ?? rejectUngovernedPackageCli();
          if ((packageId === undefined) !== (connectionId === undefined)) {
            throw new Error('Give both packageId and connectionId to run a program, or neither to list them.');
          }
          const root = await workspaceRoot();
          return renderOutcome(
            await port.run({
              workspace: root,
              ...(packageId === undefined ? {} : { packageId }),
              ...(connectionId === undefined ? {} : { connectionId }),
              args: args ?? [],
              ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
              signal: extra.signal,
            })
          );
        })
    );
  }

  return server;
};
