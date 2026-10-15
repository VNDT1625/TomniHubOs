/**
 * Identity and content pinning of hooks (design sections 9.4 and 11.6 item 2).
 *
 * The hook id is a SHA-256 of its definition. The approval hash covers event, matcher, command, args
 * and the content of every script file the hook would execute. The registry always computes both itself;
 * a value coming from the renderer is only ever compared against them.
 *
 * Pinning only uses placeholders that belong to the hook itself (plugin root, plugin data, workspace
 * directory), so the hash is identical when it is computed for the dialog and again right before a run.
 */

/* oxlint-disable no-await-in-loop -- files are hashed one at a time to bound open handles and memory */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { expandPlaceholders, type HookHandler, type PlaceholderContext } from '@/common/integrations/hooks';
import { canonicalJson } from '@process/integrations/connections/core/approval';
import { HOOK_INTERPRETER_NAMES, type HookSource } from './hookTypes';

/** Where a hook lives; decides which directory relative script paths resolve against. */
export type HookPinContext = {
  source: HookSource;
  pluginRoot?: string;
  pluginData?: string;
  workspaceDir?: string;
};

/** A script file that is part of the approval hash. `label` never contains an absolute path. */
export type PinnedFile = { label: string; file: string; required: boolean };

export type HookPinning = {
  hash: string;
  files: string[];
  /** Path-like tokens that could not be resolved to a file, so the content is not pinned. */
  unpinned: string[];
  /** Content digest of each pinned file, parallel to `files`: `sha256:<hex>`, or `unreadable` / `not-a-file`. */
  digests: string[];
};

/** One line of the approval dialog. The renderer translates `key`; `value` is data. */
export type HookDescribeLine = {
  key:
    | 'source'
    | 'plugin'
    | 'event'
    | 'matcher'
    | 'form'
    | 'command'
    | 'args'
    | 'timeout'
    | 'file'
    | 'unpinned'
    | 'network';
  value: string;
};

const MAX_PINNED_FILES = 8;
const MAX_SHELL_TOKENS = 16;
const SCRIPT_EXTENSION = /\.(?:js|mjs|cjs|ts|sh|bash|ps1|py|rb|bat|cmd|exe|com)$/i;
const INTERPRETERS: ReadonlySet<string> = new Set<string>(HOOK_INTERPRETER_NAMES);

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Stable id: SHA-256 of source, scope (package id or workspace id), event, matcher, command and args. */
export const computeHookId = (source: HookSource, scope: string | undefined, handler: HookHandler): string =>
  sha256Hex(
    canonicalJson({
      source,
      scope: scope ?? null,
      event: handler.event,
      matcher: handler.matcher ?? '',
      command: handler.command,
      args: handler.args ?? null,
    })
  );

/** Placeholders a hook owns. Run-time values such as the session workspace are deliberately excluded. */
export const pinPlaceholders = (context: HookPinContext): PlaceholderContext => {
  const placeholders: PlaceholderContext = {};
  if (context.pluginRoot !== undefined) placeholders.pluginRoot = context.pluginRoot;
  if (context.pluginData !== undefined) placeholders.pluginData = context.pluginData;
  if (context.workspaceDir !== undefined) placeholders.projectDir = context.workspaceDir;
  return placeholders;
};

const baseDirOf = (context: HookPinContext): string | undefined =>
  context.source === 'package' ? context.pluginRoot : context.source === 'workspace' ? context.workspaceDir : undefined;

const interpreterOf = (command: string): string | undefined => {
  if (command.includes('/') || command.includes('\\')) return undefined;
  const lower = command.toLowerCase().replace(/\.exe$/, '');
  return INTERPRETERS.has(lower) ? lower : undefined;
};

const stripQuotes = (token: string): string => token.replace(/^["']|["']$/g, '');

const resolveToken = (token: string, base: string | undefined): string | undefined => {
  if (path.isAbsolute(token)) return path.normalize(token);
  return base === undefined ? undefined : path.resolve(base, token);
};

const labelOf = (file: string, base: string | undefined): string => {
  if (base !== undefined) {
    const relative = path.relative(base, file);
    if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative))
      return relative.replace(/\\/g, '/');
  }
  return path.basename(file);
};

const exists = async (file: string): Promise<boolean> => {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
};

