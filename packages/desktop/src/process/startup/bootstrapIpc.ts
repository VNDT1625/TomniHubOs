/**
 * Narrow synchronous bootstrap IPC registration. These values are consumed by
 * preload before renderer APIs exist, so the raw Electron handlers must still
 * enforce the shared trusted-desktop sender boundary.
 */

import type { IpcMain, IpcMainEvent } from 'electron';
import type { BackendStartupFailureInfo } from '@/common/types/platform/electron';
import { STUDIO_SPLIT_ROUTE_REDIRECT_BOOTSTRAP_CHANNEL } from '@/common/packages/studioCompatibility';

export const BACKEND_BOOTSTRAP_IPC_CHANNELS = {
  port: 'get-backend-port',
  startupFailed: 'get-backend-startup-failed',
  startupFailure: 'get-backend-startup-failure',
} as const;

export type BootstrapIpcRegistrationOptions = Readonly<{
  ipcMain: Pick<IpcMain, 'on'>;
  isTrustedSender: (event: IpcMainEvent) => boolean;
  getBackendPort: () => number;
  getBackendStartupFailed: () => boolean;
  getBackendStartupFailure: () => BackendStartupFailureInfo | null;
  getStudioSplitRouteRedirectEnabled: () => boolean;
}>;

type SyncReply = number | boolean | BackendStartupFailureInfo | null;

const replyIfTrusted = (
  event: IpcMainEvent,
  isTrustedSender: (event: IpcMainEvent) => boolean,
  read: () => SyncReply,
  denied: SyncReply
): void => {
  event.returnValue = isTrustedSender(event) ? read() : denied;
};

/** Registers only read-only preload bootstrap channels with safe denied values. */
export const registerTrustedBootstrapIpc = (options: BootstrapIpcRegistrationOptions): void => {
  // Keep channel literals here so the static IPC inventory can prove that each
  // preload sendSync route has a registered Main handler.
  options.ipcMain.on('get-backend-port', (event) => {
    replyIfTrusted(event, options.isTrustedSender, options.getBackendPort, 0);
  });
  options.ipcMain.on('get-backend-startup-failed', (event) => {
    replyIfTrusted(event, options.isTrustedSender, options.getBackendStartupFailed, false);
  });
  options.ipcMain.on('get-backend-startup-failure', (event) => {
    replyIfTrusted(event, options.isTrustedSender, options.getBackendStartupFailure, null);
  });
  options.ipcMain.on(STUDIO_SPLIT_ROUTE_REDIRECT_BOOTSTRAP_CHANNEL, (event) => {
    replyIfTrusted(event, options.isTrustedSender, options.getStudioSplitRouteRedirectEnabled, false);
  });
};
