/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 窗口控制桥接模块
 * Window Controls Bridge Module
 *
 * 负责处理窗口的最小化、最大化、关闭等控制操作
 * Handles window minimize, maximize, close and other control operations
 */

import { app, BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { getApplicationMainWindow } from './applicationBridge';
import { requestAppRestart } from '../startup/appTermination';

/**
 * 为指定窗口注册最大化状态监听器
 * Register maximize state listeners for a specific window
 *
 * @param window - 要监听的 BrowserWindow 实例 / BrowserWindow instance to listen to
 */
export function registerWindowMaximizeListeners(window: BrowserWindow): void {
  if (window.isDestroyed()) return;

  // 当窗口最大化时通知渲染进程 / Notify renderer when window is maximized
  window.on('maximize', () => {
    ipcBridge.windowControls.maximizedChanged.emit({ is_maximized: true });
  });

  // 当窗口取消最大化时通知渲染进程 / Notify renderer when window is unmaximized
  window.on('unmaximize', () => {
    ipcBridge.windowControls.maximizedChanged.emit({ is_maximized: false });
  });
}

/**
 * Resolves the intended application window robustly:
 * 1. Prefers the currently focused BrowserWindow if it is active and not destroyed.
 * 2. Falls back to the application's main BrowserWindow via getApplicationMainWindow().
 * 3. Falls back to the first non-destroyed window in BrowserWindow.getAllWindows()
 *    (excluding devtools windows).
 */
export function resolveTargetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  const appMain = getApplicationMainWindow();
  if (appMain && !appMain.isDestroyed()) {
    return appMain;
  }
  const allWindows = BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && !win.webContents?.getURL()?.startsWith('devtools://')
  );
  return allWindows[0] ?? null;
}

/**
 * 初始化窗口控制桥接
 * Initialize window controls bridge
 *
 * 注册 IPC 处理器以响应来自渲染进程的窗口控制请求
 * Register IPC handlers to respond to window control requests from renderer process
 */
export function initWindowControlsBridge(): void {
  // 最小化窗口 / Minimize window
  ipcBridge.windowControls.minimize.provider(() => {
    const window = resolveTargetWindow();
    if (window) {
      window.minimize();
    }
    return Promise.resolve();
  });

  // 最大化窗口 / Maximize window
  ipcBridge.windowControls.maximize.provider(() => {
    const window = resolveTargetWindow();
    if (window) {
      window.maximize();
    }
    return Promise.resolve();
  });

  // 取消最大化窗口 / Unmaximize window
  ipcBridge.windowControls.unmaximize.provider(() => {
    const window = resolveTargetWindow();
    if (window) {
      window.unmaximize();
    }
    return Promise.resolve();
  });

  // 关闭窗口 / Close window
  ipcBridge.windowControls.close.provider(() => {
    const window = resolveTargetWindow();
    if (window) {
      window.close();
    }
    return Promise.resolve();
  });

  // 重启应用 / Restart app
  ipcBridge.windowControls.restart.provider(() => {
    requestAppRestart();
    return Promise.resolve();
  });

  // 获取窗口是否最大化状态 / Get window maximized state
  ipcBridge.windowControls.isMaximized.provider(() => {
    const window = resolveTargetWindow();
    return Promise.resolve(window?.isMaximized() ?? false);
  });

  // 为所有已存在的窗口注册监听器 / Register listeners for all existing windows
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach((window) => {
    registerWindowMaximizeListeners(window);
  });

  // 监听新窗口创建以自动挂载最大化状态监听 / Auto-register for any future windows
  app.on('browser-window-created', (_event, window) => {
    registerWindowMaximizeListeners(window);
  });
}
