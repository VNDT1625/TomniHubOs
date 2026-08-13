/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

// Hook Sentry IPC so the renderer SDK uses ipcRenderer.send instead of falling
// back to fetch('sentry-ipc://...'), which floods the DevTools Network panel.
// Bundled into this preload via `externalizeDepsPlugin({ exclude: [...] })` so
// Electron's sandbox-mode preload doesn't try to resolve it from node_modules.
import '@sentry/electron/preload';
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { ADAPTER_BRIDGE_EVENT_KEY } from '../common/adapter/constant';
import {
  readStudioSplitRouteRedirectBootstrap,
  STUDIO_SPLIT_ROUTE_REDIRECT_BOOTSTRAP_CHANNEL,
} from '../common/packages/studioCompatibility';
import {
  CREATOR_PREVIEW_NATIVE_CHANNELS,
  PACKAGE_CAPABILITY_NATIVE_CHANNELS,
  MICROSOFT_STORE_NATIVE_CHANNELS,
  PACKAGE_APP_GROUP_NATIVE_CHANNELS,
  PACKAGE_MUTATION_NATIVE_CHANNELS,
  PACKAGE_RUNTIME_NATIVE_CHANNELS,
} from '../common/types/platform/electron';

/**
 * @description 注入到renderer进程中, 用于与main进程通信
 * */
