/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';
import '@/common/adapter/bridgeErrorWrapper';
import {
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
import { app } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { createFoundationConversationRuntime, createFoundationRunLifecycle } from '@process/bridge/foundationBridge';
import {
  guardAccountExecution,
  registerNativeConversationBridge,
  type RequireAuthenticatedAccount,
} from '@process/services/database/nativeConversation';
import type { TChatConversation } from '@/common/config/storage';
import {
  publishTomniRemoteEvent,
  registerTomniRemoteConversations,
  subscribeTomniRemoteEvents,
} from '@process/services/remoteGateway/registry';
import { registerTelegramChannelBridge } from '@process/services/telegram/bridge';
import { TelegramChannelService } from '@process/services/telegram/service';

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
import { normalizeExactSecretHostnames } from '@process/agentRuntime/secretVault';
import {
  bindScheduledCoreRuntime,
  configureLegacyCronAdapter,
  createCoreScheduledTaskIpcHandlers,
  createCoreScheduledTaskService,
  createScheduledCoreRuntimeRunner,
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

export type ExperimentalCoreBridgeOptions = Readonly<{
  requireAuthenticatedAccount?: RequireAuthenticatedAccount;
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
  const capabilityHosts = createElectronSurfaceCapabilityHosts(contextServices.vault);
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
  const adapters = [
    new TomnyCoreAdapter(undefined, sessionActionHistory),
    new CodexAppServerAdapter(),
    new AcpCoreAdapter(),
    new LoopbackOpenAiAdapter(),
    remoteServices.adapter,
  ];
  const coreEventListeners = new Set<(event: ExperimentalCoreEvent) => void>();
  const emitCoreEvent = (event: ExperimentalCoreEvent): void => {
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
    resolveCapabilityHosts: (serverNames, sessionServers, context) =>
      capabilityHosts.resolve(serverNames, sessionServers, context),
    availableCapabilityHostNames: () => capabilityHosts.names(),
  });
  registeredRuntime = runtime;
  const experimentalFoundationLifecycle = createFoundationRunLifecycle(runtime, {
    origin: 'tomny://experimental-core',
  });
  const benchmarkFoundationLifecycle = createFoundationRunLifecycle(runtime, {
    origin: 'tomny://benchmark',
  });
  const scheduledFoundationLifecycle = createFoundationRunLifecycle(runtime, {
    origin: 'tomny://scheduler',
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
  const conversationService = registerNativeConversationBridge({
    filePath: path.join(app.getPath('userData'), 'tomny-core', 'conversations.json'),

    legacyDatabasePath: discoverLegacyDatabasePaths(),
    runtime: createFoundationConversationRuntime(runtime),
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
      return workspace;
    },
    subscribeCore: (listener) => {
      coreEventListeners.add(listener);
      return () => coreEventListeners.delete(listener);
    },
    requireAuthenticatedAccount: options.requireAuthenticatedAccount,
    userUnderstandingConsumer: options.userUnderstandingConsumer,
  });
  registerTomniRemoteConversations(conversationService);
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
  const scheduledPort = bindScheduledCoreRuntime(
    {
      start: (
        requestId,
        targetId,
        prompt,
        workspace,
        modelKey,
        permissionMode,
        sessionId,
        _companyId,
        contextIdentity
      ) => {
        options.requireAuthenticatedAccount?.();
        return scheduledFoundationLifecycle.start({
          requestId,
          targetId,
          prompt,
          workspace,
          modelKey,
          permissionMode,
          sessionId,
          contextIdentity,
        });
      },
      cancel: (requestId) => scheduledFoundationLifecycle.cancel(requestId),
      resolvePermission: (permissionId, approved) => runtime.resolvePermission(permissionId, approved),
    },
    (listener) => {
      coreEventListeners.add(listener);
      return () => coreEventListeners.delete(listener);
    }
  );
  let legacyCronAdapter!: LegacyCronAdapter;
  const scheduledService = createCoreScheduledTaskService({
    store: new JsonCoreScheduleStore(path.join(app.getPath('userData'), 'tomny-core', 'scheduled-tasks.json')),
    runner: createScheduledCoreRuntimeRunner(scheduledPort),
    onAudit: (event) => {
      if (!legacyCronAdapter || !event.kind.startsWith('run.')) return;
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
  registerAuthenticated(channels.personalSecretsSave, async ({ handle, name, note, targets, variables }) => {
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
    const normalizedTargets = normalizeExactSecretHostnames(targets);
    const fields = normalized.map((item) => item.name);
    const payload = Object.fromEntries(normalized.map((item) => [item.name, item.value]));
    const descriptorInput = {
      label: name,
      note,
      kind: 'credential' as const,
      fields,
      binding: {
        surfaces: ['browser', 'secret-firewall'],
        purposes: ['browser-fill', 'opaque-use'],
        targets: normalizedTargets,
      },
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
