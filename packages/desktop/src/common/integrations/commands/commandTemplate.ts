/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prompt templates contributed by an installed package (docs/platform/repotopackage-design.md section 10.3). Pure
 * functions only; reading the template file is the host's job and happens in Main.
 *
 * A template is DATA for the model, never something Main runs:
 * - `$ARGUMENTS` and `{{args}}` become everything typed after the command name; `$1` to `$9` become the words of
 *   it (double or single quotes group words). A placeholder is replaced in one pass, so an argument that itself
 *   contains `$1` or `{{args}}` is never expanded a second time.
 * - A template without any placeholder gets the arguments appended as a final `ARGUMENTS:` line, so they are not lost.
 * - Shell substitution (a backtick command after an exclamation mark, or `!{...}` in Gemini TOML) is NEVER executed.
 *   It is left in the text as written, so the model sees a literal string and no command output is injected.
 *   File references (`@path`, `@{path}`) are not read either. {@link countUnrunSyntax} reports how many there were.
 * - `allowed-tools` and similar front matter keys are ignored: a command grants no capability.
 */

import { parse as parseToml } from 'smol-toml';

export type PackageCommandFormat = 'markdown' | 'gemini-toml' | 'copilot-prompt';

/** A template file larger than this is refused (bytes). */
export const PACKAGE_COMMAND_MAX_BYTES = 64 * 1024;
/** The expanded prompt larger than this is refused (characters). */
export const PACKAGE_COMMAND_MAX_EXPANDED_CHARS = 200_000;
const MAX_DESCRIPTION_CHARS = 300;
const MAX_ARGUMENT_HINT_CHARS = 200;

export type ParsedCommandTemplate = Readonly<{
  /** The prompt text with the front matter removed. */
  body: string;
  description?: string;
  argumentHint?: string;
}>;

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

const unquote = (value: string): string => {
  const trimmed = value.trim();
  const first = trimmed[0];
  return trimmed.length >= 2 && (first === '"' || first === "'") && trimmed.endsWith(first)
    ? trimmed.slice(1, -1)
    : trimmed;
};

const FRONT_MATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

/** Only the three keys the menu needs are read; every other key (including `allowed-tools`) is dropped. */
const parseMarkdown = (raw: string): ParsedCommandTemplate => {
  const match = FRONT_MATTER.exec(raw);
  if (!match) return { body: raw.replace(/^﻿/u, '').trim() };
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/u)) {
    const separator = line.indexOf(':');
    if (separator <= 0 || /^\s/u.test(line)) continue;
    fields.set(line.slice(0, separator).trim().toLowerCase(), unquote(line.slice(separator + 1)));
  }
  const description = fields.get('description');
  const hint = fields.get('argument-hint') ?? fields.get('argumenthint');
  return {
    body: raw.slice(match[0].length).trim(),
    ...(description ? { description: clip(description, MAX_DESCRIPTION_CHARS) } : {}),
    ...(hint ? { argumentHint: clip(hint, MAX_ARGUMENT_HINT_CHARS) } : {}),
  };
};

const parseGeminiToml = (raw: string): ParsedCommandTemplate | undefined => {
  let table: Record<string, unknown>;
  try {
    table = parseToml(raw);
  } catch {
    return undefined;
  }
  const prompt = table.prompt;
  if (typeof prompt !== 'string' || prompt.trim() === '') return undefined;
  const description = table.description;
  return {
    body: prompt.trim(),
    ...(typeof description === 'string' && description !== ''
      ? { description: clip(description, MAX_DESCRIPTION_CHARS) }
      : {}),
  };
};

/** Reads one template file. Returns `undefined` when the file is not a usable template of that format. */
export const parseCommandTemplate = (format: PackageCommandFormat, raw: string): ParsedCommandTemplate | undefined => {
  const parsed = format === 'gemini-toml' ? parseGeminiToml(raw) : parseMarkdown(raw);
  return parsed === undefined || parsed.body === '' ? undefined : parsed;
};

