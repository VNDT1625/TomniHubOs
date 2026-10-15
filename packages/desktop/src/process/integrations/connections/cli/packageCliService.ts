/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-side use of the `cli` and `tool` connections that are turned on (docs/platform/repotopackage-design.md
 * sections 10.10, 14 S14-S15 and 15.1; task T5.4). Everything is read from the connection registry on each call, so
 * turning a CLI off or uninstalling its package is reflected at once.
 *
 * - `list` and `terminalLaunch`: the Terminal menu. The caller names a package and a connection; Main answers with a
 *   title and a one-line command that the terminal types in and never runs.
 * - `run`: the agent tool. The program is found on `PATH` (never in the workspace), its arguments are the
 *   connection's fixed ones plus tokens the agent supplied that passed `findCliArgumentProblem`, it runs without a
 *   shell in the workspace with a minimal environment and no secret, and stops at the timeout. The output is capped
 *   and scrubbed of the package's own secret values and of recognisable secret formats before anyone reads it.
 * - The service never asks for permission itself: the tool is not on the read-only list, so the host's normal tool
 *   permission path asks before the call reaches here. Every run leaves a content-free receipt.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  cliCommandLine,
  findCliArgumentProblem,
  isPackageCliConnectionId,
  isPackageCliPackageId,
  isTypeableCommandLine,
  PACKAGE_CLI_MAX_OUTPUT_BYTES,
  PACKAGE_CLI_TIMEOUT_MS,
  type TerminalLaunchResult,
} from '@/common/integrations/cli/packageCli';
import { redactSecretText } from '@process/agentRuntime/agentMesh/security/secretFirewall';
import type { ConnectionRegistry, EnabledConnection } from '@process/integrations/connections/core/registry';
import {
  createNodeRuntimeProbePorts,
  findProgramOnPath,
  type RuntimeProbePorts,
} from '@process/integrations/connections/core/runtimeProbe';
import { minimalBaseEnv } from '@process/integrations/runtime/repoProcessNodePorts';
import type { PackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';
import { nodeCliExec, type CliExecPort } from './cliExec';

const REDACTED = '[redacted]';
const MIN_SECRET_LENGTH = 4;
const MAX_SECRET_VALUES = 64;

export type PackageCliEntry = Readonly<{
  packageId: string;
  connectionId: string;
  kind: 'cli' | 'tool';
  title: string;
  description?: string;
  commandLine: string;
}>;

export type PackageCliRunRequest = Readonly<{
  /** Absolute folder of the workspace the agent was granted; the program runs there. */
  workspace: string;
  packageId: string;
  connectionId: string;
  /** What the agent supplied; checked here, never trusted. */
  args: readonly unknown[];
  timeoutSeconds?: number;
  signal?: AbortSignal;
}>;

export type PackageCliRunCode =
  | 'NOT_ENABLED'
  | 'ARGUMENT_REJECTED'
  | 'RUNTIME_MISSING'
  | 'WORKSPACE_INVALID'
  | 'START_FAILED';

export type PackageCliRunOutcome =
  | Readonly<{
      ok: true;
      exitCode: number | null;
      timedOut: boolean;
      cancelled: boolean;
      truncated: boolean;
      durationMs: number;
      output: string;
    }>
  | Readonly<{ ok: false; code: PackageCliRunCode; message: string }>;

/** What a run leaves behind: ids, counts and codes only. No argument, path, output or value. */
export type PackageCliRunRecord = Readonly<{
  packageId: string;
  connectionId: string;
  outcome: 'completed' | 'failed' | 'timed-out' | 'cancelled' | 'refused';
  code?: PackageCliRunCode;
  exitCode?: number | null;
  argumentCount: number;
  durationMs: number;
  truncated: boolean;
}>;

export type PackageCliServiceDeps = Readonly<{
  registry: Pick<ConnectionRegistry, 'enabledOfKind'>;
  exec?: CliExecPort;
  /** Where to look for a program: the `PATH` and the file system of this machine. */
  ports?: Pick<RuntimeProbePorts, 'env' | 'exists' | 'platform'>;
  /** The environment a program gets. Defaults to a minimal one without tokens or keys. */
  baseEnv?: () => Record<string, string>;
  /** Secret values of the package that must never reach the output (read from the package secret port in Main). */
  secretValues?: (packageId: string) => Promise<readonly string[]>;
  record?: (record: PackageCliRunRecord) => Promise<void>;
  isDirectory?: (candidate: string) => Promise<boolean>;
  now?: () => number;
}>;

export type PackageCliService = Readonly<{
  /** Every CLI and tool that is turned on. */
  list: () => Promise<readonly PackageCliEntry[]>;
  /** The Terminal menu: only ids come in. Never rejects. */
  terminalLaunch: (request: unknown) => Promise<TerminalLaunchResult>;
  run: (request: PackageCliRunRequest) => Promise<PackageCliRunOutcome>;
}>;

type CliLike = Readonly<{
  kind: 'cli' | 'tool';
  id: string;
  title: string;
  command: string;
  args: readonly string[];
  description?: string;
}>;

type EnabledCli = Readonly<{ entry: EnabledConnection; cli: CliLike }>;

const asCliLike = (connection: EnabledConnection['connection']): CliLike | undefined => {
  if (connection.kind !== 'cli' && connection.kind !== 'tool') return undefined;
  const description = connection.kind === 'tool' ? connection.description : undefined;
  return {
    kind: connection.kind,
    id: connection.id,
    title: connection.title,
    command: connection.command,
    args: connection.args ?? [],
    ...(description === undefined ? {} : { description }),
  };
};

const defaultIsDirectory = (candidate: string): Promise<boolean> =>
  stat(candidate).then(
    (info) => info.isDirectory(),
    () => false
  );

/** The values of the package's own secret sets, for scrubbing. Values never leave this function's caller. */
export const collectOwnSecretValues = async (
  port: Pick<PackageSecretPort, 'list' | 'resolve'>
): Promise<readonly string[]> => {
  const values = new Set<string>();
  try {
    for (const set of await port.list()) {
      if (set.origin !== 'own' || set.fields.length === 0) continue;
      try {
        // oxlint-disable-next-line no-await-in-loop -- a few sets at most
        const resolved = await port.resolve(set.handle, set.fields);
        for (const value of Object.values(resolved)) {
          if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH && values.size < MAX_SECRET_VALUES) {
            values.add(value);
          }
        }
      } catch {
        // Access refused or the set vanished: nothing to scrub from it.
      }
    }
  } catch {
    // No secret store reachable: the pattern scrub below still applies.
  }
  return [...values];
};

