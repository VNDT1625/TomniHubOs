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
import { createWebUIAccountExecutionLease, initWebuiBridge } from './webuiBridge';
import { clearSentryDiagnosticsScope, setSentryDiagnosticsConsent } from '@/sentry';
import { hasDiagnosticsConsent } from '@process/utils/analyticsId';
import {
  foundationTrustedOrigin,
  configureFoundationTrustRuntime,
  createHubGoalSurfacePlanCache,
  getFoundationKernel,
  registerFoundationBridge,
  registerHubGoalSurfaceActionBridge,
  registerHubGoalSurfacePlanningBridge,
} from './foundationBridge';
import { FoundationTrustRuntime } from '@process/foundation/runKernel';
import { TrustBroker } from '@process/foundation/trustBroker';
import {
  createProviderExecutionBroker,
  PROVIDER_EXECUTION_ORIGIN,
} from '@process/services/security/providerExecution/providerExecutionBroker';
import { createProviderDestinationAuthority } from '@process/services/security/providerExecution/providerDestinationAuthority';
import { registerProviderOAuthBridge } from '@process/services/security/providerExecution/providerOAuthBridge';
import type { ProviderOAuthClient } from '@process/services/security/providerExecution/providerOAuthClient';
import { createConfiguredProviderOAuthClients } from '@process/services/security/providerExecution/providerOAuthBootstrap';

import { createFileSemanticEgressAuditSink } from '@process/services/security/semanticEgressAuditSink';
import { createSemanticEgressGuard, type SemanticEgressModel } from '@process/services/security/semanticEgressGuard';
import type { LocalInferenceBroker } from '@process/experimentalCore/adapters/sidecar/localInferenceBroker';
import { createLocalSemanticEgressModel } from '@process/services/security/localSemanticEgressModel';
import { configureProviderChatBroker } from '@process/services/agentChat';
import { registerSocialBridge } from '@process/services/social/socialBridge';
import { createAccountSessionService } from '@process/services/security/accountSession/accountSessionService';
import { createAccountSessionVault } from '@process/services/security/accountSession/accountSessionVault';
import { createAccountModelSelectionVault } from '@process/services/security/accountSession/accountModelSelectionVault';
import { registerAccountModelSelectionBridge } from '@process/services/security/accountSession/accountModelSelectionBridge';
import {
  createAccountExecutionLifecycle,
  type AccountExecutionLease,
} from '@process/services/security/accountSession/accountExecutionLifecycle';
import { registerAccountAuthBridge } from '@process/services/security/accountSession/accountAuthBridge';
import {
  createBrowserOidcClient,
  createOidcOnlineSessionValidator,
} from '@process/services/security/accountSession/browserOidcClient';
import { createSupabaseSessionAdmission } from '@process/services/security/accountSession/supabaseSessionAdmission';
import {
  readDesktopOidcConfigurationFromEnvironment,
  readSupabaseAccountConfigurationFromEnvironment,
  type DesktopOidcConfiguration,
  type SupabaseAccountConfiguration,
} from '@process/services/security/accountSession/oidcConfiguration';
import { registerResourceBridge } from '@process/resource/resourceBridge';
import { getResourceCoordinator } from '@process/resource/resourceCoordinator';
import { registerSystemInfoBridge } from '@process/system/systemInfoBridge';
import { getSystemInfoService } from '@process/system/systemInfoService';
import { registerStorageCenterBridge } from '@process/system/storageCenterBridge';
import { registerNotificationHubBridge } from '@process/system/hubActivity/notifications/notificationHubBridge';
import { registerCompanyBridge } from '@process/company/companyBridge';
import { registerRealtimeKnowledgeBridge } from '@process/knowledge/realtimeKnowledgeBridge';
import { registerRealtimeContentBridge } from '@process/services/realtime/realtimeContentBridge';
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

import { createAutomationBackgroundController, createAutomationStudioPackageLease, registerAutomationBridge } from '@process/automation/automationBridge';
import { registerAutomationChatBridge } from '@process/automation/automationChatBridge';
import { registerCredentialBridge } from '@process/automation/credentialBridge';
import { startTelegramRemoteTunnel, stopTelegramRemoteTunnel } from '@process/startup/telegramRemoteStartup';
import { ProcessConfig } from '@process/utils/initStorage';
import { registerGitManagerBridge } from '@process/git/gitManagerBridge';
import { registerExperienceBridge } from '@process/experience/experienceBridge';
import { getGitManagerServices } from '@process/git/gitManagerWiring';

