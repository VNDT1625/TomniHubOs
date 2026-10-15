/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';
import '@/common/adapter/bridgeErrorWrapper';
import {
  conversation as conversationChannels,
  cron,
  telegramChannel,
  type PersonalContextExport,
  type PersonalLearningControlRequest,
  type PersonalLearningCorrectRequest,
  type PersonalLearningOutcomeRequest,
  type PersonalLearningProposeRequest,
  type PersonalLearningRecordIdRequest,
  type PersonalSecretSetSaveRequest,
} from '@/common/adapter/ipcBridge';
import { app, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { registerCoreWorkspaceMutationPort } from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';
import { createFoundationConversationRuntime, createFoundationRunLifecycle } from '@process/bridge/foundationBridge';
import { createTeamMutationPort } from '@process/resources/nativeFile/coreMutationPort';
import { getTeamEditService } from '@package-apps/ide/process/collaboration/teamEdit/teamEditService';
import {
  guardAccountExecution,
  registerNativeConversationBridge,
  type NativeConversationRuntime,
  type RequireAuthenticatedAccount,
} from '@process/services/database/nativeConversation';
import type { TChatConversation } from '@/common/config/storage';
import {
  publishTomniRemoteEvent,
  registerTomniRemoteConversations,
  subscribeTomniRemoteEvents,
} from '@process/services/remoteGateway/registry';
import { getHubActivityRegistry } from '@process/system/hubActivity/hubActivityRegistry';
import { registerHubActivityBridge } from '@process/system/hubActivity/hubActivityBridge';
import { getLiveSessionRegistry } from '@process/system/liveSessions/liveSessionRegistry';
import { registerLiveSessionsBridge } from '@process/system/liveSessions/liveSessionsBridge';
import { attachConversationActivity, reportScheduledRun } from '@process/system/hubActivity/hubActivitySources';
import { restoreHubActivityGrid } from '@process/system/hubActivity/hubActivityStore';
import { registerTelegramChannelBridge } from '@process/services/telegram/bridge';
import { TelegramChannelService } from '@process/services/telegram/service';
import { createOpenAiCompatibleTranscriber } from '@process/services/telegram/voice';
import {
  createLocalWhisperTranscriber,
  findLocalWhisperModel,
  localWhisperModelDirs,
} from '@process/services/telegram/localWhisper';

import { discoverLegacyDatabasePaths } from '@process/services/database/runLegacyDatabaseMigrations';
import { getCompanyServices } from '@process/company/companyBridge';
import { getMcpRegistry } from '@process/resources/mcpRegistry';
import { JsonTeamStore } from '@process/team';
import { startProductionTomniGateway, stopProductionTomniGateway } from '@process/tomnigateway';
import { createCompanyCoreRunner } from '@process/agentRuntime/companyCoreRunner';
import { configureSecretContextStoredCallback } from '@process/agentRuntime/agentMesh/mcp/secret-context/wiring';
import type { AgentMeshService } from '@process/agentRuntime/agentMesh/service';
import {
  createElectronContextServices,
  ensureActiveAccountPersonalContext,
} from '@process/agentRuntime/electronContext';
import {
  createPersonalContextMutationCoordinator,
  createPersonalLearningCoordinator,
  redactContextText,
} from '@process/agentRuntime/contextStore';
import type {
  ContextFact,
  PersonalContext,
  PersonalLearningCausalChain,
  PersonalLearningControl,
  PersonalLearningRecord,
  SecretDescriptor,
} from '@process/agentRuntime/contextTypes';
import type { UserUnderstandingConsumer } from '@process/userUnderstanding/userUnderstandingConsumer';
import type { LocalInferenceBroker } from './adapters/sidecar/localInferenceBroker';
import type { TomniGatewayModelService } from '@process/tomnigateway';
import { bindingForPersonalSet, parseSecretDestinations } from '@process/resources/sessionSecrets/destinations';
import { packageIdOfSurface } from '@process/resources/sessionSecrets/packageOfSurface';
import { getSecretRequestStore } from '@process/agentRuntime/agentMesh/mcp/secret-context/requests';
import {
  configureLegacyCronAdapter,
  createCoreScheduledTaskIpcHandlers,
  createCoreScheduledTaskService,
  createRunConversationTracker,
  createScheduledConversationRunner,
  JsonCoreScheduleStore,
  LegacyCronAdapter,
  type CoreScheduleAuditEvent,
  type CoreScheduleDraft,
  type CoreScheduledTask,
} from '@process/cron/scheduledTasks';
import {
  createBuiltinSurfaceManifests,
  createPackageSurfaceRegistrySynchronizer,
  createSurfaceRegistry,
  type PackageSurfaceRegistrySource,
} from '@process/agentRuntime/surfaceRegistry';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import { buildCoreDoctorReport, type CoreDoctorReport } from '@process/services/diagnostics/coreDoctor';
import {
  CoreTelemetryRecorder,
  JsonlCoreTelemetrySink,
  toPublicCoreTelemetryEvent,
  type CoreTelemetryEvent,
} from '@process/services/diagnostics/coreTelemetry';
import { JsonPermissionRepository, PermissionStore } from '@process/services/agentChat/permission';
import type { AccountExecutionLease } from '@process/services/security/accountSession/accountExecutionLifecycle';
import {
  AcpCoreAdapter,
  CodexAppServerAdapter,
  detectLoopbackOpenAiTarget,
  disposeMainRustSidecarLifecycle,
  getMainRustSidecarLifecycle,
  LoopbackOpenAiAdapter,
  RustMirroredDurableEventStore,
  RustRuntimeAccelerator,
  TomnyCoreAdapter,
} from './adapters';
import { detectCoreTargets, resolveExecutableOnPath } from './coreRegistry';
import { createElectronSurfaceCapabilityHosts } from './electronSurfaceCapabilityHosts';
import {
  createTomnySessionActionHistorySource,
  ExperimentalCoreRuntime,
  type ExperimentalCoreEvent,
  type ExperimentalCoreRunSnapshot,
  type ExperimentalCoreTarget,
} from './experimentalCoreRuntime';
import { JsonCoreSessionStore, type CoreSessionCheckpoint } from './sessionCheckpointStore';
import { createElectronRemoteCoreServices } from './remoteElectronServices';
import { getCronSkillsDir, ProcessConfig } from '@process/utils/initStorage';
import { listReadyProviders } from '@process/services/tomnyProviderBridge';
import { BenchmarkService, BenchmarkStore, registerBenchmarkBridge } from '@process/testing/benchmark';
import { createLiveImageOutputStore } from '@process/services/liveImageOutputStore';
import { createLiveImageOutputCoordinator } from '@process/services/liveImageOutputCoordinator';
import { createRunScopedScreenshotPublisher } from '@process/services/runScopedScreenshotMcp';
import { getBrowserControlDeps } from '@process/browser/browserControlWiring';
import { getApplicationMainWindow } from '@process/bridge/applicationBridge';
import { stopRunScopedBrowserControlMcpHost } from '@process/browser/browserControlMcpHost';
import { resolveCoreMcpServers } from '@process/resources/mcpRegistry/packageMcpLaunch';

export const EXPERIMENTAL_CORE_CHANNELS = {
  listTargets: 'experimental-core.list-targets',
  listModels: 'experimental-core.list-models',
  listSessions: 'experimental-core.list-sessions',

  listActiveRuns: 'experimental-core.list-active-runs',
  replayEvents: 'experimental-core.replay-events',
  resumeInterrupted: 'experimental-core.resume-interrupted',
  forkSession: 'experimental-core.fork-session',
  start: 'experimental-core.start',
  cancel: 'experimental-core.cancel',
  resolvePermission: 'experimental-core.resolve-permission',
  resolveOrchestrationProposal: 'experimental-core.resolve-orchestration-proposal',
  personalGet: 'personal-context.get',
  personalSave: 'personal-context.save',
  personalLearningSetPaused: 'personal-context.learning.set-paused',
  personalLearningPropose: 'personal-context.learning.propose',
  personalLearningConfirm: 'personal-context.learning.confirm',
  personalLearningReject: 'personal-context.learning.reject',
  personalLearningCorrect: 'personal-context.learning.correct',
  personalLearningOutcome: 'personal-context.learning.outcome',
  personalLearningForget: 'personal-context.learning.forget',
  personalLearningDelete: 'personal-context.learning.delete',
  personalLearningExport: 'personal-context.learning.export',
  personalSecretsList: 'personal-secrets.list',
  personalSecretsSave: 'personal-secrets.save',
  personalSecretsRemove: 'personal-secrets.remove',
  scheduledList: 'experimental-core.scheduled-list',
  scheduledGet: 'experimental-core.scheduled-get',
  scheduledSave: 'experimental-core.scheduled-save',
  scheduledRemove: 'experimental-core.scheduled-remove',
  scheduledRunNow: 'experimental-core.scheduled-run-now',
  scheduledCancel: 'experimental-core.scheduled-cancel',
  scheduledAudit: 'experimental-core.scheduled-audit',
  queryTelemetry: 'experimental-core.query-telemetry',
  doctor: 'experimental-core.doctor',
  event: 'experimental-core.event',
} as const;

export type CoreTelemetryQuery = { runId?: string; sessionId?: string; limit?: number };

const DEFAULT_TELEMETRY_LIMIT = 200;
const MAX_TELEMETRY_LIMIT = 1_000;
const MAX_PERSONAL_LEARNING_RECORD_ID_LENGTH = 160;
const MAX_PERSONAL_LEARNING_EXPLANATION_LENGTH = 4_000;
const MAX_PERSONAL_LEARNING_PROVENANCE_LENGTH = 2_000;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

const parseBoundedLearningText = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`INVALID_PERSONAL_LEARNING_${label}`);
  }
  return redactContextText(value.trim());
};

