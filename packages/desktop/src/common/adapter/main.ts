/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bridge } from '@office-ai/platform';
import './bridgeErrorWrapper';
import { ADAPTER_BRIDGE_EVENT_KEY } from './constant';
import { registerWebSocketBroadcaster, getBridgeEmitter, setBridgeEmitter, broadcastToAll } from './registry';

/**
 * Bridge event data structure for IPC communication
 * IPC 通信的桥接事件数据结构
 */
interface BridgeEventData {
  name: string;
  data: unknown;
}

const AUTO_UPDATE_PROVIDER_EVENTS = new Set([
  'subscribe-auto-update.check',
  'subscribe-auto-update.download',
  'subscribe-auto-update.quit-and-install',
]);

/**
 * Personal Context lifecycle events cross the generic platform adapter before
 * their Main-owned account and schema checks. Keep this an explicit literal
 * allowlist: no other adapter provider inherits renderer-origin authority.
 */
const PERSONAL_CONTEXT_PROVIDER_EVENTS = new Set([
  'personal-context.get',
  'personal-context.save',
  'personal-context.learning.set-paused',
  'personal-context.learning.propose',
  'personal-context.learning.confirm',
  'personal-context.learning.reject',
  'personal-context.learning.correct',
  'personal-context.learning.outcome',
  'personal-context.learning.forget',
  'personal-context.learning.delete',
  'personal-context.learning.export',
  'personal-secrets.list',
  'personal-secrets.save',
  'personal-secrets.remove',
  'subscribe-personal-context.get',
  'subscribe-personal-context.save',
  'subscribe-personal-context.learning.set-paused',
  'subscribe-personal-context.learning.propose',
  'subscribe-personal-context.learning.confirm',
  'subscribe-personal-context.learning.reject',
  'subscribe-personal-context.learning.correct',
  'subscribe-personal-context.learning.outcome',
  'subscribe-personal-context.learning.forget',
  'subscribe-personal-context.learning.delete',
  'subscribe-personal-context.learning.export',
  'subscribe-personal-secrets.list',
  'subscribe-personal-secrets.save',
  'subscribe-personal-secrets.remove',
]);

/**
 * OS handoff providers invoke Electron shell APIs or a fixed local process.
 * They need the same main-frame origin guard before the generic adapter drops
 * Electron sender metadata.
 */
const SHELL_PROVIDER_EVENTS = new Set([
  'shell.open-file',
  'shell.show-item-in-folder',
  'shell.open-external',
  'shell.check-tool-installed',
  'shell.open-folder-with',
]);

/**
 * Native-file providers cross the generic platform adapter before the
 * resource boundary can retain Electron sender identity. Keep the complete
 * currently-registered surface literal and exact: a prefix would grant future
 * filesystem operations trusted-renderer authority without review.
 */
const NATIVE_FILE_PROVIDER_EVENTS = new Set([
  'native-fs.get-files-by-dir',
  'native-fs.list-workspace-files',
  'native-fs.image-base64',
  'native-fs.fetch-remote-image',
  'native-fs.read',
  'native-fs.read-buffer',
  'native-fs.temp',
  'native-fs.write',
  'native-fs.zip',
  'native-fs.zip-cancel',
  'native-fs.metadata',
  'native-fs.copy',
  'native-fs.remove',
  'native-fs.rename',
  'native-fs.watch-start',
  'native-fs.watch-stop',
  'native-fs.watch-stop-all',
  'native-fs.office-watch-start',
  'native-fs.office-watch-stop',
]);

/**
 * Native MCP and Skill providers cross the generic platform adapter before
 * their resource-specific checks can retain Electron sender identity. Keep the
 * currently registered surface literal and exact: a prefix would grant future
 * capability operations trusted-renderer authority without review.
 */
