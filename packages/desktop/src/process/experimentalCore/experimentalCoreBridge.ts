/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';
import { cron, telegramChannel, type PersonalSecretSetSaveRequest } from '@/common/adapter/ipcBridge';
import { app } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { registerNativeConversationBridge } from '@process/services/database/nativeConversation';
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
import { startProductionTomniGateway } from '@process/tomnigateway';
import { createCompanyCoreRunner } from '@process/agentRuntime/companyCoreRunner';
import { configureSecretContextStoredCallback } from '@process/agentRuntime/agentMesh/mcp/secret-context/wiring';
import type { AgentMeshService } from '@process/agentRuntime/agentMesh/service';
import { createElectronContextServices } from '@process/agentRuntime/electronContext';
import { createPersonalContextMutationCoordinator } from '@process/agentRuntime/contextStore';
import type { PersonalContext, SecretDescriptor } from '@process/agentRuntime/contextTypes';
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
import { createBuiltinSurfaceManifests, createSurfaceRegistry } from '@process/agentRuntime/surfaceRegistry';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import { buildCoreDoctorReport, type CoreDoctorReport } from '@process/services/diagnostics/coreDoctor';
import {
  CoreTelemetryRecorder,
  JsonlCoreTelemetrySink,
  toPublicCoreTelemetryEvent,
  type CoreTelemetryEvent,
} from '@process/services/diagnostics/coreTelemetry';
import { JsonPermissionRepository, PermissionStore } from '@process/services/agentChat/permission';
import {
  AcpCoreAdapter,
  CodexAppServerAdapter,
  disposeMainRustSidecarLifecycle,
  getMainRustSidecarLifecycle,
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

let registered = false;

/** Register the temporary parallel-core IPC surface. */
export const registerExperimentalCoreBridge = (agentMeshService: AgentMeshService): void => {
  if (registered) return;
  registered = true;
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
  void rustSidecar.start().catch((): void => undefined);
  app.once('before-quit', () => void disposeMainRustSidecarLifecycle());
  const telemetrySink = new JsonlCoreTelemetrySink(path.join(app.getPath('userData'), 'tomny-core', 'telemetry.jsonl'));
  const telemetry = new CoreTelemetryRecorder(telemetrySink);
  const permissionStore = new PermissionStore(
    new JsonPermissionRepository(path.join(app.getPath('userData'), 'tomny-core', 'permissions.json'))
  );
  const contextServices = createElectronContextServices();
  const getPersonalProfile = async (): Promise<PersonalContext> => {
    await contextServices.ready;
    const profile = await contextServices.store.getPersonal('default');
    if (!profile) throw new Error('Default Personal Context is unavailable.');
    return profile;
  };
  const personalMutations = createPersonalContextMutationCoordinator({
    getPersonal: async (id) => {
      await contextServices.ready;
      return contextServices.store.getPersonal(id);
    },
    upsertPersonal: async (profile) => {
      await contextServices.ready;
      return contextServices.store.upsertPersonal(profile);
    },
  });
  configureSecretContextStoredCallback(({ descriptor }) => personalMutations.bindSecret(descriptor));
  const capabilityHosts = createElectronSurfaceCapabilityHosts(contextServices.vault);
  const remoteServices = createElectronRemoteCoreServices(
    contextServices.vault,
    path.join(app.getPath('userData'), 'tomny-core', 'remote-targets.json')
  );
  const surfaceRegistry = createSurfaceRegistry({
    manifests: createBuiltinSurfaceManifests(),
    defaultSurfaceId: 'chat',
  });
  const detectTargets = async () => [
    ...(await detectCoreTargets((candidates) =>
      resolveExecutableOnPath(candidates, (filePath) => rustAccelerator.sha256File(filePath))
    )),
    ...(await remoteServices.detectTargets()),
  ];
  const adapters = [
    new TomnyCoreAdapter(undefined, sessionActionHistory),
    new CodexAppServerAdapter(),
    new AcpCoreAdapter(),
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
  const benchmarkService = new BenchmarkService({
    store: new BenchmarkStore(path.join(app.getPath('userData'), 'testing', 'benchmarks', 'catalog.json')),
    tomny: {
      listTargets: () => runtime.listTargets(),
      listModels: (targetId, workspace) => runtime.listModels(targetId, workspace),
      start: ({ requestId, sessionId, targetId, prompt, workspace, modelKey, permissionMode, contextIdentity }) =>
        runtime.start(
          requestId,
          targetId,
          prompt,
          workspace,
          modelKey,
          permissionMode,
          sessionId,
          undefined,
          contextIdentity
        ),
      cancel: (requestId) => runtime.cancel(requestId),
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
    runtime,
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
  });
  registerTelegramChannelBridge(telegramService);
  subscribeTomniRemoteEvents((event) => {
    if (event.kind === 'conversation.completed') void telegramService.forwardCompleted(event.payload);
  });
  void telegramService.resume().catch((error) => console.error('[Telegram] Native polling startup failed:', error));
  const scheduledPort = bindScheduledCoreRuntime(runtime, (listener) => {
    coreEventListeners.add(listener);
    return () => coreEventListeners.delete(listener);
  });
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
  const scheduledReady = scheduledService.start();
  void scheduledReady.catch((error) => console.error('[TomnyCore] Scheduled task startup failed:', error));
  void scheduledReady
    .then(() =>
      startProductionTomniGateway({
        conversation: conversationService,
        teams: new JsonTeamStore(path.join(app.getPath('userData'), 'tomny-core', 'teams.json')),
        companies: getCompanyServices(),
        cron: scheduledService,
        mcp: getMcpRegistry(),
        dataDir: app.getPath('userData'),
        subscribe: (listener) => {
          const forward = (event: ExperimentalCoreEvent): void =>
            listener({ topic: `core.${event.type}`, data: event, timestamp: event.timestamp });
          coreEventListeners.add(forward);
          return () => coreEventListeners.delete(forward);
        },
      })
    )
    .then((endpoint) => console.log(`[TomnyGateway] Listening on ${endpoint.url}.`))
    .catch((error) => console.error('[TomnyGateway] Startup failed:', error));
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
  channels.listTargets.provider(() => runtime.listTargets());
  channels.listModels.provider(({ targetId, workspace }) => runtime.listModels(targetId, workspace));
  channels.listSessions.provider(() => runtime.listSessions());

  channels.listActiveRuns.provider(() => Promise.resolve(runtime.listActiveRuns()));
  channels.replayEvents.provider((query) => runtime.replayEvents(query));
  channels.resumeInterrupted.provider(({ sessionId, requestId }) => runtime.resumeInterrupted(sessionId, requestId));
  channels.forkSession.provider(({ sessionId }) => runtime.forkSession(sessionId));
  channels.start.provider(
    ({
      requestId,
      sessionId,
      targetId,
      prompt,
      workspace,
      modelKey,
      companyId,
      surface,
      agentId,
      personalId,
      permissionScopes,
      capabilityGrants,
      availableCapabilities,
      modelCapabilities,
      permissionMode,
    }) =>
      Promise.resolve(
        runtime.start(requestId, targetId, prompt, workspace, modelKey, permissionMode, sessionId, companyId, {
          surface,
          agentId,
          personalId,
          permissionScopes,
          capabilityGrants,
          availableCapabilities,
          modelCapabilities,
        })
      )
  );
  channels.cancel.provider(({ requestId }) => runtime.cancel(requestId));
  channels.resolvePermission.provider(({ permissionId, approved, lifetime }) =>
    runtime.resolvePermission(permissionId, approved, lifetime)
  );
  channels.resolveOrchestrationProposal.provider(({ proposalId, approved }) =>
    runtime.resolveOrchestrationProposal(proposalId, approved)
  );
  channels.personalGet.provider(() => getPersonalProfile());
  channels.personalSave.provider(({ profile }) => personalMutations.saveProfile(profile));
  channels.personalSecretsList.provider(async () => {
    await contextServices.ready;
    return contextServices.vault.list();
  });
  channels.personalSecretsSave.provider(async ({ handle, name, note, targets, variables }) => {
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
    await personalMutations.bindSecret(descriptor);
    return descriptor;
  });
  channels.personalSecretsRemove.provider(async ({ handle }) => {
    await contextServices.ready;
    const removed = await contextServices.vault.remove(handle);
    await personalMutations.removeSecretReference(handle);
    return removed;
  });
  cron.listJobs.provider(() => legacyCronAdapter.listJobs());
  cron.listJobsByConversation.provider((input) => legacyCronAdapter.listJobsByConversation(input));
  cron.getJob.provider((input) => legacyCronAdapter.getJob(input));
  cron.addJob.provider((input) => legacyCronAdapter.addJob(input));
  cron.updateJob.provider((input) => legacyCronAdapter.updateJob(input));
  cron.removeJob.provider((input) => legacyCronAdapter.removeJob(input));
  cron.runNow.provider((input) => legacyCronAdapter.runNow(input));
  cron.saveSkill.provider((input) => legacyCronAdapter.saveSkill(input));
  cron.hasSkill.provider((input) => legacyCronAdapter.hasSkill(input));
  cron.deleteSkill.provider((input) => legacyCronAdapter.deleteSkill(input));
  channels.scheduledList.provider(async () => {
    await scheduledReady;
    return scheduledHandlers.list();
  });
  channels.scheduledGet.provider(async (input) => {
    await scheduledReady;
    return scheduledHandlers.get(input);
  });
  channels.scheduledSave.provider(async (input) => {
    await scheduledReady;
    return scheduledHandlers.save(input);
  });
  channels.scheduledRemove.provider(async (input) => {
    await scheduledReady;
    return scheduledHandlers.remove(input);
  });
  channels.scheduledRunNow.provider(async (input) => {
    await scheduledReady;
    return scheduledHandlers.runNow(input);
  });
  channels.scheduledCancel.provider(async (input) => {
    await scheduledReady;
    return scheduledHandlers.cancel(input);
  });
  channels.scheduledAudit.provider(async (input) => {
    await scheduledReady;
    return scheduledHandlers.listAudit(input);
  });
  channels.queryTelemetry.provider(async (query) =>
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
};
