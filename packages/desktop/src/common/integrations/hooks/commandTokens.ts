/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns a Claude Code style hook command line (`node "${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs"`) into exec form (a program
 * and its argument list) without starting a shell. Only a deliberately small grammar is accepted: plain words, single
 * or double quoted words, and the placeholders `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`
 * (and their `TOMNY_` twins). Anything else (pipes, redirects, globs, command substitution, environment assignments,
 * unknown `${VAR}`, control characters) makes the command "needs shell": the caller keeps it out of the package's
 * runnable connections. Pure: no I/O, never throws.
 */

import { HOOK_LIMITS } from './config';

export type CommandTokens =
  | Readonly<{ ok: true; program: string; args: string[] }>
  | Readonly<{ ok: false; reason: string }>;

/** Placeholders the hook runtime expands (see `placeholders.ts`). Any other `$` is rejected. */
const PLACEHOLDER = /^\$\{(?:CLAUDE|TOMNY)_(?:PLUGIN_ROOT|PLUGIN_DATA|PROJECT_DIR)\}/u;
/** Characters that stand for themselves outside quotes. Everything else needs a shell or is unsafe. */
const PLAIN_CHARACTER = /^[A-Za-z0-9_\-./:=@%+,]$/u;
/** `NAME=value` as the first word: an environment assignment, which only a shell understands. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const hasControl = (text: string): boolean =>
  [...text].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f);

const needsShell = (reason: string): CommandTokens => ({ ok: false, reason });

/** Reads one word starting at `start` (a quote or a plain character). Returns the word and the next index. */
const readWord = (text: string, start: number): { word: string; next: number } | { error: string } => {
  let index = start;
  let word = '';
  while (index < text.length) {
    const character = text.charAt(index);
    if (character === ' ' || character === '\t') break;
    if (character === "'") {
      const close = text.indexOf("'", index + 1);
      if (close < 0) return { error: 'unterminated single quote' };
      const literal = text.slice(index + 1, close);
      if (literal.includes('$') || hasControl(literal)) return { error: 'single quote holds a variable or control' };
      word += literal;
      index = close + 1;
      continue;
    }
    if (character === '"') {
      index += 1;
      let closed = false;
      while (index < text.length) {
        const inner = text.charAt(index);
        if (inner === '"') {
          closed = true;
          index += 1;
          break;
        }
        if (inner === '$') {
          const placeholder = PLACEHOLDER.exec(text.slice(index));
          if (placeholder === null) return { error: 'unknown variable in double quotes' };
          word += placeholder[0];
          index += placeholder[0].length;
          continue;
        }
        if (inner === '`' || inner === '\\' || hasControl(inner)) return { error: 'shell character in double quotes' };
        word += inner;
        index += 1;
      }
      if (!closed) return { error: 'unterminated double quote' };
      continue;
    }
    if (character === '$') {
      const placeholder = PLACEHOLDER.exec(text.slice(index));
      if (placeholder === null) return { error: 'unknown variable' };
      word += placeholder[0];
      index += placeholder[0].length;
      continue;
    }
    if (!PLAIN_CHARACTER.test(character)) return { error: `shell character "${character}"` };
    word += character;
    index += 1;
  }
  return { word, next: index };
};

/**
 * Splits `command` into program and arguments. Returns `{ ok: false }` with a short reason when the line needs a
 * shell. Placeholders are kept in the output text and expanded by the hook runtime, as for exec-form args.
 */
export const commandToExecForm = (command: string): CommandTokens => {
  if (command.length === 0 || command.length > HOOK_LIMITS.commandMaxLength) return needsShell('empty or too long');
  if (hasControl(command)) return needsShell('control character');
  const words: string[] = [];
  let index = 0;
  while (index < command.length) {
    const character = command.charAt(index);
    if (character === ' ' || character === '\t') {
      index += 1;
      continue;
    }
    const read = readWord(command, index);
    if ('error' in read) return needsShell(read.error);
    words.push(read.word);
    index = read.next;
  }
  const [program, ...args] = words;
  if (program === undefined || program === '') return needsShell('no program');
  if (ASSIGNMENT.test(program)) return needsShell('environment assignment');
  if (args.length > HOOK_LIMITS.argsMaxCount || args.some((arg) => arg.length > HOOK_LIMITS.argMaxLength)) {
    return needsShell('too many or too long arguments');
  }
  return { ok: true, program, args };
};
