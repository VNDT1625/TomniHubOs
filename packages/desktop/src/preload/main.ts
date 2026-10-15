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
  PACKAGE_MODEL_INVOKE_NATIVE_CHANNELS,
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

import {
  SESSION_MEMORY_CHANNELS,
  type SessionMemoryRequest,
  type SessionMemoryRememberRequest,
  type SessionMemoryForgetRequest,
} from '../common/types/platform/sessionMemory';
import {
  COMPANY_SECRETS_CHANNELS,
  PACKAGE_SECRETS_ACCESS_CHANNEL,
  PACKAGE_SECRETS_CHANNELS,
  PACKAGE_SECRETS_LEGACY_CHANNEL,
  SESSION_SECRETS_CHANNELS,
  type ScopedSecretsNativeAPI,
} from '../common/types/platform/sessionSecrets';
import { EXPLORER_CHANNELS, type ExplorerActionRequest } from '../common/types/platform/explorer';
import {
  INSTALL_APPROVAL_CHANNELS,
  LOCAL_KEY_CHANNELS,
  PACKAGE_CONNECTIONS_CHANNELS,
  type InstallApprovalRequest,
  type InstallApprovalResponse,
} from '../common/types/platform/packageConnections';
import { SKILL_DOCUMENT_CHANNEL } from '../common/skills/skillDocument';

import { EXTENSION_STRIP_CHANNELS } from '../common/integrations/extensions/stripContract';
import {
  REPO_STORE_CHANNELS,
  type RepoStoreImportRequest,
  type RepoStoreProgress,
} from '../common/types/platform/repoStore';
import { LAUNCHER_CHANNELS } from '../common/types/platform/launcher';
import { REALTIME_CONTENT_CHANNEL, REALTIME_ARTICLE_CHANNEL, type RealtimeContentNativeAPI } from '../common/types/platform/realtimeContent';
import { HOOK_SETTINGS_CHANNELS } from '../common/integrations/hooks/hookSettings';

import {
  FILE_VIEWER_CHANNELS,
  LIBRARY_CHANNELS,
  type FileViewerNativeAPI,
  type LibraryNativeAPI,
} from '../common/integrations/library/libraryContracts';

