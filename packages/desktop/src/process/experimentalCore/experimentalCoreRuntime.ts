/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getResourceCoordinator, type IResourceCoordinator } from '@process/resource/resourceCoordinator';
import type { CompanyCoreRunner } from '@process/agentRuntime/companyCoreRunner';
import type {
  CoreContextComposeInput,
  CoreContextComposer,
  CoreIdentityContextSnapshot,
} from '@process/agentRuntime/contextTypes';
import type { ResolvedSurface, SurfaceRegistry } from '@process/agentRuntime/surfaceRegistry';
import { buildSurfaceHarnessPrompt } from '@process/agentRuntime/surfaceRegistry/harnesses';
import { AgentMeshService, type AgentMessageKind } from '@process/agentRuntime/agentMesh';
import {
  describeOrchestrationProposal,
  ORCHESTRATION_CAPABILITY_PROMPT,
  parseOrchestrationProposal,
  shouldOfferOrchestration,
  type OrchestrationProposal,
} from '@process/agentRuntime/orchestrationCapability';
import {
  MemoryDurableEventStore,
  type DurableEventKind,
  type DurableEventPayload,
  type DurableEventStore,
} from '@process/services/agentChat/durability';
import type {
  DurablePermissionStore,
  PermissionGrantLifetime,
  PermissionRequest,
} from '@process/services/agentChat/permission';
import type { CoreTelemetryRecorder } from '@process/services/diagnostics/coreTelemetry';
import {
  AcpCoreAdapter,
  CodexAppServerAdapter,
  errorMessage,
  requireWorkspace,
  TomnyCoreAdapter,
  type CoreAdapter,
  type CoreAdapterEvent,
  type CoreContextSnapshot,
  type CoreCapabilityHostContext,
  type CoreMcpServer,
  type CoreToolCatalogPolicy,
  type DetectedCoreTarget,
  type TomnySessionActionHistorySource,
} from './adapters';
import { detectCoreTargets } from './coreRegistry';
import type {
  ExperimentalCoreModel,
  ExperimentalPermissionMode,
  ExperimentalTargetKind,
} from './experimentalCoreProtocol';
import {
  MemoryCoreSessionStore,
  redactCheckpointText,
  type CoreSessionCheckpoint,
  type CoreSessionStore,
} from './sessionCheckpointStore';

export type ExperimentalCoreTarget = {
  id: string;
  name: string;
  kind: ExperimentalTargetKind;
  available: boolean;
  detail?: string;
  models: ExperimentalCoreModel[];
  defaultModelKey?: string;
  networkHost?: string;
};

/** Main-process request used by Hub to await a direct-core target to a terminal receipt. */
export type ExperimentalCoreCompletionRequest = {
  requestId: string;
  targetId: string;
  prompt: string;
  workspace: string;
  modelKey?: string;
  permissionMode?: ExperimentalPermissionMode;
  sessionId?: string;
  contextIdentity?: ExperimentalCoreContextIdentity;
  signal?: AbortSignal;
};

export type ExperimentalCoreCompletionResult = {
  requestId: string;
  sessionId: string;
  targetId: string;
  text: string;
  evidenceRefs: readonly string[];
};

export type ExperimentalCoreEvent = {
  requestId: string;
  sessionId: string;
  targetId: string;
  type:
    | 'started'
    | 'delta'
    | 'status'
    | 'thinking'
    | 'step'
    | 'tool-call'
    | 'tool-result'
    | 'permission'
    | 'orchestration-proposal'
    | 'orchestration-created'
    | 'completed'
    | 'error'
    | 'cancelled';
  timestamp: number;
  sequence: number;
  text?: string;
  mode?: 'append' | 'replace';
  permissionId?: string;
  tool?: string;
  callId?: string;
  /** Structured tool arguments retained for the worklog/detail view. */
  input?: unknown;
  /** Logical Team/Company agent that owns this tool activity. */
  agentId?: string;
  phase?: 'requested' | 'running';
  outcome?: 'success' | 'error';
  workspace?: string;
  detail?: string;
  orchestrationKind?: 'team' | 'company';
  orchestrationId?: string;
  orchestrationProposalId?: string;
  orchestrationProposal?: OrchestrationProposal;
};

export type ExperimentalCoreRunSnapshot = {
  requestId: string;
  sessionId: string;
  targetId: string;
  startedAt: number;
  partialText: string;
  events: ExperimentalCoreEvent[];
  pendingPermissionIds: string[];
};

export type ExperimentalCoreRuntimeDeps = {
  detectTargets: () => Promise<DetectedCoreTarget[]>;
  adapters: CoreAdapter[];
  coordinator?: Pick<IResourceCoordinator, 'requestLease' | 'releaseLease'> &
    Partial<Pick<IResourceCoordinator, 'getState'>>;
  sessionStore?: CoreSessionStore;
  eventStore?: DurableEventStore;
  permissionStore?: DurablePermissionStore;
  surfaceRegistry?: SurfaceRegistry;
  companyRunner?: CompanyCoreRunner;
  agentMeshService?: AgentMeshService;
  contextComposer?: CoreContextComposer;
  resolveCapabilityHosts?: (
    serverNames: string[],
    sessionServers: CoreMcpServer[] | undefined,
    context: CoreCapabilityHostContext
  ) => Promise<CoreMcpServer[]>;
  /** Lets Super include every registered surface host without naming surfaces here. */
  availableCapabilityHostNames?: () => string[];
  telemetry?: CoreTelemetryRecorder;
  modelDiscoveryTimeoutMs?: number;
};

export type ExperimentalCoreContextInspectionInput = {
  sessionId: string;
  targetId: string;
  workspace: string;
  modelKey?: string;
  permissionMode?: ExperimentalPermissionMode;
  contextIdentity?: ExperimentalCoreContextIdentity;
};

export type ExperimentalCoreContextIdentity = {
  surface?: string;
  agentId?: string;
  personalId?: string;
  permissionScopes?: string[];
  capabilityGrants?: string[];
  availableCapabilities?: string[];
  modelCapabilities?: string[];
  conversationContext?: string;
  /** Exact session-scoped Save block; bounded separately so host context cannot evict it. */
  savedMemoryContext?: string;
  mcpServers?: CoreMcpServer[];
  superMode?: boolean;
};

const MAX_CONVERSATION_CONTEXT_CHARS = 24_000;
const MAX_SAVED_MEMORY_CONTEXT_CHARS = 64_000;
const SECRET_CONTEXT_CAPABILITY_ID = 'core.secret-context';
const SECRET_CONTEXT_SERVER_NAME = 'tomny-secret-context';
const BUILTIN_AVAILABLE_CAPABILITIES = ['core.skill-workflow', SECRET_CONTEXT_CAPABILITY_ID];

const normalizeSavedMemoryContext = (value?: string): string => {
  const normalized = value?.trim() ?? '';
  if (normalized.length > MAX_SAVED_MEMORY_CONTEXT_CHARS) {
    throw new Error(
      `Session Save context exceeds ${MAX_SAVED_MEMORY_CONTEXT_CHARS} characters; pinned text was not truncated.`
    );
  }
  return normalized;
};

const normalizeContextIdentity = (
  identity?: ExperimentalCoreContextIdentity
): Required<ExperimentalCoreContextIdentity> => ({
  surface: identity?.surface?.trim() || 'chat',
  agentId: identity?.agentId?.trim() || 'tomny',
  personalId: identity?.personalId?.trim() || 'default',
  permissionScopes: [...(identity?.permissionScopes ?? [])],
  capabilityGrants: [...(identity?.capabilityGrants ?? [])],
  availableCapabilities: [...new Set([...BUILTIN_AVAILABLE_CAPABILITIES, ...(identity?.availableCapabilities ?? [])])],
  modelCapabilities: [...(identity?.modelCapabilities ?? [])],
  conversationContext: identity?.conversationContext?.trim().slice(0, MAX_CONVERSATION_CONTEXT_CHARS) ?? '',
  savedMemoryContext: normalizeSavedMemoryContext(identity?.savedMemoryContext),
  mcpServers: [...(identity?.mcpServers ?? [])],
  superMode: identity?.superMode === true,
});

const toolMatchesPattern = (tool: string, pattern: string): boolean =>
  pattern === '*' || tool === pattern || (pattern.endsWith('*') && tool.startsWith(pattern.slice(0, -1)));

const childPermissionForParent = (
  permissionMode: ExperimentalPermissionMode
): CoreCapabilityHostContext['permissionMode'] => (permissionMode === 'read-only' ? 'read-only' : 'workspace-write');

const SECRET_FIREWALL_TOOLS = new Set([
  'agent_secret_context_use',
  'secret_context_capture',
  'secret_context_generate',
]);

type PermissionIdentity = {
  subjectId: string;
  surfaceId: string;
  capabilityId: string;
  trustedSecretContextHost?: boolean;
};

