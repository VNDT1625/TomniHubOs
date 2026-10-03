/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wires the agent-facing Browser-Control MCP server (Requirement 1 — Agent
 * plane) for the Main process. It assembles the {@link BrowserControlDeps} the
 * server needs from the real browser services and starts the in-process SSE
 * host, then registers it in the MCP catalog as an `sse` server so an agent
 * (Claude Code / ACP, tomnyagentic, …) can connect and drive the live embedded
 * browser.
 *
 * ## Shared browser, two planes
 *
 * Per the design's "two planes" principle the Agent plane MUST drive the **same**
 * {@link IBrowserViewManager} as the UI plane (`browserBridge.getBrowserServices`).
 * We therefore reuse that singleton so a tab the agent opens is the same tab the
 * user can see (and that the in-conversation surfaces panel renders).
 *
 * ## Media pipeline
 *
 * `browser_summarize_video` needs an {@link IMediaPipeline}. The real pipeline
 * depends on heavy workers (ffmpeg / Whisper / TTS) that are not yet bundled, so
 * we inject a minimal stub that performs the **YouTube-or-fail** behaviour
 * honestly: the one tool that needs it degrades to a clear "not available yet"
 * message instead of crashing the whole server. Every other tool
 * (open/read/click/type/scroll/wait/screenshot) is fully real.
 *
 * Process boundary: Main-process (Node.js / Electron) module.
 */

import type { BrowserWindow } from 'electron';
import { NativeFileGateway } from '@process/resources/nativeFileGateway';
import { getResourceCoordinator } from '@process/resource/resourceCoordinator';
import { getBrowserServices } from './browserBridge';
import { createHumanLikeInput } from './humanLikeInput';
import { createPagePerception, getBrowserSecretRedactionRegistry, type IPagePerception } from './pagePerception';
import type { IMediaPipeline, MediaSource } from './mediaPipeline';
import type { BrowserControlDeps } from './browserControlServer';
import { startBrowserControlMcpHost, type BrowserControlMcpHost } from './browserControlMcpHost';
import { getEditorFrameStore } from '@process/editor/editorFrameStore';
import {
  createQuickTestLifecycleService,
  type QuickTestLifecycleService,
} from '@process/services/quick-test/lifecycle';

import { getRepoSecretStore } from '@package-apps/ide/process/data/memory/repoSecretStore';
import type { SecretVault } from '@process/agentRuntime/secretVault';

type BrowserViewManager = ReturnType<typeof getBrowserServices>['viewManager'];
let personalSecretVault: SecretVault | undefined;

/** Browser-Control editor writes require a governed path capability and receipt. */
export const BROWSER_CONTROL_EDITOR_WRITE_GOVERNANCE_REQUIRED =
  'Browser-Control editor writing is disabled pending governed execution.';

/** Bind the Core vault without changing the independent IDE Secret Context store. */
export const configureBrowserPersonalSecretVault = (vault: SecretVault): void => {
  personalSecretVault = vault;
};

const SECRET_FILL_WORLD_ID = 1001;
type BrowserPageContents = NonNullable<ReturnType<BrowserViewManager['getWebContents']>>;