/** Parses a fact at the IPC boundary and redacts credential-shaped text before persistence. */
export const parsePersonalLearningFact = (value: unknown): ContextFact => {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      'key',
      'value',
      'confidence',
      'source',
      'learnedAt',
      'lastConfirmedAt',
      'scope',
      'sensitivity',
      'userLocked',
    ])
  ) {
    throw new Error('INVALID_PERSONAL_LEARNING_FACT');
  }
  const scope = value.scope;
  if (!isPlainRecord(scope) || !hasOnlyKeys(scope, ['kind', 'surface'])) {
    throw new Error('INVALID_PERSONAL_LEARNING_FACT');
  }
  const isGlobalScope = scope.kind === 'global' && Object.keys(scope).length === 1;
  const isSurfaceScope =
    scope.kind === 'surface' &&
    typeof scope.surface === 'string' &&
    scope.surface.trim().length > 0 &&
    scope.surface.length <= 100 &&
    Object.keys(scope).length === 2;
  if (
    (!isGlobalScope && !isSurfaceScope) ||
    typeof value.confidence !== 'number' ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !Number.isSafeInteger(value.learnedAt) ||
    (value.lastConfirmedAt !== undefined && !Number.isSafeInteger(value.lastConfirmedAt)) ||
    !['user', 'observed', 'imported', 'inferred'].includes(value.source as string) ||
    !['normal', 'private'].includes(value.sensitivity as string) ||
    typeof value.userLocked !== 'boolean'
  ) {
    throw new Error('INVALID_PERSONAL_LEARNING_FACT');
  }
  return {
    key: parseBoundedLearningText(value.key, 'FACT', 200),
    value: parseBoundedLearningText(value.value, 'FACT', 8_000),
    confidence: value.confidence as number,
    source: value.source as ContextFact['source'],
    learnedAt: value.learnedAt as number,
    ...(value.lastConfirmedAt === undefined ? {} : { lastConfirmedAt: value.lastConfirmedAt as number }),
    scope: isGlobalScope
      ? { kind: 'global' }
      : { kind: 'surface', surface: redactContextText((scope.surface as string).trim()) },
    sensitivity: value.sensitivity as ContextFact['sensitivity'],
    userLocked: value.userLocked as boolean,
  };
};

const parsePersonalLearningRecordIdValue = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value) ||
    value.length > MAX_PERSONAL_LEARNING_RECORD_ID_LENGTH
  ) {
    throw new Error('INVALID_PERSONAL_LEARNING_RECORD_ID');
  }
  return value;
};

export const parsePersonalLearningRecordId = (value: unknown): string => {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['recordId'])) {
    throw new Error('INVALID_PERSONAL_LEARNING_RECORD_ID');
  }
  return parsePersonalLearningRecordIdValue(value.recordId);
};

/** Records why a preference may apply; unexplained repetition can never become a reusable rule. */
export const parsePersonalLearningCausalChain = (value: unknown): PersonalLearningCausalChain => {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['context', 'origin', 'reason', 'reasonKnown', 'proposal'])) {
    throw new Error('INVALID_PERSONAL_LEARNING_CAUSAL_CHAIN');
  }
  const reasonKnown = value.reasonKnown;
  const hasReason = typeof value.reason === 'string' && Boolean(value.reason.trim());
  if (typeof reasonKnown !== 'boolean' || (reasonKnown && !hasReason) || (!reasonKnown && value.reason !== null)) {
    throw new Error('INVALID_PERSONAL_LEARNING_CAUSAL_CHAIN');
  }
  return {
    context: parseBoundedLearningText(value.context, 'CAUSAL_CONTEXT', 1_000),
    origin: parseBoundedLearningText(value.origin, 'CAUSAL_ORIGIN', MAX_PERSONAL_LEARNING_PROVENANCE_LENGTH),
    reason: reasonKnown
      ? parseBoundedLearningText(value.reason, 'CAUSAL_REASON', MAX_PERSONAL_LEARNING_EXPLANATION_LENGTH)
      : undefined,
    reasonKnown,
    proposal: parseBoundedLearningText(value.proposal, 'CAUSAL_PROPOSAL', MAX_PERSONAL_LEARNING_EXPLANATION_LENGTH),
  };
};

/** Accepts only the explicit one-field pause control at the Main-process boundary. */
export const parsePersonalLearningControlRequest = (value: unknown): PersonalLearningControlRequest => {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['paused']) || typeof value.paused !== 'boolean') {
    throw new Error('INVALID_PERSONAL_LEARNING_CONTROL');
  }
  return { paused: value.paused };
};

