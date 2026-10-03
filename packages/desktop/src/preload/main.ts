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
  ACCOUNT_SESSION_NATIVE_CHANNELS,
  HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS,
  HUB_GOAL_SURFACE_PLANNING_NATIVE_CHANNELS,
  HUB_MODEL_SELECTION_NATIVE_CHANNELS,
  PROVIDER_DISCOVERY_NATIVE_CHANNELS,
  CREATOR_PREVIEW_NATIVE_CHANNELS,
  PACKAGE_CAPABILITY_NATIVE_CHANNELS,
  MICROSOFT_STORE_NATIVE_CHANNELS,
  PACKAGE_APP_GROUP_NATIVE_CHANNELS,
  PUBLISHER_SUBMISSION_NATIVE_CHANNELS,
  PACKAGE_MUTATION_NATIVE_CHANNELS,
  PACKAGE_RUNTIME_NATIVE_CHANNELS,
  PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS,
  PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS,
  DESIGN_VIU_NATIVE_CHANNELS,
  type PackageSurfaceAiRuntimePortBinding,
  type PackageSurfaceAiRuntimePortHandoff,
} from '../common/types/platform/electron';

const isSafeHandoffIdentifier = (value: unknown, maximumLength = 256): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximumLength && /^[A-Za-z0-9._:@/-]+$/.test(value);

const isSurfaceAiPortBinding = (value: unknown): value is PackageSurfaceAiRuntimePortBinding => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  const surface = binding.surface;
  if (!surface || typeof surface !== 'object' || Array.isArray(surface)) return false;
  const surfaceIdentity = surface as Record<string, unknown>;
  return (
    isSafeHandoffIdentifier(surfaceIdentity.packageId) &&
    isSafeHandoffIdentifier(surfaceIdentity.packageVersion, 64) &&
    isSafeHandoffIdentifier(surfaceIdentity.publisherId) &&
    isSafeHandoffIdentifier(binding.ownerId) &&
    isSafeHandoffIdentifier(binding.runtimeId, 128) &&
    isSafeHandoffIdentifier(binding.moduleId) &&
    typeof binding.artifactIntegrity === 'string' &&
    /^sha256-[a-f0-9]{64}$/.test(binding.artifactIntegrity)
  );
};

const isSurfaceAiPortHandoff = (value: unknown): value is Omit<PackageSurfaceAiRuntimePortHandoff, 'port'> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const handoff = value as Record<string, unknown>;
  return (
    isSafeHandoffIdentifier(handoff.requestId, 128) &&
    isSafeHandoffIdentifier(handoff.connectionId, 128) &&
    isSurfaceAiPortBinding(handoff.binding)
  );
};

const surfaceAiPortHandoffListeners = new Set<(handoff: PackageSurfaceAiRuntimePortHandoff) => boolean>();

