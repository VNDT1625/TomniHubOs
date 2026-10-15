/**
 * Launcher host (T5.6). An installed app is never selected or launched by a repository:
 * the person must bind a real executable via the native dialog first.
 * Turning on a launcher is an approval of its identity; it never starts a process.
 */
import path from 'node:path';

import { createNativeInstalledAppProbe, type InstalledAppProbe } from '@process/integrations/runtime/installedAppProbe';
import { createLauncherBindings, type LauncherBindings } from '@process/integrations/runtime/launcherBindings';
import { getRuntimeProbe } from '../../core/runtimeProbe';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ConnectionOf,
  type HostContext,
  type HostCheck,
  type ApprovalSubject,
} from '../../core/types';

type Launcher = ConnectionOf<'launcher'>;
const releaseLink = (target: Launcher['target']): string | undefined =>
  target.kind === 'installed' && target.release
    ? `https://github.com/${target.release.owner}/${target.release.repo}/releases/latest`
    : target.kind === 'installed'
      ? target.downloadUrl
      : undefined;
export type LauncherHostDeps = Readonly<{
  probe?: InstalledAppProbe;
  bindings?: LauncherBindings;
  programProbe?: (program: string) => Promise<HostCheck>;
}>;
const defaultBindings = async (probe: InstalledAppProbe): Promise<LauncherBindings> => {
  const { app } = await import('electron');
  return createLauncherBindings(path.join(app.getPath('userData'), 'launcher-bindings.json'), probe);
};
export const createLauncherHost = (deps: LauncherHostDeps = {}): AnyConnectionHost => {
  const probe = deps.probe ?? createNativeInstalledAppProbe();
  let bindingsPromise: Promise<LauncherBindings> | undefined;
  const bindings = (): Promise<LauncherBindings> =>
    (bindingsPromise ??= deps.bindings ? Promise.resolve(deps.bindings) : defaultBindings(probe));
  const programProbe = deps.programProbe ?? ((name: string) => getRuntimeProbe().programProbe(name));
  const check = async (context: HostContext, connection: Launcher): Promise<HostCheck> => {
    const target = connection.target;
    if (target.kind === 'installed') {
      const linked = await (await bindings()).get(context.packageId, connection.id);
      if (linked && (await probe.verify(target.executable, linked))) return { ok: true };
      // Discovery never silently grants trust or picks the first match. Main's picker is mandatory.
      const candidates = await probe.find(target.executable);
      return {
        ok: false,
        needsInput: true,
        reason: candidates.length
          ? `Found ${candidates.length} possible installation(s) of ${target.executable}. Choose its executable to link this app.`
          : `Could not find ${target.executable}. Choose its executable or download it from the publisher.`,
      };
    }
    if (target.kind === 'compose') {
      try {
        await context.readPackageFile(target.file);
      } catch {
        return { ok: false, reason: 'The package does not contain the declared compose file.' };
      }
      const docker = await programProbe('docker');
      return docker.ok === false
        ? docker
        : { ok: false, reason: 'Docker Compose launch control is not connected yet.' };
    }
    const source = await programProbe(target.command);
    return source.ok === false
      ? source
      : {
          ok: false,
          reason: 'This application needs a source launcher runtime; it is not connected yet.',
        };
  };
  const describe = async (context: HostContext, connection: Launcher): Promise<ApprovalSubject> => {
    const target = connection.target;
    if (target.kind === 'installed') {
      const linked = await (await bindings()).get(context.packageId, connection.id);
      return {
        kind: 'launcher',
        title: connection.title,
        lines: [
          { label: 'Type', value: 'Desktop application installed on this computer' },
          { label: 'Executable filename', value: target.executable },
          { label: 'Linked executable (chosen by user)', value: linked ?? 'not linked' },
          { label: 'Download page', value: releaseLink(target) ?? 'not declared' },
          { label: 'When enabled', value: 'The app becomes available to launch; enabling does not start it.' },
        ],
        files: [],
      };
    }
    if (target.kind === 'compose') {
      return {
        kind: 'launcher',
        title: connection.title,
        lines: [
          { label: 'Type', value: 'Docker Compose application' },
          { label: 'Compose file', value: target.file },
          { label: 'Launch', value: 'docker compose up -d; stop with docker compose down' },
        ],
        files: [target.file],
      };
    }
    return {
      kind: 'launcher',
      title: connection.title,
      lines: [
        { label: 'Type', value: 'Application from package source' },
        { label: 'Command', value: [target.command, ...(target.args ?? [])].join(' ') },
      ],
      files: [],
    };
  };
  return defineConnectionHost({
    kind: 'launcher',
    check,
    describe,
    enable: async (context, connection) => {
      const available = await check(context, connection);
      if (available.ok === false) throw new Error(available.reason);
      // A launcher is data until an explicit app-open request reaches Main, not an auto-start service.
      return { installed: [`launcher:${context.packageId}:${connection.id}`] };
    },
    disable: async () => {
      /* A launcher does not spawn on enable; no child to stop. */
    },
    // The user-picked executable survives turning a launcher off. Reconciliation must not erase it merely
    // because the connection is disabled. Uninstall cleanup is handled by the package lifecycle.
    reconcile: async () => undefined,
  });
};
