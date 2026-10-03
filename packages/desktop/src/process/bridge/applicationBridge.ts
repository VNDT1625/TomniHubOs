/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { app, shell as electronShell } from 'electron';
import { ipcBridge } from '@/common';
import { ProcessConfig } from '@process/utils/initStorage';
import { getZoomFactor, setZoomFactor } from '@process/utils/zoom';
import { getCdpStatus, updateCdpConfig } from '@process/utils/configureChromium';
import { getGpuStatus, setGpuUserOverride } from '@process/utils/gpuRecovery';
import { systemEgressAuthority } from '@process/services/security/systemEgressAuthority';

import { requestAppRestart } from '@process/startup/appTermination';
import { initApplicationBridgeCore } from './applicationBridgeCore';

import type { IStartOnBootStatus } from '@/common/adapter/ipcBridge';
import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

let mainWindowRef: BrowserWindow | null = null;

const START_ON_BOOT_UNSUPPORTED_MESSAGE = 'Start on boot is only available in packaged macOS and Windows apps.';
export const START_ON_BOOT_WINDOWS_ARG = '--start-on-boot';
const execFileAsync = promisify(execFile);
const launchDetached = (command: string, args: string[], cwd?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });

const EXTERNAL_HANDOFF_URL_ERROR = 'External URL is not permitted.';

/**
 * A user-visible external handoff is not application egress, but must never
 * pass a renderer-controlled file or custom protocol to the operating system.
 * `vscode:` remains an internal fixed handoff in `openFolderWith` below.
 */
export const normalizeExternalHandoffUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048 || value !== value.trim()) {
    throw new Error(EXTERNAL_HANDOFF_URL_ERROR);
  }
  const normalized = /^chatgpt:/iu.test(value) ? value.replace(/^chatgpt:\/\/?/iu, 'https://chatgpt.com/') : value;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(EXTERNAL_HANDOFF_URL_ERROR);
  }
  if (url.username || url.password || url.hash) throw new Error(EXTERNAL_HANDOFF_URL_ERROR);
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]')) return url.toString();
  throw new Error(EXTERNAL_HANDOFF_URL_ERROR);
};

const isStartOnBootSupported = (): boolean => {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
};

const getStartOnBootWindowsArgs = (): string[] => [START_ON_BOOT_WINDOWS_ARG];

const getLoginItemSettings = () => {
  return process.platform === 'win32'
    ? app.getLoginItemSettings({ args: getStartOnBootWindowsArgs() })
    : app.getLoginItemSettings();
};

export function wasLaunchedAtLogin(): boolean {
  if (!app.isPackaged) {
    return false;
  }

  if (process.platform === 'darwin') {
    return Boolean(getLoginItemSettings().wasOpenedAtLogin);
  }

  if (process.platform === 'win32') {
    return process.argv.includes(START_ON_BOOT_WINDOWS_ARG);
  }

  return false;
}

export function getStartOnBootStatus(): IStartOnBootStatus {
  if (!isStartOnBootSupported()) {
    return {
      supported: false,
      enabled: false,
      isPackaged: app.isPackaged,
      platform: process.platform,
    };
  }

  const settings = getLoginItemSettings();
  const enabled =
    process.platform === 'win32'
      ? Boolean(settings.openAtLogin || settings.executableWillLaunchAtLogin)
      : Boolean(settings.openAtLogin);

  return {
    supported: true,
    enabled,
    isPackaged: app.isPackaged,
    platform: process.platform,
  };
}

export function setStartOnBootEnabled(enabled: boolean): IStartOnBootStatus {
  const currentStatus = getStartOnBootStatus();
  if (!currentStatus.supported) {
    return currentStatus;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    ...(process.platform === 'win32'
      ? {
          args: getStartOnBootWindowsArgs(),
          enabled: true,
        }
      : {}),
  });

  return getStartOnBootStatus();
}

export function setApplicationMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
}

/**
 * Accessor for the current main window, or `null` before it is created / after
 * it is destroyed. Used by Main-process services that must attach to the window
 * lazily without owning its lifecycle — e.g. the browser bridge's
 * {@link createBrowserViewManager} `getWindow` dependency (Task 15.1 wiring).
 */
export function getApplicationMainWindow(): BrowserWindow | null {
  return mainWindowRef;
}

