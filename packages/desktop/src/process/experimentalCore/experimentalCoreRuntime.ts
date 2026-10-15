/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getResourceCoordinator, type IResourceCoordinator } from '@process/resource/resourceCoordinator';
import { redactSensitiveText } from '@process/agentRuntime/agentMesh/security';
import type { CompanyCoreRunner } from '@process/agentRuntime/companyCoreRunner';
import type {
  CoreContextComposeInput,
  CoreContextComposer,
  CoreIdentityContextSnapshot,
} from '@process/agentRuntime/contextTypes';
import type {
  ResolvedSurface,
  SurfaceCapabilityBinding,
  SurfaceRegistry,
  SurfaceResolutionRequest,
} from '@process/agentRuntime/surfaceRegistry';
import { buildSurfaceHarnessPrompt } from '@process/agentRuntime/surfaceRegistry/harnesses';
import { toolNameAllowed } from '@process/toolselect/builtinToolCatalog';
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
import { setWatchdogBreadcrumb } from '@process/services/diagnostics/mainThreadWatchdog';
import {
  dispatchNotification,
  dispatchPostToolUse,
  dispatchPreToolUse,
  dispatchStop,
  drainHookContext,
  getHookCoverage,
  hasActivePreToolUseHook,
  MAX_STOP_CONTINUATIONS,
  sanitizeHookText,
  type HookTurnContext,
} from '@process/integrations/hookRuntime/hookDispatcher';
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
  type CoreRunInput,
  type CoreToolCatalogPolicy,
  type DetectedCoreTarget,
  type TomnySessionActionHistorySource,
} from './adapters';
import { detectCoreTargets } from './coreRegistry';
import type { CliCommandDiscovery } from '@/common/chat/slash/types';
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
    | 'notice'
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
  /** Main-owned grouping for one Workflow run. */
  workflowId?: string;
    workflowStepId?: string;
  workflowStage?: number;
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
  /** Main-owned conversation binding for scoped visual output publication. */
  conversationId?: string;
  permissionScopes?: string[];
  capabilityGrants?: string[];
  availableCapabilities?: string[];
  modelCapabilities?: string[];
  conversationContext?: string;
  /** Exact session-scoped Save block; bounded separately so host context cannot evict it. */
  savedMemoryContext?: string;
  mcpServers?: CoreMcpServer[];
  superMode?: boolean;
  /**
   * Capability ids the chat pipeline chose for this turn. It can only narrow the optional `core.*` groups
   * of the active Surface; it never adds a capability or removes the Surface's own tools.
   */
    toolSelection?: readonly string[] | null;
  /** Default tool ids of the applied assistant: their schemas are attached from the first turn (no tool search). */
  assistantDefaultTools?: readonly string[];
  /** Main-derived, verified large workspace attachment needs eager read/search schemas. */
  prefetchWorkspaceRead?: boolean;
  /** Main-only bounded derivation mode: no profile, MCP, or tool context. */
  sterile?: boolean;
  /**
   * Main-only C4 mode: suppresses all personal/conversation/Save context and
   * built-in tools while retaining only an explicitly injected operation host.
   */
    suppressPersonalContext?: boolean;
  /** Trusted Main-only: ACP slash invocation must reach the provider byte-for-byte as a prompt. */
  nativeCliCommand?: boolean;
};

const MAX_CONVERSATION_CONTEXT_CHARS = 24_000;
const MAX_SAVED_MEMORY_CONTEXT_CHARS = 64_000;
const SECRET_CONTEXT_CAPABILITY_ID = 'core.secret-context';
const SECRET_CONTEXT_SERVER_NAME = 'tomny-secret-context';
/** Capabilities every Core session can use, whatever the conversation grants. A binding missing here is dropped when a surface resolves. */
export const BUILTIN_AVAILABLE_CAPABILITIES = [
    'core.skill-workflow',
  'core.tool-workflow',
  'core.workspace-read',
  // Read-only, redacted notification digest ("what did I miss"); no connector settings or secrets.
  'core.notification-hub',
  SECRET_CONTEXT_CAPABILITY_ID,
];

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
): Required<ExperimentalCoreContextIdentity> => {
  const sterile = identity?.sterile === true;
  const suppressPersonalContext = sterile || identity?.suppressPersonalContext === true;
  return {
    surface: identity?.surface?.trim() || 'chat',
    agentId: identity?.agentId?.trim() || 'tomny',
    personalId: suppressPersonalContext ? 'sterile' : identity?.personalId?.trim() || 'default',
    conversationId: suppressPersonalContext ? '' : identity?.conversationId?.trim() || '',
    permissionScopes: suppressPersonalContext ? [] : [...(identity?.permissionScopes ?? [])],
    capabilityGrants: sterile ? [] : [...(identity?.capabilityGrants ?? [])],
    availableCapabilities: suppressPersonalContext
      ? []
      : [...new Set([...BUILTIN_AVAILABLE_CAPABILITIES, ...(identity?.availableCapabilities ?? [])])],
    modelCapabilities: suppressPersonalContext ? [] : [...(identity?.modelCapabilities ?? [])],
    conversationContext: suppressPersonalContext
      ? ''
      : (identity?.conversationContext?.trim().slice(0, MAX_CONVERSATION_CONTEXT_CHARS) ?? ''),
    savedMemoryContext: suppressPersonalContext ? '' : normalizeSavedMemoryContext(identity?.savedMemoryContext),
    mcpServers: sterile ? [] : [...(identity?.mcpServers ?? [])],
    superMode: suppressPersonalContext ? false : identity?.superMode === true,
        toolSelection:
      suppressPersonalContext || !identity?.toolSelection ? null : [...new Set(identity.toolSelection)].slice(0, 32),
    // Assistant default tools are personal context: a sterile or suppressed run gets none.
    assistantDefaultTools: suppressPersonalContext ? [] : [...new Set(identity?.assistantDefaultTools ?? [])].slice(0, 24),
    prefetchWorkspaceRead: !suppressPersonalContext && identity?.prefetchWorkspaceRead === true,
        sterile,
    suppressPersonalContext,
    nativeCliCommand: identity?.nativeCliCommand === true,
  };
};