const getExactHostname = (contents: BrowserPageContents): string | undefined => {
  try {
    return new URL(contents.getURL()).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
};

/** Inject a resolved value only when the isolated renderer world still has the expected hostname. */
export const fillResolvedBrowserSecret = async (
  request: {
    viewManager: BrowserViewManager;
    tabId: string;
    selector: string;
    expectedTarget: string;
    name: string;
    reference?: string;
  },
  value: string,
  failureMessage = 'Could not fill the selected browser form control with the protected value.'
): Promise<void> => {
  const contents = request.viewManager.getWebContents(request.tabId);
  if (!contents) throw new Error('The selected browser tab is no longer available.');
  const expectedTarget = request.expectedTarget.trim().toLowerCase();
  if (!expectedTarget) throw new Error(failureMessage);
  const redactionRegistry = getBrowserSecretRedactionRegistry();
  redactionRegistry.registerSelector({
    tabId: request.tabId,
    hostname: expectedTarget,
    selector: request.selector,
    name: request.name,
    ...(request.reference ? { reference: request.reference } : {}),
  });
  redactionRegistry.enableSensitiveMode({ tabId: request.tabId, hostname: expectedTarget });

  // The hostname guard, DOM lookup, and value assignment execute atomically in
  // one isolated world. A navigation between Main-process checks and this call
  // therefore fails before the secret variable or page DOM is touched.
  const script = `(() => {
    try {
      const expectedTarget = ${JSON.stringify(expectedTarget)};
      if (location.hostname.toLowerCase() !== expectedTarget) return false;
      const element = document.querySelector(${JSON.stringify(request.selector)});
      if (!element) return false;
      const value = ${JSON.stringify(value)};
      if (element instanceof HTMLInputElement) {
        if (element.type === 'file' || element.disabled || element.readOnly) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) return false;
        element.focus();
        setter.call(element, value);
      } else if (element instanceof HTMLTextAreaElement) {
        if (element.disabled || element.readOnly) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) return false;
        element.focus();
        setter.call(element, value);
      } else if (element instanceof HTMLElement && element.isContentEditable) {
        element.focus();
        element.textContent = value;
      } else {
        return false;
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  })()`;
  let filled = false;
  try {
    filled = (await contents.executeJavaScriptInIsolatedWorld(SECRET_FILL_WORLD_ID, [{ code: script }])) === true;
  } catch {
    filled = false;
  }
  if (!filled) throw new Error(failureMessage);
};

/** Preserve the IDE repository Secret Context behavior with a navigation-race guard. */
const fillBrowserSecret = async (
  viewManager: BrowserViewManager,
  request: { tabId: string; selector: string; repository: string; secretAlias: string }
): Promise<void> => {
  const contents = viewManager.getWebContents(request.tabId);
  if (!contents) throw new Error('The selected browser tab is no longer available.');
  const expectedTarget = getExactHostname(contents);
  if (!expectedTarget) throw new Error('The selected browser tab has no valid target.');

  const values = await getRepoSecretStore().resolveEnvironment(request.repository, [request.secretAlias]);
  const secret = values[request.secretAlias.trim().toUpperCase()];
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(`Secret Context alias ${request.secretAlias.trim().toUpperCase()} has no stored value.`);
  }
  await fillResolvedBrowserSecret(
    { viewManager, ...request, expectedTarget, name: request.secretAlias.trim().toUpperCase() },
    secret,
    'Could not fill the selected browser form control with the Secret Context alias.'
  );
};

/** Resolve one Core Personal Secret field and inject it directly into the page. */
const fillBrowserPersonalSecret = async (
  viewManager: BrowserViewManager,
  request: { tabId: string; selector: string; handle: string; field: string; expectedTarget?: string }
): Promise<void> => {
  if (!personalSecretVault) throw new Error('Core Personal Secret vault is unavailable.');
  const contents = viewManager.getWebContents(request.tabId);
  if (!contents) throw new Error('The selected browser tab is no longer available.');
  const currentTarget = getExactHostname(contents);
  const expectedTarget = request.expectedTarget?.trim().toLowerCase() || currentTarget;
  if (!currentTarget || !expectedTarget || currentTarget !== expectedTarget) {
    throw new Error('The selected browser target does not match the Secret Context request.');
  }

  const values = await personalSecretVault.resolve({
    handle: request.handle,
    surface: 'browser',
    purpose: 'browser-fill',
    target: expectedTarget,
    fields: [request.field],
  });
  const secret = values[request.field];
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('Personal Secret variable is unavailable.');
  await fillResolvedBrowserSecret(
    { viewManager, ...request, expectedTarget, name: request.field, reference: request.handle },
    secret,
    'Could not fill the selected browser form control with the Personal Secret variable.'
  );
};