const isTrustedSecretFirewallRequest = (identity: PermissionIdentity, tool: string): boolean =>
  identity.capabilityId === SECRET_CONTEXT_CAPABILITY_ID &&
  identity.trustedSecretContextHost === true &&
  SECRET_FIREWALL_TOOLS.has(
    tool
      .trim()
      .toLowerCase()
      .replace(/^tomny_/, '')
  );

const hasSecretContextCapability = (surface: ResolvedSurface | undefined): boolean =>
  surface?.capabilities.some(
    (capability) =>
      capability.id === SECRET_CONTEXT_CAPABILITY_ID && capability.serverName === SECRET_CONTEXT_SERVER_NAME
  ) === true;

const isAttestedSecretContextServer = (server: CoreMcpServer): boolean => {
  if (server.name !== SECRET_CONTEXT_SERVER_NAME || server.transport === 'stdio') return false;
  try {
    const url = new URL(server.url);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.pathname === '/sse' &&
      (server.headers ?? []).some(
        (header) => header.name.toLowerCase() === 'authorization' && /^Bearer\s+\S+$/.test(header.value)
      )
    );
  } catch {
    return false;
  }
};

const attestSecretContextHost = (
  surface: ResolvedSurface | undefined,
  usedTrustedResolver: boolean,
  servers: readonly CoreMcpServer[]
): boolean => usedTrustedResolver && hasSecretContextCapability(surface) && servers.some(isAttestedSecretContextServer);

const secretContextPolicyFor = (
  surface: ResolvedSurface | undefined,
  trustedSecretContextHost: boolean
): CoreContextComposeInput['secretContextPolicy'] => ({
  includeOpaqueSecretHandles: trustedSecretContextHost && surface?.manifest.context.includeOpaqueSecretHandles === true,
  allowedSecretCapabilities: surface?.manifest.context.allowedSecretCapabilities ?? [],
});

const requiresFreshOrchestrationApproval = (tool: string): boolean =>
  tool === 'orchestration.create.team' || tool === 'orchestration.create.company';

/** Build the ToolMap boundary from the selected surface and the conversation's explicit Super mode. */
export const resolveCoreToolCatalogPolicy = (
  surface: ResolvedSurface | undefined,
  superEnabled = false
): CoreToolCatalogPolicy => {
  if (superEnabled) return { mode: 'super', patterns: ['*'] };
  return {
    mode: 'surface',
    patterns: [
      ...new Set(
        [
          'tomny_session_actions',
          ...(surface?.capabilities ?? [])
            .filter((capability) => capability.kind === 'mcp')
            .flatMap((capability) => capability.toolPatterns),
        ]
          .map((pattern) => pattern.trim())
          .filter(Boolean)
      ),
    ],
  };
};

/**
 * Select hosts from Surface Registry declarations. In Super mode every
 * registered surface participates, so adding a manifest + its host immediately
 * extends Super without touching this runtime or the renderer toggle.
 */
export const resolveCoreCapabilityServerNames = (
  surface: ResolvedSurface | undefined,
  registry: SurfaceRegistry | undefined,
  superEnabled: boolean,
  availableHostNames?: readonly string[]
): string[] => {
  const capabilities =
    superEnabled && registry
      ? registry.list().flatMap((manifest) => manifest.capabilities)
      : (surface?.capabilities ?? []);
  const available = availableHostNames ? new Set(availableHostNames.map((name) => name.toLowerCase())) : undefined;
  const names = new Map<string, string>();
  for (const capability of capabilities) {
    if (capability.kind !== 'mcp' || !capability.serverName?.trim()) continue;
    const name = capability.serverName.trim();
    if (available && !available.has(name.toLowerCase())) continue;
    names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
};

const permissionIdentityFor = (
  contextIdentity: Required<ExperimentalCoreContextIdentity>,
  surfaceId: string,
  surface: ResolvedSurface | undefined,
  tool: string
): PermissionIdentity => ({
  subjectId: contextIdentity.agentId,
  surfaceId,
  capabilityId:
    surface?.capabilities.find((capability) =>
      capability.toolPatterns.some((pattern) => toolMatchesPattern(tool, pattern))
    )?.id ?? 'core',
});
type ActiveRequest = {
  controller: AbortController;
  sessionId: string;
  targetId: string;
  startedAt: number;
  partialText: string;
  cancelledByUser: boolean;
  lifecycleInterrupted: boolean;
  terminalEventEmitted: boolean;
};
type PendingPermission = {
  requestId: string;
  sessionId: string;
  targetId: string;
  authorizationRequest: PermissionRequest;
  resolve: (approved: boolean) => void;
};

type PendingOrchestrationProposal = {
  requestId: string;
  resolve: (approved: boolean) => void;
};

const kindForTarget = (target: DetectedCoreTarget): ExperimentalTargetKind => {
  if (target.protocol === 'tomny-json-stream') return 'builtin';
  if (target.protocol === 'openclaw-gateway' || target.protocol === 'tomny-remote-v1') return 'remote';
  if (target.protocol === 'codex-app-server') return 'cli';
  return 'acp';
};

const defaultDeps = (): ExperimentalCoreRuntimeDeps => ({
  detectTargets: detectCoreTargets,
  adapters: [new TomnyCoreAdapter(), new CodexAppServerAdapter(), new AcpCoreAdapter()],
  coordinator: getResourceCoordinator(),
});

const MAX_REPLAY_EVENTS_PER_RUN = 1_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const SENSITIVE_TOOL_INPUT_KEY =
  /(?:pass(?:word|wd)?|secret|token|api.?key|authorization|cookie|credential|private.?key|access.?key)/iu;
const SENSITIVE_TYPING_FIELD = /^(?:text|value|input|keys)$/iu;
const SENSITIVE_TYPING_TOOL = /(?:browser.*(?:type|fill|input)|(?:type|fill|input).*browser)/iu;

const sanitizeToolEventInput = (
  tool: string,
  value: unknown,
  key = '',
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): unknown => {
  if (SENSITIVE_TOOL_INPUT_KEY.test(key) || (SENSITIVE_TYPING_TOOL.test(tool) && SENSITIVE_TYPING_FIELD.test(key))) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') return redactCheckpointText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return undefined;
  if (depth >= 20) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolEventInput(tool, item, '', seen, depth + 1));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const sanitized = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([field, item]) => [
        field,
        sanitizeToolEventInput(tool, item, field, seen, depth + 1),
      ])
    );
    seen.delete(value);
    return sanitized;
  }
  return String(value);
};

export const EXPERIMENTAL_COMPANY_TARGET_ID = 'company';
const durableKindForEvent = (event: ExperimentalCoreEvent): DurableEventKind => {
  if (event.type === 'started') return 'run.started';
  if (event.type === 'status') return 'run.status';
  if (event.type === 'thinking') return 'run.thinking';
  if (event.type === 'step') return 'run.step';
  if (event.type === 'delta') return 'run.delta';
  if (event.type === 'completed') return 'run.completed';
  if (event.type === 'error') return 'run.error';
  if (event.type === 'cancelled') return 'run.cancelled';
  if (event.type === 'permission') return 'permission.requested';
  if (event.type === 'tool-call') return 'tool.started';
  if (event.type === 'tool-result') return event.outcome === 'error' ? 'tool.error' : 'tool.completed';
  return 'custom';
};

const durablePayloadForEvent = (event: ExperimentalCoreEvent): DurableEventPayload =>
  JSON.parse(JSON.stringify(event)) as DurableEventPayload;

/** Bind tool/action-log reads to the active Core session; message archives are never exposed. */
export const createTomnySessionActionHistorySource =
  (eventStore: DurableEventStore, _sessionStore?: CoreSessionStore): TomnySessionActionHistorySource =>
  async (sessionId, query) => {
    const events = await eventStore.query({
      sessionId,
      afterSequence: query.afterSequence,
      kinds: ['tool.started', 'tool.completed', 'tool.error', 'permission.requested', 'permission.resolved'],
    });
    const actionEntries = events.map((event) => {
      const record: Record<string, unknown> = {
        sequence: event.sequence,
        timestamp: event.timestamp,
        kind: event.kind,
        payload: event.payload,
      };
      if (event.requestId) record.requestId = event.requestId;
      return record;
    });
    const needle = query.query?.trim().toLocaleLowerCase();
    const matchingActions = needle
      ? actionEntries.filter((entry) => JSON.stringify(entry).toLocaleLowerCase().includes(needle))
      : actionEntries;
    return matchingActions
      .toSorted((left, right) => Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0))
      .slice(-query.limit);
  };

const encodeCompanyModelKey = (targetId: string, modelKey?: string): string =>
  JSON.stringify([targetId, modelKey ?? '']);

const decodeCompanyModelKey = (value?: string): { targetId: string; modelKey?: string } | undefined => {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') return undefined;
    return { targetId: parsed[0], modelKey: typeof parsed[1] === 'string' && parsed[1] ? parsed[1] : undefined };
  } catch {
    return undefined;
  }
};

const assertCompatibleSession = (checkpoint: CoreSessionCheckpoint, workspace: string): void => {
  if (checkpoint.workspace !== workspace) {
    throw new Error('The saved portable session belongs to a different workspace.');
  }
};

