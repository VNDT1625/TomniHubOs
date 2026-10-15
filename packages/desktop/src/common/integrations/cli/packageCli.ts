/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the renderer, the host and the agent tool agree on for `cli` and `tool` connections (docs/platform/
 * repotopackage-design.md sections 10.10 and 15.1, tasks T5.4). Pure data and checks; no Node.js and no DOM.
 *
 * - A turned-on CLI means "ready to call"; nothing runs when it is turned on.
 * - The Terminal menu asks Main for a command line by package id and connection id only. The line is typed into a
 *   new terminal and never run: it holds no line break or control character, so it cannot press Enter by itself.
 * - The agent adds arguments to the connection's own fixed ones. Each must be one plain token and must not point
 *   outside the workspace. They go to the program as an argument array, never through a shell.
 */

import type { PackageConnectionView } from '@/common/types/platform/packageConnections';

/** Bounds shared by the host's approval text, the tool and the runner. */
export const PACKAGE_CLI_MAX_ARGUMENTS = 24;
export const PACKAGE_CLI_MAX_ARGUMENT_LENGTH = 200;
export const PACKAGE_CLI_TIMEOUT_MS = 120_000;
export const PACKAGE_CLI_MAX_OUTPUT_BYTES = 64 * 1024;

export const PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL = 'package-cli.terminal-launch';

/** The same token alphabet as one argument of an adapter command (`processCommand`): no space, quote or shell syntax. */
const ARGUMENT_TOKEN = /^[A-Za-z0-9@._/:=~+,-]+$/u;
const DRIVE_PREFIX = /^[A-Za-z]:/u;
// oxlint-disable-next-line no-control-regex -- control characters are exactly what a terminal line must not hold.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const CLI_CONNECTION_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export type CliArgumentProblem = Readonly<{ index: number; reason: string }>;

/** Whether the path part of an argument stays inside the workspace: relative, no `..`, not home, not a drive. */
const staysInside = (value: string): boolean =>
  !value.startsWith('/') &&
  !value.startsWith('~') &&
  !DRIVE_PREFIX.test(value) &&
  !value.split('/').some((part) => part === '..');

/**
 * The first reason the agent's arguments are refused, or `undefined`. `--flag=value` is checked on its value, so a
 * flag cannot carry a path out of the workspace either.
 */
export const findCliArgumentProblem = (args: readonly unknown[]): CliArgumentProblem | undefined => {
  if (args.length > PACKAGE_CLI_MAX_ARGUMENTS) {
    return { index: PACKAGE_CLI_MAX_ARGUMENTS, reason: `at most ${PACKAGE_CLI_MAX_ARGUMENTS} arguments are accepted` };
  }
  for (const [index, argument] of args.entries()) {
    if (typeof argument !== 'string' || argument === '') return { index, reason: 'an argument must be a text' };
    if (argument.length > PACKAGE_CLI_MAX_ARGUMENT_LENGTH) {
      return { index, reason: `an argument is at most ${PACKAGE_CLI_MAX_ARGUMENT_LENGTH} characters` };
    }
    if (!ARGUMENT_TOKEN.test(argument)) {
      return { index, reason: 'an argument must be one plain token: letters, digits and @ . _ / : = ~ + , -' };
    }
    const equals = argument.startsWith('-') ? argument.indexOf('=') : -1;
    const value = equals === -1 ? argument : argument.slice(equals + 1);
    if (!staysInside(value)) return { index, reason: 'a path must stay inside the workspace' };
  }
  return undefined;
};

/** `program arg arg`: every token is already plain, so nothing needs quoting and nothing can end the line. */
export const cliCommandLine = (command: string, args: readonly string[]): string => [command, ...args].join(' ');

/** A command line that is safe to type (never run) into a terminal: one line, no control character. */
export const isTypeableCommandLine = (line: string): boolean =>
  line !== '' && line.length <= 1000 && !CONTROL_CHARACTER.test(line);

export const isPackageCliPackageId = (value: unknown): value is string =>
  typeof value === 'string' && PACKAGE_ID.test(value);
export const isPackageCliConnectionId = (value: unknown): value is string =>
  typeof value === 'string' && CLI_CONNECTION_ID.test(value);

export type TerminalLaunchRequest = Readonly<{ packageId: string; connectionId: string }>;

export type TerminalLaunchErrorCode = 'INVALID_REQUEST' | 'NOT_ENABLED' | 'UNAVAILABLE';

export type TerminalLaunchResult =
  | Readonly<{ ok: true; title: string; commandLine: string }>
  | Readonly<{ ok: false; error: TerminalLaunchErrorCode }>;

/** One entry of the Terminal menu. Only ids and a title: no command, path or value. */
export type TerminalCliEntry = Readonly<{ id: string; packageId: string; connectionId: string; title: string }>;

/** The CLIs of one installed package that are switched on and healthy, for "Open a terminal with ...". */
export const terminalCliEntriesOf = (
  packageId: string,
  connections: readonly Pick<PackageConnectionView, 'key' | 'kind' | 'title' | 'enabled' | 'status'>[]
): TerminalCliEntry[] =>
  connections.flatMap((connection): TerminalCliEntry[] => {
    if (connection.kind !== 'cli' || !connection.enabled || connection.status !== 'on') return [];
    const connectionId = connection.key.slice('cli:'.length);
    if (!connection.key.startsWith('cli:') || !isPackageCliConnectionId(connectionId)) return [];
    return [{ id: `${packageId}\u0000${connectionId}`, packageId, connectionId, title: connection.title }];
  });