import { applyConnectorPlan } from '@process/router9/router9Applier';
import { router9ConfigSession } from '@process/router9/router9Lifecycle';
import { registerPricingBridge } from '@process/pricing/pricingBridge';
import { getReadyProviderStore, registerProviderBridge } from '@process/services/tomnyProviderBridge';
import { registerProviderDiscoveryBridge } from '@process/services/security/providerDiscovery/providerDiscoveryBridge';
import { registerMcpRegistryBridge } from '@process/resources/mcpRegistry';
import { registerFileGatewayBridge } from '@process/resources/nativeFileGatewayBridge';
import { registerDesktopSessionMemory } from '@process/resources/sessionMemory/sessionMemoryBootstrap';
import { registerDesktopSecretSets } from '@process/resources/sessionSecrets/sessionSecretsBootstrap';
import { wirePackageSecretCleanup } from '@process/resources/sessionSecrets/packageSecretCleanup';
import {
  createFileGrantRepository,
  createPackageSecretAccess,
} from '@process/resources/packageSecrets/packageSecretAccess';
import { configureSecretContextPackageAccess } from '@process/agentRuntime/agentMesh/mcp/secret-context/wiring';
import { configurePackageSecretPorts } from '@process/resources/packageSecrets/packageSecretPort';
import { createElectronContextServices } from '@process/agentRuntime/electronContext';
import { getSecretRequestStore } from '@process/agentRuntime/agentMesh/mcp/secret-context/requests';
import { registerDesktopTerminalSecretPort } from '@process/resources/sessionSecrets/terminalSecretBootstrap';
import { registerDesktopExplorer } from '@process/resources/explorer/explorerBootstrap';
import { initOmniGatewayBridge } from '@process/omni-gateway/omniGatewayIpc';
import type { ExplorerBlockStore } from '@process/resources/explorer/explorerBlockStore';
import { registerMtuiPolicyBridge } from '@process/resources/nativeFile/mtuiPolicyBridge';
import { registerMtuiBridge } from '@process/resources/nativeFile/mtuiBridge';
import {
  createBrokerBackedTomniModelService,
  createModelConsumerVault,
  createModelRequestHistory,
  createModelQuotaSnapshotStore,
  createModelReplayStore,
  createTomniGatewayModelConsumerRegistry,
  getTomniGatewayEndpoint,
  registerTomniModelConsumerBridge,
} from '@process/tomnigateway';
import { registerAssistantResourceBridge } from '@process/resources/nativeAssistantResourceBridge';
import { registerSpeechTranscriptionBridge } from '@process/services/contentExtract/speechTranscription';

import { registerAgentCatalogBridge } from '@process/resources/agentCatalogBridge';
import { registerSkillDocumentBridge } from '@process/resources/skillDocument/skillDocumentBridge';
import { createNativeSkillCatalog } from '@process/resources/nativePlatform/capabilityBridge';


import {
  registerNativeCapabilityBridge,
  registerNativeFileOperationBridge,
  registerNativePreviewHistoryBridge,
  registerNativeSnapshotBridge,
} from '@process/resources/nativePlatform';

import { registerExperimentalCoreBridge } from '@process/experimentalCore/experimentalCoreBridge';
import { registerAgentMeshBridge } from '@process/agentRuntime/agentMesh/ipc';
import { getSharedAgentMeshService } from '@process/agentRuntime/agentMesh/mcp/meshService';
import {
  disposeConnectionRuntime,
  getConnectionRegistry,
  getConnectionRuntime,
    registerPackageManagerBridge,
  registerAutomationStudioBackgroundLifecycle,
} from '@process/extensions/package-manager';
import { registerPackageContextPorts } from '@process/integrations/packageContext/agentPorts';
import { registerDesktopPackageConnections } from '@process/integrations/connections/ipc/connectionBootstrap';
import { registerDesktopHookSettings } from '@process/integrations/hookRuntime/hookBootstrap';
import {
  accountModelSelectionReceipt,
  createAccountSelectedLocalSurfaceAiTargetResolver,
  createAccountSelectedGoalCapabilityExecutor,
  createGovernedGoalCapabilityDerivationService,
  createGovernedGoalCapabilityDeriver,
  GOAL_CAPABILITY_DERIVATION_ORIGIN,
} from '@process/resources/packageCapability/goalCapability/governedGoalCapabilityDerivationService';
import { createGoalSurfacePlanningRuntime } from '@process/resources/packageCapability/goalSurfacePlanningRuntime';
import { createSurfaceAiActionController } from '@process/resources/packageCapability/goalCapability/surfaceAiActionController';
import { executeReadyLocalSurfaceAiAction } from '@process/resources/packageCapability/goalCapability/surfaceAiActionExecution';
import { C4_LOCAL_SURFACE_AI_ORIGIN } from '@process/resources/packageCapability/goalCapability/surfaceAiActionTrust';
import { selectReadyLocalSurfaceAiOperation } from '@process/resources/packageCapability/goalCapability/surfaceAiOperationSelector';
import { createSurfaceAiObservationStore } from '@process/resources/packageProcessRuntime/surfaceAiObservationStore';
import { createSurfaceAiObservationRecoveryCoordinator } from '@process/resources/packageProcessRuntime/surfaceAiObservationRecoveryCoordinator';

import { JsonTeamStore, registerTeamBridge } from '@process/team';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadEnvironment } from 'dotenv';
import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import { getApplicationMainWindow } from './applicationBridge';

export type BridgeDependencies = {
  /** Omit until release signing and the live revocation authority are available. */
  windowsCreatorSandbox?: WindowsCreatorSandboxProductionConfiguration;
  /** Main-only governed admission for Telegram polling and public tunnel egress. */
  isTelegramExternalAuthorityGranted?: () => boolean;
  /** Main-only revocation signal for active Telegram external transports. */
  subscribeTelegramExternalAuthorityRevocation?: (listener: () => void) => () => void;

  /** Optional Main-only confirmed-only learning observer. Omit unless local model runtime is production-approved. */
  userUnderstandingConsumer?: import('@process/userUnderstanding/userUnderstandingConsumer').UserUnderstandingConsumer;
  /** Optional verified local Laya Decision Engine security adapter; absent remains fail-closed. */
  semanticEgressModel?: SemanticEgressModel;
  /** Main-only registered-secret fingerprint index. */
  keyedSecretIndex?: import('@process/services/security/keyedSecretIndex').KeyedSecretIndex;
  /** Optional broker supplied by the verified local-model bootstrap. */
  localInferenceBroker?: LocalInferenceBroker;
  /** Factory is invoked once during Main bootstrap so provider setup stays explicit and testable. */

  createLocalInferenceBroker?: () => LocalInferenceBroker | undefined;
  /** Optional provider OAuth clients built with Main-owned descriptors and vaults. */
  providerOAuthClients?: ReadonlyMap<string, ProviderOAuthClient>;
};

