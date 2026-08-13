/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { initApplicationBridge } from './applicationBridge';
import { initDialogBridge } from './dialogBridge';
import { initUpdateBridge } from './updateBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initWindowControlsBridge } from './windowControlsBridge';
import { initNotificationBridge } from './notificationBridge';
import { initOmniGatewayBridge } from '@process/omni-gateway/omniGatewayIpc';
import { initWebuiBridge } from './webuiBridge';
import { registerFoundationBridge } from './foundationBridge';
import { registerResourceBridge } from '@process/resource/resourceBridge';
import { getResourceCoordinator } from '@process/resource/resourceCoordinator';
import { registerSystemInfoBridge } from '@process/system/systemInfoBridge';
import { getSystemInfoService } from '@process/system/systemInfoService';
import { registerCompanyBridge } from '@process/company/companyBridge';
import { registerRealtimeKnowledgeBridge } from '@process/knowledge/realtimeKnowledgeBridge';
import { registerCommandDocBridge } from '@process/terminal/commandDoc/commandDocBridge';
import { registerSmartFixBridge } from '@process/terminal/smartFix/smartFixBridge';
import { createCompanyGenerator } from '@process/company/companyGenerator';
import { registerBrowserBridge, getBrowserServices } from '@process/browser/browserBridge';
import { registerEditorControlBridge } from '@process/editor/editorControlBridge';
import { registerTestingBridge } from '@process/testing/testingBridge';
import { getTestingServices } from '@process/testing/testingWiring';
import { createScenarioGenerator } from '@process/testing/scenarioGenerator';
import { createAppDetector } from '@process/testing/appDetector';
import { registerMonitorBridge } from '@process/monitor/monitorBridge';
import { getMonitorServices } from '@process/monitor/monitorWiring';
import { registerStudioChatBridge } from '@process/studio/studioChatBridge';
import { registerStudioFsBridge } from '@process/studio/studioFsBridge';
import { registerStudioDocxBridge } from '@process/studio/studioDocxBridge';
import { registerStudioOfficeBridge } from '@process/studio/studioOfficeBridge';
import { registerOnlyOfficeBridge } from '@process/studio/onlyOfficeBridge';
import { registerWorkspaceBridge } from '@process/workspace/workspaceBridge';
import {
  activateProductionWindowsCreatorSandbox,
  disposeProductionCreatorPreviewBridge,
  registerCreatorPreviewBridge,
  registerProductionCreatorPreviewBridge,
} from '@process/workspace/creatorPreviewBridge';
import type { WindowsCreatorSandboxProductionConfiguration } from '@process/extensions/windowsSandboxActivation';
import { registerManagerBridge } from '@process/manager/managerBridge';
import { getManagerServices } from '@process/manager/managerWiring';
import { registerNewsBridge } from '@process/news/newsBridge';
import { getNewsServices } from '@process/news/newsWiring';
import { registerBotBridge } from '@process/news/bots/botBridge';
import { registerAutomationBridge } from '@process/automation/automationBridge';
import { registerAutomationChatBridge } from '@process/automation/automationChatBridge';
import { registerCredentialBridge } from '@process/automation/credentialBridge';
import { registerMakeVideoBridge } from '@process/makevideo/makeVideoBridge';
import { registerMusicBridge } from '@process/music/musicBridge';
import { registerTerminalBridge } from '@process/terminal/terminalBridge';
import { getTerminalServices } from '@process/terminal/terminalWiring';
import { registerMtuiBridge } from '@process/terminal/mtuiBridge';
import { registerMtuiPolicyBridge } from '@process/terminal/mtuiPolicyBridge';
import { registerGitManagerBridge } from '@process/git/gitManagerBridge';
import { registerExperienceBridge } from '@process/experience/experienceBridge';
import { getGitManagerServices } from '@process/git/gitManagerWiring';
import { registerRouter9Bridge } from '@process/router9/router9Bridge';
import { registerPricingBridge } from '@process/pricing/pricingBridge';
import { registerProviderBridge } from '@process/services/tomnyProviderBridge';
import { registerMcpRegistryBridge } from '@process/resources/mcpRegistry';
import { registerFileGatewayBridge } from '@process/resources/nativeFileGatewayBridge';
import { registerAssistantResourceBridge } from '@process/resources/nativeAssistantResourceBridge';
import { registerSpeechTranscriptionBridge } from '@process/services/contentExtract/speechTranscription';

