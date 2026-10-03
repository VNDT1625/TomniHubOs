import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const BUILTIN_CORE_WORKSPACE_NAME = 'tomny-core-workspace';

const MAX_FILE_BYTES = 2_000_000;
const DEFAULT_READ_BYTES = 40_000;
const MAX_RESULTS = 200;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', '.tomni']);

export type CoreWorkspaceServerDeps = Readonly<{ workspace: string }>;

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

const resolveWorkspacePath = async (workspace: string, input: string, allowMissing = false): Promise<string> => {
  const root = await ensureWorkspace(workspace);
  const candidate = resolve(root, input);
  if (!isWithin(root, candidate)) throw new Error('Path is outside the granted workspace.');
  try {
    const resolved = await realpath(candidate);
    if (!isWithin(root, resolved)) throw new Error('Resolved path is outside the granted workspace.');
    return resolved;
  } catch (error) {
    if (!allowMissing || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    return candidate;
  }
};

const globPattern = (pattern: string): RegExp => {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[|\\{}()[\]^$+*?.]/gu, '\\$&');
    }
  }
  return new RegExp(`${expression}$`, 'u');
};

const listFiles = async (workspace: string, directory: string, limit: number): Promise<string[]> => {
  const root = await ensureWorkspace(workspace);
  const start = await resolveWorkspacePath(root, directory);
  const files: string[] = [];
  const pending = [start];
  while (pending.length > 0 && files.length < limit) {
    const current = pending.shift();
    if (!current) break;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) pending.push(fullPath);
        continue;
      }
      if (entry.isFile()) files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
};

const renderRead = (filePath: string, source: string, from: number, to: number, lineNumbers: boolean): string => {
  const lines = source.split(/\r?\n/u);
  return lines
    .slice(from - 1, to)
    .map((line, index) => (lineNumbers ? `${from + index}: ${line}` : line))
    .join('\n');
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

/**
 * Creates the neutral workspace primitives available to Hub runs. The server is
 * scoped to one already-authorized workspace and intentionally excludes IDE
 * navigation, memory, browser, and secret-context capabilities.
 */
export const createCoreWorkspaceServer = (deps: CoreWorkspaceServerDeps): McpServer => {
  const server = new McpServer({ name: BUILTIN_CORE_WORKSPACE_NAME, version: '1.0.0' });

  server.tool(
    'tomny_read',
    'Read a text file inside the granted workspace.',
    {
      filePath: z.string().min(1),
      from: z.number().int().positive().optional(),
      to: z.number().int().positive().optional(),
      maxBytes: z.number().int().positive().max(MAX_FILE_BYTES).optional(),
      lineNumbers: z.boolean().optional(),
    },
    ({ filePath, from, to, maxBytes, lineNumbers }) =>
      guarded(async () => {
        const target = await resolveWorkspacePath(deps.workspace, filePath);
        const bytes = await readFile(target);
        const cap = bounded(maxBytes, DEFAULT_READ_BYTES, MAX_FILE_BYTES);
        const source = bytes.subarray(0, cap).toString('utf8');
        const first = from ?? 1;
        const last = to ?? source.split(/\r?\n/u).length;
        if (last < first) throw new Error('to must be greater than or equal to from.');
        const suffix = bytes.length > cap ? '\n...[truncated]' : '';
        return `${renderRead(target, source, first, last, lineNumbers ?? true)}${suffix}`;
      })
  );

  server.tool(
    'tomny_glob',
    'Find files by glob pattern inside the granted workspace.',
    {
      dir: z.string().min(1).optional(),
      pattern: z.string().min(1).max(512),
      maxResults: z.number().int().positive().max(MAX_RESULTS).optional(),
    },
    ({ dir, pattern, maxResults }) =>
      guarded(async () => {
        const root = await ensureWorkspace(deps.workspace);
        const directory = dir ?? root;
        const start = await resolveWorkspacePath(root, directory);
        const matcher = globPattern(pattern.replaceAll('\\', '/'));
        const files = await listFiles(root, start, bounded(maxResults, MAX_RESULTS, MAX_RESULTS));
        const matches = files
          .map((file) => relative(start, file).replaceAll('\\', '/'))
          .filter((file) => matcher.test(file));
        return matches.length > 0 ? matches.join('\n') : 'No files match the pattern.';
      })
  );

  server.tool(
    'tomny_search',
    'Perform a bounded literal text search inside the granted workspace.',
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
        const root = await ensureWorkspace(deps.workspace);
        const start = await resolveWorkspacePath(root, rootPath ?? root);
        const matcher = glob ? globPattern(glob.replaceAll('\\', '/')) : undefined;
        const normalizedNeedle = caseSensitive ? needle : needle.toLocaleLowerCase();
        const results: string[] = [];
        for (const file of await listFiles(root, start, 2_000)) {
          if (results.length >= bounded(maxResults, MAX_RESULTS, MAX_RESULTS)) break;
          const relPath = relative(start, file).replaceAll('\\', '/');
          if (matcher && !matcher.test(relPath)) continue;
          const bytes = await readFile(file);
          if (bytes.length > MAX_FILE_BYTES) continue;
          const lines = bytes.toString('utf8').split(/\r?\n/u);
          for (
            let index = 0;
            index < lines.length && results.length < bounded(maxResults, MAX_RESULTS, MAX_RESULTS);
            index += 1
          ) {
            const comparable = caseSensitive ? lines[index] : lines[index].toLocaleLowerCase();
            if (comparable.includes(normalizedNeedle)) results.push(`${relPath}:${index + 1}:${lines[index]}`);
          }
        }
        return results.length > 0 ? results.join('\n') : 'No matches found.';
      })
  );

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

  server.tool(
    'tomny_write',
    'Unavailable until a governed native workspace writer is composed.',
    { filePath: z.string().min(1), content: z.string().max(MAX_FILE_BYTES) },
    (_input) => guarded(async () => rejectUngovernedMutation())
  );

  server.tool(
    'tomny_edit',
    'Unavailable until a governed native workspace editor is composed.',
    { filePath: z.string().min(1), oldText: z.string().min(1), newText: z.string().max(MAX_FILE_BYTES) },
    (_input) => guarded(async () => rejectUngovernedMutation())
  );

  return server;
};