/** Finds the script files this hook would execute, and the tokens it could not pin. */
const collectFiles = async (
  handler: HookHandler,
  context: HookPinContext
): Promise<{ files: PinnedFile[]; unpinned: string[] }> => {
  const placeholders = pinPlaceholders(context);
  const base = baseDirOf(context);
  const command = expandPlaceholders(handler.command, placeholders);
  const args = (handler.args ?? []).map((arg) => expandPlaceholders(arg, placeholders));
  const found: PinnedFile[] = [];
  const unpinned: string[] = [];
  const seen = new Set<string>();

  const add = async (token: string, required: boolean): Promise<void> => {
    const resolved = resolveToken(token, base);
    if (resolved === undefined) {
      if (required && !token.startsWith('${')) unpinned.push(path.basename(token));
      return;
    }
    if (seen.has(resolved) || found.length >= MAX_PINNED_FILES) return;
    if (!required && !(await exists(resolved))) return;
    seen.add(resolved);
    found.push({ label: labelOf(resolved, base), file: resolved, required });
  };

  if (handler.form === 'shell') {
    const tokens = command
      .split(/\s+/)
      .map(stripQuotes)
      .filter((token) => token !== '' && !token.startsWith('-'))
      .slice(0, MAX_SHELL_TOKENS);
    for (const [index, token] of tokens.entries()) {
      if (index === 0 || SCRIPT_EXTENSION.test(token)) await add(token, false);
    }
    return { files: found, unpinned };
  }

  const interpreter = interpreterOf(command);
  if (interpreter !== undefined) {
    const start = (interpreter === 'uv' || interpreter === 'deno') && args[0] === 'run' ? 1 : 0;
    const script = args[start];
    if (script !== undefined && !script.startsWith('-')) await add(script, true);
  } else if (context.source === 'package' || command.includes('/') || command.includes('\\')) {
    await add(command, true);
  }
  return { files: found, unpinned };
};

const digestFile = async (file: string): Promise<string> => {
  try {
    if (!(await stat(file)).isFile()) return 'not-a-file';
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return `sha256:${hash.digest('hex')}`;
  } catch {
    // A script that vanished or cannot be read still changes the hash, so it never matches an old approval.
    return 'unreadable';
  }
};

/** Computes the approval hash from the definition and the current content of its script files. */
export const computeHookPinning = async (handler: HookHandler, context: HookPinContext): Promise<HookPinning> => {
  const { files, unpinned } = await collectFiles(handler, context);
  const digests: string[] = [];
  for (const entry of files) digests.push(await digestFile(entry.file));
  const hash = sha256Hex(
    canonicalJson({
      v: 1,
      event: handler.event,
      matcher: handler.matcher ?? '',
      command: handler.command,
      args: handler.args ?? null,
      files: files.map((entry, index) => ({ label: entry.label, digest: digests[index] })),
    })
  );
  return { hash: `sha256-${hash}`, files: files.map((entry) => entry.label), unpinned, digests };
};

/** Replaces the hook's own directories in `text` with their placeholder names. */
export const redactHookPaths = (text: string, context: HookPinContext): string => {
  let result = text;
  const swap = (root: string | undefined, token: string): void => {
    if (root === undefined || root === '') return;
    const trimmed = root.replace(/[\\/]+$/, '');
    for (const variant of new Set([trimmed, trimmed.replace(/\\/g, '/'), trimmed.replace(/\//g, '\\')])) {
      if (variant !== '') result = result.split(variant).join(token);
    }
  };
  swap(context.pluginRoot, '${CLAUDE_PLUGIN_ROOT}');
  swap(context.pluginData, '${CLAUDE_PLUGIN_DATA}');
  swap(context.workspaceDir, '${CLAUDE_PROJECT_DIR}');
  return result;
};

/** The lines the approval dialog must show (section 9.4), with the hook's own paths redacted. */
export const buildDescribeLines = (
  handler: HookHandler,
  context: HookPinContext,
  pluginId: string | undefined,
  pinning: HookPinning
): HookDescribeLine[] => {
  const lines: HookDescribeLine[] = [{ key: 'source', value: context.source }];
  if (pluginId !== undefined) lines.push({ key: 'plugin', value: pluginId });
  lines.push({ key: 'event', value: handler.event });
  lines.push({ key: 'matcher', value: handler.matcher ?? '*' });
  lines.push({ key: 'form', value: handler.form });
  lines.push({ key: 'command', value: redactHookPaths(handler.command, context) });
  for (const arg of handler.args ?? []) lines.push({ key: 'args', value: redactHookPaths(arg, context) });
  lines.push({ key: 'timeout', value: String(handler.timeoutSec) });
  for (const label of pinning.files) lines.push({ key: 'file', value: label });
  for (const token of pinning.unpinned) lines.push({ key: 'unpinned', value: token });
  lines.push({ key: 'network', value: 'unrestricted' });
  return lines;
};
