/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Building blocks shared by every connection schema: constants, field validators and the strict/tolerant object
 * factory. Nothing here knows a connection kind.
 */

import { z } from 'zod';
import { isLoopbackWebUrl } from './loopback';

export const ADAPTER_FILE = 'adapter/adapter.json';
export const ADAPTER_SOURCE_DIRECTORY = 'source';
/** The newest `schemaVersion` this version of the app understands. */
export const ADAPTER_SCHEMA_VERSION = 1;
/**
 * Upper bound on connections per document. Raised from 32 because a plugin-rich repository yields one connection
 * per command, agent, hook and rule file; 128 still bounds the work a hostile document can cause.
 */
export const MAX_CONNECTIONS = 128;
export const MAX_OPEN_ITEMS = 100;

const ID = /^[a-z0-9][a-z0-9._-]*$/;
export const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;
// One literal token: no whitespace, quotes, shell metacharacters or control characters.
const LAUNCH_ARGUMENT = /^(?:-y|--yes|[A-Za-z0-9@][A-Za-z0-9@._/:=~+-]*)$/u;
export const COMMAND_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// One argument of a command the host runs for the user: no whitespace, quotes or shell metacharacters.
const PROCESS_TOKEN = /^[A-Za-z0-9@._/:=~+,-]+$/;
// A file name only: no folder, no drive, no separators. The folder is chosen by the user on their own machine.
export const EXECUTABLE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,98}$/;
// Control characters (including NUL and newlines) never belong in a command line the host will run.
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** Programs a service may be started with. The classifier emits only these, from fixed templates. */
export const ADAPTER_PROCESS_PROGRAMS: ReadonlySet<string> = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'python',
  'pip',
  'uv',
  'uvicorn',
  'streamlit',
  'flask',
]);

/** Detectors that can name themselves as the source of a connection (`origin`). */
export const ADAPTER_ORIGINS = [
  'claude-plugin',
  'codex-plugin',
  'copilot',
  'agent-plugins',
  'gemini-extension',
  'mcp-config',
  'mcpb',
  'chrome-extension',
  'userscript',
  'vscode',
  'framework',
  'package-json',
  'pyproject',
  'cargo',
  'go',
  'compose',
  'skill-md',
  'rules-file',
  'releases',
  'classifier',
  'user',
] as const;

export const connectionId = z.string().min(1).max(64).regex(ID);
export const title = z.string().trim().min(1).max(120);
export const description = z.string().trim().min(1).max(1000);
export const launchArguments = z.array(z.string().max(200).regex(LAUNCH_ARGUMENT)).max(16);

// A flag is `-i` or `--rm`: letters and dashes only, never `=`, a value, a path or shell syntax.
const LAUNCH_FLAG = /^--?[A-Za-z][A-Za-z-]*$/u;
const MAX_LAUNCH_ARGUMENTS = 16;
const MAX_LAUNCH_ARGUMENT_LENGTH = 200;

/**
 * Flags a local MCP server's program may be given, in addition to `-y` and `--yes` (allowed for every program, as
 * before). Everything else that starts with a dash is refused. The list is a fixed allowlist per program:
 * - `docker`: `-i`/`--interactive` keeps stdin open (a stdio server cannot work without it) and `--rm` removes the
 *   container afterwards. No flag that adds a mount, an environment variable, a port, a network, a capability or
 *   privileges is listed, so `docker run` starts the image with the daemon defaults and nothing from the host.
 * - `uvx`: `--from <package>` names the package that provides the command.
 * - `python`: `-m <module>` runs a module and `-u` turns off output buffering. A module of the repository is no more
 *   power than the script `python <file>` that is already allowed.
 */
export const MCP_LAUNCH_FLAGS: Readonly<Record<string, readonly string[]>> = {
  docker: ['-i', '--interactive', '--rm'],
  uvx: ['--from'],
  python: ['-m', '-u'],
};

/** Flags that take the next argument as their value, which therefore must be a plain argument and not a flag. */
const FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(['--from', '-m']);

/** One argument of a local MCP server: a plain literal token, or a flag; `mcpLaunchProblem` decides which flags. */
export const mcpLaunchArguments = z
  .array(
    z
      .string()
      .max(MAX_LAUNCH_ARGUMENT_LENGTH)
      .refine((value) => LAUNCH_ARGUMENT.test(value) || LAUNCH_FLAG.test(value), 'not a literal launch argument')
  )
  .max(MAX_LAUNCH_ARGUMENTS);

export type LaunchProblem = Readonly<{ argument: string; reason: string }>;

/**
 * Finds the first reason a local MCP server's `command` and `args` are not accepted, or `undefined` when they are.
 * Each argument is one literal token, or a flag from `MCP_LAUNCH_FLAGS[command]` (or `-y`/`--yes`). A flag that
 * takes a value must be followed by a plain token. `docker` must be `docker run [flags] <image> [args]`: the
 * subcommand is fixed, so `exec`, `rm`, `system` or any other docker verb is refused.
 */
