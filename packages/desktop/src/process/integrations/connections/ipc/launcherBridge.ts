/**
 * Main-only launcher dialog and explicit Open action. No path, shell command or URL is accepted from IPC.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { ConnectionRegistry } from '../core/registry';
import type { InstalledAppProbe } from '@process/integrations/runtime/installedAppProbe';
import type { LauncherBindings } from '@process/integrations/runtime/launcherBindings';
import { minimalBaseEnv } from '@process/integrations/runtime/repoProcessNodePorts';
import { LAUNCHER_CHANNELS, type LauncherActionResult } from '@/common/types/platform/launcher';

const ID = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const REQUEST = z.object({ packageId: ID, connectionId: ID }).strict();
type Entry = Readonly<{
  packageId: string;
  connectionId: string;
  executable: string;
  enabled: boolean;
  download?: string;
}>;
export type LauncherBridgePorts = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  registry: Pick<ConnectionRegistry, 'view' | 'syncPackage'>;
  bindings: LauncherBindings;
  probe: InstalledAppProbe;
  chooseFile: (event: IpcMainInvokeEvent, executable: string) => Promise<string | undefined>;
  openExternal: (url: string) => Promise<void>;
  launch: (absolute: string) => Promise<void>;
}>;
export const launchInstalledApplication = (absolute: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(absolute, [], {
      cwd: path.dirname(absolute),
      env: minimalBaseEnv(),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

export const registerLauncherBridge = (ports: LauncherBridgePorts): (() => void) => {
  let active = true;
  const find = async (packageId: string, connectionId: string): Promise<Entry | undefined> => {
    const views = await ports.registry.view(packageId);
    const selected = views.find(
      (item) => item.key === `launcher:${connectionId}` && item.connection.kind === 'launcher'
    );
    if (!selected || selected.connection.kind !== 'launcher' || selected.connection.target.kind !== 'installed')
      return undefined;
    const target = selected.connection.target;
    return {
      packageId,
      connectionId,
      executable: target.executable,
      enabled: selected.state.enabled,
      ...(target.release
        ? { download: `https://github.com/${target.release.owner}/${target.release.repo}/releases/latest` }
        : target.downloadUrl
          ? { download: target.downloadUrl }
          : {}),
    };
  };
  const handler =
    (action: 'link' | 'open' | 'download') =>
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<LauncherActionResult> => {
      if (!active || !ports.verifySender(event)) return { ok: false, error: 'DENIED' };
      const parsed = REQUEST.safeParse(payload);
      if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
      const { packageId, connectionId } = parsed.data;
      try {
        const entry = await find(packageId, connectionId);
        if (!entry) return { ok: false, error: 'NOT_FOUND' };
        if (action === 'download') {
          if (!entry.download) return { ok: false, error: 'NOT_FOUND' };
          const url = new URL(entry.download);
          if (url.protocol !== 'https:' || url.username || url.password) return { ok: false, error: 'DENIED' };
          if (!active || !ports.verifySender(event)) return { ok: false, error: 'DENIED' };
          await ports.openExternal(url.toString());
          return { ok: true };
        }
        if (action === 'link') {
          const picked = await ports.chooseFile(event, entry.executable);
          if (!picked) return { ok: false, error: 'CANCELLED' };
          if (!active || !ports.verifySender(event)) return { ok: false, error: 'DENIED' };
          const saved = await ports.bindings.bind(packageId, connectionId, entry.executable, picked);
          if (!saved) return { ok: false, error: 'INVALID_REQUEST' };
          await ports.registry.syncPackage(packageId);
          return { ok: true };
        }
        // Enable via the standard Main approval workflow, *then* the person explicitly presses Open.
        if (!entry.enabled) return { ok: false, error: 'NOT_ENABLED' };
        const bound = await ports.bindings.get(packageId, connectionId);
        if (!bound || !(await ports.probe.verify(entry.executable, bound))) return { ok: false, error: 'NOT_LINKED' };
        if (!active || !ports.verifySender(event)) return { ok: false, error: 'DENIED' };
        await ports.launch(bound);
        return { ok: true };
      } catch {
        return { ok: false, error: 'FAILED' };
      }
    };
  ports.ipcMain.handle(LAUNCHER_CHANNELS.link, handler('link'));
  ports.ipcMain.handle(LAUNCHER_CHANNELS.open, handler('open'));
  ports.ipcMain.handle(LAUNCHER_CHANNELS.download, handler('download'));
  return () => {
    active = false;
    for (const channel of Object.values(LAUNCHER_CHANNELS)) ports.ipcMain.removeHandler(channel);
  };
};