const toolMatchesPattern = (tool: string, pattern: string): boolean =>
  pattern === '*' || tool === pattern || (pattern.endsWith('*') && tool.startsWith(pattern.slice(0, -1)));

const childPermissionForParent = (
  permissionMode: ExperimentalPermissionMode
): CoreCapabilityHostContext['permissionMode'] => (permissionMode === 'read-only' ? 'read-only' : 'workspace-write');

const SECRET_FIREWALL_TOOLS = new Set([
  'tomny_secret_use',
  'tomny_secret_capture',
  'tomny_secret_generate',
  'tomny_secret_list',
  'tomny_secret_request',
  'tomny_secret_request_access',
  // The CLI may report an MCP tool without its `tomny_` prefix.
  'secret_use',
  'secret_capture',
  'secret_generate',
  'secret_list',
  'secret_request',
  'secret_request_access',
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

/**
 * Tool-name patterns for MCP servers the user picked for this conversation. The CLI exposes an MCP tool as
 * `mcp__<server>__<tool>`; the server name is also tried with unsafe characters replaced, because the CLI
 * normalises names it puts into a tool identifier.
 */
export const sessionMcpToolPatterns = (servers: readonly Pick<CoreMcpServer, 'name'>[] = []): string[] => {
  const patterns = new Set<string>();
  for (const { name } of servers) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    patterns.add(`mcp__${trimmed}__*`);
    patterns.add(`mcp__${trimmed.replaceAll(/[^A-Za-z0-9_-]/gu, '_')}__*`);
  }
  return [...patterns];
};

/**
 * Resolve Super capabilities through the same scope, grant and compatibility policy as an active Surface.
 *
 * Super adds what works without a surface (`core` and `portable`). A `surface-only` capability needs its
 * surface's live harness, so it joins only as part of the active surface itself; otherwise its schemas would
 * cost tokens for tools that cannot run.
 */
export const resolveCoreSuperCapabilities = (
  registry: SurfaceRegistry | undefined,
  request: Omit<SurfaceResolutionRequest, 'surfaceId'>,
  availableHostNames?: readonly string[],
  activeSurfaceId?: string
): SurfaceCapabilityBinding[] => {
  if (!registry) return [];
  const available = availableHostNames ? new Set(availableHostNames.map((name) => name.toLowerCase())) : undefined;
  const seen = new Set<string>();
  const capabilities: SurfaceCapabilityBinding[] = [];
  for (const result of registry.discover(request)) {
    if (!result.compatible) continue;
    const inActiveSurface = activeSurfaceId !== undefined && result.manifest?.id === activeSurfaceId;
    for (const capability of result.capabilities) {
      if ((capability.availability ?? 'surface-only') === 'surface-only' && !inActiveSurface) continue;
      if (
        capability.kind === 'mcp' &&
        capability.serverName?.trim() &&
        available &&
        !available.has(capability.serverName.trim().toLowerCase())
      ) {
        continue;
      }
      const key = `${capability.id}:${capability.serverName ?? ''}:${capability.toolPatterns.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      capabilities.push(capability);
    }
  }
  return capabilities;
};

/** Build the ToolMap boundary from the selected surface and the conversation's explicit Super mode. */
export const resolveCoreToolCatalogPolicy = (
  surface: ResolvedSurface | undefined,
  superEnabled = false,
  sessionServers: readonly Pick<CoreMcpServer, 'name'>[] = [],
  superCapabilities?: readonly SurfaceCapabilityBinding[]
): CoreToolCatalogPolicy => {
  const capabilities = superEnabled
    ? (superCapabilities ?? surface?.capabilities ?? [])
    : (surface?.capabilities ?? []);
  return {
    mode: superEnabled ? 'super' : 'surface',
    patterns: [
      ...new Set(
        [
          'tomny_session_actions',
          ...sessionMcpToolPatterns(sessionServers),
          ...capabilities
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
/** Attach bounded eager file tools only when the trusted Surface already allows both schemas. */
export const shouldPrefetchAttachedFileTools = (
  requested: boolean,
  patterns: readonly string[],
  availableHostNames: readonly string[]
): boolean =>
  requested &&
  toolNameAllowed('tomny_read', patterns) &&
  toolNameAllowed('tomny_search', patterns) &&
  availableHostNames.some((name) => name === 'tomny-core-workspace' || name === 'tomny-ide');

export const resolveCoreCapabilityServerNames = (
  surface: ResolvedSurface | undefined,
  registry: SurfaceRegistry | undefined,
  superEnabled: boolean,
  availableHostNames?: readonly string[],
  superCapabilities?: readonly SurfaceCapabilityBinding[]
): string[] => {
  const capabilities = superEnabled
    ? (superCapabilities ?? (registry ? registry.list().flatMap((manifest) => manifest.capabilities) : []))
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

/** Hook state of one governed run (design 11.3). Absent for sterile derivation runs, which never fire hooks. */
type HookRunState = {
  turn: HookTurnContext;
  /** Tool requests seen so far, so PostToolUse can carry the input of the call it reports on. */
  calls: Map<string, { tool: string; input?: unknown }>;
};

const MAX_TRACKED_HOOK_CALLS = 500;

const kindForTarget = (target: DetectedCoreTarget): ExperimentalTargetKind => {
  if (target.protocol === 'tomny-json-stream') return 'builtin';
  if (target.protocol === 'loopback-openai') return 'local';
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
  /** Isolated by exact session, Surface, workspace and permission/tool grants. */
  private readonly workflowSessions = new Map<string, {
    store: import('@process/agentRuntime/agentMesh/workflow/resultDelivery').WorkflowResultStore;
    mailbox: import('@process/agentRuntime/agentMesh/workflow/mailbox').WorkflowMailbox;
    updatedAt: number;
  }>();
  private readonly eventListeners = new Set<(event: ExperimentalCoreEvent) => void>();
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly orchestrationProposals = new Map<string, PendingOrchestrationProposal>();
  private readonly hookStates = new Map<string, HookRunState>();
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

    /** Resolve advertised CLI commands via the installed provider adapter, never via a model prompt. */
    public async listCommands(
    targetId: string, workspace: string, logicalSessionId?: string,
    onUpdate?: (value: CliCommandDiscovery) => void
  ): Promise<CliCommandDiscovery> {
    const cwd = requireWorkspace(workspace);
    if (this.targets.length === 0) this.targets = await this.deps.detectTargets();
    const target = this.targets.find((candidate) => candidate.id === targetId);
    if (!target?.available) return { status: 'unavailable', commands: [] };
    const adapter = this.deps.adapters.find((candidate) => candidate.protocol === target.protocol);
    if (!adapter?.listCommands) return { status: 'unsupported', commands: [] };
        return adapter.listCommands(target, cwd, logicalSessionId, onUpdate);
  }

  public releaseCommands(logicalSessionId: string): void {
    for (const adapter of this.deps.adapters) adapter.releaseCommands?.(logicalSessionId);
  }

  /** Resolve the concrete network destination for the selected model before Foundation grants cloud execution. */
  public async resolveNetworkHost(targetId: string, modelKey?: string): Promise<string | undefined> {
    if (this.targets.length === 0) this.targets = await this.deps.detectTargets();
    if (targetId === EXPERIMENTAL_COMPANY_TARGET_ID) {
      const companyModel = decodeCompanyModelKey(modelKey);
      const transportTargetId = companyModel?.targetId ?? this.targets.find((candidate) => candidate.available)?.id;
      if (!transportTargetId) return undefined;
      const target = this.targets.find((candidate) => candidate.id === transportTargetId);
      if (!target) return undefined;
      if (target.networkHost) return target.networkHost;
      const adapter = this.deps.adapters.find((candidate) => candidate.protocol === target.protocol);
      return adapter?.networkHostForModel?.(companyModel?.modelKey ?? modelKey);
    }
    const target = this.targets.find((candidate) => candidate.id === targetId);
    if (!target) throw new Error(`Core target is not registered: ${targetId}`);
    if (target.networkHost) return target.networkHost;
    const adapter = this.deps.adapters.find((candidate) => candidate.protocol === target.protocol);
    return adapter?.networkHostForModel?.(modelKey);
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
        events: [...(this.runEvents.get(requestId) ?? [])].filter((event) => event.type !== 'delta'),
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

    const surfaceRequest = {
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
    };
    const surfaceResolution = this.deps.surfaceRegistry?.resolve(surfaceRequest);
    if (surfaceResolution?.ok === false) {
      throw new Error(surfaceResolution.issues.map((issue) => issue.message).join(' '));
    }
    const resolvedSurface = surfaceResolution?.ok ? surfaceResolution.value : undefined;
    const superCapabilities = contextIdentity.superMode
      ? resolveCoreSuperCapabilities(
          this.deps.surfaceRegistry,
          surfaceRequest,
          this.deps.availableCapabilityHostNames?.(),
          resolvedSurface?.manifest.id
        )
      : undefined;
    const surfaceId = resolvedSurface?.manifest.id ?? contextIdentity.surface;
    const toolCatalog =
      contextIdentity.sterile || contextIdentity.suppressPersonalContext
        ? { mode: 'surface' as const, patterns: [] }
        : resolveCoreToolCatalogPolicy(
            resolvedSurface,
            contextIdentity.superMode,
            contextIdentity.mcpServers,
            superCapabilities
          );
    const mcpServerNames =
      contextIdentity.sterile || contextIdentity.suppressPersonalContext
        ? []
        : resolveCoreCapabilityServerNames(
            resolvedSurface,
            this.deps.surfaceRegistry,
            contextIdentity.superMode,
            this.deps.availableCapabilityHostNames?.(),
            superCapabilities
          );
    const capabilityHostContext: CoreCapabilityHostContext = Object.freeze({
      requestId: input.sessionId,
      conversationId: contextIdentity.conversationId || input.sessionId,
      sessionId: input.sessionId,
      workspace,
      surface: surfaceId,
      permissionMode: childPermissionForParent(permissionMode),
      toolPatterns: Object.freeze([...toolCatalog.patterns]),
    });
    const mcpServers = contextIdentity.sterile
      ? []
      : this.deps.resolveCapabilityHosts
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
      this.deps.contextComposer?.inspectContext && !contextIdentity.suppressPersonalContext
        ? this.deps.contextComposer
            .inspectContext({
              agentId: contextIdentity.agentId,
              personalId: contextIdentity.personalId,
              surface: surfaceId,
              workspace,
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
    setWatchdogBreadcrumb(approved ? 'permission:approve' : 'permission:deny');
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
      const hookState = this.hookStates.get(requestId);
      if (hookState) {
        void dispatchNotification(
          hookState.turn,
          `Permission requested for ${sanitizeHookText(request.tool, 80)}`
        ).catch((): undefined => undefined);
      }
    });
  }

  /**
   * Permission callback and PreToolUse gate for one adapter run (design 11.3, spike S-1).
   *
   * - Native adapter (`tomny-json-stream`): it sees every tool request before the tool runs, so it gets the
   *   `preToolUse` gate and its own `requestPermission` is left alone (no second hook run for the same tool).
   * - Every other adapter: its tools only reach Tomny as permission requests, so the hook runs at the head of
   *   `requestPermission`. Tools the agent never asks about cannot be blocked (Codex, ACP outside ask mode).
   * A hook `deny` returns false; `ask` forces a fresh question; no verdict leaves the normal flow untouched.
   */
  private hookedPermission(
    requestId: string,
    sessionId: string,
    targetId: string,
    adapter: CoreAdapter,
    identityFor: (tool: string) => PermissionIdentity
  ): Pick<CoreRunInput, 'requestPermission' | 'preToolUse'> {
    const state = this.hookStates.get(requestId);
    const native = adapter.protocol === 'tomny-json-stream';
    const announceDeny = (tool: string, reason: string): void =>
      this.push({
        requestId,
        sessionId,
        targetId,
        type: 'notice',
        text: `A hook blocked ${sanitizeHookText(tool, 80)}: ${reason}`,
      });
    const requestPermission: CoreRunInput['requestPermission'] = async (request) => {
      let forceFresh = request.forceFresh === true;
      if (state && !native) {
        const verdict = await dispatchPreToolUse(state.turn, {
          tool: request.tool,
          input: request.detail === undefined ? {} : { detail: request.detail },
        });
        if (verdict.action === 'deny') {
          announceDeny(request.tool, verdict.reason);
          return false;
        }
        if (verdict.action === 'ask') forceFresh = true;
      }
      return this.requestPermission(requestId, sessionId, targetId, request, identityFor(request.tool), forceFresh);
    };
    if (!state || !native) return { requestPermission };
    return {
      requestPermission,
      preToolUse: async (call) => {
        const verdict = await dispatchPreToolUse(state.turn, call);
        if (verdict.action === 'deny') announceDeny(call.tool, verdict.reason);
        return verdict;
      },
    };
  }

  /** PostToolUse / PostToolUseFailure: observe finished tool calls of every agent. Never blocks the event path. */
  private observeToolHooks(requestId: string, event: CoreAdapterEvent): void {
    const state = this.hookStates.get(requestId);
    if (!state) return;
    if (event.type === 'tool-call') {
      if (!event.callId) return;
      if (state.calls.size >= MAX_TRACKED_HOOK_CALLS) state.calls.clear();
      state.calls.set(event.callId, { tool: event.tool, ...(event.input !== undefined ? { input: event.input } : {}) });
      return;
    }
    if (event.type !== 'tool-result') return;
    const call = event.callId ? state.calls.get(event.callId) : undefined;
    if (event.callId) state.calls.delete(event.callId);
    const input = event.input ?? call?.input;
    void dispatchPostToolUse(state.turn, {
      tool: event.tool,
      outcome: event.outcome,
      text: event.text,
      ...(event.callId ? { callId: event.callId } : {}),
      ...(input !== undefined ? { input } : {}),
    }).catch((): undefined => undefined);
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
          ...this.hookedPermission(
            input.requestId,
            input.sessionId,
            input.targetId,
            input.adapter,
            input.permissionIdentity
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
    this.observeToolHooks(input.requestId, adapterEvent);
    this.push({
      requestId: input.requestId,
      sessionId: input.sessionId,
      targetId: input.targetId,
      workspace: input.workspace,
      ...adapterEvent,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
  }

  private async withAgentLease<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const coordinator = this.deps.coordinator;
    if (!coordinator) return run();
    let lease: { id: string } | undefined;
    try {
      // Cancel the request when we stop waiting. Otherwise it stays queued and is granted
      // later with no owner, permanently occupying an agent slot until restart.
      const requestAbort = new AbortController();
      const requested = coordinator.requestLease({ kind: 'agent', estCostMB: 96 }, { signal: requestAbort.signal });
      let timer: NodeJS.Timeout | undefined;
      const gaveUp = new Promise<undefined>((resolve) => {
        const giveUp = (): void => {
          requestAbort.abort();
          resolve(undefined);
        };
        timer = setTimeout(giveUp, 1500);
        signal?.addEventListener('abort', giveUp, { once: true });
      });
      lease = await Promise.race([requested, gaveUp])
        .catch((err): undefined => {
          console.warn('[TomnyCore] Resource lease bypassed or timed out:', err);
          return undefined;
        })
        .finally(() => {
          if (timer) clearTimeout(timer);
        });
      // A grant that raced with the cancellation has no owner; release it immediately.
      void requested.then(
        (late) => {
          if (lease?.id !== late.id) coordinator.releaseLease(late.id);
        },
        (): undefined => undefined
      );
      return await run();
    } finally {
      if (lease?.id) {
        try {
          coordinator.releaseLease(lease.id);
        } catch {
          /* ignore */
        }
      }
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
        let closeWorkflowHost: (() => Promise<void>) | undefined;
    let workflowMailboxPrelude = '';
    // Phase timing for the first message of a session, which is where a slow start shows up (`[Tomny:send]`).
    const phaseStartedAt = performance.now();
    const markPhase = (label: string): void =>
      console.info(`[Tomny:send] run ${label} +${Math.round(performance.now() - phaseStartedAt)}ms`);
    try {
      await this.initialized;
      markPhase('initialized');
      const normalizedPrompt = prompt.trim();
      const normalizedWorkspace = requireWorkspace(workspace);
      if (!normalizedPrompt) throw new Error('Prompt cannot be empty.');
      try {
        await this.deps.telemetry?.startRun({ runId: requestId, sessionId, targetId });
      } catch (error) {
        console.warn('[TomnyCore] Telemetry start failed:', errorMessage(error));
      }

      if (this.targets.length === 0) this.targets = await this.deps.detectTargets();
      markPhase('targets detected');
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
      const surfaceRequest = {
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
      };
      const surfaceResolution = this.deps.surfaceRegistry?.resolve(surfaceRequest);
      if (surfaceResolution?.ok === false) {
        throw new Error(surfaceResolution.issues.map((issue) => issue.message).join(' '));
      }
      const resolvedSurface = surfaceResolution?.ok ? surfaceResolution.value : undefined;
      const superCapabilities = contextIdentity.superMode
        ? resolveCoreSuperCapabilities(
            this.deps.surfaceRegistry,
            surfaceRequest,
            this.deps.availableCapabilityHostNames?.()
          )
        : undefined;
      const resolvedSurfaceId = resolvedSurface?.manifest.id ?? contextIdentity.surface;
      const toolCatalog =
        contextIdentity.sterile || contextIdentity.suppressPersonalContext
          ? { mode: 'surface' as const, patterns: [] }
          : resolveCoreToolCatalogPolicy(
              resolvedSurface,
              contextIdentity.superMode,
              contextIdentity.mcpServers,
              superCapabilities
            );
      let trustedSecretContextHost = false;
      const permissionIdentity = (tool: string): PermissionIdentity => ({
        ...permissionIdentityFor(contextIdentity, resolvedSurfaceId, resolvedSurface, tool),
        trustedSecretContextHost,
      });

      const mcpServerNames =
        contextIdentity.sterile || contextIdentity.suppressPersonalContext
          ? []
          : resolveCoreCapabilityServerNames(
              resolvedSurface,
              this.deps.surfaceRegistry,
              contextIdentity.superMode,
              this.deps.availableCapabilityHostNames?.(),
              superCapabilities
            );
      const capabilityHostContext: CoreCapabilityHostContext = Object.freeze({
        requestId,
        conversationId: contextIdentity.conversationId || sessionId,
        sessionId,
        workspace: normalizedWorkspace,
        surface: resolvedSurfaceId,
        permissionMode: childPermissionForParent(permissionMode),
        requestPermission: (request) =>
          this.requestPermission(requestId, sessionId, targetId, request, permissionIdentity(request.tool)),
      });
                  // Main has verified the path; eager schemas do not widen the Surface's allowed tools.
                  const allowAttachedFileTools = shouldPrefetchAttachedFileTools(
        contextIdentity.prefetchWorkspaceRead && !contextIdentity.sterile && !contextIdentity.suppressPersonalContext,
        toolCatalog.patterns,
        mcpServerNames
      );
            const enableWorkflow =
        !contextIdentity.sterile && !contextIdentity.suppressPersonalContext &&
        Boolean(this.deps.resolveCapabilityHosts) &&
        mcpServerNames.includes('tomny-workflow') &&
        toolNameAllowed('workflow_run', toolCatalog.patterns);
      const ordinaryServerNames = mcpServerNames.filter((name) => name !== 'tomny-workflow');
      const requestedServerNames = allowAttachedFileTools
        ? [...ordinaryServerNames, 'tomny-attached-file-tools']
        : ordinaryServerNames;
      const mcpServers = contextIdentity.sterile
        ? []
        : this.deps.resolveCapabilityHosts
          ? await this.deps.resolveCapabilityHosts(requestedServerNames, contextIdentity.mcpServers, capabilityHostContext)
          : contextIdentity.mcpServers;
                  if (enableWorkflow) {
        const scope = JSON.stringify([sessionId, targetId, normalizedWorkspace, resolvedSurfaceId, permissionMode,
          [...toolCatalog.patterns].sort(), contextIdentity.permissionScopes, contextIdentity.capabilityGrants]);
        for (const [key, value] of this.workflowSessions) {
          if (Date.now() - value.updatedAt > 600_000 && value.mailbox.activeCount() === 0) {
            value.store.clear();
            this.workflowSessions.delete(key);
          }
        }
        let workflowSession = this.workflowSessions.get(scope);
        if (!workflowSession) {
          const { createWorkflowResultStore } = await import('@process/agentRuntime/agentMesh/workflow/resultDelivery');
          const { createWorkflowMailbox } = await import('@process/agentRuntime/agentMesh/workflow/mailbox');
          const store = createWorkflowResultStore();
          workflowSession = { store, mailbox: createWorkflowMailbox(store), updatedAt: Date.now() };
          if (this.workflowSessions.size >= 32) throw new Error('WORKFLOW_SESSION_CAPACITY');
          this.workflowSessions.set(scope, workflowSession);
        }
        workflowSession.updatedAt = Date.now();
        const { startWorkflowMcpHost } = await import('@process/agentRuntime/agentMesh/workflow/host');
        const host = await startWorkflowMcpHost({
          requestId,
          servers: mcpServers,
          patterns: toolCatalog.patterns,
                    signal,
          coordinator: getResourceCoordinator(),
          resultStore: workflowSession.store,
          mailbox: workflowSession.mailbox,

                              onStep: async (event) => {
            // Live workflow diagnostics never trigger another Agent/model turn.
            const raw = event.output === undefined ? '' : typeof event.output === 'string' ? event.output : JSON.stringify(event.output) ?? '';
            this.push({
              requestId, sessionId, targetId,
              type: event.phase === 'running' ? 'tool-call' : 'tool-result',
              tool: event.tool,
              callId: `workflow:${event.workflowId}:${event.id}`,
              workflowId: event.workflowId,
                            workflowStepId: event.id,
              workflowStage: event.workflowStage,
              input: sanitizeToolEventInput(event.tool, event.input),
              text: event.phase === 'running' ? '' : redactSensitiveText(raw.slice(0, 3_000)).text,
              ...(event.phase !== 'running' ? { outcome: event.phase === 'success' ? 'success' : 'error' } : {}),
            });
            const state = this.hookStates.get(requestId);
            if (!state || event.phase === 'running') return;
                        try {
              await dispatchPostToolUse(state.turn, {
                tool: event.tool,
                outcome: event.phase === 'success' ? 'success' : 'error',
                text: typeof event.output === 'string' ? event.output.slice(0, 4_000) : JSON.stringify(event.output)?.slice(0, 4_000) ?? '',
                input: event.input,
                callId: `workflow:${event.id}`,
              });
            } catch (error) {
              console.warn('[TomnyCore] Workflow PostToolUse report failed:', errorMessage(error));
            }
          },
                    authorize: async (tool, input) => {
            if (!this.active.has(requestId) || !toolNameAllowed(tool, toolCatalog.patterns) || signal.aborted) return false;
            let forceFresh = false;
            const hookState = this.hookStates.get(requestId);
            if (hookState) {
              const verdict = await dispatchPreToolUse(hookState.turn, { tool, input });
              if (verdict.action === 'deny') return false;
              if (verdict.action === 'ask') forceFresh = true;
            }
            return this.requestPermission(
              requestId, sessionId, targetId,
              { tool, detail: 'A step of a user-scoped multi-tool workflow.' },
              permissionIdentity(tool), forceFresh
            );
          },
        });
        closeWorkflowHost = host.close;
                mcpServers.push({ name: host.name, url: host.url, headers: host.headers, deferred: false });
        const pendingMail = workflowSession.mailbox.list().filter((job) => job.unread > 0 || job.status === 'needs_agent' || job.status === 'running');
                if (pendingMail.length) {
          workflowMailboxPrelude = `## Pending Workflow Mailbox (Main-owned, scoped to this Session)\n${JSON.stringify(pendingMail.slice(0, 8))}\nUse the preloaded workflow_mailbox_poll tool for a specific workflowId and cursor. A completed tool never triggers a model turn by itself.`;
          this.push({ requestId, sessionId, targetId, type: 'notice', text: workflowMailboxPrelude });
        }
      }
      markPhase(`capability hosts ready (${mcpServers.length})`);
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
      if (!contextIdentity.sterile && !contextIdentity.suppressPersonalContext) {
        const hookTurn: HookTurnContext = {
          sessionId,
          workspaceDir: normalizedWorkspace,
          permissionMode,
          surface: resolvedSurfaceId,
          agent: targetId,
          signal,
          ...(contextIdentity.conversationId ? { conversationId: contextIdentity.conversationId } : {}),
        };
        this.hookStates.set(requestId, { turn: hookTurn, calls: new Map() });
        // Say so when the selected agent cannot be blocked by the active PreToolUse hooks (never overstate coverage).
        const coverage = getHookCoverage(adapter.protocol, permissionMode);
        if (coverage.preToolUse !== 'all-tools' && (await hasActivePreToolUseHook(normalizedWorkspace))) {
          this.push({ requestId, sessionId, targetId, type: 'notice', text: coverage.note });
        }
      }
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
      // Context hooks queued for this session (SessionStart, tool hooks of the last turn): untrusted data.
      const hookContext = this.hookStates.has(requestId) ? await drainHookContext(sessionId) : undefined;
      const surfacePrelude = [capabilityContract, surfaceHarness, savedMemoryContext, conversationContext, hookContext, workflowMailboxPrelude]
        .filter(Boolean)
        .join('\n\n');
            // ACP slash commands are a protocol invocation, not a natural language request.
      // Retain the normal resource grants, permissions and audit, but do not prepend any host context.
            if (contextIdentity.nativeCliCommand && adapter.protocol !== 'acp' &&
        !(adapter.protocol === 'codex-app-server' && /^\/skill:[a-zA-Z0-9][a-zA-Z0-9_.-]{0,71}(?=\s|$)/u.test(normalizedPrompt))) {
        throw new Error('CLI_COMMAND_PROVIDER_UNSUPPORTED');
      }
      let effectivePrompt = contextIdentity.nativeCliCommand
        ? normalizedPrompt
        : surfacePrelude ? `${surfacePrelude}\n\n${normalizedPrompt}` : normalizedPrompt;
      if (!contextIdentity.nativeCliCommand && this.deps.contextComposer && !contextIdentity.suppressPersonalContext) {
        try {
          effectivePrompt = await this.deps.contextComposer.composePrompt({
            agentId: contextIdentity.agentId,
            personalId: contextIdentity.personalId,
            surface: resolvedSurfaceId,
            workspace: normalizedWorkspace,
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
                  ...this.hookedPermission(requestId, sessionId, targetId, adapter, permissionIdentity),
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
        let firstAdapterEventSeen = false;
        const runAdapterTurn = (turnPrompt: string): Promise<void> =>
          this.withAgentLease(
            () =>
              adapter.run({
                                sessionId,
                target,
                persistentSession: (adapter.protocol === 'acp' || adapter.protocol === 'codex-app-server') &&
                  Boolean(contextIdentity.conversationId),
                prompt: turnPrompt,
                workspace: normalizedWorkspace,
                modelKey,
                permissionMode,
                surface: resolvedSurfaceId,
                mcpServers,
                toolCatalog,
                signal,
                emit: (event) => {
                  this.observeAdapterTelemetry(requestId, event);
                  if (!firstAdapterEventSeen) {
                    firstAdapterEventSeen = true;
                    markPhase(`first agent event (${event.type})`);
                  }
                  if (event.type === 'delta') {
                    candidateResponse = event.mode === 'replace' ? event.text : candidateResponse + event.text;

                    const active = this.active.get(requestId);
                    if (active) active.partialText = candidateResponse;
                    if (!shouldOfferOrchestration(normalizedPrompt) || !candidateResponse.trimStart().startsWith('{')) {
                      this.pushAdapterEvent({ requestId, sessionId, targetId, workspace: normalizedWorkspace, event });
                    }
                    return;
                  }
                  this.pushAdapterEvent({ requestId, sessionId, targetId, workspace: normalizedWorkspace, event });
                },
                ...this.hookedPermission(requestId, sessionId, targetId, adapter, permissionIdentity),
              }),
            signal
          );
        markPhase('starting the agent');
                await runAdapterTurn(
          !contextIdentity.nativeCliCommand && shouldOfferOrchestration(normalizedPrompt)
            ? [ORCHESTRATION_CAPABILITY_PROMPT, `User request:\n${effectivePrompt}`].join('\n\n')
            : effectivePrompt
        );
        // Stop hooks (design 11.5): a hook may ask the agent to keep going. The runtime had no turn loop, so this
        // is it: at most MAX_STOP_CONTINUATIONS extra turns, and `completed` is emitted only after the loop.
        const stopState = this.hookStates.get(requestId);
        let stopContinuations = 0;
        let stopTranscript = '';
        for (;;) {
          if (contextIdentity.nativeCliCommand || !stopState || signal.aborted || parseOrchestrationProposal(candidateResponse)) break;
          // oxlint-disable-next-line no-await-in-loop -- continuations are sequential by design
          const stop = await dispatchStop(stopState.turn, {
            lastAssistantMessage: candidateResponse,
            stopHookActive: stopContinuations > 0,
          });
          if (stop.halted && stop.notice) {
            this.push({
              requestId,
              sessionId,
              targetId,
              type: 'notice',
              text: `A hook stopped the turn: ${stop.notice}`,
            });
          }
          if (!stop.continueWith) break;
          if (stopContinuations >= MAX_STOP_CONTINUATIONS) {
            this.push({
              requestId,
              sessionId,
              targetId,
              type: 'notice',
              text: `Stop hooks asked to continue more than ${MAX_STOP_CONTINUATIONS} times in a row; the turn ended.`,
            });
            break;
          }
          stopContinuations += 1;
          const separator = `\n\n> ${stop.continueWith}\n\n`;
          stopTranscript += candidateResponse + separator;
          this.push({ requestId, sessionId, targetId, type: 'delta', text: separator, mode: 'append' });
          const previousAnswer = candidateResponse.slice(-8_000);
          candidateResponse = '';
          // A transport that does not keep the conversation needs the earlier answer in the prompt again.
          // oxlint-disable-next-line no-await-in-loop -- continuations are sequential by design
          await runAdapterTurn(
            retainsConversationHistory
              ? stop.continueWith
              : [effectivePrompt, `Your previous answer:\n${previousAnswer}`, stop.continueWith].join('\n\n')
          );
        }
        if (stopContinuations > 0) candidateResponse = stopTranscript + candidateResponse;
        const proposal = contextIdentity.nativeCliCommand || stopContinuations > 0
          ? undefined : parseOrchestrationProposal(candidateResponse);
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
      if (!assistantText.trim() && !signal.aborted) {
        assistantText =
          'The model completed the turn without generating any output. Please verify your model selection and provider status in Settings.';
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
            if (closeWorkflowHost) {
        await closeWorkflowHost().catch((error) =>
          console.warn('[TomnyCore] Workflow host cleanup failed:', errorMessage(error))
        );
      }
      this.denyPermissionsForRequest(requestId);
      this.denyOrchestrationProposalsForRequest(requestId);
      this.active.delete(requestId);
      this.hookStates.delete(requestId);

      this.runEvents.delete(requestId);
    }
  }
}
