/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers shared by the MCP detectors (`mcp-config`, `mcp-published`). Everything read from a repository is
 * untrusted data: it is checked here against the same rules the adapter schema enforces, and a literal value that
 * could be a secret is never returned, only the name of the variable the user must fill in.
 */

import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { connectionSchema } from '@/common/packages/adapter/connections';
import { findLaunchProblem } from '@/common/packages/adapter/primitives';

/** Programs a local MCP server may start with (same list as the adapter schema). */
const ALLOWED_PROGRAMS: ReadonlySet<string> = new Set(['npx', 'uvx', 'docker', 'node', 'python', 'uv', 'bun']);

const PROGRAM_ALIASES: Readonly<Record<string, string>> = { python3: 'python', py: 'python', nodejs: 'node' };

/** `${NAME}`, `${input:NAME}`, `${env:NAME}`, `${NAME:-default}`. */
const PLACEHOLDER = /\$\{([^}]{1,100})\}/gu;

/**
 * Variables that stand for a folder, not for a value the user supplies. They are never turned into environment
 * variables: they only tell where a relative path starts.
 */
const PATH_VARIABLES: ReadonlySet<string> = new Set([
  'workspacefolder',
  'workspaceroot',
  'workspacefolderbasename',
  'userhome',
  'cwd',
  'pwd',
  'home',
  'claude_plugin_root',
  'codex_plugin_root',
  'plugin_root',
  '__dirname',
  'extensionpath',
  'tmpdir',
]);

/** Names of variables and headers that normally carry a secret. */
const SECRET_NAME = /key|token|secret|passw|credential|auth|bearer|session|cookie|signature|\bsig\b/iu;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

export type Placeholder = Readonly<{ raw: string; name: string; isPath: boolean }>;

/** `NAME` as an environment variable name (`[A-Z][A-Z0-9_]*`, at most 64 characters), or `undefined`. */
export const toEnvName = (raw: string): string | undefined => {
  const name = raw
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase()
    .slice(0, 64);
  return /^[A-Z][A-Z0-9_]*$/u.test(name) ? name : undefined;
};