const NATIVE_CAPABILITY_PROVIDER_EVENTS = new Set([
  'mcp-registry.list',
  'mcp-registry.extension-list',
  'mcp-registry.create',
  'mcp-registry.import',
  'mcp-registry.update',
  'mcp-registry.remove',
  'mcp-registry.toggle',
  'native-mcp.agent-configs',
  'native-mcp.test',
  'native-mcp.oauth-status',
  'native-mcp.oauth-login',
  'native-mcp.oauth-logout',
  'native-mcp.oauth-authenticated',
  'native-skills.list',
  'native-skills.materialize',
  'native-skills.info',
  'native-skills.import',
  'native-skills.scan',
  'native-skills.common-paths',
  'native-skills.detect-external',
  'native-skills.import-link',
  'native-skills.delete',
  'native-skills.paths',
  'native-skills.external-paths',
  'native-skills.external-add',
  'native-skills.external-remove',
]);

/**
 * Assistant-resource rules and skills are Main-owned files. Speech accepts raw
 * audio. Both cross the generic adapter before their resource providers can
 * retain Electron sender metadata, so keep this exact literal list scoped to
 * the currently registered routes.
 */
const ASSISTANT_RESOURCE_AND_SPEECH_PROVIDER_EVENTS = new Set([
  'assistant-resource.read-rule',
  'assistant-resource.write-rule',
  'assistant-resource.delete-rule',
  'assistant-resource.read-skill',
  'assistant-resource.write-skill',
  'assistant-resource.delete-skill',
  'speech.transcribe',
]);

/**
 * WebUI lifecycle control crosses the generic platform adapter before the
 * provider callback can retain Electron sender identity. Keep the complete
 * current surface literal and exact; no prefix grants future controls trust.
 */
const WEBUI_PROVIDER_EVENTS = new Set(['webui.get-status', 'webui.start', 'webui.stop']);

/**
 * Cron mutates durable scheduled work and associated skill content after the
 * generic platform adapter has discarded Electron sender metadata. Keep this
 * exact literal surface: a prefix would silently grant a future scheduler
 * operation trusted-renderer authority without review.
 */
const CRON_PROVIDER_EVENTS = new Set([
  'cron.list-jobs',
  'cron.list-by-conversation',
  'cron.get-job',
  'cron.add-job',
  'cron.update-job',
  'cron.remove-job',
  'cron.run-now',
  'cron.save-skill',
  'cron.has-skill',
  'cron.delete-skill',
]);

/**
 * Team operations cross the generic platform adapter before the Team runtime
 * can retain Electron sender identity. Keep this exact literal surface: a
 * prefix would silently grant a future Team operation trusted-renderer
 * authority without review.
 */
const TEAM_PROVIDER_EVENTS = new Set([
  'team.create',
  'team.list',
  'team.get',
  'team.remove',
  'team.add-agent',
  'team.remove-agent',
  'team.stop',
  'team.ensure-session',
  'team.rename-agent',
  'team.rename',
  'team.group.save',
  'team.group.remove',
  'team.task.save',
  'team.task.remove',
  'team.task.bind',
  'team.task.unbind',
  'team.set-session-mode',
]);

/**
 * Company workflows can create, mutate, and run multi-agent work after the
 * generic platform adapter has discarded Electron sender metadata. Keep this
 * current surface literal and exact: a prefix would silently grant a future
 * Company operation trusted-renderer authority without review.
 */
const COMPANY_PROVIDER_EVENTS = new Set([
  'company.create-from-description',
  'company.get-structure',
  'company.get-rules',
  'company.set-rules',
  'company.list-agents',
  'company.set-assignment',
  'company.accept-drafts',
  'company.update-structure',
  'company.delete-company',
  'company.run-conversation',
  'company.resolve-permission',
  'company.cancel-conversation',
]);

/**
 * Store and package-platform operations cross the generic platform adapter
 * before package lifecycle callbacks can retain Electron sender identity. Keep
 * this current surface literal and exact: a prefix would silently grant future
 * catalog, artifact, or lifecycle operations trusted-renderer authority.
 */
const PACKAGE_PLATFORM_PROVIDER_EVENTS = new Set([
  'package-platform.refresh',
  'package-platform.list',
  'package-platform.search',
  'package-platform.catalog.federated-search',
  'package-platform.status',
  'package-platform.install',
  'package-platform.uninstall',
  'package-platform.contributions',
  'package-platform.read-asset',
]);

