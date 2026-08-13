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
import { initWebuiBridge } from './webuiBridge';
import { registerFoundationBridge } from './foundationBridge';
import { registerResourceBridge } from '@process/resource/resourceBridge';
import { getResourceCoordinator } from '@process/resource/resourceCoordinator';
import { registerSystemInfoBridge } from '@process/system/systemInfoBridge';
import { getSystemInfoService } from '@process/system/systemInfoService';
import { registerCompanyBridge } from '@process/company/companyBridge';
import { registerRealtimeKnowledgeBridge } from '@process/knowledge/realtimeKnowledgeBridge';
import { createCompanyGenerator } from '@process/company/companyGenerator';
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
  initSystemSettingsBridge,
  initUpdateBridge,
  initWindowControlsBridge,
  initWebuiBridge,
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