ipcRenderer.on(PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS.portHandoff, (event, payload: unknown) => {
  const port = event.ports?.[0];
  if (!port || event.ports?.length !== 1 || !isSurfaceAiPortHandoff(payload)) {
    port?.close();
    return;
  }

  const handoff = Object.freeze({
    ...payload,
    binding: Object.freeze({ ...payload.binding, surface: { ...payload.binding.surface } }),
    port,
  });
  for (const listener of surfaceAiPortHandoffListeners) {
    try {
      if (listener(handoff)) return;
    } catch {
      // A host exception cannot leave a privileged port available to another frame.
    }
  }
  port.close();
});

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
  // Get current backend port dynamically via synchronous IPC
  getBackendPort: () => ipcRenderer.sendSync('get-backend-port') as number,
  accountSession: {
    getStatus: () => ipcRenderer.invoke(ACCOUNT_SESSION_NATIVE_CHANNELS.getStatus),
    beginSignIn: () => ipcRenderer.invoke(ACCOUNT_SESSION_NATIVE_CHANNELS.beginSignIn),
    admitSupabaseSession: (payload: { accessToken: string; refreshToken?: string }) =>
      ipcRenderer.invoke(ACCOUNT_SESSION_NATIVE_CHANNELS.admitSupabaseSession, payload),
    signOut: () => ipcRenderer.invoke(ACCOUNT_SESSION_NATIVE_CHANNELS.signOut),
    getDiagnosticsConsent: () => ipcRenderer.invoke(ACCOUNT_SESSION_NATIVE_CHANNELS.getDiagnosticsConsent),
    setDiagnosticsConsent: (payload: Readonly<{ granted: boolean }>) =>
      ipcRenderer.invoke(ACCOUNT_SESSION_NATIVE_CHANNELS.setDiagnosticsConsent, payload),
  },
  hubModelSelection: {
    get: () => ipcRenderer.invoke(HUB_MODEL_SELECTION_NATIVE_CHANNELS.get),
    list: () => ipcRenderer.invoke(HUB_MODEL_SELECTION_NATIVE_CHANNELS.list),
    set: (payload: unknown) => ipcRenderer.invoke(HUB_MODEL_SELECTION_NATIVE_CHANNELS.set, payload),
  },
  providerDiscovery: {
    fetchModels: (payload: unknown) => ipcRenderer.invoke(PROVIDER_DISCOVERY_NATIVE_CHANNELS.fetchModels, payload),
  },
  hubGoalSurfacePlanning: {
    plan: (payload: unknown) => ipcRenderer.invoke(HUB_GOAL_SURFACE_PLANNING_NATIVE_CHANNELS.plan, payload),
  },
  hubGoalSurfaceAction: {
    prepare: (payload: unknown) => ipcRenderer.invoke(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.prepare, payload),
    execute: (payload: unknown) => ipcRenderer.invoke(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.execute, payload),
    cancel: (payload: unknown) => ipcRenderer.invoke(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.cancel, payload),
    listRestartCancelled: () => ipcRenderer.invoke(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.listRestartCancelled),
  },
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
  publisherSubmission: {
    pickAndSubmit: (payload: unknown) =>
      ipcRenderer.invoke(PUBLISHER_SUBMISSION_NATIVE_CHANNELS.pickAndSubmit, payload),
  },
  packageRuntime: {
    open: (payload: unknown) => ipcRenderer.invoke(PACKAGE_RUNTIME_NATIVE_CHANNELS.open, payload),
    close: (payload: unknown) => ipcRenderer.invoke(PACKAGE_RUNTIME_NATIVE_CHANNELS.close, payload),
  },
  packageSurfaceAiRuntime: {
    requestPortHandoff: (payload: unknown) =>
      ipcRenderer.invoke(PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS.requestPortHandoff, payload),
    onPortHandoff: (listener: (handoff: PackageSurfaceAiRuntimePortHandoff) => boolean) => {
      surfaceAiPortHandoffListeners.add(listener);
      return () => surfaceAiPortHandoffListeners.delete(listener);
    },
  },
  packageSurfaceAiAccess: {
    requestChallenge: (payload: unknown) =>
      ipcRenderer.invoke(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.requestChallenge, payload),
    confirmChallenge: (payload: unknown) =>
      ipcRenderer.invoke(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.confirmChallenge, payload),
    revokeConsent: (payload: unknown) =>
      ipcRenderer.invoke(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.revokeConsent, payload),
    listConsents: (payload: unknown) =>
      ipcRenderer.invoke(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.listConsents, payload),
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
  designViu: {
    create: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.create, payload),
    capture: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.capture, payload),
    analyzeImage: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.analyzeImage, payload),
    persist: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.persist, payload),
    inspect: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.v2Inspect, payload),
    preview: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.v2Preview, payload),
    commit: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.v2Commit, payload),
    validate: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.v2Validate, payload),
    grantAsset: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.assetGrant, payload),
    listAssets: (payload: unknown) => ipcRenderer.invoke(DESIGN_VIU_NATIVE_CHANNELS.assetList, payload),
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