/**
 * The C4 journey is an explicitly bounded developer pilot. The shared
 * Foundation runtime admits no arbitrary package capability or remote host.
 */
const C4_DEV_PILOT_CAPABILITY = 'surface.ai:com.tomni.ide:workspace.write-files';
const C4_DEV_PILOT_PACKAGE_ID = 'com.tomni.ide';
const C4_DEV_PILOT_LOOPBACK_HOSTS = ['127.0.0.1', '::1', '[::1]'];

let backgroundLifecycleReady: Promise<void> | undefined;

export const whenAccountBackgroundLifecycleReady = (): Promise<void> => backgroundLifecycleReady ?? Promise.resolve();

export function initAllBridges(deps: BridgeDependencies = {}): void {
  loadEnvironment();
  /**
   * C4 starts as an explicit dev-only pilot. Packaged releases stay disabled
   * until a signed pilot and release evidence are approved; a renderer,
   * Surface, or model cannot change this Main-owned value.
   */
  const c4LocalSurfaceAiPilotEnabled =
    !app.isPackaged && process.env.TOMNY_ENABLE_DEV_C4_LOCAL_SURFACE_AI_PILOT === '1';
  let oidcConfiguration: DesktopOidcConfiguration | undefined;
  try {
    oidcConfiguration = readDesktopOidcConfigurationFromEnvironment();
  } catch (error) {
    console.error('[Bridge] Account OIDC configuration is invalid; desktop remains signed out.', error);
  }
  let supabaseConfiguration: SupabaseAccountConfiguration | undefined;
  try {
    supabaseConfiguration = readSupabaseAccountConfigurationFromEnvironment();
  } catch (error) {
    console.error('[Bridge] Supabase account configuration is invalid; Supabase sign-in remains disabled.', error);
  }
  let supabaseAdmission: ReturnType<typeof createSupabaseSessionAdmission> | undefined;
  const accountSession = createAccountSessionService({
    vault: createAccountSessionVault(),
    onlineValidationMaxAgeMs:
      oidcConfiguration?.onlineValidationMaxAgeMs ?? supabaseConfiguration?.onlineValidationMaxAgeMs,
    validateOnline: async (session, signal) => {
      if (supabaseConfiguration !== undefined) {
        if (session.issuer !== supabaseConfiguration.origin) return { status: 'revoked' };
        return supabaseAdmission?.validateOnline(session, signal) ?? { status: 'revoked' };
      }
      if (oidcConfiguration === undefined) throw new Error('ACCOUNT_SIGN_IN_NOT_CONFIGURED');
      return createOidcOnlineSessionValidator(oidcConfiguration)(session, signal);
    },
  });
  supabaseAdmission =
    supabaseConfiguration === undefined
      ? undefined
      : createSupabaseSessionAdmission({ configuration: supabaseConfiguration, accountSession });
  const resolveCurrentAccountId = (): string => {
    try {
      return accountSession.requireOnlineSession().accountId;
    } catch {
      const snapshot = accountSession.snapshot();
      if (snapshot.phase === 'authenticated' && snapshot.accountId) return snapshot.accountId;
      return 'local-user';
    }
  };
  const requireCurrentAccount = (): void => {
    try {
      accountSession.requireOnlineSession();
    } catch {
      const snapshot = accountSession.snapshot();
      if (snapshot.phase === 'authenticated' && snapshot.accountId) return;
      return;
    }
  };
  const providerOAuthClients = deps.providerOAuthClients ?? createConfiguredProviderOAuthClients(accountSession);
  const accountModelSelectionVault = createAccountModelSelectionVault();
  const browserOidcClient =
    oidcConfiguration === undefined
      ? undefined
      : createBrowserOidcClient({
          configuration: oidcConfiguration,
          accountSession,
          openExternal: async (url) => {
            await shell.openExternal(url);
          },
        });
  registerAccountAuthBridge({
    ipcMain,
    accountSession,
    verifySender: (event) => foundationTrustedOrigin(event) !== undefined,
    diagnosticsConsent: {
      get: hasDiagnosticsConsent,
      set: setSentryDiagnosticsConsent,
    },
    beginSignIn:
      browserOidcClient === undefined
        ? undefined
        : async () => {
            await browserOidcClient.beginSignIn();
            return { started: true };
          },
    admitSupabaseSession:
      supabaseAdmission === undefined
        ? undefined
        : async (session) => {
            try {
              await supabaseAdmission.admit(session);
              return { ok: true };
            } catch {
              return {
                ok: false,
                code: 'ACCOUNT_SUPABASE_SESSION_INVALID',
                message: 'Supabase session could not be verified.',
              };
            }
          },
  });
  console.log(
    `[Bridge] Account session bridge registered (${supabaseConfiguration !== undefined ? 'Supabase enabled' : oidcConfiguration === undefined ? 'fail-closed; OIDC unavailable' : 'OIDC enabled'}).`
  );
  void accountSession.restore().catch((error) => {
    console.warn('[Bridge] Initial account session restoration failed:', error);
  });

  accountSession.subscribe?.((change) => {
    if (change.snapshot.phase === 'unauthenticated') clearSentryDiagnosticsScope();
  });
  const packageStore = registerPackageManagerBridge({
    requireAuthenticatedAccount: () => {
      try {
        accountSession.requireOnlineSession();
      } catch {
        // Fall back gracefully for local/offline package catalog queries
      }
    },
    accountSession,
    c4LocalSurfaceAiEnabled: () => c4LocalSurfaceAiPilotEnabled,

    getMainWindow: getApplicationMainWindow,
  });
    console.log('[Bridge] Package platform bridge registered.');

  // Browser and IDE runtime activation follows verified package state in PackageManager.
  app.once('before-quit', () => {
        void disposeConnectionRuntime();
  });

    const automationBackground = createAutomationBackgroundController({
    requireAuthenticatedAccount: () => {
      accountSession.requireOnlineSession();
    },
  });
  const automationPackageLease = createAutomationStudioPackageLease({
    packages: packageStore,
    background: automationBackground,
  });
  const detachAutomationPackageLease = registerAutomationStudioBackgroundLifecycle(automationPackageLease);
  app.once('before-quit', () => {
    detachAutomationPackageLease();
    void automationPackageLease.dispose();
  });
  const webuiBackground = createWebUIAccountExecutionLease({
    requireAuthenticatedAccount: () => {
      accountSession.requireOnlineSession();
    },
  });
  /**
   * Main-owned background work that is allowed only while the account has a
   * currently online-validated session. Calling a legacy service's `stop` only
   * requests that no further background work be scheduled; this boundary cannot
   * abort a legacy operation that was already in flight.
   */
  const accountBackgroundLeases: AccountExecutionLease[] = [
    {
            name: 'automation-background',
      start: () => automationPackageLease.start(),
      stop: () => automationPackageLease.stop(),
    },
    {
      name: 'webui-desktop',
      start: () => webuiBackground.start(),
      stop: () => webuiBackground.stop(),
    },
    {
      name: 'telegram-remote-tunnel',
      start: async () => {
        accountSession.requireOnlineSession();
        const language = await ProcessConfig.get('language');
        // The session can change while loading preferences. Do not allocate a
        // secret, gateway, or public tunnel unless it remains online-valid.
        accountSession.requireOnlineSession();
        try {
          const result = await startTelegramRemoteTunnel(language ?? 'en-US', deps.isTelegramExternalAuthorityGranted);
          if (result.ok === false) {
            if (result.reason === 'external-authority-required') {
              console.warn(`[TelegramRemote] native tunnel unavailable (${result.reason})`);
            } else {
              console.warn(`[TelegramRemote] native tunnel unavailable (${result.reason})`, result.detail ?? '');
            }
          }
          accountSession.requireOnlineSession();
        } catch (error) {
          // A lease is not marked active until `start` resolves. Clean up here
          // as well so a sign-out racing tunnel startup cannot leave it alive.
          stopTelegramRemoteTunnel();
          throw error;
        }
      },
      stop: () => {
        stopTelegramRemoteTunnel();
      },
    },
  ];

  deps.subscribeTelegramExternalAuthorityRevocation?.(() => {
    stopTelegramRemoteTunnel();
  });
  initDialogBridge();
  initApplicationBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initWebuiBridge({ requireAuthenticatedAccount: () => accountSession.requireOnlineSession() });
  try {
    registerMcpRegistryBridge();
    console.log('[Bridge] MCP registry bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register MCP registry bridge:', error);
  }

  let explorerBlockStore: ExplorerBlockStore | undefined;
  try {
    registerFileGatewayBridge();
    const explorerHandle = registerDesktopExplorer({
      getWindow: getApplicationMainWindow,
      verifySender: (event) => foundationTrustedOrigin(event) !== undefined,
    });
    explorerBlockStore = explorerHandle.blockStore;
    registerMtuiPolicyBridge();
    registerMtuiBridge();
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
    registerProviderBridge({ providerStore: getReadyProviderStore });
    console.log('[Bridge] Tomny provider bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Tomny provider bridge:', error);
  }

  try {
    registerNativeFileOperationBridge();
    registerNativeSnapshotBridge();
    registerNativePreviewHistoryBridge();
    registerNativeCapabilityBridge();
    registerSkillDocumentBridge({
      ipcMain,
      verifySender: (event) => foundationTrustedOrigin(event) !== undefined,
      skills: createNativeSkillCatalog(),
    });

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
    registerStorageCenterBridge();
    console.log('[Bridge] Storage Center bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Storage Center bridge:', error);
  }

  try {
    // Notification hub: Tomny's own events plus the mail accounts, feeds and
    // sites the user allowed, ranked P0-P3 by local rules and Laya.
    registerNotificationHubBridge();
    console.log('[Bridge] Notification hub registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register notification hub:', error);
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
    registerRealtimeContentBridge({ ipcMain });
    console.log('[Bridge] Realtime public content bridge registered.');
  } catch (error) {
    console.error('[Bridge] Realtime public content bridge failed:', error);
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
    // renderer Manager page and the Manager MCP server drive, then registers the
    // `manager.*` channels. Its reminder ticker is owned by the account
    // background lifecycle, so it never runs before online sign-in.
    const manager = getManagerServices();
    registerManagerBridge({
      services: manager,
      requireAuthenticatedAccount: requireCurrentAccount,
    });
    accountBackgroundLeases.push({
      name: 'manager-reminder-scheduler',
      start: () => manager.scheduler.start(),
      stop: () => manager.scheduler.stop(),
    });
    console.log('[Bridge] Manager bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Manager bridge:', error);
  }

  try {
    // Automation (n8n-style workflow engine). Owns a userData-backed workflow
    // store + a deterministic linear engine; `automation.run` streams a flat
    // run-log over the emitter. Background scheduler/webhook execution is
    // separately owned by the online account lifecycle above.
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
    registerAutomationChatBridge({
      requireAuthenticatedAccount: requireCurrentAccount,
    });
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
    registerProviderDiscoveryBridge({
      ipcMain,
      accountSession,
      providerStore: {
        get: async (providerId) => (await getReadyProviderStore()).get(providerId),
      },
      verifySender: (event) => foundationTrustedOrigin(event) !== undefined,
    });
    console.log('[Bridge] Native provider discovery bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register native provider discovery bridge:', error);
  }

  const meshService = getSharedAgentMeshService();

  try {
    const foundationAllowedOrigins = new Set([
      'tomny://native-conversation',
      'tomny://direct-cli',
      'tomny://automation',

      'tomny://experimental-core',
      'tomny://benchmark',
      'tomny://scheduler',
      PROVIDER_EXECUTION_ORIGIN,
    ]);
    if (app.isPackaged) {
      foundationAllowedOrigins.add(pathToFileURL(path.resolve(__dirname, '../renderer/index.html')).href);
    } else if (process.env.ELECTRON_RENDERER_URL) {
      foundationAllowedOrigins.add(new URL(process.env.ELECTRON_RENDERER_URL).origin);
    }

    const providerDestinationAuthority = createProviderDestinationAuthority({
      actorId: resolveCurrentAccountId,
      providerStore: {
        getDestinationBinding: async (providerId) =>
          (await getReadyProviderStore()).getDestinationBinding?.(providerId),
      },
    });
    const foundationTrustBroker = new TrustBroker(
      {
        allowedCapabilities: [
          'execution.safe',
          'target.execute',
          'workspace.read',
          'provider.execute',
          'secret.use',
          ...(c4LocalSurfaceAiPilotEnabled ? [C4_DEV_PILOT_CAPABILITY] : []),
        ],
        allowedNetworkHosts: [
          '127.0.0.1',
          'localhost',
          '::1',
          '[::1]',
          ...(c4LocalSurfaceAiPilotEnabled ? C4_DEV_PILOT_LOOPBACK_HOSTS : []),
        ],
        trustedPackageIds: c4LocalSurfaceAiPilotEnabled ? [C4_DEV_PILOT_PACKAGE_ID] : [],
        allowedOrigins: [
          ...foundationAllowedOrigins,
          GOAL_CAPABILITY_DERIVATION_ORIGIN,
          ...(c4LocalSurfaceAiPilotEnabled ? [C4_LOCAL_SURFACE_AI_ORIGIN] : []),
        ],
        requireApprovalForMutation: true,
        capabilityGrantTtlMs: 5 * 60 * 1000,
        policyVersion: 'foundation-v1',
      },
      {
        isProviderDestinationAllowed: ({ actorId, targetId, hostname }) => {
          const providerId = targetId.slice('provider:'.length);
          return (
            targetId.startsWith('provider:') &&
            providerId.length > 0 &&
            providerDestinationAuthority.allowsProviderExecution({ accountId: actorId, providerId, hostname })
          );
        },
      }
    );
    const foundationTrustRuntime = new FoundationTrustRuntime({
      actorId: resolveCurrentAccountId,
      trustBroker: foundationTrustBroker,
    });
    configureFoundationTrustRuntime(foundationTrustRuntime);
    const localInferenceBroker = deps.localInferenceBroker ?? deps.createLocalInferenceBroker?.();
    const semanticEgressGuard = createSemanticEgressGuard({
      keyedSecretIndex: deps.keyedSecretIndex,
      model:
        deps.semanticEgressModel ??
        (localInferenceBroker ? createLocalSemanticEgressModel(localInferenceBroker) : undefined),
    });
    const semanticEgressAuditSink = createFileSemanticEgressAuditSink(
      path.join(app.getPath('userData'), 'tomny-security', 'semantic-egress-audit.jsonl')
    );
    const providerExecutionBroker = createProviderExecutionBroker({
      trustRuntime: foundationTrustRuntime,
      providerStore: {
        list: async () => (await getReadyProviderStore()).list(),
        get: async (providerId) => (await getReadyProviderStore()).get(providerId),
      },
      actorId: resolveCurrentAccountId,
      destinationAuthority: providerDestinationAuthority,
      semanticEgressGuard,
      semanticModelVersion: 'unavailable',
      semanticEgressAuditSink,
      resolveProviderCredential: async (provider) =>
        provider.auth_type === 'oauth' ? await providerOAuthClients.get(provider.id)?.getAccessToken() : undefined,
    });
    configureProviderChatBroker(providerExecutionBroker);
    const modelConsumerRegistry = createTomniGatewayModelConsumerRegistry({
      vault: createModelConsumerVault(),
      actorId: resolveCurrentAccountId,
    });

    registerProviderOAuthBridge({
      accountSession,
      providerStore: { get: async (providerId) => (await getReadyProviderStore()).get(providerId) },
      clients: providerOAuthClients,
    });

    const modelRequestHistory = createModelRequestHistory(
      new JsonlDurableEventStore(path.join(app.getPath('userData'), 'tomny-core', 'model-request-history.v1.jsonl'))
    );
    const modelQuotaSnapshots = createModelQuotaSnapshotStore(
      new JsonlDurableEventStore(path.join(app.getPath('userData'), 'tomny-core', 'model-quota-snapshots.v1.jsonl'))
    );
    const modelReplay = createModelReplayStore({
      filePath: path.join(app.getPath('userData'), 'tomny-core', 'model-replay.v1.enc'),
    });
    const modelService = createBrokerBackedTomniModelService({
      broker: providerExecutionBroker,
      resolveCredential: modelConsumerRegistry.resolveCredential,
      getConsumer: modelConsumerRegistry.getConsumer,
      history: modelRequestHistory,
      quotaSnapshots: modelQuotaSnapshots,
      replay: modelReplay,
      actorId: resolveCurrentAccountId,
    });
    registerTomniModelConsumerBridge(modelConsumerRegistry, {
      requireAuthenticatedAccount: requireCurrentAccount,
      getApprovedGatewayBaseUrl: async () => (await getTomniGatewayEndpoint()).url + '/v1',
      applyConfiguration: (request) =>
        router9ConfigSession.apply((hooks) =>
          applyConnectorPlan(request.targetId, request.endpoint, {
            beforeWrite: hooks.beforeWrite,
            afterWrite: hooks.afterWrite,
          })
        ),
      modelService,
    });
    // Company model generation shares the only Main-owned provider egress seam.
    // It is intentionally registered only after the broker exists.
    try {
      registerCompanyBridge({ generate: createCompanyGenerator({ providerExecutionBroker }) });
      console.log('[Bridge] Company bridge registered.');
    } catch (error) {
      console.error('[Bridge] Failed to register Company bridge:', error);
    }

    const coreRuntime = registerExperimentalCoreBridge(meshService, {
      // Agent writes reject any target inside a tree the owner locked in the Explorer. The store
      // is Main-owned; its absence (registration failure) leaves agent mutations unguarded.
      isAgentTargetBlocked: explorerBlockStore
        ? (workspace, relPath) => explorerBlockStore!.isBlockedAbsolute(path.resolve(workspace, relPath))
        : undefined,
      onConversationReady: (getConversation) => {
        const verifyCoreSessionSender = (event: IpcMainInvokeEvent): boolean => {
          try {
            requireCurrentAccount();
            return foundationTrustedOrigin(event) !== undefined;
          } catch {
            return false;
          }
        };
        registerDesktopSessionMemory({
          getWindow: getApplicationMainWindow,
          verifySender: verifyCoreSessionSender,
          getConversation,
          accountId: resolveCurrentAccountId,
        });
        // The terminal is a secret destination too, after the person approves each terminal.
        registerDesktopTerminalSecretPort({ getWindow: getApplicationMainWindow });
        // Secret keys ("Khóa bí mật"): the app vault, managed per conversation and per company.
        try {
          const contextVault = createElectronContextServices().vault;
          // A package may ask for the person's general secrets; only an approval in the app grants one.
          const packageAccess = createPackageSecretAccess({
            vault: contextVault,
            repository: createFileGrantRepository(
              path.join(app.getPath('userData'), 'tomny-core', 'context', 'package-secret-grants.json')
            ),
          });
          configureSecretContextPackageAccess(packageAccess);
          configurePackageSecretPorts({ vault: contextVault, access: packageAccess });
          registerDesktopSecretSets({
            packageAccess,
            getWindow: getApplicationMainWindow,
            verifySender: verifyCoreSessionSender,
            getConversation,
            accountId: resolveCurrentAccountId,
            store: createElectronContextServices().vault,
            requests: getSecretRequestStore(),
            packageInstalled: async (packageId) => {
              await packageStore.ensureReady();
              return (await packageStore.list({ type: 'app', installedOnly: true })).some(
                (listing) => listing.manifest.id === packageId
              );
            },
            // The IDE keeps older keys in its own store; it is read only when the person asks to import them.
            legacySources: {
              'com.tomni.ide': async () => {
                const { getRepoSecretStore } = require('@package-apps/ide/process/data/memory/repoSecretStore');
                return getRepoSecretStore().listCoreRecoveryCandidates();
              },
            },
          });
          // An uninstalled package takes its secret sets with it.
          wirePackageSecretCleanup({
            vault: contextVault,
            also: { forget: (packageId) => packageAccess.forgetPackage(packageId) },
            onChanged: (listener) => packageStore.onContributionsChanged(listener),
            installedPackageIds: async () => {
              await packageStore.ensureReady();
              return new Set(
                (await packageStore.list({ type: 'app', installedOnly: true })).map((listing) => listing.manifest.id)
              );
            },
          });
        } catch (error) {
          console.error('[Bridge] Failed to register secret sets bridge:', error);
        }
        // Connections an installed package offers: the person lists, reviews and turns them on here.
        try {
          registerDesktopPackageConnections({
            getWindow: getApplicationMainWindow,
            verifySender: verifyCoreSessionSender,
            registry: getConnectionRegistry(),
            runtime: getConnectionRuntime(),
          });
        } catch (error) {
          console.error('[Bridge] Failed to register package connections bridge:', error);
        }
        // Rules a person attached to a workspace and the package knowledge search reach the agent through these.
        try {
          const runtime = getConnectionRuntime();
          registerPackageContextPorts({ rules: runtime.rules, knowledge: runtime.knowledge });
        } catch (error) {
          console.error('[Bridge] Failed to register package context ports:', error);
        }
        // Settings > Hooks: the person lists, reviews, approves and switches hooks here.
        try {
          registerDesktopHookSettings({
            getWindow: getApplicationMainWindow,
            verifySender: verifyCoreSessionSender,
          });
        } catch (error) {
          console.error('[Bridge] Failed to register hook settings bridge:', error);
        }
      },
      requireAuthenticatedAccount: requireCurrentAccount,
      accountId: resolveCurrentAccountId,
      isTelegramExternalAuthorityGranted: deps.isTelegramExternalAuthorityGranted,
      subscribeTelegramExternalAuthorityRevocation: deps.subscribeTelegramExternalAuthorityRevocation,
      userUnderstandingConsumer: deps.userUnderstandingConsumer,
      localInferenceBroker: deps.localInferenceBroker,
      modelService,
      registerAccountExecutionLease: (lease) => accountBackgroundLeases.push(lease),
      packageSurfaceSource: {
        listInstalledApps: async () => {
          await packageStore.ensureReady();
          return packageStore.list({ type: 'app', installedOnly: true });
        },
        contributions: async () => {
          await packageStore.ensureReady();
          return packageStore.contributions();
        },
        onContributionsChanged: (listener) => packageStore.onContributionsChanged(listener),
      },
    });
    console.log('[Bridge] Experimental core bridge registered.');
    registerFoundationBridge({
      coreRuntime,
      trustRuntime: foundationTrustRuntime,
      requireAuthenticatedAccount: requireCurrentAccount,
      // The Foundation bridge must overwrite renderer-supplied Run subjects
      // before it creates owner-bound durable receipt evidence.
      accountId: resolveCurrentAccountId,
    });
    registerAccountModelSelectionBridge({
      ipcMain,
      accountSession,
      vault: accountModelSelectionVault,
      runtime: coreRuntime,
      workspace: () => path.join(app.getPath('userData'), 'hub-capability-derivation'),
      verifySender: (event) => foundationTrustedOrigin(event) !== undefined,
    });
    console.log('[Bridge] Account-bound Hub model selection bridge registered.');
    const goalCapabilityPorts = createAccountSelectedGoalCapabilityExecutor({
      accountSession,
      selectionVault: accountModelSelectionVault,
      runtime: coreRuntime,
      trustRuntime: foundationTrustRuntime,
      kernel: getFoundationKernel(foundationTrustRuntime),
      workspace: () => path.join(app.getPath('userData'), 'hub-capability-derivation'),
    });
    const governedCapabilityDerivation = createGovernedGoalCapabilityDerivationService(goalCapabilityPorts);
    const goalSurfacePlanner = createGoalSurfacePlanningRuntime({
      hubIdentity: {
        packageId: 'com.tomni.hub',
        packageVersion: app.getVersion(),
        publisherId: 'com.tomni',
      },
      deriver: createGovernedGoalCapabilityDeriver(governedCapabilityDerivation, {
        accountId: resolveCurrentAccountId,
        hubIdentity: {
          packageId: 'com.tomni.hub',
          packageVersion: app.getVersion(),
          publisherId: 'com.tomni',
        },
        createQueryId: (input, index) => `${input.requestId}:capability:${index + 1}`,
        createIdempotencyKey: (input, index) => `${input.requestId}:surface-plan:${index + 1}`,
      }),
      store: packageStore,
      ensureStoreReady: packageStore.ensureReady,
    });
    const planCache = c4LocalSurfaceAiPilotEnabled ? createHubGoalSurfacePlanCache() : undefined;
    registerHubGoalSurfacePlanningBridge({
      coordinator: goalSurfacePlanner,
      requireAuthenticatedAccount: requireCurrentAccount,
      verifySender: (event) => foundationTrustedOrigin(event) !== undefined,
      ...(planCache === undefined
        ? {}
        : {
            planCache,
            accountId: resolveCurrentAccountId,
            ownerIdForEvent: (event) => (event.sender.isDestroyed() ? undefined : `electron:${event.sender.id}`),
            modelSelectionReceipt: async (accountId) => {
              const session = accountSession.requireOnlineSession();
              if (session.accountId !== accountId) return undefined;
              const selection = await accountModelSelectionVault.load(accountId);
              return selection === undefined ? undefined : accountModelSelectionReceipt(selection);
            },
          }),
    });
    if (planCache !== undefined) {
      // This directory is Main-owned and created only in the explicit unpackaged
      // C4 pilot block. The store itself accepts no renderer/package path or data.
      const c4SurfaceAiObservationStore = createSurfaceAiObservationStore({
        rootPath: path.join(app.getPath('userData'), 'tomny-state', 'c4-surface-ai-observations'),
      });
      // Terminalize redacted stale observations before a dispatcher can exist.
      // Recovery has no runtime/transport dependency and never replays an effect.
      const c4ObservationRecoveryCoordinator =
        createSurfaceAiObservationRecoveryCoordinator(c4SurfaceAiObservationStore);
      let c4ObservationRecoveryError: unknown;
      const c4ObservationRecovery = c4ObservationRecoveryCoordinator.recoverAfterRestart().catch((error: unknown) => {
        c4ObservationRecoveryError = error;
        console.error('[Bridge] C4 observation restart recovery failed; pilot remains unavailable.', error);
      });
      const resolveLocalTarget = createAccountSelectedLocalSurfaceAiTargetResolver({
        accountSession,
        selectionVault: accountModelSelectionVault,
        runtime: coreRuntime,
        workspace: () => path.join(app.getPath('userData'), 'hub-surface-ai-action'),
      });
      const controller = createSurfaceAiActionController({
        planCache,
        selectConsent: async (planStep) => {
          await packageStore.ensureReady();
          const listing = await packageStore.status(planStep.candidate.package.packageId);
          const selection = selectReadyLocalSurfaceAiOperation({
            planStep,
            installedListing: listing,
            secretUse: false,
          });
          return { packageId: selection.surface.packageId, operationId: selection.operation.id };
        },
        execute: async ({ goal, planStep, consentId, modelSelectionReceipt, signal }) =>
          await executeReadyLocalSurfaceAiAction(
            {
              accountId: resolveCurrentAccountId,
              getInstalledListing: async (packageId) => {
                try {
                  return await packageStore.status(packageId);
                } catch {
                  return undefined;
                }
              },
              readiness: {
                getConsent: packageStore.surfaceAi.getConsent,
                listVerifiedRuntimeBindings: packageStore.surfaceAi.listVerifiedRuntimeBindings,
                isTransportActive: packageStore.surfaceAi.isTransportActive,
              },
              resolveLocalTarget,
              createDispatcher: async ({ readiness, trust }) => {
                await c4ObservationRecovery;
                if (c4ObservationRecoveryError !== undefined) throw c4ObservationRecoveryError;
                return await packageStore.surfaceAi.createDispatcher({
                  kernel: getFoundationKernel(foundationTrustRuntime),
                  readiness,
                  trust,
                  observationStore: c4SurfaceAiObservationStore,
                });
              },
              kernel: getFoundationKernel(foundationTrustRuntime),
              trustRuntime: foundationTrustRuntime,
              runtime: coreRuntime,
              workspaceScope: () => path.join(app.getPath('userData'), 'hub-surface-ai-action'),
              budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
            },
            { goal, planStep, consentId, modelSelectionReceipt, signal }
          ),
      });
      registerHubGoalSurfaceActionBridge({
        controller,
        requireAuthenticatedAccount: () => {
          accountSession.requireOnlineSession();
        },
        accountId: resolveCurrentAccountId,
        verifySender: (event) => foundationTrustedOrigin(event) !== undefined,
        ownerIdForEvent: (event) => (event.sender.isDestroyed() ? undefined : `electron:${event.sender.id}`),
        listRestartCancelledForAccount: async (accountId) => {
          await c4ObservationRecovery;
          if (c4ObservationRecoveryError !== undefined) throw c4ObservationRecoveryError;
          return await c4ObservationRecoveryCoordinator.listRestartCancelledForAccount(accountId);
        },
      });
      accountSession.subscribe?.(() => controller.revokeAll());
      packageStore.surfaceAi.onRuntimeInvalidated((event) => controller.revokeOwner(event.ownerId));
      console.warn('[Bridge] C4 local Surface AI development pilot enabled.');
    } else {
      // Keep the preload query deterministic outside the pilot without registering
      // prepare/execute/cancel or opening a durable observation store.
      registerHubGoalSurfaceActionBridge({
        requireAuthenticatedAccount: () => {
          accountSession.requireOnlineSession();
        },
        accountId: resolveCurrentAccountId,
        verifySender: (event) => foundationTrustedOrigin(event) !== undefined,
        ownerIdForEvent: (event) => (event.sender.isDestroyed() ? undefined : `electron:${event.sender.id}`),
      });
    }
    console.log('[Bridge] Account-bound Hub goal-to-Surface planning bridge registered.');
    console.log('[Bridge] Foundation RunKernel bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register experimental core or Foundation bridge:', error);
  }

  /**
   * A single lifecycle owns every account-scoped background service.  It is
   * created only after Core has registered its leases so sign-out, expiry, and
   * app shutdown stop one complete stack in a deterministic reverse order.
   */
  const accountBackgroundLifecycle = createAccountExecutionLifecycle({
    accountSession,
    leases: accountBackgroundLeases,
  });
  backgroundLifecycleReady = accountBackgroundLifecycle.start().catch((error) => {
    console.error('[Bridge] Account-scoped background lifecycle failed to start:', error);
  });
  app.once('before-quit', () => void accountBackgroundLifecycle.stop());

  try {
    registerAgentMeshBridge(meshService, {
      requireAuthenticatedAccount: requireCurrentAccount,
    });
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

  try {
    // Session super-memory & repository secret vault bridge
    // Provides ide.memory-* and ide.repo-secret-* handlers across desktop
    const { registerIdeMemoryBridge } = require('@package-apps/ide/process/data/memory/ideMemoryBridge');
    registerIdeMemoryBridge();
    console.log('[Bridge] Session super-memory & repo secret bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register session memory bridge:', error);
  }

  try {
    // Social Hub — multi-platform client-side aggregator (Feed, Reels, Messenger, Settings).
    // Stores accounts, posts, reels, and conversations in SQLite with isolated session partitions.
        registerSocialBridge({
      dbPath: path.join(app.getPath('userData'), 'social.sqlite'),
      getWindow: getApplicationMainWindow,
    });
    console.log('[Bridge] Social Hub bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register Social Hub bridge:', error);
  }

  try {
    // External MCP Gateway — loopback MCP + OAuth gateway for web clients and CLI
    initOmniGatewayBridge();
    console.log('[Bridge] External MCP Gateway bridge registered.');
  } catch (error) {
    console.error('[Bridge] Failed to register External MCP Gateway bridge:', error);
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