export const parsePersonalLearningProposeRequest = (value: unknown): PersonalLearningProposeRequest => {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['collection', 'fact', 'explanation', 'provenance', 'causal'])) {
    throw new Error('INVALID_PERSONAL_LEARNING_PROPOSAL');
  }
  if (!['facts', 'preferences', 'habits'].includes(value.collection as string)) {
    throw new Error('INVALID_PERSONAL_LEARNING_PROPOSAL');
  }
  return {
    collection: value.collection as PersonalLearningRecord['collection'],
    fact: parsePersonalLearningFact(value.fact),
    explanation: parseBoundedLearningText(value.explanation, 'EXPLANATION', MAX_PERSONAL_LEARNING_EXPLANATION_LENGTH),
    provenance: parseBoundedLearningText(value.provenance, 'PROVENANCE', MAX_PERSONAL_LEARNING_PROVENANCE_LENGTH),
    causal: parsePersonalLearningCausalChain(value.causal),
  };
};

export const parsePersonalLearningCorrectRequest = (value: unknown): PersonalLearningCorrectRequest => {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['recordId', 'fact', 'explanation', 'causal'])) {
    throw new Error('INVALID_PERSONAL_LEARNING_CORRECTION');
  }
  return {
    recordId: parsePersonalLearningRecordIdValue(value.recordId),
    fact: parsePersonalLearningFact(value.fact),
    explanation: parseBoundedLearningText(value.explanation, 'EXPLANATION', MAX_PERSONAL_LEARNING_EXPLANATION_LENGTH),
    causal: parsePersonalLearningCausalChain(value.causal),
  };
};

export const parsePersonalLearningOutcomeRequest = (value: unknown): PersonalLearningOutcomeRequest => {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['recordId', 'outcome'])) {
    throw new Error('INVALID_PERSONAL_LEARNING_OUTCOME');
  }
  if (value.outcome !== 'helpful' && value.outcome !== 'not_helpful') {
    throw new Error('INVALID_PERSONAL_LEARNING_OUTCOME');
  }
  return { recordId: parsePersonalLearningRecordIdValue(value.recordId), outcome: value.outcome };
};

/** Keep renderer diagnostics bounded even when a caller supplies invalid input. */
export const normalizeTelemetryLimit = (limit?: number): number =>
  Math.min(
    MAX_TELEMETRY_LIMIT,
    Math.max(1, Number.isFinite(limit) ? Math.trunc(limit ?? DEFAULT_TELEMETRY_LIMIT) : DEFAULT_TELEMETRY_LIMIT)
  );

const channels = {
  listTargets: bridge.buildProvider<ExperimentalCoreTarget[], void>(EXPERIMENTAL_CORE_CHANNELS.listTargets),
  listModels: bridge.buildProvider<ExperimentalCoreTarget['models'], { targetId: string; workspace: string }>(
    EXPERIMENTAL_CORE_CHANNELS.listModels
  ),
  listSessions: bridge.buildProvider<CoreSessionCheckpoint[], void>(EXPERIMENTAL_CORE_CHANNELS.listSessions),

  listActiveRuns: bridge.buildProvider<ExperimentalCoreRunSnapshot[], void>(EXPERIMENTAL_CORE_CHANNELS.listActiveRuns),
  replayEvents: bridge.buildProvider<
    ExperimentalCoreEvent[],
    { sessionId?: string; requestId?: string; afterSequence?: number; limit?: number }
  >(EXPERIMENTAL_CORE_CHANNELS.replayEvents),
  resumeInterrupted: bridge.buildProvider<
    { requestId: string; sessionId: string },
    { sessionId: string; requestId?: string }
  >(EXPERIMENTAL_CORE_CHANNELS.resumeInterrupted),
  forkSession: bridge.buildProvider<CoreSessionCheckpoint, { sessionId: string }>(
    EXPERIMENTAL_CORE_CHANNELS.forkSession
  ),
  start: bridge.buildProvider<
    { requestId: string; sessionId: string },
    {
      requestId: string;
      sessionId?: string;
      targetId: string;
      prompt: string;
      workspace?: string;
      modelKey?: string;
      companyId?: string;
      surface?: string;
      agentId?: string;
      personalId?: string;
      permissionScopes?: string[];
      capabilityGrants?: string[];
      availableCapabilities?: string[];
      modelCapabilities?: string[];
      permissionMode?: 'read-only' | 'workspace-write' | 'full-access';
    }
  >(EXPERIMENTAL_CORE_CHANNELS.start),
  cancel: bridge.buildProvider<boolean, { requestId: string }>(EXPERIMENTAL_CORE_CHANNELS.cancel),
  resolvePermission: bridge.buildProvider<
    boolean,
    { permissionId: string; approved: boolean; lifetime?: 'allow-once' | 'session' | 'persistent' }
  >(EXPERIMENTAL_CORE_CHANNELS.resolvePermission),
  resolveOrchestrationProposal: bridge.buildProvider<boolean, { proposalId: string; approved: boolean }>(
    EXPERIMENTAL_CORE_CHANNELS.resolveOrchestrationProposal
  ),
  personalGet: bridge.buildProvider<PersonalContext, void>(EXPERIMENTAL_CORE_CHANNELS.personalGet),
  personalSave: bridge.buildProvider<PersonalContext, { profile: PersonalContext }>(
    EXPERIMENTAL_CORE_CHANNELS.personalSave
  ),
  personalLearningSetPaused: bridge.buildProvider<PersonalLearningControl, PersonalLearningControlRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningSetPaused
  ),
  personalLearningPropose: bridge.buildProvider<PersonalLearningRecord, PersonalLearningProposeRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningPropose
  ),
  personalLearningConfirm: bridge.buildProvider<boolean, PersonalLearningRecordIdRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningConfirm
  ),
  personalLearningReject: bridge.buildProvider<boolean, PersonalLearningRecordIdRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningReject
  ),
  personalLearningCorrect: bridge.buildProvider<boolean, PersonalLearningCorrectRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningCorrect
  ),
  personalLearningOutcome: bridge.buildProvider<boolean, PersonalLearningOutcomeRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningOutcome
  ),
  personalLearningForget: bridge.buildProvider<boolean, PersonalLearningRecordIdRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningForget
  ),
  personalLearningDelete: bridge.buildProvider<boolean, PersonalLearningRecordIdRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningDelete
  ),
  personalLearningExport: bridge.buildProvider<PersonalContextExport, void>(
    EXPERIMENTAL_CORE_CHANNELS.personalLearningExport
  ),
  personalSecretsList: bridge.buildProvider<SecretDescriptor[], void>(EXPERIMENTAL_CORE_CHANNELS.personalSecretsList),
  personalSecretsSave: bridge.buildProvider<SecretDescriptor, PersonalSecretSetSaveRequest>(
    EXPERIMENTAL_CORE_CHANNELS.personalSecretsSave
  ),
  personalSecretsRemove: bridge.buildProvider<boolean, { handle: string }>(
    EXPERIMENTAL_CORE_CHANNELS.personalSecretsRemove
  ),
  scheduledList: bridge.buildProvider<CoreScheduledTask[], void>(EXPERIMENTAL_CORE_CHANNELS.scheduledList),
  scheduledGet: bridge.buildProvider<CoreScheduledTask | undefined, { id: string }>(
    EXPERIMENTAL_CORE_CHANNELS.scheduledGet
  ),
  scheduledSave: bridge.buildProvider<CoreScheduledTask, { draft: CoreScheduleDraft }>(
    EXPERIMENTAL_CORE_CHANNELS.scheduledSave
  ),
  scheduledRemove: bridge.buildProvider<void, { id: string }>(EXPERIMENTAL_CORE_CHANNELS.scheduledRemove),
  scheduledRunNow: bridge.buildProvider<void, { id: string }>(EXPERIMENTAL_CORE_CHANNELS.scheduledRunNow),
  scheduledCancel: bridge.buildProvider<boolean, { id: string }>(EXPERIMENTAL_CORE_CHANNELS.scheduledCancel),
  scheduledAudit: bridge.buildProvider<CoreScheduleAuditEvent[], { taskId?: string }>(
    EXPERIMENTAL_CORE_CHANNELS.scheduledAudit
  ),
  queryTelemetry: bridge.buildProvider<CoreTelemetryEvent[], CoreTelemetryQuery>(
    EXPERIMENTAL_CORE_CHANNELS.queryTelemetry
  ),
  doctor: bridge.buildProvider<CoreDoctorReport, { limit?: number }>(EXPERIMENTAL_CORE_CHANNELS.doctor),
  event: bridge.buildEmitter<ExperimentalCoreEvent>(EXPERIMENTAL_CORE_CHANNELS.event),
};

