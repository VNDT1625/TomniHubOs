/**
 * Renderer-safe Browser host client. This published SDK crosses only the
 * fixed Browser host ABI; it contains no Browser route, UI, or runtime code.
 */

import { bridge } from '@office-ai/platform';
import {
  BROWSER_HOST_CHANNELS,
  type AgentEvent,
  type AgentEventEnvelope,
  type AgentModeState,
  type BrowserTabIdRequest,
  type BrowserTabInfo,
  type DefaultBrowserStatus,
  type NavigateRequest,
  type OpenTabRequest,
  type OpenTabResult,
  type RunAgentBridgeRequest,
  type RunAgentBridgeResult,
  type SetAgentModeRequest,
  type SetBoundsRequest,
  type SetVisibleRequest,
  type SetZoomRequest,
  type TabUpdate,
} from './browserHost';

export const BROWSER_HOST_TIMEOUT_MS = 4_000;
export const BROWSER_HOST_BOUNDS_TIMEOUT_MS = 1_500;

const channels = {
  openTab: bridge.buildProvider<OpenTabResult, OpenTabRequest>(BROWSER_HOST_CHANNELS.openTab),
  navigate: bridge.buildProvider<void, NavigateRequest>(BROWSER_HOST_CHANNELS.navigate),
  goBack: bridge.buildProvider<{ navigated: boolean }, BrowserTabIdRequest>(BROWSER_HOST_CHANNELS.goBack),
  goForward: bridge.buildProvider<{ navigated: boolean }, BrowserTabIdRequest>(BROWSER_HOST_CHANNELS.goForward),
  reload: bridge.buildProvider<void, BrowserTabIdRequest>(BROWSER_HOST_CHANNELS.reload),
  setBounds: bridge.buildProvider<void, SetBoundsRequest>(BROWSER_HOST_CHANNELS.setBounds),
  setZoom: bridge.buildProvider<void, SetZoomRequest>(BROWSER_HOST_CHANNELS.setZoom),
  show: bridge.buildProvider<void, BrowserTabIdRequest>(BROWSER_HOST_CHANNELS.show),
  setVisible: bridge.buildProvider<void, SetVisibleRequest>(BROWSER_HOST_CHANNELS.setVisible),
  hide: bridge.buildProvider<void, BrowserTabIdRequest>(BROWSER_HOST_CHANNELS.hide),
  hideAll: bridge.buildProvider<void, void>(BROWSER_HOST_CHANNELS.hideAll),
  listTabs: bridge.buildProvider<BrowserTabInfo[], void>(BROWSER_HOST_CHANNELS.listTabs),
  destroyTab: bridge.buildProvider<void, BrowserTabIdRequest>(BROWSER_HOST_CHANNELS.destroyTab),
  getAgentMode: bridge.buildProvider<AgentModeState, BrowserTabIdRequest>(BROWSER_HOST_CHANNELS.getAgentMode),
  setAgentMode: bridge.buildProvider<AgentModeState, SetAgentModeRequest>(BROWSER_HOST_CHANNELS.setAgentMode),
  runAgent: bridge.buildProvider<RunAgentBridgeResult, RunAgentBridgeRequest>(BROWSER_HOST_CHANNELS.runAgent),
  cancelAgent: bridge.buildProvider<void, BrowserTabIdRequest>(BROWSER_HOST_CHANNELS.cancelAgent),
  agentEvent: bridge.buildEmitter<AgentEventEnvelope>(BROWSER_HOST_CHANNELS.agentEvent),
  tabUpdated: bridge.buildEmitter<TabUpdate>(BROWSER_HOST_CHANNELS.tabUpdated),
  getPersona: bridge.buildProvider<string, void>(BROWSER_HOST_CHANNELS.getPersona),
  setPersona: bridge.buildProvider<void, { persona: string }>(BROWSER_HOST_CHANNELS.setPersona),
  getDefaultBrowserStatus: bridge.buildProvider<DefaultBrowserStatus, void>(
    BROWSER_HOST_CHANNELS.getDefaultBrowserStatus
  ),
  setAsDefaultBrowser: bridge.buildProvider<DefaultBrowserStatus, void>(BROWSER_HOST_CHANNELS.setAsDefaultBrowser),
};

export class BrowserHostTimeoutError extends Error {
  constructor(channel: string) {
    super(`[BrowserHostClient] No reply on "${channel}".`);
    this.name = 'BrowserHostTimeoutError';
  }
}

const invokeWithTimeout = <T>(channel: string, call: () => Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new BrowserHostTimeoutError(channel));
    }, timeoutMs);
    call().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });

/** Fixed, timeout-guarded renderer access to an admitted Browser package host. */
export const browserHostClient = {
  openTab: (request: OpenTabRequest = {}): Promise<OpenTabResult> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.openTab, () => channels.openTab.invoke(request), BROWSER_HOST_TIMEOUT_MS),
  navigate: (request: NavigateRequest): Promise<void> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.navigate, () => channels.navigate.invoke(request), BROWSER_HOST_TIMEOUT_MS),
  goBack: (request: BrowserTabIdRequest): Promise<{ navigated: boolean }> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.goBack, () => channels.goBack.invoke(request), BROWSER_HOST_TIMEOUT_MS),
  goForward: (request: BrowserTabIdRequest): Promise<{ navigated: boolean }> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.goForward,
      () => channels.goForward.invoke(request),
      BROWSER_HOST_TIMEOUT_MS
    ),
  reload: (request: BrowserTabIdRequest): Promise<void> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.reload, () => channels.reload.invoke(request), BROWSER_HOST_TIMEOUT_MS),
  setBounds: (request: SetBoundsRequest): Promise<void> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.setBounds,
      () => channels.setBounds.invoke(request),
      BROWSER_HOST_BOUNDS_TIMEOUT_MS
    ),
  setZoom: (request: SetZoomRequest): Promise<void> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.setZoom, () => channels.setZoom.invoke(request), BROWSER_HOST_TIMEOUT_MS),
  show: (request: BrowserTabIdRequest): Promise<void> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.show, () => channels.show.invoke(request), BROWSER_HOST_TIMEOUT_MS),
  setVisible: (request: SetVisibleRequest): Promise<void> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.setVisible,
      () => channels.setVisible.invoke(request),
      BROWSER_HOST_TIMEOUT_MS
    ),
  hide: (request: BrowserTabIdRequest): Promise<void> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.hide, () => channels.hide.invoke(request), BROWSER_HOST_TIMEOUT_MS),
  hideAll: (): Promise<void> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.hideAll, () => channels.hideAll.invoke(), BROWSER_HOST_TIMEOUT_MS),
  listTabs: (): Promise<BrowserTabInfo[]> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.listTabs, () => channels.listTabs.invoke(), BROWSER_HOST_TIMEOUT_MS),
  destroyTab: (request: BrowserTabIdRequest): Promise<void> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.destroyTab,
      () => channels.destroyTab.invoke(request),
      BROWSER_HOST_TIMEOUT_MS
    ),
  getAgentMode: (request: BrowserTabIdRequest): Promise<AgentModeState> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.getAgentMode,
      () => channels.getAgentMode.invoke(request),
      BROWSER_HOST_TIMEOUT_MS
    ),
  setAgentMode: (request: SetAgentModeRequest): Promise<AgentModeState> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.setAgentMode,
      () => channels.setAgentMode.invoke(request),
      BROWSER_HOST_TIMEOUT_MS
    ),
  runAgent: (request: RunAgentBridgeRequest): Promise<RunAgentBridgeResult> => channels.runAgent.invoke(request),
  cancelAgent: (request: BrowserTabIdRequest): Promise<void> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.cancelAgent,
      () => channels.cancelAgent.invoke(request),
      BROWSER_HOST_TIMEOUT_MS
    ),
  onAgentEvent: (listener: (event: AgentEvent) => void): (() => void) =>
    channels.agentEvent.on((envelope) => listener(envelope.event)),
  onTabUpdated: (listener: (update: TabUpdate) => void): (() => void) => channels.tabUpdated.on(listener),
  getPersona: (): Promise<string> =>
    invokeWithTimeout(BROWSER_HOST_CHANNELS.getPersona, () => channels.getPersona.invoke(), BROWSER_HOST_TIMEOUT_MS),
  setPersona: (persona: string): Promise<void> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.setPersona,
      () => channels.setPersona.invoke({ persona }),
      BROWSER_HOST_TIMEOUT_MS
    ),
  getDefaultBrowserStatus: (): Promise<DefaultBrowserStatus> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.getDefaultBrowserStatus,
      () => channels.getDefaultBrowserStatus.invoke(),
      BROWSER_HOST_TIMEOUT_MS
    ),
  setAsDefaultBrowser: (): Promise<DefaultBrowserStatus> =>
    invokeWithTimeout(
      BROWSER_HOST_CHANNELS.setAsDefaultBrowser,
      () => channels.setAsDefaultBrowser.invoke(),
      BROWSER_HOST_TIMEOUT_MS
    ),
};

export type { AgentEvent, BrowserTabInfo, DefaultBrowserStatus, RunAgentBridgeResult, TabUpdate };