import { registerAgentCatalogBridge } from '@process/resources/agentCatalogBridge';

import {
  registerNativeCapabilityBridge,
  registerNativeFileOperationBridge,
  registerNativePreviewHistoryBridge,
  registerNativeSnapshotBridge,
} from '@process/resources/nativePlatform';

import { registerExperimentalCoreBridge } from '@process/experimentalCore/experimentalCoreBridge';
import { registerAgentMeshBridge } from '@process/agentRuntime/agentMesh/ipc';
import { getSharedAgentMeshService } from '@process/agentRuntime/agentMesh/mcp/meshService';
import { registerPackageManagerBridge } from '@process/extensions/package-manager';

import { JsonTeamStore, registerTeamBridge } from '@process/team';
import path from 'node:path';
import { app, ipcMain } from 'electron';
import { getApplicationMainWindow } from './applicationBridge';

export type BridgeDependencies = {
  /** Omit until release signing and the live revocation authority are available. */
  windowsCreatorSandbox?: WindowsCreatorSandboxProductionConfiguration;
};

export function initAllBridges(deps: BridgeDependencies = {}): void {
  registerPackageManagerBridge();
  console.log('[Bridge] Package platform bridge registered.');

  initDialogBridge();
  initApplicationBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initOmniGatewayBridge();
  initWebuiBridge();
  try {
    registerMcpRegistryBridge();
    console.log('[Bridge] MCP registry bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register MCP registry bridge:', error);
  }

  try {
    registerFileGatewayBridge();
    console.log('[Bridge] Native file gateway registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register native file gateway:', error);
  }

  try {
    registerAssistantResourceBridge();
    registerSpeechTranscriptionBridge();
    console.log('[Bridge] Assistant resource bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register assistant resource bridge:', error);
  }

  try {
    registerAgentCatalogBridge();
    console.log('[Bridge] Tomny assistant and agent catalogs registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Tomny assistant and agent catalogs:', error);
  }

  try {
    registerNativeFileOperationBridge();
    registerNativeSnapshotBridge();
    registerNativePreviewHistoryBridge();
    registerNativeCapabilityBridge();
    console.log('[Bridge] Native filesystem, snapshot, MCP and skill drivers registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register native platform drivers:', error);
  }

  try {
    registerResourceBridge();
    getResourceCoordinator()
      .init()
      .catch((error) => console.error('[Bridge] ResourceCoordinator init failed:', error));
    console.log('[Bridge] Resource bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Resource bridge:', error);
  }

  try {
    // System Insight (Settings › Quan sát). Native main-process observability
    // service: probes the static host profile once at startup and samples live
    // metrics (CPU/RAM/per-process/...) on an adaptive timer. The renderer page
    // reads the profile + subscribes to the live push; the agent reads the
    // periodically-persisted snapshot via the System MCP server. `start()` is
    // awaited-but-detached so a slow probe never blocks the rest of bootstrap.
    registerSystemInfoBridge();
    getSystemInfoService()
      .start()
      .catch((error) => console.error('[Bridge] SystemInfo service start failed:', error));
    console.log('[Bridge] System Insight bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register System Insight bridge:', error);
  }

  try {
    // Inject a role-chart generator backed by the user's configured provider/
    // model so "Dựng công ty" works end-to-end. The generator resolves the
    // model lazily on each call (so changing it in Settings takes effect), and
    // throws a clear error when no model is configured.
    registerCompanyBridge({ generate: createCompanyGenerator() });
    console.log('[Bridge] Company bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Company bridge:', error);
  }

  try {
    // Realtime Knowledge inspector plane. Exposes the time-sensitive fact store
    // (list / lookup / refresh / relate) to the Settings → Realtime Knowledge
    // page. The service is resolved lazily per call, so registering before a
    // model/window exists is safe.
    registerRealtimeKnowledgeBridge();
    console.log('[Bridge] Realtime Knowledge bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Realtime Knowledge bridge:', error);
  }

  try {
    // docTerminal — learned-command suggestions for the in-app terminal. Tiny
    // surface (snapshot once + fire-and-forget capture); the renderer computes
    // ghost-text locally so typing never round-trips through IPC.
    registerCommandDocBridge();
    console.log('[Bridge] docTerminal bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register docTerminal bridge:', error);
  }

  try {
    // Smart Fix — resolve deprecated commands to their replacement (seed + RTK).
    // Consulted only when a command fails, so a single round-trip is fine.
    registerSmartFixBridge();
    console.log('[Bridge] Smart Fix bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Smart Fix bridge:', error);
  }

  try {
    // Embedded-browser UI plane (Requirement 1). The view manager attaches its
    // WebContentsView tabs to the main window, but `getWindow` is read lazily
    // (only when a tab is actually created), so registering here — before the
    // window may exist — is safe. Without this call the renderer Browser page's
    // probe times out and shows the "bridgeUnavailable" notice.
    registerBrowserBridge({ getWindow: getApplicationMainWindow });
    console.log('[Bridge] Browser bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Browser bridge:', error);
  }

  try {
    // Editor capability for Super (Studio-editor plane). Exposes the open editor
    // frames the agent created via `editor_*` MCP tools so the in-chat watch
    // grid can render a live UniversalEditor per frame. Pure metadata store, no
    // window needed — safe to register early.
    registerEditorControlBridge();
    console.log('[Bridge] Editor-control bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Editor-control bridge:', error);
  }

  try {
    // Multi-platform testing UI plane (Requirement 2b). Builds the shared
    // orchestrator both planes drive (the Testing page here + the Testing MCP
    // server for agents) and registers the list/report/run channels. The
    // embedded test tabs are created lazily (only when a web session runs), so
    // registering before the window exists is safe; without this call the
    // Testing page's probe times out and shows the "unavailable" notice.
    const testing = getTestingServices(getApplicationMainWindow);
    registerTestingBridge({
      orchestrator: testing.orchestrator,
      scenarioGenerator: createScenarioGenerator(),
      appDetector: createAppDetector(),
    });
    console.log('[Bridge] Testing bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Testing bridge:', error);
  }

  try {
    // Bug monitor UI plane (Requirement 6). Surfaces the auto-collected bug
    // reports + the patch approval gate. The background error sources (Sentry)
    // are wired by the bug monitor itself; here we register the bridge + start
    // collecting so the renderer Monitor page can list reports.
    const monitor = getMonitorServices();
    registerMonitorBridge({ services: monitor });
    monitor.bugMonitor.start();
    console.log('[Bridge] Monitor bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Monitor bridge:', error);
  }

  try {
    // Studio document-assistant chat (Yêu cầu 2a). Powers the AI side-panel in
    // the Studio editor with a single provider-backed completion. The renderer
    // cannot call providers directly (CORS), so this Main-process handler does.
    registerStudioChatBridge();
    console.log('[Bridge] Studio chat bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Studio chat bridge:', error);
  }

  try {
    // Studio binary-safe file write (Yêu cầu 2a). The tomnycore /api/fs/write
    // persists data as literal text (no base64 decode), so saving an edited
    // binary file (e.g. a .docx ZIP) needs this Node-side raw-bytes writer.
    registerStudioFsBridge();
    console.log('[Bridge] Studio fs bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Studio fs bridge:', error);
  }

  try {
    // Studio Word (.docx) read/write (Yêu cầu 2a). Done in Main with Node
    // `mammoth`/`docx` reading the file straight by path — avoids the fragile
    // renderer base64 + mammoth.browser path that failed on real documents.
    registerStudioDocxBridge();
    console.log('[Bridge] Studio docx bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Studio docx bridge:', error);
  }

  try {
    // Studio Office (.xlsx / .pptx) read/write (Yêu cầu 2a). Same rationale as
    // the docx bridge: binary ZIP formats are read/written in Main by path.
    registerStudioOfficeBridge();
    console.log('[Bridge] Studio office bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Studio office bridge:', error);
  }

  try {
    // ONLYOFFICE full-editing integration host (Yêu cầu 2a). Only starts a local
    // HTTP host when the user opens a doc for editing; idles down afterwards.
    registerOnlyOfficeBridge();
    console.log('[Bridge] ONLYOFFICE bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register ONLYOFFICE bridge:', error);
  }

  try {
    // Workspace orchestrator (parallel sub-agents, each on its own live
    // surface). Browser surfaces attach WebContentsView tabs to the main
    // window; `getWindow` is read lazily (only when a surface tab is created),
    // so registering before the window exists is safe. Without this call the
    // renderer Workspace page's run probe times out and shows a friendly notice.
    registerWorkspaceBridge({ getWindow: getApplicationMainWindow });
    console.log('[Bridge] Workspace bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Workspace bridge:', error);
  }

  try {
    // Keep the legacy generic adapter fail-closed because it discards Electron
    // sender metadata. The native route below preserves the main-frame sender,
    // enforces main-owned project claims and still rejects opens until a trusted
    // OS sandbox driver is explicitly registered.
    registerCreatorPreviewBridge();
    registerProductionCreatorPreviewBridge({
      coordinator: getResourceCoordinator(),
      ipcMain,
      getMainWindow: getApplicationMainWindow,
    });
    if (deps.windowsCreatorSandbox) {
      void activateProductionWindowsCreatorSandbox(deps.windowsCreatorSandbox).then((result) => {
        if (result.state === 'unavailable') {
          console.warn(`[Bridge] Windows Creator Sandbox remains unavailable: ${result.code}`);
        }
      });
    }
    app.once('before-quit', () => void disposeProductionCreatorPreviewBridge());
    console.log('[Bridge] Creator preview native contract registered in fail-closed mode.');
  } catch (error) {
    console.error('[Bridge] Failed to register Creator preview contract:', error);
  }

  try {
    // Personal Manager (Tasks + Note + Schedule). Builds the shared services
    // (local file store + provider-backed AI + reminder scheduler) that both the
    // renderer Manager page and the Manager MCP server drive, registers the
    // `manager.*` channels, and starts the reminder ticker (which runs a
    // catch-up pass for reminders that came due while the app was closed).
    const manager = getManagerServices();
    registerManagerBridge({ services: manager });
    manager.scheduler.start().catch((error) => console.error('[Bridge] Manager scheduler start failed:', error));
    console.log('[Bridge] Manager bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Manager bridge:', error);
  }

  try {
    // News aggregator (RSS/Atom, no AI). Builds the shared services (local file
    // store + refresh scheduler), registers the `news.*` channels, and starts
    // the refresh ticker (which runs an immediate catch-up fetch so reopening
    // the app pulls fresh news). Feeds are fetched + rule-classified in the Main
    // process; the renderer News page reads the state via the bridge.
    const news = getNewsServices();
    registerNewsBridge({ services: news });
    news.scheduler.start().catch((error) => console.error('[Bridge] News scheduler start failed:', error));
    // Realtime social firehose (Bluesky Jetstream). Best-effort: a failed socket
    // never blocks bootstrap; it self-reconnects with backoff.
    news.realtime.start().catch((error) => console.error('[Bridge] News realtime connector start failed:', error));
    // Realtime bots (news + trading). Paper-only by default; the engine never
    // places real-money orders without a deliberately-wired exchange adapter.
    registerBotBridge({ engine: news.bots });
    news.bots.start().catch((error) => console.error('[Bridge] Bot engine start failed:', error));
    console.log('[Bridge] News bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register News bridge:', error);
  }

  try {
    // Automation (n8n-style workflow engine). Owns a userData-backed workflow
    // store + a deterministic linear engine; `automation.run` streams a flat
    // run-log over the emitter. The AI node is just one step in the pipeline —
    // the engine itself is deterministic. Without this call the Automation
    // Studio view's probe times out and shows a friendly "unavailable" notice.
    registerAutomationBridge();
    console.log('[Bridge] Automation bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Automation bridge:', error);
  }

  try {
    // AI Workflow Designer chat plane — lets users create/modify/explain/fix
    // workflows in natural language. Reuses the same automation store as the
    // bridge above (single source of truth), so a workflow the AI generates
    // appears immediately on the Automation canvas.
    registerAutomationChatBridge();
    console.log('[Bridge] Automation chat bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Automation chat bridge:', error);
  }

  try {
    // Credential vault — encrypted token/secret storage reused across workflows.
    // Decrypted values never leave the Main process; the renderer only sees
    // metadata + field keys.
    registerCredentialBridge();
    console.log('[Bridge] Credential bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Credential bridge:', error);
  }

  try {
    // Make Video (AI movie/anime factory). Cloud-only: a provider-backed LLM
    // authors a scene-by-scene script, and the shared image-generation core
    // renders each scene with the user's configured cloud image model. Owns a
    // userData-backed project store. Without this call the Make Video Studio
    // view's probe times out and shows a friendly "unavailable" notice.
    registerMakeVideoBridge();
    console.log('[Bridge] Make Video bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Make Video bridge:', error);
  }

  try {
    // Music Studio (Tomny music). Persistence + offline render/export for
    // the music-core engine. Safe to register unconditionally: it only exposes
    // music.* channels the gated /music page calls. Without this the Music
    // Studio page's save/render would have no provider.
    registerMusicBridge();
    console.log('[Bridge] Music bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Music bridge:', error);
  }

  try {
    // In-app Terminal manager (Settings › Terminal + IDE terminal panel). Owns
    // the registry of app-managed shell sessions (spawned with `child_process`,
    // no native dependency) and a `croner`-backed scheduler that fires saved
    // scripts into fresh sessions (e.g. launching 9router every morning). The
    // scheduler arms enabled schedules immediately so they fire on time even if
    // the Terminal page is never opened. Without this call the Terminal page's
    // probe times out and shows a friendly "unavailable" notice.
    const terminal = getTerminalServices();
    registerTerminalBridge({ services: terminal });
    registerMtuiBridge();
    registerMtuiPolicyBridge();
    terminal.scheduler.start().catch((error) => console.error('[Bridge] Terminal scheduler start failed:', error));
    console.log('[Bridge] Terminal & MTUI bridges registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Terminal bridge:', error);
  }

  try {
    registerPricingBridge();
    console.log('[Bridge] Pricing bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Pricing bridge:', error);
  }

  try {
    registerProviderBridge();
    console.log('[Bridge] Tomny provider bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Tomny provider bridge:', error);
  }

  const meshService = getSharedAgentMeshService();

  try {
    const coreRuntime = registerExperimentalCoreBridge(meshService);
    console.log('[Bridge] Experimental core bridge registered.');
    registerFoundationBridge({ coreRuntime });
    console.log('[Bridge] Foundation RunKernel bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register experimental core or Foundation bridge:', error);
  }

  try {
    registerAgentMeshBridge(meshService);
    console.log('[Bridge] AgentMesh bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register AgentMesh bridge:', error);
  }

  try {
    registerTeamBridge({
      mesh: meshService,
      store: new JsonTeamStore(path.join(app.getPath('userData'), 'tomny-core', 'teams.json')),
    });
    console.log('[Bridge] Native Team bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register native Team bridge:', error);
  }

  try {
    // Git Manager — a real GitHub-backed repo manager: register a repo by URL +
    // token (encrypted at rest via safeStorage), clone it down, commit + push
    // up, pull back, two-way backup. Desktop-only (native git via child_process).
    registerGitManagerBridge({ services: getGitManagerServices() });
    console.log('[Bridge] Git Manager bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Git Manager bridge:', error);
  }

  try {
    // 9Router connector applier — turns the "Distribute via 9Router" panel's
    // computed plan into real config files on disk (deep-merge + timestamped
    // backup, atomic write) so a user can one-click wire Claude Code / OpenClaw
    // to their local 9Router endpoint. The plan is recomputed in Main (never
    // trusts a plan shipped from the renderer). Without this call the panel's
    // Apply button times out and shows a friendly notice.
    registerRouter9Bridge();
    console.log('[Bridge] 9Router connector bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register 9Router connector bridge:', error);
  }

  try {
    // ExpBase — debugging-experience memory. Lets the app/agent record fixes and
    // mistakes, then retrieve grounded lessons for similar bugs. `search` drains
    // the AI-free `mtui exp add` inbox + forget queue and rebuilds the MTUI
    // projection first, closing the capture → index → retrieve loop. Embeddings
    // are best-effort; without a provider it degrades to lexical + metadata.
    registerExperienceBridge();
    console.log('[Bridge] ExpBase bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register ExpBase bridge:', error);
  }
}

export {
  initApplicationBridge,
  initDialogBridge,
  initNotificationBridge,
  initOmniGatewayBridge,
  initSystemSettingsBridge,
  initUpdateBridge,
  initWindowControlsBridge,
  initWebuiBridge,
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