let registeredRuntime: ExperimentalCoreRuntime | undefined;

type E2ENativeConversationCapture = {
  requests: Array<{
    conversationId: string;
    files: string[];
    workspaceReferences: Array<{ relativePath: string; kind: 'file' | 'folder' }>;
    prompt: string;
  }>;
  explorerActionCount: number;
};

const e2eNativeConversationCapture: E2ENativeConversationCapture = { requests: [], explorerActionCount: 0 };

export const recordE2EExplorerAction = (): void => {
  if (process.env.TOMNY_E2E_TEST === '1') e2eNativeConversationCapture.explorerActionCount += 1;
};

const registerE2ENativeConversationCapture = (): void => {
  if (process.env.TOMNY_E2E_TEST !== '1') return;
  ipcMain.handle('e2e.native-conversation-capture.reset', () => {
    e2eNativeConversationCapture.requests.length = 0;
    e2eNativeConversationCapture.explorerActionCount = 0;
    return true;
  });
  ipcMain.handle('e2e.native-conversation-capture.get', () => structuredClone(e2eNativeConversationCapture));
};

export type ExperimentalCoreBridgeOptions = Readonly<{
  requireAuthenticatedAccount?: RequireAuthenticatedAccount;
  /** Integrator-owned native human memory port, initialized after the conversation service. */
  onConversationReady?: (getConversation: (id: string) => Promise<TChatConversation | undefined>) => void;
  /** Main-owned account identity; never supplied by a renderer payload. */
  accountId?: () => string;
  /** Main-owned Telegram egress admission; absence deliberately leaves transport inert. */
  isTelegramExternalAuthorityGranted?: () => boolean;
  /** Main-owned revoke signal for an admitted Telegram polling transport. */
  subscribeTelegramExternalAuthorityRevocation?: (listener: () => void) => () => void;
  /** Optional Main-only confirmed-only learning observer for native chat queries. */
  userUnderstandingConsumer?: UserUnderstandingConsumer;
  /** Optional Main-owned local model broker for confirmed-only understanding. */
  localInferenceBroker?: LocalInferenceBroker;
  /** Optional Main-owned consumer-scoped model ingress for the native gateway. */
  modelService?: TomniGatewayModelService;
  /**
   * Main-owned shared block list used by the human Explorer. Agent writes and edits whose target
   * lies inside a blocked tree are refused. Absence leaves agent mutations unguarded by blocks.
   */
  isAgentTargetBlocked?: (workspace: string, relPath: string) => Promise<boolean>;
  registerAccountExecutionLease?: (lease: AccountExecutionLease) => void;
  /**
   * Main-owned Package lifecycle facts. Package Apps are mirrored as metadata
   * Surface entries only after the Package Manager validates their activation.
   */
  packageSurfaceSource?: PackageSurfaceRegistrySource;
}>;