export function initApplicationBridge(): void {
  // Platform-agnostic handlers: systemInfo, updateSystemInfo, getPath
  initApplicationBridgeCore();
  ipcBridge.starOffice.detectUrl.provider(async ({ preferredUrl, force: _force, timeoutMs }) => {
    const candidates = [
      ...new Set([preferredUrl, 'http://127.0.0.1:19000'].filter((value): value is string => Boolean(value))),
    ].flatMap((value) => {
      try {
        const parsed = new URL(value.includes('://') ? value : 'http://' + value);
        if (
          (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
        )
          return [];
        const normalized = parsed.toString();
        const candidate = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
        return systemEgressAuthority.authorize({
          egressClass: 'local-office-probe',
          destination: candidate,
        }).decision === 'allow'
          ? [candidate]
          : [];
      } catch {
        return [];
      }
    });
    const timeout = Math.min(5000, Math.max(200, timeoutMs || 1200));
    const results = await Promise.all(
      candidates.map(async (url) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(timeout),
          });
          return response.status >= 200 && response.status < 500 ? url : null;
        } catch {
          return null;
        }
      })
    );
    return { url: results.find((value): value is string => value !== null) || null };
  });
  ipcBridge.shell.openFile.provider(async (filePath) => {
    const error = await electronShell.openPath(filePath);
    if (error) throw new Error(error);
  });
  ipcBridge.shell.showItemInFolder.provider((filePath) => {
    electronShell.showItemInFolder(filePath);
    return Promise.resolve();
  });
  ipcBridge.shell.openExternal.provider(async (url) => {
    await electronShell.openExternal(normalizeExternalHandoffUrl(url));
  });
  ipcBridge.shell.checkToolInstalled.provider(async ({ tool }) => {
    if (!/^[A-Za-z0-9._-]+$/u.test(tool)) return false;
    try {
      await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', [tool], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  });
  ipcBridge.shell.openFolderWith.provider(async ({ folder_path: folderPath, tool }) => {
    const info = await stat(folderPath);
    if (!info.isDirectory()) throw new Error('The selected workspace is not a directory.');
    if (tool === 'explorer') {
      const error = await electronShell.openPath(folderPath);
      if (error) throw new Error(error);
      return;
    }
    if (tool === 'vscode') {
      const normalizedPath = folderPath.replaceAll(String.fromCharCode(92), '/');
      await electronShell.openExternal('vscode://file/' + encodeURI(normalizedPath));
      return;
    }
    if (process.platform === 'win32') {
      await launchDetached(
        'powershell.exe',
        [
          '-NoExit',
          '-Command',
          'Set-Location -LiteralPath (Get-Item -LiteralPath ([Environment]::GetCommandLineArgs()[-1])).FullName',
          folderPath,
        ],
        folderPath
      );
      return;
    }
    if (process.platform === 'darwin') {
      await launchDetached('open', ['-a', 'Terminal', folderPath], folderPath);
      return;
    }
    try {
      await launchDetached('x-terminal-emulator', ['--working-directory', folderPath], folderPath);
    } catch {
      await launchDetached('gnome-terminal', ['--working-directory=' + folderPath], folderPath);
    }
  });

  ipcBridge.application.restart.provider(async () => {
    // Backend subprocess shutdown is handled by backendManager.stop() in the
    // main window's before-quit hook; agent children are killed transitively
    // when backend exits.
    requestAppRestart();
  });

  ipcBridge.application.isDevToolsOpened.provider(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      return Promise.resolve(mainWindowRef.webContents.isDevToolsOpened());
    }
    return Promise.resolve(false);
  });

  ipcBridge.application.openDevTools.provider(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      const win = mainWindowRef;
      const wasOpen = win.webContents.isDevToolsOpened();

      if (wasOpen) {
        win.webContents.closeDevTools();
        return Promise.resolve(false);
      } else {
        return new Promise((resolve) => {
          const onOpened = () => {
            win.webContents.off('devtools-opened', onOpened);
            resolve(true);
          };

          win.webContents.once('devtools-opened', onOpened);
          win.webContents.openDevTools();

          setTimeout(() => {
            win.webContents.off('devtools-opened', onOpened);
            if (win.isDestroyed()) {
              resolve(false);
              return;
            }
            resolve(win.webContents.isDevToolsOpened());
          }, 500);
        });
      }
    }
    return Promise.resolve(false);
  });

  ipcBridge.application.getZoomFactor.provider(() => Promise.resolve(getZoomFactor()));

  ipcBridge.application.setZoomFactor.provider(async ({ factor }) => {
    const updatedFactor = setZoomFactor(factor);
    try {
      await ProcessConfig.set('ui.zoomFactor', updatedFactor);
    } catch (error) {
      console.error('[ApplicationBridge] Failed to persist zoom factor:', error);
    }
    return updatedFactor;
  });

  // CDP status and configuration
  ipcBridge.application.getCdpStatus.provider(async () => {
    try {
      const status = getCdpStatus();
      // If port is set, CDP is considered enabled (verification is optional)
      return { success: true, data: status };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.updateCdpConfig.provider(async (config) => {
    try {
      const updatedConfig = updateCdpConfig(config);
      return { success: true, data: updatedConfig };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.getStartOnBootStatus.provider(async () => {
    try {
      return { success: true, data: getStartOnBootStatus() };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.setStartOnBoot.provider(async ({ enabled }) => {
    try {
      const status = setStartOnBootEnabled(enabled);
      if (!status.supported) {
        return { success: false, msg: START_ON_BOOT_UNSUPPORTED_MESSAGE, data: status };
      }
      return { success: true, data: status };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.getGpuStatus.provider(async () => {
    try {
      return { success: true, data: getGpuStatus() };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.setGpuOverride.provider(async ({ override }) => {
    try {
      return { success: true, data: setGpuUserOverride(override) };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });
}