/**
 * Resource lifecycle changes scheduler mode, budgets, and activation state
 * after the generic platform adapter has discarded Electron sender metadata.
 * Keep this current surface literal and exact: a prefix would silently grant a
 * future resource operation trusted-renderer authority without review.
 */
const RESOURCE_PROVIDER_EVENTS = new Set([
  'resource.get-state',
  'resource.set-mode',
  'resource.set-budget',
  'resource.apply-preset',
  'resource.lifecycle-activate',
  'resource.lifecycle-deactivate',
  'resource.lifecycle-get',
]);

/**
 * System information routes expose host state and can change process priority
 * or live collection. They cross the generic adapter before their providers
 * can retain Electron sender identity, so keep this exact literal surface.
 */
const SYSTEM_INFO_PROVIDER_EVENTS = new Set([
  'system-info.get-static',
  'system-info.refresh-static',
  'system-info.get-snapshot',
  'system-info.set-process-priority',
  'system-info.start-stream',
  'system-info.stop-stream',
]);

/**
 * Omni Gateway routes control a local/remote MCP host, bearer and debug tokens,
 * OAuth clients, and durable access policy. They cross the generic adapter
 * before the gateway can retain Electron sender identity, so this surface is
 * strictly literal rather than prefix-based.
 */
const OMNI_GATEWAY_PROVIDER_EVENTS = new Set([
  'omni-gateway.get-status',
  'omni-gateway.apply-config',
  'omni-gateway.rotate-token',
  'omni-gateway.reveal-token',
  'omni-gateway.enable-web-access',
  'omni-gateway.disable-web-access',
  'omni-gateway.create-debug-access',
  'omni-gateway.revoke-debug-access',
  'omni-gateway.get-progress',
  'omni-gateway.set-auth-mode',
  'omni-gateway.set-session-ttl',
  'omni-gateway.set-tool-permission',
  'omni-gateway.list-oauth-clients',
  'omni-gateway.revoke-oauth-client',
  'omni-gateway.set-remote-access',
]);

/**
 * Tomni Agent catalog and management routes cross the platform adapter before
 * the agent catalog store can retain Electron sender identity.
 */
const TOMNI_AGENT_PROVIDER_EVENTS = new Set([
  'tomni-agent.list',
  'tomni-agent.refresh',
  'tomni-agent.test',
  'tomni-agent.create',
  'tomni-agent.update',
  'tomni-agent.remove',
  'tomni-agent.set-enabled',
  'tomni-agent.health',
  'subscribe-tomni-agent.list',
  'subscribe-tomni-agent.refresh',
  'subscribe-tomni-agent.test',
  'subscribe-tomni-agent.create',
  'subscribe-tomni-agent.update',
  'subscribe-tomni-agent.remove',
  'subscribe-tomni-agent.set-enabled',
  'subscribe-tomni-agent.health',
]);

/**
 * Tomni Assistant catalog routes cross the platform adapter before
 * the assistant catalog store can retain Electron sender identity.
 */
const TOMNI_ASSISTANT_PROVIDER_EVENTS = new Set([
  'tomni-assistant.list',
  'tomni-assistant.create',
  'tomni-assistant.update',
  'tomni-assistant.remove',
  'tomni-assistant.set-state',
  'tomni-assistant.import',
  'subscribe-tomni-assistant.list',
  'subscribe-tomni-assistant.create',
  'subscribe-tomni-assistant.update',
  'subscribe-tomni-assistant.remove',
  'subscribe-tomni-assistant.set-state',
  'subscribe-tomni-assistant.import',
]);

const UNTRUSTED_AUTO_UPDATE_SENDER_ERROR = 'Untrusted auto-update IPC sender';
const UNTRUSTED_PERSONAL_CONTEXT_SENDER_ERROR = 'Untrusted personal context IPC sender';
const UNTRUSTED_SHELL_PROVIDER_SENDER_ERROR = 'Untrusted shell IPC sender';
const UNTRUSTED_NATIVE_FILE_SENDER_ERROR = 'Untrusted native file IPC sender';
const UNTRUSTED_NATIVE_CAPABILITY_SENDER_ERROR = 'Untrusted native capability IPC sender';