/**
 * Minimal {@link IMediaPipeline} for the Agent plane. Video summarisation needs
 * heavy workers that are not bundled yet, so every method rejects with a clear,
 * honest message rather than pretending to work. `browser_summarize_video`
 * surfaces this as a tool error; no other Browser-Control tool touches it.
 */
const createStubMediaPipeline = (): IMediaPipeline => {
  const notAvailable = (what: string): Promise<never> =>
    Promise.reject(new Error(`${what} is not available yet (media workers are not bundled).`));
  return {
    summarizeVideo: (source: MediaSource) =>
      notAvailable(`Summarising ${source.type === 'url' ? source.url : source.path}`),
    transcribe: () => notAvailable('Transcription'),
    generateSubtitles: () => notAvailable('Subtitle generation'),
    dub: () => notAvailable('Dubbing'),
    getJob: () => undefined,
    listJobs: () => [],
  };
};

/** Lazily-built deps so the host + register step share one assembly. */
let cachedDeps: BrowserControlDeps | undefined;
let quickTestLifecycle: QuickTestLifecycleService | undefined;

/** Drop Browser-owned MCP collaborators when the package is disabled or removed. */
export const disposeBrowserControl = (): void => {
  cachedDeps = undefined;
  quickTestLifecycle = undefined;
  personalSecretVault = undefined;
};

/** Resolve Browser Quick Test through the Core lifecycle launcher. */
export const getQuickTestLifecycle = (getWindow: () => BrowserWindow | null | undefined): QuickTestLifecycleService => {
  if (quickTestLifecycle) return quickTestLifecycle;
  const browser = getBrowserServices(getWindow).viewManager;
  quickTestLifecycle = createQuickTestLifecycleService({
    viewManager: browser,
  });
  return quickTestLifecycle;
};

/**
 * Build (once) the {@link BrowserControlDeps} from the shared browser services.
 *
 * @param getWindow Main-window accessor (shared with the UI-plane browser bridge).
 */
export const getBrowserControlDeps = (getWindow: () => BrowserWindow | null | undefined): BrowserControlDeps => {
  if (cachedDeps) return cachedDeps;

  const coordinator = getResourceCoordinator();
  // Reuse the UI-plane browser services so both planes share ONE view manager.
  const services = getBrowserServices(getWindow);
  const viewManager = services.viewManager;
  const mediaPipeline = createStubMediaPipeline();

  const pagePerception: IPagePerception = createPagePerception({
    getWebContents: (id) => viewManager.getWebContents(id),
    mediaPipeline,
    coordinator,
  });

  cachedDeps = {
    viewManager,
    createInput: (sink) => createHumanLikeInput({ sink }),
    pagePerception,
    mediaPipeline,
    coordinator,
    fillSecret: (request) => fillBrowserSecret(viewManager, request),
    fillPersonalSecret: (request) => fillBrowserPersonalSecret(viewManager, request),
    quickTest: getQuickTestLifecycle(getWindow),
    // Editor capability (Super's Studio-editor plane): share ONE frame store
    // with the renderer bridge so a file the agent opens shows up as a frame.
    editorFrames: getEditorFrameStore(),
    editorIO: {
      read: async (filePath: string): Promise<string> => (await new NativeFileGateway().readText(filePath)) ?? '',
      write: async (): Promise<void> => Promise.reject(new Error(BROWSER_CONTROL_EDITOR_WRITE_GOVERNANCE_REQUIRED)),
    },
  };
  return cachedDeps;
};

/**
 * Start the in-process Browser-Control MCP host bound to the shared browser
 * services.
 *
 * @param getWindow Main-window accessor (shared with the UI-plane browser bridge).
 * @returns The running host (url + port + close).
 */
export const startBrowserControl = (
  getWindow: () => BrowserWindow | null | undefined
): Promise<BrowserControlMcpHost> => startBrowserControlMcpHost(getBrowserControlDeps(getWindow));