/** Cuts a capped capture back to its last whole line, so a secret cut by the cap cannot survive half-visible. */
const wholeLines = (text: string, truncated: boolean): string => {
  if (!truncated) return text;
  const cut = text.lastIndexOf('\n');
  return cut === -1 ? text : text.slice(0, cut);
};

export const scrubCliOutput = (text: string, secrets: readonly string[]): string => {
  let result = text;
  for (const secret of secrets) if (secret.length >= MIN_SECRET_LENGTH) result = result.split(secret).join(REDACTED);
  return redactSecretText(result).text;
};

const clampTimeout = (seconds: number | undefined): number => {
  if (seconds === undefined || !Number.isFinite(seconds)) return PACKAGE_CLI_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(seconds) * 1000, 1000), PACKAGE_CLI_TIMEOUT_MS);
};

export const createPackageCliService = (deps: PackageCliServiceDeps): PackageCliService => {
  const exec = deps.exec ?? nodeCliExec;
  const ports = deps.ports ?? createNodeRuntimeProbePorts();
  const baseEnv = deps.baseEnv ?? (() => minimalBaseEnv());
  const isDirectory = deps.isDirectory ?? defaultIsDirectory;
  const now = deps.now ?? (() => Date.now());

  const enabled = async (): Promise<readonly EnabledCli[]> => {
    const [clis, tools] = await Promise.all([deps.registry.enabledOfKind('cli'), deps.registry.enabledOfKind('tool')]);
    return [...clis, ...tools].flatMap((entry) => {
      const cli = asCliLike(entry.connection);
      return cli === undefined ? [] : [{ entry, cli }];
    });
  };

  const record = async (value: PackageCliRunRecord): Promise<void> => {
    try {
      await deps.record?.(value);
    } catch {
      // A receipt that cannot be written must not hide what already happened.
    }
  };

  const list = async (): Promise<readonly PackageCliEntry[]> => {
    try {
      const entries: PackageCliEntry[] = [];
      for (const { entry, cli } of await enabled()) {
        entries.push({
          packageId: entry.packageId,
          connectionId: cli.id,
          kind: cli.kind,
          title: cli.title,
          commandLine: cliCommandLine(cli.command, cli.args),
          ...(cli.description === undefined ? {} : { description: cli.description }),
        });
      }
      return entries;
    } catch {
      return [];
    }
  };

  const terminalLaunch = async (raw: unknown): Promise<TerminalLaunchResult> => {
    const request = raw as Record<string, unknown> | null;
    if (
      typeof request !== 'object' ||
      request === null ||
      Object.keys(request).some((key) => key !== 'packageId' && key !== 'connectionId') ||
      !isPackageCliPackageId(request['packageId']) ||
      !isPackageCliConnectionId(request['connectionId'])
    ) {
      return { ok: false, error: 'INVALID_REQUEST' };
    }
    try {
      const found = (await enabled()).find(
        ({ entry, cli }) =>
          cli.kind === 'cli' && entry.packageId === request['packageId'] && cli.id === request['connectionId']
      );
      if (found === undefined) return { ok: false, error: 'NOT_ENABLED' };
      const commandLine = cliCommandLine(found.cli.command, found.cli.args);
      if (!isTypeableCommandLine(commandLine)) return { ok: false, error: 'UNAVAILABLE' };
      return { ok: true, title: found.cli.title, commandLine };
    } catch {
      return { ok: false, error: 'UNAVAILABLE' };
    }
  };

  const run = async (request: PackageCliRunRequest): Promise<PackageCliRunOutcome> => {
    const started = now();
    const argumentCount = Array.isArray(request.args) ? request.args.length : 0;
    const refuse = async (code: PackageCliRunCode, message: string): Promise<PackageCliRunOutcome> => {
      await record({
        packageId: request.packageId,
        connectionId: request.connectionId,
        outcome: 'refused',
        code,
        argumentCount,
        durationMs: now() - started,
        truncated: false,
      });
      return { ok: false, code, message };
    };

    const found = (await enabled().catch((): readonly EnabledCli[] => [])).find(
      ({ entry, cli }) => entry.packageId === request.packageId && cli.id === request.connectionId
    );
    if (found === undefined) {
      return refuse(
        'NOT_ENABLED',
        'That package CLI is not turned on. Ask the person to turn it on in the package connections.'
      );
    }
    if (!Array.isArray(request.args)) return refuse('ARGUMENT_REJECTED', 'args must be a list of text arguments.');
    const problem = findCliArgumentProblem(request.args);
    if (problem !== undefined) {
      return refuse('ARGUMENT_REJECTED', `Argument ${problem.index + 1} was refused: ${problem.reason}.`);
    }
    if (!path.isAbsolute(request.workspace) || !(await isDirectory(request.workspace))) {
      return refuse('WORKSPACE_INVALID', 'The workspace is not an existing folder.');
    }
    const program = await findProgramOnPath(found.cli.command, ports).catch((): undefined => undefined);
    if (program === undefined) {
      return refuse(
        'RUNTIME_MISSING',
        `"${found.cli.command}" is not installed on this machine (it was not found in PATH). Ask the person to install it.`
      );
    }

    const secrets = (await deps.secretValues?.(request.packageId).catch((): readonly string[] => [])) ?? [];
    const result = await exec({
      file: program,
      args: [...found.cli.args, ...(request.args as readonly string[])],
      cwd: request.workspace,
      env: baseEnv(),
      timeoutMs: clampTimeout(request.timeoutSeconds),
      maxOutputBytes: PACKAGE_CLI_MAX_OUTPUT_BYTES,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const durationMs = now() - started;
    const receipt = {
      packageId: request.packageId,
      connectionId: request.connectionId,
      argumentCount,
      durationMs,
      truncated: result.truncated,
    } as const;

    if (result.startError !== undefined) {
      await record({ ...receipt, outcome: 'failed', code: 'START_FAILED', exitCode: null });
      return { ok: false, code: 'START_FAILED', message: `The program could not be started.` };
    }
    await record({
      ...receipt,
      outcome: result.timedOut
        ? 'timed-out'
        : result.cancelled
          ? 'cancelled'
          : result.exitCode === 0
            ? 'completed'
            : 'failed',
      exitCode: result.exitCode,
    });
    return {
      ok: true,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      truncated: result.truncated,
      durationMs,
      output: scrubCliOutput(wholeLines(result.output, result.truncated), secrets),
    };
  };

  return { list, terminalLaunch, run };
};

export type CorePackageCliInput = Readonly<{
  workspace: string;
  packageId?: string;
  connectionId?: string;
  args: readonly string[];
  timeoutSeconds?: number;
  signal?: AbortSignal;
}>;

/** The shape the core workspace server consumes; kept structural so the server imports no package code. */
export type CorePackageCliPortLike = Readonly<{
  run: (input: CorePackageCliInput) => Promise<Readonly<{ ok: boolean; message: string }>>;
}>;

const seconds = (milliseconds: number): string => `${Math.max(0.1, Math.round(milliseconds / 100) / 10)} s`;

/** Turns the service into the tool's port: a listing when no CLI is named, otherwise a run rendered for the model. */
export const createCorePackageCliPort = (service: PackageCliService): CorePackageCliPortLike => ({
  run: async (input) => {
    if (input.packageId === undefined || input.connectionId === undefined) {
      const entries = await service.list();
      if (entries.length === 0) return { ok: true, message: 'No package CLI or tool is turned on.' };
      return {
        ok: true,
        message: entries
          .map(
            (entry) =>
              `${entry.packageId} / ${entry.connectionId} (${entry.kind}): ${entry.commandLine}${entry.description === undefined ? '' : ` - ${entry.description}`}`
          )
          .join('\n'),
      };
    }
    const outcome = await service.run({
      workspace: input.workspace,
      packageId: input.packageId,
      connectionId: input.connectionId,
      args: input.args,
      ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: input.timeoutSeconds }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (outcome.ok === false) return { ok: false, message: outcome.message };
    const tail = outcome.truncated ? `\n...[output cut at ${PACKAGE_CLI_MAX_OUTPUT_BYTES / 1024} KB]` : '';
    if (outcome.timedOut) {
      return {
        ok: false,
        message: `Stopped after the time limit (${seconds(outcome.durationMs)}).\n${outcome.output}${tail}`,
      };
    }
    if (outcome.cancelled) return { ok: false, message: `Cancelled.\n${outcome.output}${tail}` };
    const header = `exit code ${outcome.exitCode === null ? 'none' : outcome.exitCode} in ${seconds(outcome.durationMs)}`;
    return { ok: outcome.exitCode === 0, message: `${header}\n${outcome.output}${tail}` };
  },
});
