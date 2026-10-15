/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection host for `service` (docs/platform/repotopackage-design.md sections 9.3, 10.11, 13, 15.1): programs that
 * run in the background from the package `source/` folder, without a page to embed.
 *
 * - Needs consent. Turning the connection on is the approval of exactly what would run; it starts nothing. The program
 *   starts only when the person presses Start (`packageServices.ts`), never when the Hub starts, and it stops when the
 *   connection is turned off, the package is removed, a reconcile no longer keeps it, or the application quits.
 * - The approval lists every working folder, setup command, start command, port and variable name of every program,
 *   says in words that it runs in the background with the person's rights, and that its outgoing network is not
 *   restricted in this version. Its hash also covers the files those commands run (the `package.json` of each working
 *   folder and every file named on a command line). A secret value is never shown. Nothing about this machine goes into
 *   the lines (they are hashed), so installing a runtime later does not invalidate an approval.
 * - `check` is where this machine's runtimes count: every program a service starts must be present (`node` runs
 *   through Electron). The probe is injected; the default searches `PATH`.
 */

/* oxlint-disable no-await-in-loop -- a few services, programs and tokens, checked one after another */

import path from 'node:path';
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
import { pathProgramProbe, type ProgramProbe } from './webEmbedHost';

type ServiceHostConnection = ConnectionOf<'service'>;
type ServiceProgram = ServiceHostConnection['process']['services'][number];

/** What the host needs from the service control; it is bound later because the control needs the registry. */
export type PackageServiceProcessControl = Readonly<{
  stop: (request: Readonly<{ packageId: string; connectionId: string }>) => Promise<void>;
  reconcile: (keep: ReadonlySet<string>) => Promise<void>;
}>;

export type ServiceHostDeps = Readonly<{
  programProbe?: ProgramProbe;
  control?: PackageServiceProcessControl;
}>;

/** Programs Electron itself runs (`ELECTRON_RUN_AS_NODE`); they need nothing installed. */
const BUNDLED_PROGRAMS: ReadonlySet<string> = new Set(['node']);
const MAX_ENTRY_FILES = 200;

const programsOf = (service: ServiceProgram): string[] => [
  service.start[0] ?? '',
  ...(service.setup ?? []).map((argv) => argv[0] ?? ''),
];

const commandLine = (argv: readonly string[]): string => argv.join(' ');

/** How a program is known to be started: its port accepts connections, or (headless) its process is alive. */
const readinessOf = (service: ServiceProgram): { label: string; value: string } =>
  service.ready === undefined
    ? { label: `Service ${service.id}: ready when`, value: 'the program is alive (it has no port to wait for)' }
    : { label: `Service ${service.id}: ready when`, value: `127.0.0.1:${service.ready.port} accepts connections` };

/** Why the service cannot run on this machine, or `undefined`. */
const problemOf = async (
  context: HostContext,
  connection: ServiceHostConnection,
  probe: ProgramProbe
): Promise<string | undefined> => {
  const programs = new Set<string>();
  const ports = new Set<number>();
  for (const service of connection.process.services) {
    if (service.ready !== undefined) {
      if (ports.has(service.ready.port)) return 'Two programs of the service declare the same port.';
      ports.add(service.ready.port);
    }
    try {
      await resolveCwdInsidePackage(context.packageDirectory, service.cwd, service.id);
    } catch (error) {
      return error instanceof RepoProcessError
        ? `The working folder of "${service.id}" is not usable (${service.cwd}).`
        : 'The service folder could not be read.';
    }
    for (const program of programsOf(service)) if (!BUNDLED_PROGRAMS.has(program)) programs.add(program);
  }
  for (const program of programs) {
    const result = await probe(program);
    if (result.ok === false) return result.reason;
  }
  return undefined;
};

/** Package-relative files the commands run; hashed into the approval. */
const entryFiles = async (context: HostContext, connection: ServiceHostConnection): Promise<string[]> => {
  const files = new Set<string>();
  for (const service of connection.process.services) {
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

const subjectOf = async (context: HostContext, connection: ServiceHostConnection): Promise<ApprovalSubject> => {
  const lines: { label: string; value: string }[] = [
    {
      label: 'Type',
      value:
        connection.headless === true
          ? 'Headless background program run from the package source: it runs with no window and opens no port'
          : 'Background service run from the package source, without a window',
    },
    {
      label: 'Starts',
      value:
        'only when you press Start, never when the Hub starts; stops when you turn it off, remove the package or quit',
    },
    { label: 'Runs as', value: 'a program with your user rights; it can use your files and network' },
  ];
  for (const service of connection.process.services) {
    lines.push({
      label: `Service ${service.id}: working folder`,
      value: path.join(context.packageDirectory, service.cwd),
    });
    for (const argv of service.setup ?? []) {
      lines.push({ label: `Service ${service.id}: setup (once)`, value: commandLine(argv) });
    }
    lines.push({ label: `Service ${service.id}: start`, value: commandLine(service.start) }, readinessOf(service), {
      label: `Service ${service.id}: variables (from the package secret store)`,
      value:
        (service.env ?? []).map((item) => `${item.name}${item.required ? '' : ' (optional)'}`).join(', ') || 'none',
    });
  }
  lines.push({ label: 'Outgoing network of the program', value: 'not restricted in this version' });
  return { kind: 'service', title: connection.title, lines, files: await entryFiles(context, connection) };
};

export const createServiceHost = (deps: ServiceHostDeps = {}): AnyConnectionHost => {
  const probe = deps.programProbe ?? pathProgramProbe;

  const check = async (context: HostContext, connection: ServiceHostConnection): Promise<HostCheck> => {
    const problem = await problemOf(context, connection, probe);
    return problem === undefined ? { ok: true } : { ok: false, reason: problem };
  };

  return defineConnectionHost({
    kind: 'service',
    check,
    describe: (context, connection: ServiceHostConnection) => subjectOf(context, connection),
    // Approval only: the program starts when the person presses Start.
    enable: async (context, connection: ServiceHostConnection) => {
      const checked = await check(context, connection);
      if (checked.ok === false) throw new Error(checked.reason);
      return { installed: [`service:${connection.id}`] };
    },
    disable: async (context, connection: ServiceHostConnection, _installed) => {
      await deps.control?.stop({ packageId: context.packageId, connectionId: connection.id });
    },
    reconcile: async ({ keep }) => {
      await deps.control?.reconcile(keep);
    },
  });
};