/** Register the temporary parallel-core IPC surface. */
export const registerExperimentalCoreBridge = (
  agentMeshService: AgentMeshService,
  options: ExperimentalCoreBridgeOptions = {}
): ExperimentalCoreRuntime => {
  if (registeredRuntime) return registeredRuntime;
  registerE2ENativeConversationCapture();
  const sessionStore = new JsonCoreSessionStore(
    path.join(app.getPath('userData'), 'tomny-core', 'session-checkpoints.json')
  );
  const rustSidecar = getMainRustSidecarLifecycle({
    resourcesPath: process.resourcesPath,
    developmentRoot: process.cwd(),
    clientVersion: app.getVersion(),
  });
  const rustAccelerator = new RustRuntimeAccelerator(rustSidecar);
  const primaryEventStore = new JsonlDurableEventStore(
    path.join(app.getPath('userData'), 'tomny-core', 'events.jsonl')
  );
  const eventStore = new RustMirroredDurableEventStore(primaryEventStore, rustSidecar);
  const sessionActionHistory = createTomnySessionActionHistorySource(eventStore, sessionStore);
  options.registerAccountExecutionLease?.({
    name: 'experimental-core.rust-sidecar',
    start: async () => {
      await rustSidecar.start();
    },
    stop: () => rustSidecar.stop(),
  });
  app.once('before-quit', () => void disposeMainRustSidecarLifecycle());
  const telemetrySink = new JsonlCoreTelemetrySink(path.join(app.getPath('userData'), 'tomny-core', 'telemetry.jsonl'));
  const telemetry = new CoreTelemetryRecorder(telemetrySink);
  const permissionStore = new PermissionStore(
    new JsonPermissionRepository(path.join(app.getPath('userData'), 'tomny-core', 'permissions.json'))
  );
  const contextServices = createElectronContextServices();
  const personalMutationsByProfileId = new Map<string, ReturnType<typeof createPersonalContextMutationCoordinator>>();
  const personalLearningByProfileId = new Map<string, ReturnType<typeof createPersonalLearningCoordinator>>();
  const getPersonalProfile = async (): Promise<PersonalContext> => {
    await contextServices.ready;
    const accountId = options.accountId?.();
    if (!accountId) throw new Error('ACCOUNT_PERSONAL_CONTEXT_UNAVAILABLE');
    return ensureActiveAccountPersonalContext(contextServices.store, accountId);
  };
  const getPersonalMutations = async () => {
    const profile = await getPersonalProfile();
    let coordinator = personalMutationsByProfileId.get(profile.id);
    if (!coordinator) {
      coordinator = createPersonalContextMutationCoordinator(contextServices.store, { personalId: profile.id });
      personalMutationsByProfileId.set(profile.id, coordinator);
    }
    return coordinator;
  };
  const getPersonalLearning = async () => {
    const profile = await getPersonalProfile();
    let coordinator = personalLearningByProfileId.get(profile.id);
    if (!coordinator) {
      coordinator = createPersonalLearningCoordinator(contextServices.store, { personalId: profile.id });
      personalLearningByProfileId.set(profile.id, coordinator);
    }
    return coordinator;
  };
  configureSecretContextStoredCallback(async ({ descriptor }) => {
    await (await getPersonalMutations()).bindSecret(descriptor);
  });
  let publishLiveImageOutput: ((update: unknown) => void) | undefined;
  const capabilityHosts = createElectronSurfaceCapabilityHosts(contextServices.vault, {
    packageIdOfSurface: (surfaceId) => packageIdOfSurface(surfaceRegistry.get(surfaceId)),
    publishLiveImageOutput: (update) => publishLiveImageOutput?.(update),
  });
  const remoteServices = createElectronRemoteCoreServices(
    contextServices.vault,
    path.join(app.getPath('userData'), 'tomny-core', 'remote-targets.json')
  );
  const surfaceRegistry = createSurfaceRegistry({
    manifests: createBuiltinSurfaceManifests(),
    defaultSurfaceId: 'chat',
  });
  const packageSurfaceSynchronizer = options.packageSurfaceSource
    ? createPackageSurfaceRegistrySynchronizer(surfaceRegistry, options.packageSurfaceSource)
    : undefined;
  if (packageSurfaceSynchronizer) {
    void packageSurfaceSynchronizer
      .start()
      .catch((error) => console.error('[ExperimentalCore] Package Surface registry synchronization failed.', error));
    app.once('before-quit', () => packageSurfaceSynchronizer.dispose());
  }
  const detectTargets = async () => [
    ...(await detectCoreTargets((candidates) =>
      resolveExecutableOnPath(candidates, (filePath) => rustAccelerator.sha256File(filePath))
    )),
    ...(await remoteServices.detectTargets()),
    await detectLoopbackOpenAiTarget(),
  ];
  // Chat agents write and edit through the same lease table as IDE agents, saved via MTUI.
  registerCoreWorkspaceMutationPort(
    createTeamMutationPort(() => getTeamEditService(), {
      isBlocked: options.isAgentTargetBlocked,
    })
  );
  const adapters = [
    new TomnyCoreAdapter(undefined, sessionActionHistory),
    new CodexAppServerAdapter(),
    new AcpCoreAdapter(),
    new LoopbackOpenAiAdapter(),
    remoteServices.adapter,
  ];
  const coreEventListeners = new Set<(event: ExperimentalCoreEvent) => void>();
  const emitCoreEvent = (event: ExperimentalCoreEvent): void => {
    if (event.type === 'started') activeLiveImageRuns.add(event.requestId);
    channels.event.emit(event);
    publishTomniRemoteEvent({ kind: 'core', payload: event });
    for (const listener of coreEventListeners) listener(event);
  };
  const runtime = new ExperimentalCoreRuntime(emitCoreEvent, {
    detectTargets,
    adapters,
    sessionStore,
    eventStore,
    telemetry,
    permissionStore,
    surfaceRegistry,
    companyRunner: createCompanyCoreRunner(),
    agentMeshService,
    contextComposer: contextServices.composer,
    // Package connection servers keep `package-secret://` placeholders everywhere else; the values are filled here,
    // in Main, for the run that is about to launch them (docs/platform/repotopackage-design.md section 10.2).
    resolveCapabilityHosts: async (serverNames, sessionServers, context) =>
      resolveCoreMcpServers(await capabilityHosts.resolve(serverNames, sessionServers, context)),
    availableCapabilityHostNames: () => capabilityHosts.names(),
  });
  registeredRuntime = runtime;
  const experimentalFoundationLifecycle = createFoundationRunLifecycle(runtime, {
    origin: 'tomny://experimental-core',
  });
  const benchmarkFoundationLifecycle = createFoundationRunLifecycle(runtime, {
    origin: 'tomny://benchmark',
  });
  const benchmarkService = new BenchmarkService({
    store: new BenchmarkStore(path.join(app.getPath('userData'), 'testing', 'benchmarks', 'catalog.json')),
    tomny: {
      listTargets: () => runtime.listTargets(),
      listModels: (targetId, workspace) => runtime.listModels(targetId, workspace),
      start: ({ requestId, sessionId, targetId, prompt, workspace, modelKey, permissionMode, contextIdentity }) =>
        benchmarkFoundationLifecycle.start({
          requestId,
          sessionId,
          targetId,
          prompt,
          workspace,
          modelKey,
          permissionMode,
          contextIdentity,
        }),
      cancel: (requestId) => benchmarkFoundationLifecycle.cancel(requestId),
      resolvePermission: (permissionId, approved) => runtime.resolvePermission(permissionId, approved, 'allow-once'),
      resolveOrchestrationProposal: (proposalId, approved) =>
        runtime.resolveOrchestrationProposal(proposalId, approved),
      firstTokenMs: async (requestId) =>
        (await telemetrySink.query({ runId: requestId, limit: 100 })).find((event) => event.kind === 'first-token')
          ?.elapsedMs ?? null,
      subscribe: (listener) => {
        coreEventListeners.add(listener);
        return () => coreEventListeners.delete(listener);
      },
    },
  });
  registerBenchmarkBridge(benchmarkService);
  const liveImageOutputStore = createLiveImageOutputStore({
    indexPath: path.join(app.getPath('userData'), 'tomny-core', 'live-image-outputs.json'),
  });
  let liveImageOutputs: ReturnType<typeof createLiveImageOutputCoordinator> | undefined;
  const activeLiveImageRuns = new Set<string>();
  publishLiveImageOutput = async (raw: unknown): Promise<void> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('LIVE_IMAGE_OUTPUT_REQUEST_INVALID');
    const request = raw as Record<string, unknown>;
    const outputId = typeof request.outputId === 'string' ? request.outputId : '';
    const tabId = typeof request.tabId === 'string' ? request.tabId : '';
    const requestId = typeof request.requestId === 'string' ? request.requestId : '';
        const conversationId = typeof request.conversationId === 'string' ? request.conversationId : '';
    const accountId = options.accountId?.();
    const workspace = typeof request.workspace === 'string' ? request.workspace : '';
        if (!/^[A-Za-z0-9._:@-]{1,200}$/u.test(outputId) || !/^[A-Za-z0-9._:@-]{1,200}$/u.test(conversationId) || !accountId || !tabId || !activeLiveImageRuns.has(requestId)) {
      throw new Error('LIVE_IMAGE_OUTPUT_REQUEST_INVALID');
    }
    const publisher = createRunScopedScreenshotPublisher({
            runId: requestId,
      accountId,
      conversationId,
      workspace,
      pagePerception: getBrowserControlDeps(getApplicationMainWindow).pagePerception,
      outputs: liveImageOutputs ?? (() => { throw new Error('LIVE_IMAGE_OUTPUT_UNAVAILABLE'); })(),
      isRunActive: () => activeLiveImageRuns.has(requestId),
    });
    await publisher.capture({ outputId, tabId });
  };
  const conversationRuntime: NativeConversationRuntime =
    process.env.TOMNY_E2E_TEST === '1'
      ? {
          start: (requestId, _targetId, _prompt, _workspace, _modelKey, _permissionMode, sessionId) => ({
            requestId,
            sessionId,
            terminal: Promise.resolve({ type: 'cancelled' as const, text: 'E2E fake runtime completed.' }),
          }),
          cancel: async () => true,
          inspectContext: (input) => runtime.inspectContext(input),
          resolvePermission: (permissionId, approved, lifetime) => runtime.resolvePermission(permissionId, approved, lifetime),
          resolveOrchestrationProposal: (proposalId, approved) => runtime.resolveOrchestrationProposal(proposalId, approved),
          getSession: (sessionId) => runtime.getSession(sessionId),
          updateSessionConfig: (sessionId, config) => runtime.updateSessionConfig(sessionId, config),
                    listModels: (targetId, workspace) => runtime.listModels(targetId, workspace),
                    listCommands: (targetId, workspace, logicalSessionId, onUpdate) =>
            runtime.listCommands(targetId, workspace, logicalSessionId, onUpdate),
          releaseCommands: (logicalSessionId) => runtime.releaseCommands(logicalSessionId),
        }
      : createFoundationConversationRuntime(runtime, {
          onTerminalReceipt: async (receipt) => {
            await liveImageOutputs?.finishRun({
              runId: receipt.runId,
              receiptId: receipt.receiptId,
              status: receipt.status === 'approval_required' ? 'failed' : receipt.status,
            });
            activeLiveImageRuns.delete(receipt.runId);
            await stopRunScopedBrowserControlMcpHost(receipt.runId);
          },
        });

  const conversationService = registerNativeConversationBridge({
    filePath: path.join(app.getPath('userData'), 'tomny-core', 'conversations.json'),

    legacyDatabasePath: discoverLegacyDatabasePaths(),
    runtime: conversationRuntime,
    onSessionEnded: (sessionId) => {
      getSecretRequestStore().clearSession(sessionId);
      void contextServices.vault.removeSession(sessionId).catch((): undefined => undefined);
    },
    e2eCapture:
      process.env.TOMNY_E2E_TEST === '1'
        ? (record) => {
            e2eNativeConversationCapture.requests.push(structuredClone(record));
          }
        : undefined,
    workspaceProvisioner: async (conversation: TChatConversation) => {
      const candidate = (conversation.extra as Record<string, unknown>).surface;
      const surface = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : 'chat';
      const safeSurface = surface.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'chat';
      const workspace = path.join(
        app.getPath('userData'),
        'tomny-core',
        'surface-workspaces',
        safeSurface,
        conversation.id
      );
      await mkdir(workspace, { recursive: true });
      if (process.env.TOMNY_E2E_TEST === '1') {
        await mkdir(path.join(workspace, '.tomni', 'understand'), { recursive: true });
        await mkdir(path.join(workspace, 'src'), { recursive: true });
        await mkdir(path.join(workspace, 'docs'), { recursive: true });
        await writeFile(path.join(workspace, 'src', 'a.ts'), 'export const answer = 42;\n', 'utf8');
        await writeFile(
          path.join(workspace, '.tomni', 'understand', 'summary.json'),
          JSON.stringify({ modules: [{ id: 'docs', summary: 'Canonical docs summary.' }] }),
          'utf8'
        );
      }
      return workspace;
    },
    subscribeCore: (listener) => {
      coreEventListeners.add(listener);
      return () => coreEventListeners.delete(listener);
    },
        requireAuthenticatedAccount: options.requireAuthenticatedAccount,
    accountId: options.accountId,
    liveImageOutputStore,
    userUnderstandingConsumer: options.userUnderstandingConsumer,
  });
  liveImageOutputs = createLiveImageOutputCoordinator({
    store: liveImageOutputStore,
    emit: (update) => conversationService.publishLiveImageOutput(update),
  });

  options.onConversationReady?.((id) => conversationService.get(id));
  registerTomniRemoteConversations(conversationService);
  // Home shows every running agent turn; it observes the same event stream the remote gateway reads.
  const hubActivity = getHubActivityRegistry();
    registerHubActivityBridge(hubActivity, options.requireAuthenticatedAccount, (id) => conversationService.get(id));
  registerLiveSessionsBridge(getLiveSessionRegistry(), options.requireAuthenticatedAccount);
  attachConversationActivity(hubActivity, subscribeTomniRemoteEvents, conversationService);
  // Home must show the previous grid right after boot, not only work from this run.
  restoreHubActivityGrid(hubActivity, path.join(app.getPath('userData'), 'tomny-core', 'runs', 'hub-activity.json'));
  // The local Whisper sidecar starts on the first voice message and stops itself after a quiet period.
  let localWhisper: ReturnType<typeof createLocalWhisperTranscriber> | undefined;
  let localWhisperKey = '';
  const telegramService = new TelegramChannelService({
    statePath: path.join(app.getPath('userData'), 'tomny-core', 'channels', 'telegram.json'),
    vault: contextServices.vault,
    conversations: conversationService,
    events: {
      pairingRequested: (value) => telegramChannel.pairingRequested.emit(value),
      userAuthorized: (value) => telegramChannel.userAuthorized.emit(value),
      statusChanged: (status) => telegramChannel.pluginStatusChanged.emit({ plugin_id: 'telegram', status }),
    },
    readSettings: async () => {
      const [selection, agent] = await Promise.all([
        ProcessConfig.get('assistant.telegram.defaultModel'),
        ProcessConfig.get('assistant.telegram.agent'),
      ]);
      const provider = selection
        ? (await listReadyProviders()).find((candidate) => candidate.id === selection.id)
        : undefined;
      return {
        model: provider && selection ? { ...provider, use_model: selection.use_model } : undefined,
        agent,
      };
    },
    resolveVoiceTranscriber: async () => {
      const local = await ProcessConfig.get('assistant.telegram.sttLocal');
      if (local?.enabled) {
        const size = local.size ?? 'base';
        // A missing model is reported to the user by the sidecar's setup message, so the path is passed either way.
        const modelDir =
          findLocalWhisperModel(size, app.getPath('userData')) ??
          localWhisperModelDirs(size, app.getPath('userData'))[0];
        const key = `${size}:${modelDir}:${local.prompt ?? ''}`;
        if (!localWhisper || localWhisperKey !== key) {
          localWhisper?.stop();
          localWhisper = createLocalWhisperTranscriber({
            modelDir,
            scriptPath: path.resolve(process.cwd(), 'scripts/whisper_sidecar.py'),
            language: 'vi',
            initialPrompt: local.prompt?.trim() || undefined,
          });
          localWhisperKey = key;
        }
        return localWhisper;
      }
      const selection = await ProcessConfig.get('assistant.telegram.sttModel');
      if (!selection?.id || !selection.use_model) return undefined;
      const provider = (await listReadyProviders()).find((candidate) => candidate.id === selection.id);
      if (!provider?.base_url || !provider.api_key) return undefined;
      return createOpenAiCompatibleTranscriber({
        baseUrl: provider.base_url,
        model: selection.use_model,
        getApiKey: async () => provider.api_key,
      });
    },
    requireAuthenticatedAccount: options.requireAuthenticatedAccount,
    isExternalAuthorityGranted: options.isTelegramExternalAuthorityGranted,
    subscribeExternalAuthorityRevocation: options.subscribeTelegramExternalAuthorityRevocation,
  });
  registerTelegramChannelBridge(telegramService);
  subscribeTomniRemoteEvents((event) => {
    if (event.kind === 'conversation.completed') void telegramService.forwardCompleted(event.payload);
  });
  options.registerAccountExecutionLease?.({
    name: 'experimental-core.telegram-polling',
    start: () => telegramService.resume(),
    stop: () => telegramService.suspendPolling(),
  });
  // Each scheduled run is a turn of a real conversation (tagged with the task id), so its answer is kept and shown.
  const runConversations = createRunConversationTracker();
  const scheduledRunner = createScheduledConversationRunner({
    port: {
      get: (id) => conversationService.get(id),
      create: (params) => conversationService.create(params),
      send: async (params) => {
        options.requireAuthenticatedAccount?.();
        return conversationService.send(params);
      },
      cancel: (conversationId) => conversationService.cancel(conversationId),
      resolvePermission: (permissionId, approved) => conversationService.resolvePermission(permissionId, approved),
      subscribe: (listener) => subscribeTomniRemoteEvents(listener),
    },
    describe: (taskId) => scheduledService.get(taskId),
    skillFor: (taskId) => legacyCronAdapter.readSkill({ job_id: taskId }),
    onConversation: (taskId, conversationId) => runConversations.started(taskId, conversationId),
  });
  let legacyCronAdapter!: LegacyCronAdapter;
  const scheduledService = createCoreScheduledTaskService({
    store: new JsonCoreScheduleStore(path.join(app.getPath('userData'), 'tomny-core', 'scheduled-tasks.json')),
    runner: scheduledRunner,
    onAudit: (event) => {
      if (!legacyCronAdapter || !event.kind.startsWith('run.')) return;
      reportScheduledRun(
        hubActivity,
        event,
        async (taskId) => (await legacyCronAdapter?.getJob({ job_id: taskId }))?.name
      );
      setTimeout(() => {
        void legacyCronAdapter?.getJob({ job_id: event.taskId }).then((job) => {
          if (!job) return;
          cron.onJobUpdated.emit(job);
          if (event.kind === 'run.completed') cron.onJobExecuted.emit({ job_id: event.taskId, status: 'ok' });
          else if (event.kind === 'run.failed' || event.kind === 'run.cancelled' || event.kind === 'run.interrupted')
            cron.onJobExecuted.emit({ job_id: event.taskId, status: 'error', error: event.detail });
          else if (event.kind === 'run.skipped.missed')
            cron.onJobExecuted.emit({ job_id: event.taskId, status: 'missed' });
          else if (event.kind === 'run.skipped.overlap')
            cron.onJobExecuted.emit({ job_id: event.taskId, status: 'skipped' });
        });
      }, 0);
    },
  });
  hubActivity.registerController('schedule', { stop: (taskId) => scheduledService.cancel(taskId) });
  let resolveScheduledReady: (() => void) | undefined;
  const scheduledReady = new Promise<void>((resolve) => {
    resolveScheduledReady = resolve;
  });
  const startScheduledTasks = async (): Promise<void> => {
    await scheduledService.start();
    resolveScheduledReady?.();
    resolveScheduledReady = undefined;
  };
  const startGateway = async (): Promise<void> => {
    const endpoint = await startProductionTomniGateway({
      conversation: conversationService,
      teams: new JsonTeamStore(path.join(app.getPath('userData'), 'tomny-core', 'teams.json')),
      companies: getCompanyServices(),
      cron: scheduledService,
      mcp: getMcpRegistry(),
      modelService: options.modelService,
      dataDir: app.getPath('userData'),
      subscribe: (listener) => {
        const forward = (event: ExperimentalCoreEvent): void =>
          listener({ topic: `core.${event.type}`, data: event, timestamp: event.timestamp });
        coreEventListeners.add(forward);
        return () => coreEventListeners.delete(forward);
      },
    });
    console.log(`[TomnyGateway] Listening on ${endpoint.url}.`);
  };
  void startScheduledTasks().catch((error) => console.error('[ScheduledTasks] Startup failed:', error));
  void startGateway().catch((error) => console.error('[TomnyGateway] Startup failed:', error));
  app.once('before-quit', () => {
    void scheduledService.stop();
    void stopProductionTomniGateway();
  });
  options.registerAccountExecutionLease?.({
    name: 'experimental-core.scheduled-tasks',
    start: startScheduledTasks,
    stop: () => scheduledService.stop(),
  });
  options.registerAccountExecutionLease?.({
    name: 'experimental-core.tomny-gateway',
    start: startGateway,
    stop: stopProductionTomniGateway,
  });
  legacyCronAdapter = new LegacyCronAdapter({
    service: scheduledService,
    ready: scheduledReady,
    skillsDirectory: getCronSkillsDir(),
    defaultWorkspace: app.getPath('home'),
    awaitRunConversation: (taskId) => runConversations.next(taskId),
    events: {
      created: (job) => cron.onJobCreated.emit(job),
      updated: (job) => cron.onJobUpdated.emit(job),
      removed: (jobId) => cron.onJobRemoved.emit({ job_id: jobId }),
      executed: (event) => cron.onJobExecuted.emit(event),
    },
  });
  configureLegacyCronAdapter(legacyCronAdapter);
  const scheduledHandlers = createCoreScheduledTaskIpcHandlers(scheduledService);
  const registerAuthenticated = <Input, Result>(
    channel: { provider: (handler: (input: Input) => Promise<Result>) => unknown },
    operation: (input: Input) => Result | Promise<Result>
  ): void => {
    const guarded = guardAccountExecution(options.requireAuthenticatedAccount ?? (() => {}), operation);
    channel.provider(async (input) => guarded(input));
  };
  channels.listTargets.provider(() => runtime.listTargets());
  channels.listModels.provider(({ targetId, workspace }) => runtime.listModels(targetId, workspace));
  channels.listSessions.provider(() => runtime.listSessions());

  channels.listActiveRuns.provider(() => Promise.resolve(runtime.listActiveRuns()));
  channels.replayEvents.provider((query) => runtime.replayEvents(query));
  registerAuthenticated(channels.resumeInterrupted, ({ sessionId, requestId }) =>
    runtime.resumeInterrupted(sessionId, requestId)
  );
  registerAuthenticated(channels.forkSession, ({ sessionId }) => runtime.forkSession(sessionId));
  registerAuthenticated(
    channels.start,
    async ({
      requestId,
      sessionId,
      targetId,
      prompt,
      workspace,
      modelKey,
      surface,
      agentId,
      permissionScopes,
      capabilityGrants,
      availableCapabilities,
      modelCapabilities,
      permissionMode,
    }) => {
      const profile = await getPersonalProfile();
      return experimentalFoundationLifecycle.start({
        requestId,
        targetId,
        prompt,
        workspace,
        modelKey,
        permissionMode,
        sessionId,
        contextIdentity: {
          surface,
          agentId,
          // Renderer input cannot select a different account's profile.
          personalId: profile.id,
          permissionScopes,
          capabilityGrants,
          availableCapabilities,
          modelCapabilities,
        },
      });
    }
  );
  registerAuthenticated(channels.cancel, ({ requestId }) => experimentalFoundationLifecycle.cancel(requestId));
  registerAuthenticated(channels.resolvePermission, ({ permissionId, approved, lifetime }) =>
    runtime.resolvePermission(permissionId, approved, lifetime)
  );
  registerAuthenticated(channels.resolveOrchestrationProposal, ({ proposalId, approved }) =>
    runtime.resolveOrchestrationProposal(proposalId, approved)
  );
  registerAuthenticated(channels.personalGet, () => getPersonalProfile());
  registerAuthenticated(channels.personalSave, async ({ profile }) =>
    (await getPersonalMutations()).saveProfile(profile)
  );
  registerAuthenticated(channels.personalLearningSetPaused, async (input) =>
    (await getPersonalLearning()).setPaused(parsePersonalLearningControlRequest(input).paused)
  );
  registerAuthenticated(channels.personalLearningPropose, async (input) =>
    (await getPersonalLearning()).propose(parsePersonalLearningProposeRequest(input))
  );
  registerAuthenticated(channels.personalLearningConfirm, async (input) =>
    (await getPersonalLearning()).confirm(parsePersonalLearningRecordId(input))
  );
  registerAuthenticated(channels.personalLearningReject, async (input) =>
    (await getPersonalLearning()).reject(parsePersonalLearningRecordId(input))
  );
  registerAuthenticated(channels.personalLearningCorrect, async (input) => {
    const request = parsePersonalLearningCorrectRequest(input);
    return (await getPersonalLearning()).correct(request.recordId, request.fact, request.explanation, request.causal);
  });
  registerAuthenticated(channels.personalLearningOutcome, async (input) => {
    const request = parsePersonalLearningOutcomeRequest(input);
    return (await getPersonalLearning()).recordOutcome(request.recordId, request.outcome);
  });
  registerAuthenticated(channels.personalLearningForget, async (input) =>
    (await getPersonalLearning()).forget(parsePersonalLearningRecordId(input))
  );
  registerAuthenticated(channels.personalLearningDelete, async (input) =>
    (await getPersonalLearning()).delete(parsePersonalLearningRecordId(input))
  );
  registerAuthenticated(channels.personalLearningExport, async () => (await getPersonalLearning()).export());
  registerAuthenticated(channels.personalSecretsList, async () => {
    const profile = await getPersonalProfile();
    const allowedHandles = new Set(profile.secretReferences.map((reference) => reference.handle));
    return (await contextServices.vault.list()).filter((descriptor) => allowedHandles.has(descriptor.handle));
  });
  registerAuthenticated(channels.personalSecretsSave, async ({ handle, name, note, targets, destinations, variables }) => {
    const profile = await getPersonalProfile();
    if (handle && !profile.secretReferences.some((reference) => reference.handle === handle)) {
      throw new Error('ACCOUNT_PERSONAL_SECRET_NOT_FOUND');
    }
    if (typeof name !== 'string' || !name.trim()) throw new Error('A secret-set name is required.');
    if (!Array.isArray(variables) || variables.length === 0 || variables.length > 50) {
      throw new Error('A secret set must contain between 1 and 50 variables.');
    }
    const normalized = variables.map((item) => ({
      name: typeof item?.name === 'string' ? item.name.trim() : '',
      value: typeof item?.value === 'string' ? item.value : '',
    }));
    if (
      normalized.some((item) => !item.name || !item.value) ||
      new Set(normalized.map((item) => item.name)).size !== normalized.length
    ) {
      throw new Error('Every secret variable requires a unique name and a value.');
    }
    // Without destinations this is the original web-plus-firewall binding; a terminal-only set needs no hostname.
    const binding = bindingForPersonalSet(parseSecretDestinations(destinations), targets);
    const fields = normalized.map((item) => item.name);
    const payload = Object.fromEntries(normalized.map((item) => [item.name, item.value]));
    const descriptorInput = {
      label: name,
      note,
      kind: 'credential' as const,
      fields,
      binding,
    };
    const descriptor = handle
      ? await contextServices.vault.replace(handle, descriptorInput, payload)
      : await contextServices.vault.put(descriptorInput, payload);
    await (await getPersonalMutations()).bindSecret(descriptor);
    return descriptor;
  });
  registerAuthenticated(channels.personalSecretsRemove, async ({ handle }) => {
    const profile = await getPersonalProfile();
    if (!profile.secretReferences.some((reference) => reference.handle === handle)) {
      throw new Error('ACCOUNT_PERSONAL_SECRET_NOT_FOUND');
    }
    const removed = await contextServices.vault.remove(handle);
    await (await getPersonalMutations()).removeSecretReference(handle);
    return removed;
  });
  registerAuthenticated(cron.listJobs, () => legacyCronAdapter.listJobs());
  registerAuthenticated(cron.listJobsByConversation, (input) => legacyCronAdapter.listJobsByConversation(input));
  registerAuthenticated(cron.getJob, (input) => legacyCronAdapter.getJob(input));
  registerAuthenticated(cron.addJob, (input) => legacyCronAdapter.addJob(input));
  registerAuthenticated(cron.updateJob, (input) => legacyCronAdapter.updateJob(input));
  registerAuthenticated(cron.removeJob, (input) => legacyCronAdapter.removeJob(input));
  registerAuthenticated(cron.runNow, (input) => legacyCronAdapter.runNow(input));
  registerAuthenticated(cron.saveSkill, (input) => legacyCronAdapter.saveSkill(input));
  registerAuthenticated(cron.hasSkill, (input) => legacyCronAdapter.hasSkill(input));
  registerAuthenticated(cron.deleteSkill, (input) => legacyCronAdapter.deleteSkill(input));
  registerAuthenticated(conversationChannels.listByCronJob, async ({ cron_job_id: job_id }) => {
    const { items } = await conversationService.list(undefined, 200);
    return items
      .filter((conversation) => (conversation.extra as Record<string, unknown>)?.cron_job_id === job_id)
      .toSorted((a, b) => (b.modified_at ?? 0) - (a.modified_at ?? 0));
  });
  registerAuthenticated(channels.scheduledList, async () => {
    await scheduledReady;
    return scheduledHandlers.list();
  });
  registerAuthenticated(channels.scheduledGet, async (input) => {
    await scheduledReady;
    return scheduledHandlers.get(input);
  });
  registerAuthenticated(channels.scheduledSave, async (input) => {
    await scheduledReady;
    return scheduledHandlers.save(input);
  });
  registerAuthenticated(channels.scheduledRemove, async (input) => {
    await scheduledReady;
    return scheduledHandlers.remove(input);
  });
  registerAuthenticated(channels.scheduledRunNow, async (input) => {
    await scheduledReady;
    return scheduledHandlers.runNow(input);
  });
  registerAuthenticated(channels.scheduledCancel, async (input) => {
    await scheduledReady;
    return scheduledHandlers.cancel(input);
  });
  registerAuthenticated(channels.scheduledAudit, async (input) => {
    await scheduledReady;
    return scheduledHandlers.listAudit(input);
  });
  registerAuthenticated(channels.queryTelemetry, async (query) =>
    (await telemetrySink.query({ ...query, limit: normalizeTelemetryLimit(query.limit) })).map(
      toPublicCoreTelemetryEvent
    )
  );
  channels.doctor.provider(async ({ limit }) => {
    try {
      const [targets, events, rustHealth] = await Promise.all([
        detectTargets(),
        telemetrySink.query({ limit: normalizeTelemetryLimit(limit) }),
        rustSidecar.health(),
      ]);
      return buildCoreDoctorReport({
        targets,
        adapters,
        telemetry: events,
        additionalChecks: [
          {
            id: 'rust-runtime',
            status: rustHealth.status,
            summary: rustHealth.runtimeVersion
              ? `${rustHealth.summary} Runtime ${rustHealth.runtimeVersion}.`
              : rustHealth.summary,
          },
        ],
      });
    } catch {
      return {
        generatedAt: Date.now(),
        status: 'unhealthy',
        checks: [
          {
            id: 'doctor-unavailable',
            status: 'error',
            summary: 'Core diagnostics could not inspect the local runtime.',
          },
        ],
        metrics: {
          runCount: 0,
          completionRate: 0,
          retryRate: 0,
          toolFailureRate: 0,
        },
      };
    }
  });
  return runtime;
};
