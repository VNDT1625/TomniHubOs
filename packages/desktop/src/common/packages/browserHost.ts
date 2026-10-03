/**
 * Renderer-safe Browser package host ABI. Core owns only these JSON-safe IPC
 * shapes; Browser implementation remains package-owned.
 */

export const BROWSER_HOST_CHANNELS = {
  openTab: 'browser.open-tab',
  navigate: 'browser.navigate',
  goBack: 'browser.go-back',
  goForward: 'browser.go-forward',
  reload: 'browser.reload',
  setBounds: 'browser.set-bounds',
  setZoom: 'browser.set-zoom',
  show: 'browser.show',
  setVisible: 'browser.set-visible',
  hide: 'browser.hide',
  hideAll: 'browser.hide-all',
  listTabs: 'browser.list-tabs',
  destroyTab: 'browser.destroy-tab',
  getAgentMode: 'browser.get-agent-mode',
  setAgentMode: 'browser.set-agent-mode',
  runAgent: 'browser.run-agent',
  cancelAgent: 'browser.cancel-agent',
  agentEvent: 'browser.agent-event',
  tabUpdated: 'browser.tab-updated',
  getPersona: 'browser.get-persona',
  setPersona: 'browser.set-persona',
  getDefaultBrowserStatus: 'browser.get-default-browser-status',
  setAsDefaultBrowser: 'browser.set-as-default-browser',
} as const;

export type BrowserTabId = string;

export type TabBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserTabInfo = {
  id: BrowserTabId;
  url: string;
  title: string;
  visible: boolean;
  background?: boolean;
  bounds: TabBounds;
};

export type TabUpdate = {
  id: BrowserTabId;
  url: string;
  title: string;
};

export type OpenTabRequest = {
  id?: BrowserTabId;
  url?: string;
  bounds?: TabBounds;
  visible?: boolean;
  partition?: string;
  background?: boolean;
};

export type OpenTabResult = { id: BrowserTabId };
export type BrowserTabIdRequest = { id: BrowserTabId };
export type NavigateRequest = { id: BrowserTabId; url: string };
export type SetBoundsRequest = { id: BrowserTabId; bounds: TabBounds };
export type SetZoomRequest = { id: BrowserTabId; factor: number };
export type SetVisibleRequest = { id: BrowserTabId; visible: boolean };
export type SetAgentModeRequest = { id: BrowserTabId; enabled: boolean };
export type AgentModeState = { id: BrowserTabId; enabled: boolean };

export type AgentHistoryMessage = { role: 'user' | 'assistant'; content: string };

export type RunAgentBridgeRequest = {
  id: BrowserTabId;
  model: string;
  instruction: string;
  history?: AgentHistoryMessage[];
  interactive?: boolean;
};

export type RunAgentBridgeResult = {
  answer: string;
  status: 'done' | 'stopped' | 'error' | 'max-steps';
  steps: number;
};

export type AgentEvent =
  | { type: 'action'; tabId: BrowserTabId; tool: string; summary: string; detail?: string }
  | { type: 'observation'; tabId: BrowserTabId; tool: string; ok: boolean; summary: string }
  | { type: 'final'; tabId: BrowserTabId; text: string }
  | { type: 'error'; tabId: BrowserTabId; message: string }
  | { type: 'stopped'; tabId: BrowserTabId };

/** Boxed to keep the bridge emitter generic non-distributive. */
export type AgentEventEnvelope = { event: AgentEvent };

export type DefaultBrowserStatus = {
  supported: boolean;
  isDefault: boolean;
  platform: string;
};
