/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection host for `web-embed` (docs/platform/repotopackage-design.md sections 9.3, 10.9, 13, 15.1).
 *
 * - Two kinds. `url`: a website shown as an app in a Browser tab Main creates. `process`: a local web service the
 *   process runtime starts from the package `source/` folder, shown on its loopback address.
 * - Turning the connection on is only the approval. Nothing is started here: the process runs when the person opens
 *   the app, never when the Hub starts (`webEmbedApps.ts`). Turning it off, removing the package and `reconcile`
 *   stop whatever runs.
 * - The approval lists the exact page address, the origins the tab may stay on, and for a process app every working
 *   folder, command, setup command, port and variable name. Its hash also covers the files those commands run: the
 *   `package.json` of each working folder and every file named on a command line. A secret value is never shown.
 *   Nothing about this machine goes into the lines (they are hashed), so installing a runtime later does not
 *   invalidate an approval.
 * - `check` is where this machine's runtimes count: every program a process app starts must be present. The probe is
 *   injected (the shared runtime probe supplies it); the default searches `PATH`. `node` runs through Electron.
 * - Not enforced in this version, and said so in the approval: the outgoing network of the started program.
 */

/* oxlint-disable no-await-in-loop -- a few services, programs and tokens, checked one after another */

import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  hasCredentials,
  loopbackPolicyOf,
  webEmbedAllowedOrigins,
  webEmbedStartUrl,
  webEmbedUrlProblem,
  type WebEmbedService,
} from '@/common/integrations/webEmbed/webEmbed';
import { isLoopbackWebUrl } from '@/common/packages/adapter';
import { resolveCwdInsidePackage } from '@process/integrations/runtime/repoProcessCwd';
import { RepoProcessError } from '@process/integrations/runtime/repoProcessPorts';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ApprovalSubject,
  type ConnectionOf,
  type HostCheck,
  type HostContext,
} from '../../core/types';

type WebEmbedHostConnection = ConnectionOf<'web-embed'>;

/** Whether one program can run on this machine; the reason is a sentence a person can read. */
export type ProgramProbe = (program: string) => Promise<HostCheck>;

/** What the host needs from the app service; it is bound later because the service needs the registry. */
export type WebEmbedProcessControl = Readonly<{
  stop: (request: Readonly<{ packageId: string; connectionId: string }>) => Promise<void>;
  reconcile: (keep: ReadonlySet<string>) => Promise<void>;
}>;

export type WebEmbedHostDeps = Readonly<{
  programProbe?: ProgramProbe;
  control?: WebEmbedProcessControl;
}>;

/** Programs Electron itself runs (`ELECTRON_RUN_AS_NODE`); they need nothing installed. */
const BUNDLED_PROGRAMS: ReadonlySet<string> = new Set(['node']);
const MAX_ENTRY_FILES = 200;

/** Searches `PATH` (with `PATHEXT` on Windows) for an executable of that name. */
export const pathProgramProbe: ProgramProbe = async (program) => {
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter((entry) => entry !== '');
  const extensions =
    process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  const found = await Promise.all(
    directories.flatMap((directory) =>
      extensions.map((extension) =>
        access(path.join(directory, `${program}${extension}`)).then(
          () => true,
          () => false
        )
      )
    )
  );
  return found.some(Boolean) ? { ok: true } : { ok: false, reason: `"${program}" is not installed or not on PATH.` };
};

const servicePrograms = (service: WebEmbedService): string[] => [
  service.start[0] ?? '',
  ...(service.setup ?? []).map((argv) => argv[0] ?? ''),
];

/** Why the connection cannot be opened on this machine, or `undefined`. */
const problemOf = async (
  context: HostContext,
  connection: WebEmbedHostConnection,
  probe: ProgramProbe
): Promise<string | undefined> => {
  if (connection.process === undefined) {
    if (connection.url === undefined) return 'The app has no address to open.';
    const urlProblem = webEmbedUrlProblem(connection.url, loopbackPolicyOf(context));
    if (urlProblem !== undefined) return urlProblem;
    if ((connection.origins ?? []).some(hasCredentials))
      return 'An allowed origin must not contain a user name or password.';
    return undefined;
  }
  if (webEmbedStartUrl(connection) === undefined) return 'The embedded service is not one of the services.';
  const programs = new Set<string>();
  for (const service of connection.process.services) {
    try {
      await resolveCwdInsidePackage(context.packageDirectory, service.cwd, service.id);
    } catch (error) {
      return error instanceof RepoProcessError
        ? `The working folder of "${service.id}" is not usable (${service.cwd}).`
        : 'The app folder could not be read.';
    }
    for (const program of servicePrograms(service)) if (!BUNDLED_PROGRAMS.has(program)) programs.add(program);
  }
  for (const program of programs) {
    const result = await probe(program);
    if (result.ok === false) return result.reason;
  }
  return undefined;
};