/** One scoped secrets surface (a conversation or a company): five channels, nothing else. */
const scopedSecretsApi = <Key extends 'sessionId' | 'companyId' | 'packageId'>(
  channels: Readonly<Record<'list' | 'save' | 'remove' | 'reveal' | 'dismissRequest', string>>
): ScopedSecretsNativeAPI<Key> => ({
  list: (payload) => ipcRenderer.invoke(channels.list, payload),
  save: (payload) => ipcRenderer.invoke(channels.save, payload),
  remove: (payload) => ipcRenderer.invoke(channels.remove, payload),
  reveal: (payload) => ipcRenderer.invoke(channels.reveal, payload),
  dismissRequest: (payload) => ipcRenderer.invoke(channels.dismissRequest, payload),
});

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
  ...(process.env.TOMNY_E2E_TEST === '1'
    ? {
        e2e: {
          resetNativeConversationCapture: () => ipcRenderer.invoke('e2e.native-conversation-capture.reset'),
          getNativeConversationCapture: () => ipcRenderer.invoke('e2e.native-conversation-capture.get'),
        },
      }
    : {}),
  sessionMemory: {
    snapshot: (payload: SessionMemoryRequest) => ipcRenderer.invoke(SESSION_MEMORY_CHANNELS.snapshot, payload),
    remember: (payload: SessionMemoryRememberRequest) => ipcRenderer.invoke(SESSION_MEMORY_CHANNELS.remember, payload),
    clear: (payload: SessionMemoryRequest) => ipcRenderer.invoke(SESSION_MEMORY_CHANNELS.clear, payload),
    forget: (payload: SessionMemoryForgetRequest) => ipcRenderer.invoke(SESSION_MEMORY_CHANNELS.forget, payload),
  },
  sessionSecrets: scopedSecretsApi<'sessionId'>(SESSION_SECRETS_CHANNELS),
  companySecrets: scopedSecretsApi<'companyId'>(COMPANY_SECRETS_CHANNELS),
  packageSecrets: {
    ...scopedSecretsApi<'packageId'>(PACKAGE_SECRETS_CHANNELS),
    access: {
      overview: (payload: { packageId: string }) =>
        ipcRenderer.invoke(PACKAGE_SECRETS_ACCESS_CHANNEL, { ...payload, action: 'overview' }),
      approve: (payload: { packageId: string; requestId: string }) =>
        ipcRenderer.invoke(PACKAGE_SECRETS_ACCESS_CHANNEL, { ...payload, action: 'approve' }),
      deny: (payload: { packageId: string; requestId: string }) =>
        ipcRenderer.invoke(PACKAGE_SECRETS_ACCESS_CHANNEL, { ...payload, action: 'deny' }),
      grant: (payload: { packageId: string; handle: string }) =>
        ipcRenderer.invoke(PACKAGE_SECRETS_ACCESS_CHANNEL, { ...payload, action: 'grant' }),
      revoke: (payload: { packageId: string; handle: string }) =>
        ipcRenderer.invoke(PACKAGE_SECRETS_ACCESS_CHANNEL, { ...payload, action: 'revoke' }),
    },
    legacy: {
      status: (payload: { packageId: string }) =>
        ipcRenderer.invoke(PACKAGE_SECRETS_LEGACY_CHANNEL, { ...payload, action: 'status' }),
      import: (payload: { packageId: string }) =>
        ipcRenderer.invoke(PACKAGE_SECRETS_LEGACY_CHANNEL, { ...payload, action: 'import' }),
    },
  },
  // Only the named fields cross; Main validates them again and refuses anything else (never a path).
  launcher: {
    link: (request: { packageId: string; connectionId: string }) => ipcRenderer.invoke(LAUNCHER_CHANNELS.link, request),
    open: (request: { packageId: string; connectionId: string }) => ipcRenderer.invoke(LAUNCHER_CHANNELS.open, request),
    download: (request: { packageId: string; connectionId: string }) =>
      ipcRenderer.invoke(LAUNCHER_CHANNELS.download, request),
  },
  repoStore: {
    import: (request: RepoStoreImportRequest) => ipcRenderer.invoke(REPO_STORE_CHANNELS.import, request),
    checkUpdate: (request: { packageId: string }) =>
      ipcRenderer.invoke(REPO_STORE_CHANNELS.checkUpdate, { packageId: request.packageId }),
    onProgress: (listener: (progress: RepoStoreProgress) => void) => {
      const onEvent = (_event: IpcRendererEvent, progress: RepoStoreProgress): void => {
        if (progress && typeof progress.requestId === 'string') listener(progress);
      };
      ipcRenderer.on(REPO_STORE_CHANNELS.progress, onEvent);
      return () => ipcRenderer.removeListener(REPO_STORE_CHANNELS.progress, onEvent);
    },
  },
  extensionStrip: {
    list: () => ipcRenderer.invoke(EXTENSION_STRIP_CHANNELS.list, {}),
    setPinned: (payload: { id: string; pinned: boolean }) =>
      ipcRenderer.invoke(EXTENSION_STRIP_CHANNELS.setPinned, { id: payload.id, pinned: payload.pinned }),
    setSiteAccess: (payload: { id: string; mode: string }) =>
      ipcRenderer.invoke(EXTENSION_STRIP_CHANNELS.setSiteAccess, { id: payload.id, mode: payload.mode }),
    allowSite: (payload: { id: string }) => ipcRenderer.invoke(EXTENSION_STRIP_CHANNELS.allowSite, { id: payload.id }),
    uninstall: (payload: { packageId: string }) =>
      ipcRenderer.invoke(EXTENSION_STRIP_CHANNELS.uninstall, { packageId: payload.packageId }),
  },
  skillDocuments: {
    read: (payload: { name: string; packageId?: string }) => ipcRenderer.invoke(SKILL_DOCUMENT_CHANNEL, payload),
  },

  localKeys: {
    revoke: () => ipcRenderer.invoke(LOCAL_KEY_CHANNELS.revoke),
  },
  packageConnections: {
    list: (payload: { packageId: string }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.list, { packageId: payload.packageId }),
    describe: (payload: { packageId: string; connectionKey: string }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.describe, {
        packageId: payload.packageId,
        connectionKey: payload.connectionKey,
      }),
    enable: (payload: { packageId: string; connectionKey: string; approvalHash: string }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.enable, {
        packageId: payload.packageId,
        connectionKey: payload.connectionKey,
        approvalHash: payload.approvalHash,
      }),
    disable: (payload: { packageId: string; connectionKey: string }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.disable, {
        packageId: payload.packageId,
        connectionKey: payload.connectionKey,
      }),
    setAutoStart: (payload: { packageId: string; connectionKey: string; autoStart: boolean }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.setAutoStart, {
        packageId: payload.packageId,
        connectionKey: payload.connectionKey,
        autoStart: payload.autoStart,
      }),
    setPackageEnabled: (payload: { packageId: string; enabled: boolean }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.setPackageEnabled, {
        packageId: payload.packageId,
        enabled: payload.enabled,
      }),

    onInstallApprovalRequest: (listener: (request: InstallApprovalRequest) => void) => {
      const onEvent = (_event: IpcRendererEvent, request: InstallApprovalRequest): void => {
        if (request && typeof request.requestId === 'string') listener(request);
      };
      ipcRenderer.on(INSTALL_APPROVAL_CHANNELS.request, onEvent);
      // A window that was reloaded while a request waited gets the still-pending requests again. Main keeps them until answered.
      void ipcRenderer
        .invoke(INSTALL_APPROVAL_CHANNELS.pending)
        .then((items: unknown) => {
          if (!Array.isArray(items)) return;
          for (const item of items) onEvent({} as IpcRendererEvent, item as InstallApprovalRequest);
        })
        .catch((): undefined => undefined);
      return () => ipcRenderer.removeListener(INSTALL_APPROVAL_CHANNELS.request, onEvent);
    },
    respondInstallApproval: (response: InstallApprovalResponse) =>
      ipcRenderer.invoke(INSTALL_APPROVAL_CHANNELS.respond, response),

    rulesList: () => ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.rulesList, {}),
    rulesAttach: (payload: { packageId: string; connectionId: string; workspace: string }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.rulesAttach, {
        packageId: payload.packageId,
        connectionId: payload.connectionId,
        workspace: payload.workspace,
      }),
    rulesDetach: (payload: { packageId: string; connectionId: string; workspace: string }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.rulesDetach, {
        packageId: payload.packageId,
        connectionId: payload.connectionId,
        workspace: payload.workspace,
      }),
    servicesList: () => ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.servicesList, {}),
    servicesStart: (payload: { packageId: string; connectionId: string }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.servicesStart, {
        packageId: payload.packageId,
        connectionId: payload.connectionId,
      }),
    servicesStop: (payload: { packageId: string; connectionId: string }) =>
      ipcRenderer.invoke(PACKAGE_CONNECTIONS_CHANNELS.servicesStop, {
        packageId: payload.packageId,
        connectionId: payload.connectionId,
      }),
  },
  // Hook settings (design S10). Only the named fields cross; Main validates them again and refuses anything else.
  hookSettings: {
    list: () => ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.list, {}),
    describe: (payload: { hookId: string }) =>
      ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.describe, { hookId: payload.hookId }),
    approve: (payload: { hookId: string; approvalHash: string }) =>
      ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.approve, {
        hookId: payload.hookId,
        approvalHash: payload.approvalHash,
      }),
    setEnabled: (payload: { hookId: string; enabled: boolean }) =>
      ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.setEnabled, { hookId: payload.hookId, enabled: payload.enabled }),
    setDisableAll: (payload: { disabled: boolean }) =>
      ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.setDisableAll, { disabled: payload.disabled }),
    setSourceEnabled: (payload: { source: string; enabled: boolean }) =>
      ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.setSourceEnabled, { source: payload.source, enabled: payload.enabled }),
    createUser: (payload: { event: string; matcher?: string; command: string; args?: string[]; timeoutSec: number }) =>
      ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.createUser, {
        event: payload.event,
        ...(payload.matcher === undefined ? {} : { matcher: payload.matcher }),
        command: payload.command,
        ...(payload.args === undefined ? {} : { args: payload.args }),
        timeoutSec: payload.timeoutSec,
      }),
    removeUser: (payload: { hookId: string }) =>
      ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.removeUser, { hookId: payload.hookId }),
    audit: (payload?: { limit?: number }) =>
      ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.audit, payload?.limit === undefined ? {} : { limit: payload.limit }),
    coverage: () => ipcRenderer.invoke(HOOK_SETTINGS_CHANNELS.coverage, {}),
  },
    realtimeContent: {
    read: (payload) => ipcRenderer.invoke(REALTIME_CONTENT_CHANNEL, payload),
    readArticle: (payload) => ipcRenderer.invoke(REALTIME_ARTICLE_CHANNEL, payload),
  } satisfies RealtimeContentNativeAPI,
  explorer: {
    open: (payload: { path?: string; pick?: boolean }) => ipcRenderer.invoke(EXPLORER_CHANNELS.open, payload),
    list: (payload: { sessionId: string; relativePath: string }) => ipcRenderer.invoke(EXPLORER_CHANNELS.list, payload),
    action: (payload: ExplorerActionRequest) => ipcRenderer.invoke(EXPLORER_CHANNELS.action, payload),
    close: (payload: { sessionId: string }) => ipcRenderer.invoke(EXPLORER_CHANNELS.close, payload),
    quickView: (payload: { sessionId: string; relativePath: string }) =>
      ipcRenderer.invoke(EXPLORER_CHANNELS.quickView, payload),
  },
  // The Hub file viewer and Library: requests name a file only by an opaque id; Main resolves and re-validates it.
  fileViewer: {
    openFromExplorer: (payload) =>
      ipcRenderer.invoke(FILE_VIEWER_CHANNELS.openFromExplorer, {
        sessionId: payload.sessionId,
        relativePath: payload.relativePath,
      }),
    read: (payload) => ipcRenderer.invoke(FILE_VIEWER_CHANNELS.read, { ref: payload.ref }),
    openExternal: (payload) => ipcRenderer.invoke(FILE_VIEWER_CHANNELS.openExternal, { ref: payload.ref }),
  } satisfies FileViewerNativeAPI,
  library: {
    list: () => ipcRenderer.invoke(LIBRARY_CHANNELS.list),
    add: () => ipcRenderer.invoke(LIBRARY_CHANNELS.add),
    addFromView: (payload) => ipcRenderer.invoke(LIBRARY_CHANNELS.addFromView, { viewId: payload.viewId }),
    repick: (payload) => ipcRenderer.invoke(LIBRARY_CHANNELS.repick, { entryId: payload.entryId }),
    remove: (payload) => ipcRenderer.invoke(LIBRARY_CHANNELS.remove, { entryId: payload.entryId }),
  } satisfies LibraryNativeAPI,

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
  packageModelInvoke: {
    invoke: (payload: unknown) => ipcRenderer.invoke(PACKAGE_MODEL_INVOKE_NATIVE_CHANNELS.invoke, payload),
    cancel: (payload: unknown) => ipcRenderer.invoke(PACKAGE_MODEL_INVOKE_NATIVE_CHANNELS.cancel, payload),
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
