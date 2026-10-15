/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection hosts for `cli` and `tool` (docs/platform/repotopackage-design.md sections 9.3, 10.10, 15.1; task T5.4).
 *
 * - Turning one on only means "ready to call". Nothing runs and nothing is installed: the host has no process to
 *   start, so `enable` is the approval and `disable` and `reconcile` have nothing to undo. What the app offers is read
 *   on demand from the registry's turned-on connections (the Terminal menu and the agent tool), so there is no second
 *   copy to keep in step.
 * - The approval lists the exact command line, how the agent may extend it and the limits it runs under. A setup
 *   command or a package source the connection names is listed for the person to read; this version never runs it.
 * - `check` is where this machine counts: the program must exist (the shared runtime probe supplies the answer, in
 *   words). A package source such as npm is only turned into a hint of what to install.
 * - Not enforced in this version, and said so: the outgoing network of the program.
 */

import {
  cliCommandLine,
  PACKAGE_CLI_MAX_ARGUMENT_LENGTH,
  PACKAGE_CLI_MAX_ARGUMENTS,
  PACKAGE_CLI_MAX_OUTPUT_BYTES,
  PACKAGE_CLI_TIMEOUT_MS,
} from '@/common/integrations/cli/packageCli';
import { getRuntimeProbe } from '../../core/runtimeProbe';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ApprovalSubject,
  type ConnectionOf,
  type HostCheck,
  type HostContext,
} from '../../core/types';

type CliConnection = ConnectionOf<'cli'>;
type ToolConnection = ConnectionOf<'tool'>;
type CliLikeConnection = CliConnection | ToolConnection;

/** Whether one program can run on this machine; the reason is a sentence a person can read. */
export type CliProgramProbe = (program: string) => Promise<HostCheck>;

export type CliHostDeps = Readonly<{
  /** Defaults to the shared runtime probe. */
  programProbe?: CliProgramProbe;
}>;

type CliFields = Readonly<{
  id: string;
  title: string;
  command: string;
  args: readonly string[];
  description?: string;
  source?: string;
  packageName?: string;
  cwd?: string;
  setup: readonly (readonly string[])[];
}>;

const fieldsOf = (connection: CliLikeConnection): CliFields => ({
  id: connection.id,
  title: connection.title,
  command: connection.command,
  args: connection.args ?? [],
  ...('description' in connection && connection.description !== undefined
    ? { description: connection.description }
    : {}),
  ...('source' in connection && connection.source !== undefined ? { source: connection.source } : {}),
  ...('package' in connection && connection.package !== undefined ? { packageName: connection.package } : {}),
  ...('cwd' in connection && connection.cwd !== undefined ? { cwd: connection.cwd } : {}),
  setup: 'setup' in connection ? (connection.setup ?? []) : [],
});

/** What to install, as words only. The host never runs this. */
const installHint = (fields: CliFields): string | undefined => {
  if (fields.packageName === undefined) return undefined;
  switch (fields.source) {
    case 'npm':
      return `npm install -g ${fields.packageName}`;
    case 'pypi':
      return `pip install ${fields.packageName}`;
    case 'cargo':
      return `cargo install ${fields.packageName}`;
    case 'go':
      return `go install ${fields.packageName}@latest`;
    default:
      return undefined;
  }
};

const problemOf = async (fields: CliFields, probe: CliProgramProbe): Promise<string | undefined> => {
  const result = await probe(fields.command);
  if (result.ok !== false) return undefined;
  const hint = installHint(fields);
  return hint === undefined ? result.reason : `${result.reason} Hub không tự cài; gói nguồn gợi ý cài bằng: ${hint}`;
};

const subjectOf = (kind: 'cli' | 'tool', connection: CliLikeConnection): ApprovalSubject => {
  const fields = fieldsOf(connection);
  const lines: { label: string; value: string }[] = [
    {
      label: 'Type',
      value:
        kind === 'cli'
          ? 'Command-line program (ready to call; nothing runs when this is turned on)'
          : 'Tool the agent can call (ready to call; nothing runs when this is turned on)',
    },
    { label: 'Command', value: cliCommandLine(fields.command, fields.args) },
    {
      label: 'Extra arguments from the agent',
      value: `up to ${PACKAGE_CLI_MAX_ARGUMENTS}, each one a plain token of at most ${PACKAGE_CLI_MAX_ARGUMENT_LENGTH} characters (letters, digits and @ . _ / : = ~ + , -); no shell; a path must stay inside the workspace`,
    },
    { label: 'Working folder', value: 'the open workspace' },
    {
      label: 'Agent tool',
      value: `tomny_package_cli: asks for your permission on every call; stops after ${PACKAGE_CLI_TIMEOUT_MS / 1000} seconds; output kept to ${PACKAGE_CLI_MAX_OUTPUT_BYTES / 1024} KB with secrets scrubbed`,
    },
    ...(kind === 'cli'
      ? [
          {
            label: 'Terminal menu',
            value: 'offered as "Open terminal with this program": the command is typed in, never run by itself',
          },
        ]
      : []),
    { label: 'Secrets given to the program', value: 'none' },
  ];
  if (fields.description !== undefined) lines.push({ label: 'Description', value: fields.description });
  if (fields.source !== undefined) {
    lines.push({
      label: 'Source',
      value: `${fields.source}${fields.packageName === undefined ? '' : ` package "${fields.packageName}"`} (the Hub does not install it)`,
    });
  }
  if (fields.cwd !== undefined) {
    lines.push({ label: 'Package folder', value: `${fields.cwd} (listed only; the program runs in the workspace)` });
  }
  for (const argv of fields.setup) {
    lines.push({ label: 'Setup (listed only, the Hub does not run it)', value: argv.join(' ') });
  }
  lines.push({ label: 'Outgoing network of the program', value: 'not restricted in this version' });
  return { kind, title: connection.title, lines, files: [] };
};

const createHost = (kind: 'cli' | 'tool', deps: CliHostDeps): AnyConnectionHost => {
  const probe: CliProgramProbe = deps.programProbe ?? ((program) => getRuntimeProbe().programProbe(program));

  const check = async (_context: HostContext, connection: CliLikeConnection): Promise<HostCheck> => {
    const problem = await problemOf(fieldsOf(connection), probe);
    return problem === undefined ? { ok: true } : { ok: false, reason: problem };
  };

  const behaviour = {
    check,
    describe: (_context: HostContext, connection: CliLikeConnection): Promise<ApprovalSubject> =>
      Promise.resolve(subjectOf(kind, connection)),
    // Approval only: there is no process, file or setting to install.
    enable: async (context: HostContext, connection: CliLikeConnection) => {
      const checked = await check(context, connection);
      if (checked.ok === false) throw new Error(checked.reason);
      return { installed: [`${kind}:${connection.id}`] };
    },
    disable: async (): Promise<void> => undefined,
    reconcile: async (): Promise<void> => undefined,
  };
  return kind === 'cli'
    ? defineConnectionHost<'cli'>({ kind: 'cli', ...behaviour })
    : defineConnectionHost<'tool'>({ kind: 'tool', ...behaviour });
};

/** The `cli` host and the `tool` host. They share one implementation; the registry keys them by kind. */
export const createCliHosts = (deps: CliHostDeps = {}): readonly AnyConnectionHost[] => [
  createHost('cli', deps),
  createHost('tool', deps),
];