const UNTRUSTED_ASSISTANT_RESOURCE_AND_SPEECH_SENDER_ERROR = 'Untrusted assistant resource or speech IPC sender';

const UNTRUSTED_WEBUI_SENDER_ERROR = 'Untrusted WebUI IPC sender';

const UNTRUSTED_CRON_SENDER_ERROR = 'Untrusted cron IPC sender';

const UNTRUSTED_TEAM_SENDER_ERROR = 'Untrusted Team IPC sender';

const UNTRUSTED_COMPANY_SENDER_ERROR = 'Untrusted Company IPC sender';

const UNTRUSTED_PACKAGE_PLATFORM_SENDER_ERROR = 'Untrusted package platform IPC sender';

const UNTRUSTED_RESOURCE_PROVIDER_SENDER_ERROR = 'Untrusted resource IPC sender';

const UNTRUSTED_SYSTEM_INFO_PROVIDER_SENDER_ERROR = 'Untrusted system info IPC sender';

const UNTRUSTED_OMNI_GATEWAY_SENDER_ERROR = 'Untrusted Omni Gateway IPC sender';

const UNTRUSTED_TOMNI_AGENT_SENDER_ERROR = 'Untrusted Tomni agent IPC sender';
const UNTRUSTED_TOMNI_ASSISTANT_SENDER_ERROR = 'Untrusted Tomni assistant IPC sender';

const parseBridgeEventData = (info: unknown): BridgeEventData => {
  if (typeof info !== 'string') throw new Error('Invalid bridge IPC payload');
  const parsed: unknown = JSON.parse(info);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid bridge IPC payload');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.name !== 'string') throw new Error('Invalid bridge IPC payload');
  return { name: record.name, data: record.data };
};

/**
 * The platform provider abstraction deliberately receives only request data.
 * Validate the Electron event here, before that abstraction discards sender
 * identity, for the three signed native-updater provider routes.
 */
/**
 * Shared Main-process guard for desktop renderer IPC that needs origin identity
 * before a higher-level provider abstraction receives only its payload.
 */