contextBridge.exposeInMainWorld('electronAPI', {
  emit: (name: string, data: unknown) => {
    return ipcRenderer
      .invoke(
        ADAPTER_BRIDGE_EVENT_KEY,
        JSON.stringify({
          name: name,
          data: data,
        })
      )
      .catch((error) => {
        console.error('IPC invoke error:', error);
        throw error;
      });
  },
  on: (callback: (event: { value: string }) => void) => {
    const handler = (_event: IpcRendererEvent, value: unknown): void => {
      if (typeof value === 'string') callback({ value });
    };
    ipcRenderer.on(ADAPTER_BRIDGE_EVENT_KEY, handler);
    return () => {
      ipcRenderer.off(ADAPTER_BRIDGE_EVENT_KEY, handler);
    };
  },
  // 获取拖拽文件/目录的绝对路径 / Get absolute path for dragged file/directory
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // Feedback: collect and compress recent log files
  collectFeedbackLogs: () => ipcRenderer.invoke('feedback:collect-logs'),
  // Feedback: capture a screenshot of the current window
  captureFeedbackScreenshot: () => ipcRenderer.invoke('feedback:capture-screenshot'),
  // Foundation RunKernel execution & event query
  executeFoundationRun: (payload: unknown) => ipcRenderer.invoke('foundation:execute-run', payload),
  getFoundationEvents: (runId: string) => ipcRenderer.invoke('foundation:get-events', runId),
  creatorPreview: {
    open: (payload: unknown) => ipcRenderer.invoke(CREATOR_PREVIEW_NATIVE_CHANNELS.open, payload),
    suspend: (payload: unknown) => ipcRenderer.invoke(CREATOR_PREVIEW_NATIVE_CHANNELS.suspend, payload),
    snapshot: (payload: unknown) => ipcRenderer.invoke(CREATOR_PREVIEW_NATIVE_CHANNELS.snapshot, payload),
    reset: (payload: unknown) => ipcRenderer.invoke(CREATOR_PREVIEW_NATIVE_CHANNELS.reset, payload),
    remove: (payload: unknown) => ipcRenderer.invoke(CREATOR_PREVIEW_NATIVE_CHANNELS.remove, payload),
    cancel: (payload: unknown) => ipcRenderer.invoke(CREATOR_PREVIEW_NATIVE_CHANNELS.cancel, payload),
    getState: (payload: unknown) => ipcRenderer.invoke(CREATOR_PREVIEW_NATIVE_CHANNELS.getState, payload),
    onEvent: (callback: (payload: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => callback(payload);
      ipcRenderer.on(CREATOR_PREVIEW_NATIVE_CHANNELS.event, handler);
      return () => ipcRenderer.off(CREATOR_PREVIEW_NATIVE_CHANNELS.event, handler);
    },
  },
  packageMutation: {
    requestConsent: (payload: unknown) => ipcRenderer.invoke(PACKAGE_MUTATION_NATIVE_CHANNELS.requestConsent, payload),
    preparePermissionConsent: (payload: unknown) =>
      ipcRenderer.invoke(PACKAGE_MUTATION_NATIVE_CHANNELS.preparePermissionConsent, payload),
    approvePermissionConsent: (payload: unknown) =>
      ipcRenderer.invoke(PACKAGE_MUTATION_NATIVE_CHANNELS.approvePermissionConsent, payload),
    execute: (payload: unknown) => ipcRenderer.invoke(PACKAGE_MUTATION_NATIVE_CHANNELS.execute, payload),
  },
  packageRuntime: {
    open: (payload: unknown) => ipcRenderer.invoke(PACKAGE_RUNTIME_NATIVE_CHANNELS.open, payload),
    close: (payload: unknown) => ipcRenderer.invoke(PACKAGE_RUNTIME_NATIVE_CHANNELS.close, payload),
  },
  packageCapability: {
    activate: (payload: unknown) => ipcRenderer.invoke(PACKAGE_CAPABILITY_NATIVE_CHANNELS.activate, payload),
    invoke: (payload: unknown) => ipcRenderer.invoke(PACKAGE_CAPABILITY_NATIVE_CHANNELS.invoke, payload),
    cancel: (payload: unknown) => ipcRenderer.invoke(PACKAGE_CAPABILITY_NATIVE_CHANNELS.cancel, payload),
  },
  microsoftStore: {
    requestConsent: (payload: unknown) => ipcRenderer.invoke(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent, payload),
    execute: (payload: unknown) => ipcRenderer.invoke(MICROSOFT_STORE_NATIVE_CHANNELS.execute, payload),
    openStorePage: (payload: unknown) => ipcRenderer.invoke(MICROSOFT_STORE_NATIVE_CHANNELS.openStorePage, payload),
  },
  packageAppGroups: {
    read: (payload: unknown) => ipcRenderer.invoke(PACKAGE_APP_GROUP_NATIVE_CHANNELS.read, payload),
    create: (payload: unknown) => ipcRenderer.invoke(PACKAGE_APP_GROUP_NATIVE_CHANNELS.create, payload),
    rename: (payload: unknown) => ipcRenderer.invoke(PACKAGE_APP_GROUP_NATIVE_CHANNELS.rename, payload),
    reorder: (payload: unknown) => ipcRenderer.invoke(PACKAGE_APP_GROUP_NATIVE_CHANNELS.reorder, payload),
    remove: (payload: unknown) => ipcRenderer.invoke(PACKAGE_APP_GROUP_NATIVE_CHANNELS.remove, payload),
  },
});

// The Studio split gate is bootstrapped from the main-process environment only.
// If an older main process or any IPC failure cannot provide the value, retain
// the legacy Studio runtime rather than attempting the split redirect.
const studioSplitRouteRedirectEnabled = readStudioSplitRouteRedirectBootstrap(() =>
  ipcRenderer.sendSync(STUDIO_SPLIT_ROUTE_REDIRECT_BOOTSTRAP_CHANNEL)
);
contextBridge.exposeInMainWorld('__studioSplitRouteRedirectEnabled', studioSplitRouteRedirectEnabled);

// Synchronously fetch the tomnycore port and expose it to the renderer
// via contextBridge (direct window assignment is invisible under contextIsolation).
const backendPort = ipcRenderer.sendSync('get-backend-port') as number;
const backendStartupFailed = ipcRenderer.sendSync('get-backend-startup-failed') as boolean;
const backendStartupFailure = ipcRenderer.sendSync('get-backend-startup-failure') as unknown;
contextBridge.exposeInMainWorld('__backendPort', backendPort > 0 ? backendPort : 0);
contextBridge.exposeInMainWorld('__backendStartupFailed', backendStartupFailed === true);
contextBridge.exposeInMainWorld('__backendStartupFailure', backendStartupFailure ?? null);

// 托盘事件监听 - 将 IPC 事件转换为 DOM 事件
// Tray event listeners - convert IPC events to DOM events
const trayEvents = [
  'tray:navigate-to-guid',
  'tray:navigate-to-conversation',
  'tray:open-about',
  'tray:pause-all-tasks',
  'tray:check-update',
];

for (const channel of trayEvents) {
  ipcRenderer.on(channel, (_event, ...args) => {
    window.dispatchEvent(new CustomEvent(channel, { detail: args[0] }));
  });
}