export const findLaunchProblem = (command: string, args: readonly string[]): LaunchProblem | undefined => {
  const allowed = new Set<string>(['-y', '--yes', ...(MCP_LAUNCH_FLAGS[command] ?? [])]);
  for (const [index, argument] of args.entries()) {
    const isFlag = argument.startsWith('-');
    if (argument.length > MAX_LAUNCH_ARGUMENT_LENGTH || !(isFlag ? LAUNCH_FLAG : LAUNCH_ARGUMENT).test(argument)) {
      return { argument, reason: 'not a literal launch argument' };
    }
    if (!isFlag) continue;
    if (!allowed.has(argument)) return { argument, reason: `flag not allowed for ${command}` };
    if (FLAGS_WITH_VALUE.has(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('-')) return { argument, reason: 'flag needs a value' };
    }
  }
  if (command === 'docker') {
    if (args[0] !== 'run') return { argument: args[0] ?? '', reason: 'docker may only run an image' };
    if (!args.slice(1).some((argument) => !argument.startsWith('-'))) {
      return { argument: 'run', reason: 'docker run needs an image' };
    }
  }
  return undefined;
};
/** A package or crate name as written by a registry: one literal token. */
export const packageName = z.string().min(1).max(200).regex(LAUNCH_ARGUMENT);
/** An https URL; plain http is never accepted. */
export const httpsUrl = (max: number) => z.string().url().startsWith('https://').max(max);
/** A `web-embed` address: https, or the loopback http form of `loopback.ts` (only where the package policy allows it). */
export const webEmbedUrl = z
  .string()
  .max(500)
  .refine((value) => httpsUrl(500).safeParse(value).success || isLoopbackWebUrl(value), {
    message: 'must be https, or http://127.0.0.1 or http://localhost with an explicit port',
  });

/** A path relative to a repository: forward slashes, no `..`, no drive, no empty or `.` parts. */
export const isSafeRelativePath = (value: string): boolean =>
  !value.includes('\\') &&
  !CONTROL_CHARACTER.test(value) &&
  !value.startsWith('/') &&
  !/^[A-Za-z]:/u.test(value) &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

/** A path inside the package: relative, forward slashes, no `..`, below `source/` or `adapter/`. */
export const packagePath = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) =>
      isSafeRelativePath(value) &&
      (value === ADAPTER_SOURCE_DIRECTORY ||
        value.startsWith(`${ADAPTER_SOURCE_DIRECTORY}/`) ||
        value.startsWith('adapter/')),
    'must be source or a relative path below source/ or adapter/'
  );

/** A command the host runs for the user as an argument vector; only programs in `ADAPTER_PROCESS_PROGRAMS`. */
export const processCommand = z
  .array(z.string().min(1).max(200).regex(PROCESS_TOKEN))
  .min(1)
  .max(24)
  .refine((argv) => ADAPTER_PROCESS_PROGRAMS.has(argv[0] ?? ''), 'program is not one the host starts');

/**
 * The connection schemas are built twice: strict for the writer and tolerant for the reader. A tolerant object
 * drops fields it does not know (they are never acted on); every field it does know is checked exactly as the
 * writer checks it. Typed as strict for both: the two differ only at run time, in what they do with unknown fields.
 */
export const shapedFor =
  (tolerant: boolean) =>
  <T extends z.ZodRawShape>(shape: T): z.ZodObject<T, 'strict'> =>
    (tolerant ? z.object(shape).strip() : z.object(shape).strict()) as z.ZodObject<T, 'strict'>;

export type Shaped = ReturnType<typeof shapedFor>;

/**
 * Optional fields every connection carries (`plugin`: folder of the plugin it came from, `group`: connections that
 * replace one another, `origin`: the detector that produced it). They are labels for the UI and the host; none of
 * them grants anything.
 */
export const commonFields = {
  plugin: packagePath.optional(),
  group: connectionId.optional(),
  origin: z.enum(ADAPTER_ORIGINS).optional(),
};

/** A variable a connection reads; its value is the user's (or the agent's) to supply, never stored here. */
export const buildEnvironmentVariable = (shaped: Shaped) =>
  shaped({
    name: z.string().max(64).regex(ENV_KEY),
    required: z.boolean(),
    hint: description.optional(),
  });

/** Fields every program of an app carries; the readiness rule differs by connection (see below). */
const processServiceFields = (shaped: Shaped) => ({
  id: connectionId,
  /** Working folder, inside source/. */
  cwd: packagePath,
  /** Commands run once before the first start (install dependencies). */
  setup: z.array(processCommand).max(6).optional(),
  start: processCommand,
  /** Variables the service reads; their values are the user's (or the agent's) to supply. */
  env: z.array(buildEnvironmentVariable(shaped)).max(20).optional(),
});

const readyPort = (shaped: Shaped) => shaped({ port: z.number().int().min(1024).max(65535) });

/** One program of an app that is started from source/ (a back end, a front end). Always has a ready port. */
export const buildProcessService = (shaped: Shaped) =>
  shaped({
    ...processServiceFields(shaped),
    /** The service is ready when this loopback port accepts connections. */
    ready: readyPort(shaped),
  });

/**
 * A program of a `service` connection. `ready` is optional here: a headless service has no port, and the connection
 * schema requires a port for every program of a non-headless service and forbids one on a headless service.
 */
export const buildServiceProgram = (shaped: Shaped) =>
  shaped({
    ...processServiceFields(shaped),
    ready: readyPort(shaped).optional(),
  });
