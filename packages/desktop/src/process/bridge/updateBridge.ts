/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { app } from 'electron';
import { autoUpdaterService } from '../services/autoUpdaterService';

type AutoUpdateCheckParams = {
  /** Whether to include prerelease/dev builds in update checks. */
  includePrerelease?: boolean;
};

/**
 * Broadcasts status emitted by the signed Electron updater to renderer listeners.
 * Manual GitHub asset download intentionally has no IPC route: only electron-updater
 * owns update discovery, artifact verification, and installation.
 */
export function createAutoUpdateStatusBroadcast(): (
  status: import('../services/autoUpdaterService').AutoUpdateStatus
) => void {
  return (status) => {
    ipcBridge.autoUpdate.status.emit(status);
  };
}

export function initUpdateBridge(): void {
  ipcBridge.autoUpdate.check.provider(
    async (
      params: AutoUpdateCheckParams
    ): Promise<{
      success: boolean;
      data?: { currentVersion: string; updateInfo?: { version: string; releaseDate?: string; releaseNotes?: string } };
      msg?: string;
    }> => {
      try {
        autoUpdaterService.setAllowPrerelease(Boolean(params?.includePrerelease));
        const result = await autoUpdaterService.checkForUpdates();

        if (result.success && result.updateInfo) {
          return {
            success: true,
            data: {
              currentVersion: app.getVersion(),
              updateInfo: {
                version: result.updateInfo.version,
                releaseDate: result.updateInfo.releaseDate,
                releaseNotes:
                  typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : undefined,
              },
            },
          };
        }

        return {
          success: result.success,
          data: result.success ? { currentVersion: app.getVersion() } : undefined,
          msg: result.error,
        };
      } catch (error: unknown) {
        return { success: false, msg: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcBridge.autoUpdate.download.provider(async (): Promise<{ success: boolean; msg?: string }> => {
    try {
      const result = await autoUpdaterService.downloadUpdate();
      return { success: result.success, msg: result.error };
    } catch (error: unknown) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.autoUpdate.quitAndInstall.provider(async (): Promise<void> => {
    try {
      autoUpdaterService.quitAndInstall();
    } catch (error: unknown) {
      console.error('quitAndInstall failed:', error);
    }
  });
}