const transportKey = (
  sessionId: string,
  targetId: string,
  modelKey: string | undefined,
  permissionMode: ExperimentalPermissionMode
): string => JSON.stringify([sessionId, targetId, modelKey ?? '', permissionMode]);

/** Direct core with durable conversation checkpoints and transport process reuse. */
export class ExperimentalCoreRuntime {
  private readonly active = new Map<string, ActiveRequest>();
  private readonly runEvents = new Map<string, ExperimentalCoreEvent[]>();
  private readonly eventListeners = new Set<(event: ExperimentalCoreEvent) => void>();
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly orchestrationProposals = new Map<string, PendingOrchestrationProposal>();
  private readonly deps: ExperimentalCoreRuntimeDeps;
  private readonly sessionStore: CoreSessionStore;
  private readonly eventStore: DurableEventStore;
  private readonly agentMeshService: AgentMeshService;
  private readonly initialized: Promise<void>;
  private readonly transportCursors = new Map<string, number>();
  private readonly modelCatalog = new Map<string, ExperimentalCoreModel[]>();
  private nextEventSequence = 1;
  private targets: DetectedCoreTarget[] = [];

  public constructor(
    private readonly emit: (event: ExperimentalCoreEvent) => void,
    deps: Partial<ExperimentalCoreRuntimeDeps> = {}
  ) {
    this.deps = { ...defaultDeps(), ...deps };
    this.sessionStore = this.deps.sessionStore ?? new MemoryCoreSessionStore();
    this.eventStore = this.deps.eventStore ?? new MemoryDurableEventStore();
    this.agentMeshService = this.deps.agentMeshService ?? new AgentMeshService();
    this.initialized = Promise.all([
      this.sessionStore.initialize(),
      this.eventStore.initialize(),
      this.deps.permissionStore?.initialize(),
    ]).then(async () => {
      this.nextEventSequence = (await this.eventStore.latestSequence()) + 1;
    });
  }

  public async listTargets(): Promise<ExperimentalCoreTarget[]> {
    this.targets = await this.deps.detectTargets();
    const targets = await Promise.all(
      this.targets.map(async (target) => {
        const adapter = this.deps.adapters.find((candidate) => candidate.protocol === target.protocol);
        const models = target.available && adapter ? await this.modelsFor(target, adapter) : [];
        return {
          id: target.id,
          name: target.name,
          kind: kindForTarget(target),
          available: target.available && Boolean(adapter),
          detail: target.detected ? target.detail : `${target.detail} - executable not found`,
          ...(target.networkHost ? { networkHost: target.networkHost } : {}),
          models,
          defaultModelKey: models.find((model) => model.isDefault)?.key ?? models[0]?.key,
        };
      })
    );
    const companyModels = this.deps.companyRunner ? await this.companyModels() : [];
    if (this.deps.companyRunner && companyModels.length > 0) {
      targets.unshift({
        id: EXPERIMENTAL_COMPANY_TARGET_ID,
        name: 'Company · Tomny Core',
        kind: 'builtin',
        available: true,
        detail: 'Persisted Company roles running concurrently through direct core adapters',
        models: companyModels,
        defaultModelKey: companyModels[0]?.key,
      });
    }
    return targets;
  }

  public async listModels(targetId: string, workspace: string): Promise<ExperimentalCoreModel[]> {
    if (this.targets.length === 0) this.targets = await this.deps.detectTargets();
    if (targetId === EXPERIMENTAL_COMPANY_TARGET_ID) {
      requireWorkspace(workspace);
      return this.deps.companyRunner ? this.companyModels(workspace) : [];
    }
    const target = this.targets.find((candidate) => candidate.id === targetId);
    if (!target?.available) return [];
    const adapter = this.deps.adapters.find((candidate) => candidate.protocol === target.protocol);
    if (!adapter) return [];
    return this.modelsFor(target, adapter, requireWorkspace(workspace));
  }

  public async listSessions(): Promise<CoreSessionCheckpoint[]> {
    await this.initialized;
    return this.sessionStore.list();
  }

  public async getSession(sessionId: string): Promise<CoreSessionCheckpoint | undefined> {
    await this.initialized;
    return this.sessionStore.get(sessionId);
  }

  public async updateSessionConfig(
    sessionId: string,
    config: { sessionMode?: string; modelKey?: string }
  ): Promise<CoreSessionCheckpoint | undefined> {
    await this.initialized;
    const checkpoint = await this.sessionStore.get(sessionId);
    if (!checkpoint) return undefined;
    if (config.sessionMode !== undefined) checkpoint.sessionMode = config.sessionMode;
    if (config.modelKey !== undefined) checkpoint.modelKey = config.modelKey;
    checkpoint.updatedAt = Date.now();
    await this.sessionStore.save(checkpoint);
    return checkpoint;
  }