/** A connection id (`[a-z0-9][a-z0-9._-]*`, at most 64 characters) made from a server or package name. */
export const toConnectionId = (raw: string): string | undefined => {
  const id = raw
    .toLowerCase()
    .replace(/^@[^/]+\//u, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 64);
  return id === '' ? undefined : id;
};

/** Text that came from a repository, made safe to put in a one-line note: no control characters, bounded. */
export const quoteForNote = (text: string, max = 60): string => {
  const clean = text.replace(CONTROL_CHARACTERS, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
};

/** Every `${...}` in `text`. The name of a path variable is kept as written. */
export const findPlaceholders = (text: string): readonly Placeholder[] => {
  const found: Placeholder[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const inner = (match[1] ?? '').trim();
    const withoutPrefix = inner.replace(/^(?:input|env):/iu, '');
    const name = withoutPrefix.replace(/:-.*$/u, '');
    const isPath = PATH_VARIABLES.has(name.toLowerCase());
    found.push({ raw: match[0], name, isPath });
  }
  return found;
};

/** True when a name looks like it holds a secret, so its value is requested rather than assumed optional. */
export const looksSecret = (name: string): boolean => SECRET_NAME.test(name);

/** Cheap check that a literal looks like a credential, used to refuse query strings that carry one. */
export const looksLikeCredential = (value: string): boolean =>
  value.length >= 16 && /^[A-Za-z0-9._~+/=-]+$/u.test(value) && /[0-9]/u.test(value) && /[A-Za-z]/u.test(value);

/**
 * Reduces the `command` of a server to a program the adapter allows. Handles a path (`/usr/bin/npx`), a Windows shim
 * (`npx.cmd`), `python3` and the `cmd /c npx ...` wrapper. Returns `undefined` for any other program.
 */
export const normalizeProgram = (
  command: string,
  args: readonly string[]
): Readonly<{ program: string; args: readonly string[] }> | undefined => {
  const base = (command.split(/[\\/]/u).at(-1) ?? '').toLowerCase().replace(/\.(?:cmd|exe|bat)$/u, '');
  if (base === 'cmd' && (args[0] ?? '').toLowerCase() === '/c' && args.length >= 2) {
    return normalizeProgram(args[1] ?? '', args.slice(2));
  }
  const program = PROGRAM_ALIASES[base] ?? base;
  return ALLOWED_PROGRAMS.has(program) ? { program, args } : undefined;
};

/**
 * The first argument the adapter would refuse for `program` (shell syntax, a space, a flag that program is not
 * allowed, a docker verb other than `run`...), if any. Mirrors the schema because it uses the same function.
 */
export const firstUnsafeArgument = (program: string, args: readonly string[]): string | undefined =>
  findLaunchProblem(program, args)?.argument;

/** An open item about something the rules could not turn into a connection. `file` is repository-relative. */
export const unrecognizedItem = (file: string, note: string): AdapterOpenItem => ({
  kind: 'unrecognized',
  path: `source/${file}`,
  note: note.slice(0, 300),
});

/** Asks the user for a variable's value. The note never contains a value from the repository. */
export const envValueItem = (connection: string, name: string, note: string): AdapterOpenItem => ({
  kind: 'env-value',
  connection,
  name,
  required: true,
  note: note.slice(0, 300),
});

/**
 * Checks a connection against the strict adapter schema. A connection the writer would reject is returned as an open
 * item instead, so a detector never hands a bad connection to the packager.
 */
export const validateConnection = (
  candidate: unknown,
  file: string
): Readonly<{ connection: AdapterConnection } | { problem: AdapterOpenItem }> => {
  const parsed = connectionSchema.safeParse(candidate);
  if (parsed.success) return { connection: parsed.data };
  const reason = quoteForNote(parsed.error.issues[0]?.message ?? 'invalid', 100);
  return { problem: unrecognizedItem(file, `Kết nối MCP không hợp lệ sau khi chuẩn hóa (${reason}).`) };
};

/**
 * JSON with comments and trailing commas (`.vscode/mcp.json`). Comments are removed outside strings only. Returns
 * `undefined` when the text is not JSON even after that.
 */
export const parseLooseJson = (text: string): unknown => {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return JSON.parse(withoutBom);
  } catch {
    // Fall through to the tolerant scan.
  }
  let output = '';
  let index = 0;
  while (index < withoutBom.length) {
    const char = withoutBom.charAt(index);
    if (char === '"') {
      let end = index + 1;
      while (end < withoutBom.length && withoutBom.charAt(end) !== '"') end += withoutBom.charAt(end) === '\\' ? 2 : 1;
      output += withoutBom.slice(index, end + 1);
      index = end + 1;
    } else if (char === '/' && withoutBom.charAt(index + 1) === '/') {
      while (index < withoutBom.length && withoutBom.charAt(index) !== '\n') index += 1;
    } else if (char === '/' && withoutBom.charAt(index + 1) === '*') {
      const end = withoutBom.indexOf('*/', index + 2);
      index = end < 0 ? withoutBom.length : end + 2;
    } else {
      output += char;
      index += 1;
    }
  }
  try {
    return JSON.parse(output.replace(/,(\s*[}\]])/gu, '$1'));
  } catch {
    return undefined;
  }
};

/** Last path segment, lowercase. */
export const baseName = (path: string): string => (path.split('/').at(-1) ?? '').toLowerCase();

/** The folder of a repository-relative path; `''` for the root. */
export const dirName = (path: string): string => {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
};

/** `source` or `source/<dir>`: where a repository folder sits inside a package. */
export const sourcePath = (dir: string): string => (dir === '' ? 'source' : `source/${dir}`);