export const isTrustedDesktopRendererSender = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  try {
    const sender = event.sender;
    if (!sender || sender.isDestroyed()) return false;
    const frame = event.senderFrame;
    const isMain = !frame || frame === sender.mainFrame || frame.parent === null;
    if (!isMain) return false;
    const ownerWindow = BrowserWindow.fromWebContents(sender);
    if (!ownerWindow || ownerWindow.isDestroyed()) return false;

    const rawUrl = (frame ?? sender.mainFrame)?.url || (typeof sender.getURL === 'function' ? sender.getURL() : '');
    if (!rawUrl) return false;
    const senderUrl = new URL(rawUrl);
    if (senderUrl.protocol === 'file:') {
      const actualFile = path.resolve(fileURLToPath(senderUrl));
      const expectedFile = path.resolve(__dirname, '../renderer/index.html');
      return process.platform === 'win32'
        ? actualFile.toLowerCase() === expectedFile.toLowerCase()
        : actualFile === expectedFile;
    }
    if (!app.isPackaged) {
      const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1';
      if (isLocalHost(senderUrl.hostname)) {
        return true;
      }
      const rendererUrl = process.env.ELECTRON_RENDERER_URL;
      if (rendererUrl) {
        const expectedUrl = new URL(rendererUrl);
        if (senderUrl.origin === expectedUrl.origin) return true;
        if (isLocalHost(expectedUrl.hostname) && senderUrl.port === expectedUrl.port) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
};

const adapterWindowList: Array<BrowserWindow> = [];

export { registerWebSocketBroadcaster, getBridgeEmitter };

let petNotifyHook: ((name: string, data: unknown) => void) | null = null;

export const setPetNotifyHook = (hook: ((name: string, data: unknown) => void) | null): void => {
  petNotifyHook = hook;
};

/**
 * @description 建立与每一个browserWindow的通信桥梁
 * */
/** Maximum IPC payload size (50 MB). Messages exceeding this are dropped with an error notification. */
const MAX_IPC_PAYLOAD_SIZE = 50 * 1024 * 1024;

bridge.adapter({
  emit(name, data) {
    // Notify pet (if hook is set)
    if (petNotifyHook) {
      try {
        petNotifyHook(name, data);
      } catch {
        /* never crash */
      }
    }

    // 1. Send to all Electron BrowserWindows (skip destroyed ones)
    let serialized: string;
    try {
      serialized = JSON.stringify({ name, data });
    } catch (error) {
      // RangeError: Invalid string length — data too large to serialize
      console.error('[adapter] Failed to serialize bridge event:', name, error);
      return;
    }

    // Guard: reject oversized payloads to prevent main-process blocking
    if (serialized.length > MAX_IPC_PAYLOAD_SIZE) {
      console.error(
        `[adapter] Bridge event "${name}" too large (${(serialized.length / 1024 / 1024).toFixed(1)}MB), skipped`
      );
      const errorPayload = JSON.stringify({
        name: 'bridge:error',
        data: { originalEvent: name, reason: 'payload_too_large', size: serialized.length },
      });
      for (let i = adapterWindowList.length - 1; i >= 0; i--) {
        const win = adapterWindowList[i];
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(ADAPTER_BRIDGE_EVENT_KEY, errorPayload);
        }
      }
      return;
    }

    for (let i = adapterWindowList.length - 1; i >= 0; i--) {
      const win = adapterWindowList[i];
      if (win.isDestroyed() || win.webContents.isDestroyed()) {
        adapterWindowList.splice(i, 1);
        continue;
      }
      win.webContents.send(ADAPTER_BRIDGE_EVENT_KEY, serialized);
    }
    // 2. Also broadcast to all WebSocket clients
    broadcastToAll(name, data);
  },
  on(emitter) {
    // 保存 emitter 引用供 WebSocket 处理使用 / Save emitter reference for WebSocket handling
    setBridgeEmitter(emitter);

    ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, async (event, info) => {
      const { name, data } = parseBridgeEventData(info);
      if (AUTO_UPDATE_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_AUTO_UPDATE_SENDER_ERROR);
      }
      if (PERSONAL_CONTEXT_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_PERSONAL_CONTEXT_SENDER_ERROR);
      }
      if (SHELL_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_SHELL_PROVIDER_SENDER_ERROR);
      }
      if (NATIVE_FILE_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_NATIVE_FILE_SENDER_ERROR);
      }
      if (NATIVE_CAPABILITY_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_NATIVE_CAPABILITY_SENDER_ERROR);
      }
      if (ASSISTANT_RESOURCE_AND_SPEECH_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_ASSISTANT_RESOURCE_AND_SPEECH_SENDER_ERROR);
      }

      if (WEBUI_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_WEBUI_SENDER_ERROR);
      }
      if (CRON_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_CRON_SENDER_ERROR);
      }
      if (TEAM_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_TEAM_SENDER_ERROR);
      }
      if (COMPANY_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_COMPANY_SENDER_ERROR);
      }
      if (PACKAGE_PLATFORM_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_PACKAGE_PLATFORM_SENDER_ERROR);
      }

      if (RESOURCE_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_RESOURCE_PROVIDER_SENDER_ERROR);
      }
      if (SYSTEM_INFO_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_SYSTEM_INFO_PROVIDER_SENDER_ERROR);
      }
      if (OMNI_GATEWAY_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_OMNI_GATEWAY_SENDER_ERROR);
      }

      if (TOMNI_AGENT_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_TOMNI_AGENT_SENDER_ERROR);
      }
      if (TOMNI_ASSISTANT_PROVIDER_EVENTS.has(name) && !isTrustedDesktopRendererSender(event)) {
        throw new Error(UNTRUSTED_TOMNI_ASSISTANT_SENDER_ERROR);
      }

      return Promise.resolve(emitter.emit(name, data));
    });
  },
});

export const initMainAdapterWithWindow = (win: BrowserWindow) => {
  adapterWindowList.push(win);
  const off = () => {
    const index = adapterWindowList.indexOf(win);
    if (index > -1) adapterWindowList.splice(index, 1);
  };
  win.on('closed', off);
  return off;
};