/** Splits the text after a command name into words; quotes group words and are removed. */
export const splitCommandArguments = (rawArguments: string): string[] => {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let started = false;
  for (const char of rawArguments) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started || current !== '') words.push(current);
      current = '';
      started = false;
    } else {
      current += char;
    }
  }
  if (started || current !== '') words.push(current);
  return words;
};

const PLACEHOLDER = /\$ARGUMENTS|\$([1-9])(?!\d)|\{\{\s*args\s*\}\}/gu;
const SHELL_SUBSTITUTION = /!`[^`\n]*`|!\{[^}\n]*\}/gu;
const FILE_REFERENCE = /(?:^|\s)@\{[^}\n]*\}|(?:^|\s)@[\w./\\-]+/gu;

/** How many shell substitutions and file references the template holds that Main will not run or read. */
export const countUnrunSyntax = (body: string): Readonly<{ shell: number; files: number }> => ({
  shell: body.match(SHELL_SUBSTITUTION)?.length ?? 0,
  files: body.match(FILE_REFERENCE)?.length ?? 0,
});

export type ExpandedCommand = Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; reason: 'too-large' }>;

/** Fills a template with what the person typed after the command name. */
export const expandCommandTemplate = (body: string, rawArguments: string): ExpandedCommand => {
  const typed = rawArguments.trim();
  const words = splitCommandArguments(typed);
  let usedPlaceholder = false;
  const filled = body.replace(PLACEHOLDER, (_match, index: string | undefined) => {
    usedPlaceholder = true;
    return index === undefined ? typed : (words[Number(index) - 1] ?? '');
  });
  const text = !usedPlaceholder && typed !== '' ? `${filled}\n\nARGUMENTS: ${typed}` : filled;
  return text.length > PACKAGE_COMMAND_MAX_EXPANDED_CHARS ? { ok: false, reason: 'too-large' } : { ok: true, text };
};

export type PackageSlash = Readonly<{ name: string; rawArguments: string }>;

const SLASH_LINE = /^\s*\/([a-z0-9][a-z0-9._:-]{0,200})(?:\s+([\s\S]*))?$/iu;

/** `/name rest` at the very start of a message. Only the first token is a command; the rest is its arguments. */
export const parsePackageSlash = (input: string): PackageSlash | undefined => {
  const match = SLASH_LINE.exec(input);
  return match ? { name: (match[1] ?? '').toLowerCase(), rawArguments: match[2] ?? '' } : undefined;
};

export type PackageCommandIdentity = Readonly<{ packageId: string; id: string; plugin?: string }>;

const pluginSlug = (plugin: string | undefined): string | undefined => {
  const last = plugin?.split(/[\\/]/u).findLast((part) => part !== '');
  const slug = last
    ?.toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9._-]+$/gu, '')
    .slice(0, 64);
  return slug === undefined || slug === '' ? undefined : slug;
};

/**
 * The name each command is offered and typed under, in the order given. A command keeps its own id; when two
 * packages offer the same id, or the id is already a built-in command, mode or agent command (`reserved`), it is
 * `<plugin>:<id>` (the plugin folder, else the package id). Should that still collide, `<packageId>:<id>` is used,
 * which is unique because a package has one command per id.
 */
export const assignPackageCommandNames = (
  commands: readonly PackageCommandIdentity[],
  reserved: ReadonlySet<string>
): string[] => {
  const counts = new Map<string, number>();
  for (const command of commands) counts.set(command.id, (counts.get(command.id) ?? 0) + 1);
  const first = commands.map((command) =>
    (counts.get(command.id) ?? 0) > 1 || reserved.has(command.id)
      ? `${pluginSlug(command.plugin) ?? command.packageId}:${command.id}`
      : command.id
  );
  const firstCounts = new Map<string, number>();
  for (const name of first) firstCounts.set(name, (firstCounts.get(name) ?? 0) + 1);
  return first.map((name, index) =>
    (firstCounts.get(name) ?? 0) > 1 || reserved.has(name)
      ? `${commands[index]?.packageId ?? ''}:${commands[index]?.id ?? ''}`
      : name
  );
};