const commandLine = (argv: readonly string[]): string => argv.join(' ');

/** Package-relative files the commands of a process app run; hashed into the approval. */
const entryFiles = async (context: HostContext, connection: WebEmbedHostConnection): Promise<string[]> => {
  const files = new Set<string>();
  for (const service of connection.process?.services ?? []) {
    const folder = service.cwd.replace(/\/+$/u, '');
    const tokens = [
      'package.json',
      ...service.start.slice(1),
      ...(service.setup ?? []).flatMap((argv) => argv.slice(1)),
    ].filter((token) => !token.startsWith('-'));
    for (const token of tokens) {
      const candidate = `${folder}/${token.replace(/^\.\//u, '')}`;
      if (files.size >= MAX_ENTRY_FILES) break;
      try {
        await context.readPackageFile(candidate);
        files.add(candidate);
      } catch {
        // Not a file of the package: an argument such as "install" or "run".
      }
    }
  }
  return [...files].toSorted();
};

const describeProcess = (context: HostContext, connection: WebEmbedHostConnection): ApprovalSubject['lines'] => {
  const app = connection.process;
  if (app === undefined) return [];
  const lines: { label: string; value: string }[] = [
    { label: 'Type', value: 'Web app served by a local program (runs from the package source)' },
    { label: 'Opens', value: webEmbedStartUrl(connection) ?? 'not set' },
  ];
  for (const service of app.services) {
    lines.push({
      label: `Service ${service.id}: working folder`,
      value: path.join(context.packageDirectory, service.cwd),
    });
    for (const argv of service.setup ?? []) {
      lines.push({ label: `Service ${service.id}: setup (once)`, value: commandLine(argv) });
    }
    lines.push(
      { label: `Service ${service.id}: start`, value: commandLine(service.start) },
      { label: `Service ${service.id}: ready when`, value: `127.0.0.1:${service.ready.port} accepts connections` },
      {
        label: `Service ${service.id}: variables (from the package secret store)`,
        value:
          (service.env ?? []).map((item) => `${item.name}${item.required ? '' : ' (optional)'}`).join(', ') || 'none',
      }
    );
  }
  lines.push({ label: 'Outgoing network of the program', value: 'not restricted in this version' });
  return lines;
};

const subjectOf = async (context: HostContext, connection: WebEmbedHostConnection): Promise<ApprovalSubject> => {
  const origins = webEmbedAllowedOrigins(connection);
  const common: ApprovalSubject['lines'] = [
    { label: 'Tab may stay on', value: origins.join(', ') || 'none' },
    { label: 'Other links', value: 'open in a normal Browser tab' },
    { label: 'Session', value: 'the Browser profile; web permissions are denied and agent control is off by default' },
  ];
  if (connection.process === undefined) {
    return {
      kind: 'web-embed',
      title: connection.title,
      lines: [
        { label: 'Type', value: 'Web app (a website shown in a Browser tab)' },
        { label: 'URL', value: connection.url ?? 'not set' },
        {
          label: 'Network',
          value:
            connection.url !== undefined && isLoopbackWebUrl(connection.url)
              ? 'this machine only (loopback address)'
              : 'remote https address',
        },
        ...common,
      ],
      files: [],
    };
  }
  return {
    kind: 'web-embed',
    title: connection.title,
    lines: [...describeProcess(context, connection), ...common],
    files: await entryFiles(context, connection),
  };
};

export const createWebEmbedHost = (deps: WebEmbedHostDeps = {}): AnyConnectionHost => {
  const probe = deps.programProbe ?? pathProgramProbe;

  const check = async (context: HostContext, connection: WebEmbedHostConnection): Promise<HostCheck> => {
    const problem = await problemOf(context, connection, probe);
    return problem === undefined ? { ok: true } : { ok: false, reason: problem };
  };

  return defineConnectionHost({
    kind: 'web-embed',
    check,
    describe: (context, connection: WebEmbedHostConnection) => subjectOf(context, connection),
    // Approval only: a process app starts when it is opened, a url app has nothing to start.
    enable: async (context, connection: WebEmbedHostConnection) => {
      const checked = await check(context, connection);
      if (checked.ok === false) throw new Error(checked.reason);
      return { installed: [`app:${connection.id}`] };
    },
    disable: async (context, connection: WebEmbedHostConnection, _installed) => {
      await deps.control?.stop({ packageId: context.packageId, connectionId: connection.id });
    },
    reconcile: async ({ keep }) => {
      await deps.control?.reconcile(keep);
    },
  });
};