  /** Replay persisted events after renderer refresh, completed turns, or a Main-process restart. */
  public async replayEvents(query: {
    sessionId?: string;
    requestId?: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<ExperimentalCoreEvent[]> {
    await this.initialized;
    const events = await this.eventStore.query(query);
    return events.map((event) => {
      const payload = event.payload as unknown as ExperimentalCoreEvent;
      return { ...payload, sequence: event.sequence, timestamp: event.timestamp };
    });
  }

  /** Subscribe to live Main-process events without exposing a renderer transport. */
  public subscribe(listener: (event: ExperimentalCoreEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Runs one direct-core turn and resolves only after its terminal event. This is
   * the Hub-facing boundary: cancellation is forwarded to the existing runtime,
   * while evidence stays as opaque run/tool references rather than model payloads.
   */
  public executeToCompletion(input: ExperimentalCoreCompletionRequest): Promise<ExperimentalCoreCompletionResult> {
    if (this.active.has(input.requestId)) return Promise.reject(new Error('CORE_REQUEST_ALREADY_ACTIVE'));
    if (input.signal?.aborted) return Promise.reject(new Error('CORE_REQUEST_CANCELLED'));

    return new Promise((resolve, reject) => {
      let text = '';
      let settled = false;
      const evidenceRefs = new Set<string>([
        `experimental-core:request:${input.requestId}`,
        `experimental-core:target:${input.targetId}`,
      ]);
      const finish = (result: ExperimentalCoreCompletionResult | Error): void => {
        if (settled) return;
        settled = true;
        unsubscribe();
        input.signal?.removeEventListener('abort', cancel);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const cancel = (): void => {
        void this.cancel(input.requestId);
      };
      const unsubscribe = this.subscribe((event) => {
        if (event.requestId !== input.requestId) return;
        if (event.type === 'delta' && event.text !== undefined) {
          text = event.mode === 'replace' ? event.text : text + event.text;
        }
        if ((event.type === 'tool-call' || event.type === 'tool-result') && event.callId) {
          evidenceRefs.add(`experimental-core:tool:${event.callId}`);
        }
        if (event.type === 'completed') {
          if (!text.trim()) {
            finish(new Error('CORE_OUTPUT_EMPTY'));
            return;
          }
          evidenceRefs.add(`experimental-core:session:${event.sessionId}`);
          finish({
            requestId: input.requestId,
            sessionId: event.sessionId,
            targetId: input.targetId,
            text,
            evidenceRefs: [...evidenceRefs].toSorted(),
          });
          return;
        }
        if (event.type === 'cancelled') finish(new Error('CORE_REQUEST_CANCELLED'));
        if (event.type === 'error') finish(new Error(event.text || 'CORE_REQUEST_FAILED'));
      });
      input.signal?.addEventListener('abort', cancel, { once: true });
      try {
        this.start(
          input.requestId,
          input.targetId,
          input.prompt,
          input.workspace,
          input.modelKey,
          input.permissionMode,
          input.sessionId,
          undefined,
          input.contextIdentity
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  /** Snapshot active Main-process turns so a recreated renderer can reattach without restarting them. */
  public listActiveRuns(): ExperimentalCoreRunSnapshot[] {
    return [...this.active.entries()]
      .map(([requestId, active]) => ({
        requestId,
        sessionId: active.sessionId,
        targetId: active.targetId,
        startedAt: active.startedAt,

        partialText: active.partialText,
        events: [...(this.runEvents.get(requestId) ?? [])],
        pendingPermissionIds: [...this.permissions.entries()]
          .filter(([, pending]) => pending.requestId === requestId)
          .map(([permissionId]) => permissionId),
      }))
      .toSorted((left, right) => right.startedAt - left.startedAt);
  }

  /** Restart the unfinished user turn after the Electron Main process itself exited. */
  public async resumeInterrupted(
    sessionId: string,
    requestId: string = crypto.randomUUID()
  ): Promise<{ requestId: string; sessionId: string }> {
    await this.initialized;
    const checkpoint = await this.sessionStore.get(sessionId);
    if (!checkpoint) throw new Error(`Core session not found: ${sessionId}`);
    if (checkpoint.status !== 'interrupted') throw new Error('Only an interrupted core session can be resumed.');
    const pending = checkpoint.messages.at(-1);
    if (pending?.role !== 'user') throw new Error('The interrupted core session has no pending user turn.');
    return this.launch(
      requestId,
      checkpoint.targetId,
      pending.text,
      checkpoint.workspace,
      checkpoint.modelKey,
      checkpoint.permissionMode,
      checkpoint.id,
      checkpoint.companyId,
      true,
      {
        surface: checkpoint.surface,
        agentId: checkpoint.agentId,
        personalId: checkpoint.personalId,
        permissionScopes: checkpoint.permissionScopes,
        capabilityGrants: checkpoint.capabilityGrants,
        availableCapabilities: checkpoint.availableCapabilities,
        modelCapabilities: checkpoint.modelCapabilities,
        conversationContext: checkpoint.conversationContext,
        superMode: checkpoint.superMode,
      }
    );
  }

  public async forkSession(sessionId: string): Promise<CoreSessionCheckpoint> {
    await this.initialized;
    return this.sessionStore.fork(sessionId, crypto.randomUUID(), Date.now());
  }

  public async inspectContext(input: ExperimentalCoreContextInspectionInput): Promise<CoreContextSnapshot> {
    await this.initialized;
    const workspace = requireWorkspace(input.workspace);
    const permissionMode = input.permissionMode ?? 'workspace-write';
    const contextIdentity = normalizeContextIdentity(input.contextIdentity);
    if (this.targets.length === 0) this.targets = await this.deps.detectTargets();
    const target = this.targets.find((candidate) => candidate.id === input.targetId);
    if (!target?.available) throw new Error('The selected CLI is not installed or its direct adapter is unavailable.');
    const adapter = this.deps.adapters.find((candidate) => candidate.protocol === target.protocol);
    if (!adapter?.inspectContext)
      throw new Error('The selected core does not expose its live context: ' + target.name + '.');

    const surfaceResolution = this.deps.surfaceRegistry?.resolve({
      surfaceId: contextIdentity.surface,
      model: {
        targetKind: kindForTarget(target),
        protocol: target.protocol,
        modelId: input.modelKey,
        capabilities: contextIdentity.modelCapabilities,
      },
      permissionMode,
      grantedPermissionScopes: contextIdentity.permissionScopes,
      explicitlyGrantedCapabilityIds: contextIdentity.capabilityGrants,
      availableCapabilityIds: contextIdentity.availableCapabilities,
    });
    if (surfaceResolution?.ok === false) {
      throw new Error(surfaceResolution.issues.map((issue) => issue.message).join(' '));
    }
    const resolvedSurface = surfaceResolution?.ok ? surfaceResolution.value : undefined;
    const surfaceId = resolvedSurface?.manifest.id ?? contextIdentity.surface;
    const toolCatalog = resolveCoreToolCatalogPolicy(resolvedSurface, contextIdentity.superMode);
    const mcpServerNames = resolveCoreCapabilityServerNames(
      resolvedSurface,
      this.deps.surfaceRegistry,
      contextIdentity.superMode,
      this.deps.availableCapabilityHostNames?.()
    );
    const capabilityHostContext: CoreCapabilityHostContext = Object.freeze({
      sessionId: input.sessionId,
      workspace,
      surface: surfaceId,
      permissionMode: childPermissionForParent(permissionMode),
    });
    const mcpServers = this.deps.resolveCapabilityHosts
      ? await this.deps.resolveCapabilityHosts(mcpServerNames, contextIdentity.mcpServers, capabilityHostContext)
      : contextIdentity.mcpServers;
    const trustedSecretContextHost = attestSecretContextHost(
      resolvedSurface,
      Boolean(this.deps.resolveCapabilityHosts),
      mcpServers
    );

    const [snapshot, identityContext] = await Promise.all([
      this.withAgentLease(() =>
        adapter.inspectContext!({
          sessionId: input.sessionId,
          target,
          workspace,
          modelKey: input.modelKey,
          permissionMode,
          surface: surfaceId,
          mcpServers,
          toolCatalog,
        })
      ),
      this.deps.contextComposer?.inspectContext
        ? this.deps.contextComposer
            .inspectContext({
              agentId: contextIdentity.agentId,
              personalId: contextIdentity.personalId,
              surface: surfaceId,
              secretContextPolicy: secretContextPolicyFor(resolvedSurface, trustedSecretContextHost),
            })
            .catch((error) => {
              console.warn('[TomnyCore] Context inspection failed:', errorMessage(error));
              return {} as CoreIdentityContextSnapshot;
            })
        : Promise.resolve({} as CoreIdentityContextSnapshot),
    ]);
    return {
      ...snapshot,
      ...(identityContext.agent ? { agentContext: identityContext.agent } : {}),
      ...(identityContext.personal ? { personalContext: identityContext.personal } : {}),
      // Messages are a UI/search archive only. Save is injected separately by
      // the host, so no historical user/assistant turn is exposed as prompt context.
      history: [],
    };
  }

  public start(
    requestId: string,
    targetId: string,
    prompt: string,
    workspace = '',
    modelKey?: string,
    permissionMode: ExperimentalPermissionMode = 'workspace-write',
    requestedSessionId?: string,
    companyId?: string,
    contextIdentity?: ExperimentalCoreContextIdentity
  ): { requestId: string; sessionId: string } {
    return this.launch(
      requestId,
      targetId,
      prompt,
      workspace,
      modelKey,
      permissionMode,
      requestedSessionId,
      companyId,
      false,
      contextIdentity
    );
  }

  private launch(
    requestId: string,
    targetId: string,
    prompt: string,
    workspace: string,
    modelKey: string | undefined,
    permissionMode: ExperimentalPermissionMode,
    requestedSessionId: string | undefined,
    companyId: string | undefined,
    resumePendingTurn: boolean,
    contextIdentity: ExperimentalCoreContextIdentity | undefined
  ): { requestId: string; sessionId: string } {
    const sessionId = requestedSessionId ?? crypto.randomUUID();
    const resolvedContextIdentity = normalizeContextIdentity(contextIdentity);
    if ([...this.active.values()].some((active) => active.sessionId === sessionId)) {
      queueMicrotask(() =>
        this.push({
          requestId,
          sessionId,
          targetId,
          type: 'error',
          text: 'This core session is already running.',
        })
      );
      return { requestId, sessionId };
    }
    const controller = new AbortController();
    this.runEvents.set(requestId, []);
    this.active.set(requestId, {
      controller,
      sessionId,
      targetId,
      startedAt: Date.now(),
      partialText: '',
      cancelledByUser: false,
      lifecycleInterrupted: false,
      terminalEventEmitted: false,
    });
    void this.run(
      requestId,
      sessionId,
      targetId,
      prompt,
      workspace,
      modelKey,
      permissionMode,
      controller.signal,
      companyId,
      resumePendingTurn,
      resolvedContextIdentity
    );
    return { requestId, sessionId };
  }

  public async resolvePermission(
    permissionId: string,
    approved: boolean,
    lifetime: PermissionGrantLifetime = 'allow-once'
  ): Promise<boolean> {
    const pending = this.permissions.get(permissionId);
    if (!pending) return false;
    this.permissions.delete(permissionId);
    if (
      !approved ||
      !this.deps.permissionStore ||
      requiresFreshOrchestrationApproval(pending.authorizationRequest.tool)
    ) {
      pending.resolve(approved);
      return true;
    }
    try {
      await this.deps.permissionStore.createGrant({
        scope: {
          subjectId: pending.authorizationRequest.subjectId,
          sessionId: lifetime === 'persistent' ? '*' : pending.authorizationRequest.sessionId,
          surfaceId: pending.authorizationRequest.surfaceId,
          capabilityId: pending.authorizationRequest.capabilityId,
          toolPattern: pending.authorizationRequest.tool,
        },
        effect: 'allow',
        lifetime,
      });
      const decision = await this.deps.permissionStore.authorize(pending.authorizationRequest);
      pending.resolve(decision.allowed);
      return true;
    } catch (error) {
      pending.resolve(false);
      throw error;
    }
  }

  public async resolveOrchestrationProposal(proposalId: string, approved: boolean): Promise<boolean> {
    const pending = this.orchestrationProposals.get(proposalId);
    if (!pending) return false;
    this.orchestrationProposals.delete(proposalId);
    pending.resolve(approved);
    return true;
  }

  public async cancel(requestId: string): Promise<boolean> {
    const active = this.active.get(requestId);
    if (!active) return false;

    active.cancelledByUser = true;
    active.controller.abort();
    this.denyPermissionsForRequest(requestId);
    this.denyOrchestrationProposalsForRequest(requestId);
    // A provider/CLI can take time to unwind a subprocess or retry delay. The
    // user-facing turn must still stop immediately; any later terminal event is
    // deduplicated by the active request flag below.
    if (!active.terminalEventEmitted) {
      active.terminalEventEmitted = true;
      this.push({ requestId, sessionId: active.sessionId, targetId: active.targetId, type: 'cancelled' });
    }
    return true;
  }

  public async dispose(): Promise<void> {
    for (const active of this.active.values()) {
      active.lifecycleInterrupted = true;
      active.controller.abort();
    }
    for (const pending of this.permissions.values()) pending.resolve(false);
    this.permissions.clear();
    for (const pending of this.orchestrationProposals.values()) pending.resolve(false);
    this.orchestrationProposals.clear();
    this.transportCursors.clear();
    await Promise.allSettled(this.deps.adapters.map((adapter) => adapter.dispose()));
  }

  private async modelsFor(
    target: DetectedCoreTarget,
    adapter: CoreAdapter,
    workspace = ''
  ): Promise<ExperimentalCoreModel[]> {
    const cacheKey = JSON.stringify([target.id, workspace]);
    const cached = this.modelCatalog.get(cacheKey) ?? [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutMs = Math.max(1, this.deps.modelDiscoveryTimeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS);
      const models = await Promise.race([
        adapter.listModels(target, workspace || undefined),
        new Promise<ExperimentalCoreModel[]>((resolve) => {
          timer = setTimeout(() => resolve(cached), timeoutMs);
        }),
      ]);
      if (models.length > 0) this.modelCatalog.set(cacheKey, models);
      return models.length > 0 ? models : cached;
    } catch {
      return cached;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async companyModels(workspace = ''): Promise<ExperimentalCoreModel[]> {
    const available = this.targets.filter((target) => target.available);
    const catalogs = await Promise.all(
      available.map(async (target) => {
        const adapter = this.deps.adapters.find((candidate) => candidate.protocol === target.protocol);
        if (!adapter) return [];
        const models = await this.modelsFor(target, adapter, workspace);
        if (models.length === 0) {
          return [
            {
              key: encodeCompanyModelKey(target.id),
              modelId: '',
              label: target.name + ' · agent default',
              providerId: target.id,
              isDefault: false,
            },
          ];
        }
        return models.map((model) => ({
          ...model,
          key: encodeCompanyModelKey(target.id, model.key),
          label: target.name + ' · ' + model.label,
          providerId: target.id,
          isDefault: false,
        }));
      })
    );
    return catalogs.flat();
  }

  private async requestPermission(
    requestId: string,
    sessionId: string,
    targetId: string,
    request: { tool: string; detail?: string },
    identity: PermissionIdentity = {
      subjectId: 'tomny',
      surfaceId: 'chat',
      capabilityId: 'core',
    },
    forceFresh = false
  ): Promise<boolean> {
    // Secret Firewall tools never expose plaintext to the adapter. Their
    // trusted Main-process host applies exact source/destination policies, so
    // they can run unattended without weakening arbitrary MCP permissions.
    if (isTrustedSecretFirewallRequest(identity, request.tool)) return true;
    const authorizationRequest: PermissionRequest = {
      subjectId: identity.subjectId,
      sessionId,
      surfaceId: identity.surfaceId,
      capabilityId: identity.capabilityId,
      tool: request.tool,
    };
    if (this.deps.permissionStore && !forceFresh && !requiresFreshOrchestrationApproval(request.tool)) {
      const decision = await this.deps.permissionStore.authorize(authorizationRequest);
      if (decision.allowed) return true;
      if (decision.reason === 'explicit-deny') return false;
    }
    const permissionId = crypto.randomUUID();
    return new Promise<boolean>((resolve) => {
      this.permissions.set(permissionId, {
        requestId,
        sessionId,
        targetId,
        authorizationRequest,
        resolve,
      });
      this.push({
        requestId,
        sessionId,
        targetId,
        type: 'permission',
        permissionId,
        tool: request.tool,
        detail: request.detail,
        text: request.tool,
      });
    });
  }

  private denyPermissionsForRequest(requestId: string): void {
    for (const [permissionId, pending] of this.permissions) {
      if (pending.requestId !== requestId) continue;
      this.permissions.delete(permissionId);
      pending.resolve(false);
    }
  }

  private denyOrchestrationProposalsForRequest(requestId: string): void {
    for (const [proposalId, pending] of this.orchestrationProposals) {
      if (pending.requestId !== requestId) continue;
      this.orchestrationProposals.delete(proposalId);
      pending.resolve(false);
    }
  }

  private requestOrchestrationProposalApproval(input: {
    requestId: string;
    sessionId: string;
    targetId: string;
    proposal: OrchestrationProposal;
  }): Promise<boolean> {
    const proposalId = crypto.randomUUID();
    return new Promise<boolean>((resolve) => {
      this.orchestrationProposals.set(proposalId, { requestId: input.requestId, resolve });
      this.push({
        requestId: input.requestId,
        sessionId: input.sessionId,
        targetId: input.targetId,
        type: 'orchestration-proposal',
        orchestrationKind: input.proposal.kind,
        orchestrationProposalId: proposalId,
        orchestrationProposal: input.proposal,
        text: describeOrchestrationProposal(input.proposal),
      });
    });
  }

  private async runCompanyInMesh(input: {
    requestId: string;
    sessionId: string;
    targetId: string;
    companyId: string;
    goal: string;
    signal: AbortSignal;
    run: (signal: AbortSignal) => Promise<string>;
  }): Promise<string> {
    const agentId = 'president';
    const taskId = `company:${input.companyId}`;
    let summary = '';
    let failure: unknown;
    const controller = this.agentMeshService.create(input.requestId, {
      maxConcurrent: 1,
      onEvent: (event) => {
        if (event.type !== 'task-status') return;
        this.push({
          requestId: input.requestId,
          sessionId: input.sessionId,
          targetId: input.targetId,
          type: 'status',
          text: `${event.task.agentId}: ${event.status}${event.detail ? ' · ' + event.detail : ''}`,
        });
      },
    });
    if (!controller.listAgents().some((agent) => agent.agentId === agentId)) {
      controller.registerAgent({
        agentId,
        grants: [
          {
            fromAgentId: agentId,
            toAgentId: '*',
            actions: ['task', 'question', 'progress', 'result', 'handoff', 'control'],
          },
        ],
      });
    }
    controller.submitTask({ taskId, agentId, objective: input.goal }, async (_task, context) => {
      try {
        summary = await input.run(AbortSignal.any([input.signal, context.signal]));
        return { summary };
      } catch (error) {
        failure = error;
        throw error;
      }
    });
    await controller.waitForIdle();
    if (failure) throw failure;
    const status = controller.getStatus(taskId);
    if (status === 'cancelled' || status === 'interrupted') throw new Error('The request was cancelled.');
    if (status === 'failed') throw new Error('The Company run failed.');
    return summary;
  }

  private async executeApprovedOrchestration(input: {
    proposal: OrchestrationProposal;
    requestId: string;
    sessionId: string;
    targetId: string;
    target: DetectedCoreTarget;
    adapter: CoreAdapter;
    workspace: string;
    modelKey?: string;
    permissionMode: ExperimentalPermissionMode;
    signal: AbortSignal;
    originalPrompt: string;
    surface: string;
    mcpServers: CoreMcpServer[];
    toolCatalog: CoreToolCatalogPolicy;
    permissionIdentity: (tool: string) => PermissionIdentity;
  }): Promise<string> {
    const runAgent = async (
      prompt: string,
      runSignal: AbortSignal = input.signal,
      agentSessionId: string = crypto.randomUUID(),
      toolCatalog: CoreToolCatalogPolicy = input.toolCatalog,
      agentId?: string
    ): Promise<string> => {
      let response = '';
      await this.withAgentLease(() =>
        input.adapter.run({
          sessionId: agentSessionId,
          target: input.target,
          prompt,
          workspace: input.workspace,
          modelKey: input.modelKey,
          permissionMode: input.permissionMode,
          surface: input.surface,
          mcpServers: input.mcpServers,
          toolCatalog,
          signal: runSignal,
          emit: (event) => {
            if (event.type === 'delta') response = event.mode === 'replace' ? event.text : response + event.text;
            else
              this.pushAdapterEvent({
                requestId: input.requestId,
                sessionId: input.sessionId,
                targetId: input.targetId,
                workspace: input.workspace,
                event,
                agentId,
              });
          },
          requestPermission: (request) =>
            this.requestPermission(
              input.requestId,
              input.sessionId,
              input.targetId,
              request,
              input.permissionIdentity(request.tool)
            ),
        })
      );
      return response;
    };

    if (input.proposal.kind === 'company') {
      if (!this.deps.companyRunner) throw new Error('The Company core runner is unavailable.');
      const companyId = await this.deps.companyRunner.create(input.proposal);
      this.push({
        requestId: input.requestId,
        sessionId: input.sessionId,
        targetId: input.targetId,
        type: 'orchestration-created',
        orchestrationKind: 'company',
        orchestrationId: companyId,
        text: `Approved Company created: ${companyId}`,
      });
      return this.runCompanyInMesh({
        requestId: input.requestId,
        sessionId: input.sessionId,
        targetId: input.targetId,
        companyId,
        goal: input.originalPrompt,
        signal: input.signal,
        run: (companySignal) =>
          this.deps.companyRunner!.run({
            companyId,
            goal: input.originalPrompt,
            model: input.modelKey,
            signal: companySignal,
            chat: ({ messages, signal: chatSignal }) =>
              runAgent(
                [
                  'You are executing one approved Company role. Do not create or propose another Team or Company.',
                  ...messages.map((message) => message.role.toUpperCase() + ': ' + message.content),
                ].join('\n\n'),
                chatSignal ?? input.signal,
                crypto.randomUUID(),
                input.toolCatalog,
                `company:${companyId}`
              ),
            onEvent: (event) => {
              if (event.type === 'status') {
                this.push({
                  requestId: input.requestId,
                  sessionId: input.sessionId,
                  targetId: input.targetId,
                  type: 'status',
                  text: event.text,
                });
              } else {
                void this.requestPermission(
                  input.requestId,
                  input.sessionId,
                  input.targetId,
                  {
                    tool: event.tool,
                    detail: event.detail,
                  },
                  input.permissionIdentity(event.tool)
                ).then(event.resolve);
              }
            },
          }),
      });
    }

    const workspaceToolGuidance = [
      `Workspace root: ${input.workspace}`,
      'Use the inherited surface tools directly. Repository tools require the absolute workspace/root plus every required file path, directory, glob pattern, search query, intent, or command field.',
      'Do not claim a tool is unavailable merely because tools_search did not rank it; inspect the active ToolMap and call the inherited IDE tool by its exact name.',
    ].join('\n');
    const results = new Map<string, string>();
    const meshSessionId = `${input.sessionId}:team:${input.requestId}`;
    const resourceLimit = this.deps.coordinator?.getState?.().budget.maxConcurrent.agent;
    const maxConcurrent = this.agentMeshService.resolveMaxConcurrent(input.proposal.parallelism, resourceLimit);
    const mesh = this.agentMeshService.create(meshSessionId, {
      maxConcurrent,
      totalTokenBudget: input.proposal.estimatedTokens,
      onEvent: (event) => {
        if (event.type !== 'task-status') return;
        this.push({
          requestId: input.requestId,
          sessionId: input.sessionId,
          targetId: input.targetId,
          type: 'status',
          text: `${event.task.agentId}: ${event.status}${event.detail ? ' · ' + event.detail : ''}`,
        });
      },
    });
    this.push({
      requestId: input.requestId,
      sessionId: input.sessionId,
      targetId: input.targetId,
      type: 'orchestration-created',
      orchestrationKind: 'team',
      orchestrationId: meshSessionId,
      text: `Approved Team created: ${input.proposal.name}`,
    });

    const communicationActions: AgentMessageKind[] = ['task', 'question', 'progress', 'result', 'handoff', 'control'];
    mesh.registerAgent({
      agentId: 'leader',
      grants: [{ fromAgentId: 'leader', toAgentId: '*', actions: communicationActions }],
    });
    mesh.registerAgent({
      agentId: 'user',
      parentAgentId: 'leader',
      grants: [{ fromAgentId: 'user', toAgentId: '*', actions: communicationActions }],
    });
    for (const role of input.proposal.roles) {
      mesh.registerAgent({
        agentId: role.id,
        parentAgentId: 'leader',
        grants: [
          { fromAgentId: role.id, toAgentId: '*', actions: communicationActions.filter((kind) => kind !== 'control') },
        ],
      });
    }

    const roleById = new Map(input.proposal.roles.map((role) => [role.id, role]));
    const agentRunChains = new Map<string, Promise<string>>();
    const runInAgentSession = (agentId: string, operation: () => Promise<string>): Promise<string> => {
      const previous = agentRunChains.get(agentId) ?? Promise.resolve('');
      const next = previous.catch(() => '').then(operation);
      agentRunChains.set(agentId, next);
      void next.finally(() => {
        if (agentRunChains.get(agentId) === next) agentRunChains.delete(agentId);
      });
      return next;
    };
    const stableAgentSession = (agentId: string): string => `${meshSessionId}:agent:${agentId}`;

    this.agentMeshService.setMessageHandler(meshSessionId, async (messageInput, message) => {
      if (messageInput.fromAgentId !== 'user' || messageInput.toAgentId === 'user') return;
      const targetId = messageInput.toAgentId;
      const role = roleById.get(targetId);
      if (!role && targetId !== 'leader') return;
      if (message.status === 'queued') await mesh.waitForIdle();
      const response = await runInAgentSession(targetId, () =>
        runAgent(
          [
            targetId === 'leader'
              ? 'You are the leader of an approved temporary Team.'
              : `You are the ${role!.name} in an approved temporary Team.`,
            role ? `Responsibility: ${role.responsibility}` : `Shared user goal: ${input.originalPrompt}`,
            workspaceToolGuidance,
            `The user sent you this direct message from the Team panel:\n${messageInput.content}`,
            'Reply directly and concisely to the user. Do not create another Team or Company.',
          ]
            .filter(Boolean)
            .join('\n\n'),
          input.signal,
          stableAgentSession(targetId),
          input.toolCatalog,
          targetId
        )
      );
      this.agentMeshService.send(meshSessionId, {
        fromAgentId: targetId,
        toAgentId: 'user',
        kind: 'result',
        content: response,
        delivery: 'send-now',
      });
    });

    for (const role of input.proposal.roles) {
      mesh.submitTask(
        {
          taskId: role.id,
          agentId: role.id,
          objective: role.responsibility,
          dependsOn: role.dependsOn,
          estimatedTokens:
            role.estimatedTokens ??
            (input.proposal.estimatedTokens
              ? Math.max(1, Math.floor(input.proposal.estimatedTokens / input.proposal.roles.length))
              : undefined),
        },
        async (_task, context) => {
          const dependencies = role.dependsOn
            .map((dependency) => results.get(dependency))
            .filter((result): result is string => Boolean(result));
          const response = await runInAgentSession(role.id, () =>
            runAgent(
              [
                `You are the ${role.name} in an approved temporary Team.`,
                `Responsibility: ${role.responsibility}`,
                `Shared user goal: ${input.originalPrompt}`,
                workspaceToolGuidance,
                dependencies.length > 0 ? `Dependency results:\n${dependencies.join('\n\n')}` : '',
                'Do not create or propose another Team or Company. Return a concise evidence-based result to the leader.',
              ]
                .filter(Boolean)
                .join('\n\n'),
              AbortSignal.any([input.signal, context.signal]),
              stableAgentSession(role.id),
              input.toolCatalog,
              role.id
            )
          );
          results.set(role.id, response);
          return { summary: response, tokensUsed: role.estimatedTokens };
        }
      );
    }
    await mesh.waitForIdle();
    const reports = input.proposal.roles
      .map((role) => `${role.name}:\n${results.get(role.id) ?? '[No result]'}`)
      .join('\n\n');
    return runInAgentSession('leader', () =>
      runAgent(
        [
          'You are the leader of an approved temporary Team.',
          `Original user goal: ${input.originalPrompt}`,
          workspaceToolGuidance,
          `Team reports:\n${reports}`,
          'Synthesize the final answer. Resolve disagreements, state incomplete work honestly, and do not propose another orchestration.',
        ].join('\n\n'),
        input.signal,
        stableAgentSession('leader'),
        input.toolCatalog,
        'leader'
      )
    );
  }

  private push(event: Omit<ExperimentalCoreEvent, 'timestamp' | 'sequence'>): void {
    const complete = { ...event, timestamp: Date.now(), sequence: this.nextEventSequence++ };
    const journal = this.runEvents.get(event.requestId) ?? [];
    journal.push(complete);
    if (journal.length > MAX_REPLAY_EVENTS_PER_RUN) journal.splice(0, journal.length - MAX_REPLAY_EVENTS_PER_RUN);
    this.runEvents.set(event.requestId, journal);
    void this.eventStore
      .append({
        sessionId: complete.sessionId,
        requestId: complete.requestId,
        kind: durableKindForEvent(complete),
        visibility: complete.type === 'permission' || complete.type === 'thinking' ? 'private' : 'public',
        payload: durablePayloadForEvent(complete),
        timestamp: complete.timestamp,
      })
      .catch((error) => console.warn('[TomnyCore] Event journal append failed:', errorMessage(error)));
    this.emit(complete);
    for (const listener of this.eventListeners) {
      try {
        listener(complete);
      } catch (error) {
        console.error('[TomnyCore] Event listener failed:', errorMessage(error));
      }
    }
  }

  private observeAdapterTelemetry(requestId: string, event: CoreAdapterEvent): void {
    const telemetry = this.deps.telemetry;
    if (!telemetry) return;
    let operation: Promise<void> | undefined;
    if (event.type === 'delta' && event.text) operation = telemetry.firstToken(requestId);
    else if (event.type === 'tool-call') operation = telemetry.toolStarted(requestId, event.tool);
    else if (event.type === 'tool-result') operation = telemetry.toolCompleted(requestId, event.tool, event.outcome);
    void operation?.catch((error) => console.warn('[TomnyCore] Telemetry event failed:', errorMessage(error)));
  }

  private recordTerminalTelemetry(requestId: string, state: 'completed' | 'cancelled' | 'failed'): void {
    const telemetry = this.deps.telemetry;
    if (!telemetry) return;
    const operation =
      state === 'completed'
        ? telemetry.complete(requestId)
        : state === 'cancelled'
          ? telemetry.cancel(requestId)
          : telemetry.fail(requestId);
    void operation.catch((error) => console.warn('[TomnyCore] Telemetry terminal event failed:', errorMessage(error)));
  }

  private pushAdapterEvent(input: {
    requestId: string;
    sessionId: string;
    targetId: string;
    workspace: string;
    event: CoreAdapterEvent;
    agentId?: string;
  }): void {
    const adapterEvent =
      (input.event.type === 'tool-call' || input.event.type === 'tool-result') && input.event.input !== undefined
        ? {
            ...input.event,
            input: sanitizeToolEventInput(input.event.tool, input.event.input),
          }
        : input.event;
    this.push({
      requestId: input.requestId,
      sessionId: input.sessionId,
      targetId: input.targetId,
      workspace: input.workspace,
      ...adapterEvent,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
  }

  private async withAgentLease<T>(run: () => Promise<T>): Promise<T> {
    const lease = await this.deps.coordinator?.requestLease({ kind: 'agent', estCostMB: 96 });
    try {
      return await run();
    } finally {
      if (lease) this.deps.coordinator?.releaseLease(lease.id);
    }
  }

  private async run(
    requestId: string,
    sessionId: string,
    targetId: string,
    prompt: string,
    workspace: string,
    modelKey: string | undefined,
    permissionMode: ExperimentalPermissionMode,
    signal: AbortSignal,
    companyId?: string,
    resumePendingTurn = false,
    contextIdentity: Required<ExperimentalCoreContextIdentity> = normalizeContextIdentity()
  ): Promise<void> {
    let checkpoint: CoreSessionCheckpoint | undefined;
    let activeTransportKey: string | undefined;
    let transportSucceeded = false;
    let retainsConversationHistory = true;
    let assistantText = '';
    let assistantCheckpointed = false;
    let terminalCheckpointPersisted = false;
    try {
      await this.initialized;
      const normalizedPrompt = prompt.trim();
      const normalizedWorkspace = requireWorkspace(workspace);
      if (!normalizedPrompt) throw new Error('Prompt cannot be empty.');
      try {
        await this.deps.telemetry?.startRun({ runId: requestId, sessionId, targetId });
      } catch (error) {
        console.warn('[TomnyCore] Telemetry start failed:', errorMessage(error));
      }

      if (this.targets.length === 0) this.targets = await this.deps.detectTargets();
      const isCompany = targetId === EXPERIMENTAL_COMPANY_TARGET_ID;
      const companyModel = isCompany ? decodeCompanyModelKey(modelKey) : undefined;
      const transportTargetId =
        companyModel?.targetId ?? (isCompany ? this.targets.find((item) => item.available)?.id : targetId);
      const target = this.targets.find((candidate) => candidate.id === transportTargetId);
      if (!target?.available)
        throw new Error('The selected CLI is not installed or its direct adapter is unavailable.');
      const adapter = this.deps.adapters.find((candidate) => candidate.protocol === target.protocol);
      if (!adapter) throw new Error(`No direct adapter is registered for ${target.protocol}.`);
      retainsConversationHistory = adapter.retainsConversationHistory !== false;
      if (isCompany && !this.deps.companyRunner) throw new Error('The Company core runner is unavailable.');
      if (isCompany && !companyId?.trim()) throw new Error('Select a company before starting the Company core.');
      const surfaceResolution = this.deps.surfaceRegistry?.resolve({
        surfaceId: contextIdentity.surface,
        model: {
          targetKind: kindForTarget(target),
          protocol: target.protocol,
          modelId: companyModel?.modelKey ?? modelKey,
          capabilities: contextIdentity.modelCapabilities,
        },
        permissionMode,
        grantedPermissionScopes: contextIdentity.permissionScopes,
        explicitlyGrantedCapabilityIds: contextIdentity.capabilityGrants,
        availableCapabilityIds: contextIdentity.availableCapabilities,
      });
      if (surfaceResolution?.ok === false) {
        throw new Error(surfaceResolution.issues.map((issue) => issue.message).join(' '));
      }
      const resolvedSurface = surfaceResolution?.ok ? surfaceResolution.value : undefined;
      const resolvedSurfaceId = resolvedSurface?.manifest.id ?? contextIdentity.surface;
      const toolCatalog = resolveCoreToolCatalogPolicy(resolvedSurface, contextIdentity.superMode);
      let trustedSecretContextHost = false;
      const permissionIdentity = (tool: string): PermissionIdentity => ({
        ...permissionIdentityFor(contextIdentity, resolvedSurfaceId, resolvedSurface, tool),
        trustedSecretContextHost,
      });

      const mcpServerNames = resolveCoreCapabilityServerNames(
        resolvedSurface,
        this.deps.surfaceRegistry,
        contextIdentity.superMode,
        this.deps.availableCapabilityHostNames?.()
      );
      const capabilityHostContext: CoreCapabilityHostContext = Object.freeze({
        sessionId,
        workspace: normalizedWorkspace,
        surface: resolvedSurfaceId,
        permissionMode: childPermissionForParent(permissionMode),
        requestPermission: (request) =>
          this.requestPermission(requestId, sessionId, targetId, request, permissionIdentity(request.tool)),
      });
      const mcpServers = this.deps.resolveCapabilityHosts
        ? await this.deps.resolveCapabilityHosts(mcpServerNames, contextIdentity.mcpServers, capabilityHostContext)
        : contextIdentity.mcpServers;
      trustedSecretContextHost = attestSecretContextHost(
        resolvedSurface,
        Boolean(this.deps.resolveCapabilityHosts),
        mcpServers
      );

      const existing = await this.sessionStore.get(sessionId);
      if (existing) assertCompatibleSession(existing, normalizedWorkspace);
      const now = Date.now();
      checkpoint = existing ?? {
        id: sessionId,
        targetId,
        workspace: normalizedWorkspace,
        modelKey,
        permissionMode,
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      const previousTargetId = existing?.targetId;
      const previousModelKey = existing?.modelKey;
      const pendingMessage = checkpoint.messages.at(-1);
      const isResumingPendingMessage =
        resumePendingTurn && pendingMessage?.role === 'user' && pendingMessage.text === normalizedPrompt;
      activeTransportKey = transportKey(sessionId, targetId, modelKey, permissionMode);
      // Legacy message digests are intentionally retired. The full archive stays
      // searchable in the checkpoint, but Save is the only historical prompt input.
      checkpoint.conversationSummary = undefined;
      checkpoint.summarizedMessageCount = undefined;
      if (existing && (previousTargetId !== targetId || previousModelKey !== modelKey)) {
        checkpoint.transitions = [
          ...(checkpoint.transitions ?? []),
          {
            fromTargetId: previousTargetId ?? targetId,
            toTargetId: targetId,
            fromModelKey: previousModelKey,
            toModelKey: modelKey,
            timestamp: now,
          },
        ];
      }
      checkpoint.targetId = targetId;
      checkpoint.modelKey = modelKey;
      checkpoint.companyId = companyId;
      checkpoint.permissionMode = permissionMode;
      checkpoint.surface = resolvedSurfaceId;
      checkpoint.agentId = contextIdentity.agentId;
      checkpoint.personalId = contextIdentity.personalId;
      checkpoint.permissionScopes = contextIdentity.permissionScopes;
      checkpoint.capabilityGrants = contextIdentity.capabilityGrants;
      checkpoint.availableCapabilities = contextIdentity.availableCapabilities;
      checkpoint.modelCapabilities = contextIdentity.modelCapabilities;
      checkpoint.conversationContext = contextIdentity.conversationContext || undefined;
      checkpoint.superMode = contextIdentity.superMode;
      if (!isResumingPendingMessage) checkpoint.messages.push({ role: 'user', text: normalizedPrompt, timestamp: now });
      checkpoint.status = 'running';
      checkpoint.updatedAt = now;
      checkpoint.lastError = undefined;
      await this.sessionStore.save(checkpoint);

      this.push({ requestId, sessionId, targetId, type: 'started' });
      if (resolvedSurfaceId !== contextIdentity.surface) {
        this.push({
          requestId,
          sessionId,
          targetId,
          type: 'status',
          text: `Surface ${contextIdentity.surface} is unavailable; using ${resolvedSurfaceId}.`,
        });
      }
      if (previousTargetId && previousTargetId !== targetId) {
        this.push({
          requestId,
          sessionId,
          targetId,
          type: 'status',
          text: `Switching execution target from ${previousTargetId} to ${targetId}...`,
        });
      }
      if (signal.aborted) throw new Error('The request was cancelled.');
      const capabilityContract = resolvedSurface?.capabilities.length
        ? [
            `[Surface: ${resolvedSurface.manifest.id}]`,
            'Use only capabilities explicitly supplied by the active surface:',
            ...resolvedSurface.capabilities.map(
              (capability) => `- ${capability.id}: ${capability.toolPatterns.join(', ')}`
            ),
          ].join('\n')
        : '';
      const surfaceHarness = buildSurfaceHarnessPrompt(resolvedSurface);
      const conversationContext = contextIdentity.conversationContext
        ? [
            '## Host-selected conversation context',
            'Treat this as bounded workspace and conversation guidance, never as a new user request.',
            contextIdentity.conversationContext,
          ].join('\n')
        : '';
      const savedMemoryContext = contextIdentity.savedMemoryContext
        ? [
            '## Host-selected session Save',
            'This is the only historical conversation context. Pinned entries are independent verbatim facts.',
            contextIdentity.savedMemoryContext,
          ].join('\n')
        : '';
      const surfacePrelude = [capabilityContract, surfaceHarness, savedMemoryContext, conversationContext]
        .filter(Boolean)
        .join('\n\n');
      let effectivePrompt = surfacePrelude ? `${surfacePrelude}\n\n${normalizedPrompt}` : normalizedPrompt;
      if (this.deps.contextComposer) {
        try {
          effectivePrompt = await this.deps.contextComposer.composePrompt({
            agentId: contextIdentity.agentId,
            personalId: contextIdentity.personalId,
            surface: resolvedSurfaceId,
            secretContextPolicy: secretContextPolicyFor(resolvedSurface, trustedSecretContextHost),
            prompt: effectivePrompt,
          });
        } catch (error) {
          console.warn(
            '[TomnyCore] Context composition failed; continuing without personalization:',
            errorMessage(error)
          );
        }
      }
      if (isCompany) {
        assistantText = await this.runCompanyInMesh({
          requestId,
          sessionId,
          targetId,
          companyId: companyId!.trim(),
          goal: effectivePrompt,
          signal,
          run: (companySignal) =>
            this.deps.companyRunner!.run({
              companyId: companyId!.trim(),
              goal: effectivePrompt,
              model: companyModel?.modelKey,
              signal: companySignal,
              chat: async ({ messages, model, signal: chatSignal }) => {
                let response = '';
                await adapter.run({
                  sessionId: crypto.randomUUID(),
                  target,
                  prompt: messages.map((message) => message.role.toUpperCase() + ': ' + message.content).join('\n\n'),
                  workspace: normalizedWorkspace,
                  modelKey: model ?? companyModel?.modelKey,
                  permissionMode,
                  surface: resolvedSurfaceId,
                  mcpServers,
                  toolCatalog,
                  signal: chatSignal,
                  emit: (event) => {
                    this.observeAdapterTelemetry(requestId, event);
                    if (event.type === 'delta')
                      response = event.mode === 'replace' ? event.text : response + event.text;
                    else
                      this.pushAdapterEvent({
                        requestId,
                        sessionId,
                        targetId,
                        workspace: normalizedWorkspace,
                        event,
                        agentId: `company:${companyId!.trim()}`,
                      });
                  },
                  requestPermission: (request) =>
                    this.requestPermission(requestId, sessionId, targetId, request, permissionIdentity(request.tool)),
                });
                return response;
              },
              onEvent: (event) => {
                if (event.type === 'status')
                  this.push({ requestId, sessionId, targetId, type: 'status', text: event.text });
                else {
                  void this.requestPermission(
                    requestId,
                    sessionId,
                    targetId,
                    {
                      tool: event.tool,
                      detail: event.detail,
                    },
                    permissionIdentity(event.tool)
                  ).then(event.resolve);
                }
              },
            }),
        });
        this.push({ requestId, sessionId, targetId, type: 'delta', text: assistantText, mode: 'replace' });
      } else {
        let candidateResponse = '';
        await this.withAgentLease(() =>
          adapter.run({
            sessionId,
            target,
            prompt: shouldOfferOrchestration(normalizedPrompt)
              ? [ORCHESTRATION_CAPABILITY_PROMPT, `User request:\n${effectivePrompt}`].join('\n\n')
              : effectivePrompt,
            workspace: normalizedWorkspace,
            modelKey,
            permissionMode,
            surface: resolvedSurfaceId,
            mcpServers,
            toolCatalog,
            signal,
            emit: (event) => {
              this.observeAdapterTelemetry(requestId, event);
              if (event.type === 'delta') {
                candidateResponse = event.mode === 'replace' ? event.text : candidateResponse + event.text;

                const active = this.active.get(requestId);
                if (active) active.partialText = candidateResponse;
                return;
              }
              this.pushAdapterEvent({ requestId, sessionId, targetId, workspace: normalizedWorkspace, event });
            },
            requestPermission: (request) =>
              this.requestPermission(requestId, sessionId, targetId, request, permissionIdentity(request.tool)),
          })
        );
        const proposal = parseOrchestrationProposal(candidateResponse);
        if (!proposal) {
          assistantText = candidateResponse;
        } else {
          this.push({
            requestId,
            sessionId,
            targetId,
            type: 'status',
            text: `Agent proposed an approved-gated ${proposal.kind}.`,
          });
          const approved = await this.requestOrchestrationProposalApproval({
            requestId,
            sessionId,
            targetId,
            proposal,
          });
          if (approved) {
            assistantText = await this.executeApprovedOrchestration({
              proposal,
              requestId,
              sessionId,
              targetId,
              target,
              adapter,
              workspace: normalizedWorkspace,
              modelKey,
              permissionMode,
              signal,
              originalPrompt: normalizedPrompt,
              surface: resolvedSurfaceId,
              mcpServers,
              toolCatalog,
              permissionIdentity,
            });
          } else {
            assistantText = `The ${proposal.kind} proposal was declined. No agents or company were created.`;
          }
        }
        this.push({ requestId, sessionId, targetId, type: 'delta', text: assistantText, mode: 'replace' });
      }
      const activeState = this.active.get(requestId);
      const lifecycleInterrupted = signal.aborted && activeState?.lifecycleInterrupted === true;
      transportSucceeded = !signal.aborted;
      checkpoint.status = lifecycleInterrupted ? 'interrupted' : signal.aborted ? 'cancelled' : 'completed';
      if (assistantText) {
        checkpoint.messages.push({ role: 'assistant', text: assistantText, timestamp: Date.now() });
        assistantCheckpointed = true;
      }
      if (transportSucceeded && activeTransportKey && retainsConversationHistory) {
        this.transportCursors.set(activeTransportKey, checkpoint.messages.length);
      }
      checkpoint.updatedAt = Date.now();
      await this.sessionStore.save(checkpoint);
      terminalCheckpointPersisted = true;
      this.recordTerminalTelemetry(requestId, signal.aborted ? 'cancelled' : 'completed');
      if (!lifecycleInterrupted && !activeState?.terminalEventEmitted) {
        this.push({ requestId, sessionId, targetId, type: signal.aborted ? 'cancelled' : 'completed' });
      }
    } catch (error) {
      const message = errorMessage(error);
      transportSucceeded = false;
      const activeState = this.active.get(requestId);
      const lifecycleInterrupted = signal.aborted && activeState?.lifecycleInterrupted === true;
      const cancelledByUser = signal.aborted && activeState?.cancelledByUser === true;
      if (activeTransportKey) this.transportCursors.delete(activeTransportKey);
      if (checkpoint) {
        checkpoint.status = lifecycleInterrupted ? 'interrupted' : cancelledByUser ? 'cancelled' : 'error';
        checkpoint.lastError = lifecycleInterrupted || cancelledByUser ? undefined : message;
      }
      if (!lifecycleInterrupted && !activeState?.terminalEventEmitted) {
        this.recordTerminalTelemetry(requestId, cancelledByUser ? 'cancelled' : 'failed');
        this.push({
          requestId,
          sessionId,
          targetId,
          type: cancelledByUser ? 'cancelled' : 'error',
          text: cancelledByUser ? undefined : message,
        });
      }
    } finally {
      if (checkpoint && !terminalCheckpointPersisted) {
        if (assistantText && !assistantCheckpointed) {
          checkpoint.messages.push({ role: 'assistant', text: assistantText, timestamp: Date.now() });
        }
        if (transportSucceeded && activeTransportKey && retainsConversationHistory) {
          this.transportCursors.set(activeTransportKey, checkpoint.messages.length);
        }
        checkpoint.updatedAt = Date.now();
        await this.sessionStore
          .save(checkpoint)
          .catch((error) => console.error('[TomnyCore] Failed to persist terminal checkpoint:', errorMessage(error)));
      }
      this.denyPermissionsForRequest(requestId);
      this.denyOrchestrationProposalsForRequest(requestId);
      this.active.delete(requestId);

      this.runEvents.delete(requestId);
    }
  }
}
