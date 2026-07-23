/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AionrsContextBranch,
  AionrsContextSnapshot,
  IConversationListChangedEvent,
  IConversationTurnCompletedEvent,
  ICreateConversationParams,
  IResponseMessage,
  ISendMessageResult,
} from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation, TProviderWithModel } from '@/common/config/storage';

import { TOMNI_GATEWAY_PROVIDER_ID, withRouter9ReasoningEffort } from '@/common/router9';
import type { NativeOpenClawRuntime } from '@/common/types/agent/sessionChannels';
import type { AcpModelInfo } from '@/common/types/platform/acpTypes';
import type {
  ExperimentalCoreContextIdentity,
  ExperimentalCoreEvent,
} from '@process/experimentalCore/experimentalCoreRuntime';
import type { ExperimentalPermissionMode } from '@process/experimentalCore/experimentalCoreProtocol';
import type { CoreContextSnapshot, CoreMcpServer } from '@process/experimentalCore/adapters';
import type { ExperimentalCoreModel } from '@process/experimentalCore/experimentalCoreProtocol';
import type { CoreSessionCheckpoint } from '@process/experimentalCore/sessionCheckpointStore';
import type { ISessionMemoryStore, SuperMemoryItem } from '@process/ide/memory/sessionMemoryStore';
import { classifyWorkKind, deepDebugTask, isDeepDebugRequest, type WorkKind } from '@process/services/debug';
import type { NativeConversationRepository } from './repository';
import {
  emptyActionEvidence,
  recordActionEvidence,
  renderActionEvidence,
  type ActionEvidenceLedger,
} from './actionContext';

export type NativeConversationRuntime = {
  start: (
    requestId: string,
    targetId: string,
    prompt: string,
    workspace: string,
    modelKey: string | undefined,
    permissionMode: ExperimentalPermissionMode,
    sessionId: string,
    companyId?: string,
    contextIdentity?: ExperimentalCoreContextIdentity
  ) => { requestId: string; sessionId: string };
  cancel: (requestId: string) => Promise<boolean>;
  inspectContext: (input: {
    sessionId: string;
    targetId: string;
    workspace: string;
    modelKey?: string;
    permissionMode?: ExperimentalPermissionMode;
    contextIdentity?: ExperimentalCoreContextIdentity;
  }) => Promise<CoreContextSnapshot>;
  resolvePermission: (
    permissionId: string,
    approved: boolean,
    lifetime?: 'allow-once' | 'session' | 'persistent'
  ) => Promise<boolean>;
  resolveOrchestrationProposal: (proposalId: string, approved: boolean) => Promise<boolean>;
  getSession: (sessionId: string) => Promise<CoreSessionCheckpoint | undefined>;
  updateSessionConfig: (
    sessionId: string,
    config: { sessionMode?: string; modelKey?: string }
  ) => Promise<CoreSessionCheckpoint | undefined>;
  listModels: (targetId: string, workspace: string) => Promise<ExperimentalCoreModel[]>;
};

export type NativeConversationEvents = {
  response: (message: IResponseMessage) => void;
  turnCompleted: (event: IConversationTurnCompletedEvent) => void;
  listChanged: (event: IConversationListChangedEvent) => void;
};

export type NativeConversationWorkspaceProvisioner = (conversation: TChatConversation) => Promise<string>;

export type NativeSendMessageParams = {
  input: string;
  model_input?: string;
  conversation_id: string;
  files?: string[];
  loading_id?: string;
  inject_skills?: string[];
};

type ActiveTurn = {
  conversationId: string;
  requestId: string;
  userPrompt: string;
  assistantMessageId: string;
  assistantText: string;
  /** Retain arguments between the requested/running and result frames. */
  toolInputs: Map<string, unknown>;
  /** Bounded action journal exists only after the model passes StartAction. */
  action?: {
    goal: string;
    kind: WorkKind;
    deepDebug: boolean;
    tools: string[];
    evidence: ActionEvidenceLedger;
  };
};

const clone = <T>(value: T): T => structuredClone(value);

const stringValue = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const numberValue = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

const MCP_ERROR_ENVELOPE =
  /^\s*(?:mcp\s+error(?:\s+-?\d+)?\s*:|input\s+validation\s+error\b|invalid\s+arguments?\s+for\s+tool\b|\{?\s*["']?is[_ ]?error["']?\s*[:=]\s*true\b)/iu;

/**
 * Structured outcomes are authoritative. Some MCP servers still return a
 * validation failure as a successful text payload, so detect that legacy
 * fallback only when the payload itself starts with an error envelope.
 * Successful command output may legitimately quote those words later.
 */
const isMcpToolResultError = (event: ExperimentalCoreEvent): boolean => {
  if (event.outcome === 'error') return true;
  if (event.type !== 'tool-result') return false;
  return [event.text, event.detail].some((value) => typeof value === 'string' && MCP_ERROR_ENVELOPE.test(value));
};

const providerModel = (conversation: TChatConversation): TProviderWithModel | undefined =>
  'model' in conversation ? (conversation.model as TProviderWithModel | undefined) : undefined;

const workspaceFor = (conversation: TChatConversation): string =>
  typeof conversation.extra?.workspace === 'string' ? conversation.extra.workspace : '';

const modelKeyFor = (conversation: TChatConversation): string | undefined => {
  const extra = conversation.extra as Record<string, unknown>;
  const provider = providerModel(conversation);
  const appProviderModel =
    provider?.id === TOMNI_GATEWAY_PROVIDER_ID
      ? withRouter9ReasoningEffort(provider.use_model, provider.reasoning_effort)
      : provider?.use_model;
  const appProviderKey =
    conversation.type === 'aionrs' && provider?.id?.trim() && appProviderModel?.trim()
      ? `app-provider:${encodeURIComponent(provider.id)}:${encodeURIComponent(appProviderModel)}`
      : undefined;
  for (const value of [extra.tomny_core_model_key, extra.current_model_id, extra.codexModel, extra.codex_model]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    // A Tomni conversation must carry the provider identity with the model so
    // the adapter can inject that provider's API key, rather than falling back
    // to a stale CLI environment key.
    if (
      appProviderKey &&
      !value.startsWith('app-provider:') &&
      !value.startsWith('provider:') &&
      !value.startsWith('profile:')
    ) {
      return appProviderKey;
    }
    return value;
  }
  return appProviderKey ?? provider?.use_model;
};

const targetFor = (conversation: TChatConversation): string => {
  const nativeTarget = (conversation.extra as Record<string, unknown>).tomny_core_target_id;
  if (typeof nativeTarget === 'string' && nativeTarget.trim()) return nativeTarget;
  if (conversation.type === 'aionrs') return 'tomny';
  if (conversation.type === 'codex') return 'codex';
  if (conversation.type === 'remote') {
    const id = (conversation.extra as Record<string, unknown>).remote_agent_id;
    return typeof id === 'string' && id.trim() ? id : 'remote';
  }
  if (conversation.type === 'openclaw-gateway') return 'openclaw';
  const backend = (conversation.extra as Record<string, unknown>).backend;
  return typeof backend === 'string' && backend.trim() ? backend : 'tomny';
};

const permissionFor = (conversation: TChatConversation): ExperimentalPermissionMode => {
  const extra = conversation.extra as Record<string, unknown>;
  const sessionMode = typeof extra.session_mode === 'string' ? extra.session_mode.trim().toLowerCase() : '';
  if (sessionMode === 'yolo' || sessionMode === 'full-access') return 'full-access';
  if (sessionMode === 'auto_edit' || sessionMode === 'auto-edit' || sessionMode === 'workspace-write') {
    return 'workspace-write';
  }
  const sandbox = extra.sandboxMode;
  if (sandbox === 'read-only' || sandbox === 'workspace-write') return sandbox;
  if (sandbox === 'danger-full-access') return 'full-access';
  return 'workspace-write';
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

const stringEntries = (value: unknown): Array<{ name: string; value: string }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([name, item]) =>
    typeof item === 'string' ? [{ name, value: item }] : []
  );
};

const coreMcpServerFromSnapshot = (value: unknown): CoreMcpServer | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const server = value as Record<string, unknown>;
  const name = typeof server.name === 'string' ? server.name.trim() : '';
  const transport =
    server.transport && typeof server.transport === 'object' && !Array.isArray(server.transport)
      ? (server.transport as Record<string, unknown>)
      : {};
  const type = typeof transport.type === 'string' ? transport.type : '';
  if (!name) return undefined;
  if (type === 'stdio') {
    const command = typeof transport.command === 'string' ? transport.command.trim() : '';
    if (!command) return undefined;
    return {
      name,
      transport: 'stdio',
      command,
      args: stringList(transport.args),
      env: stringEntries(transport.env),
    };
  }
  if (type !== 'sse' && type !== 'http' && type !== 'streamable_http') return undefined;
  const url = typeof transport.url === 'string' ? transport.url.trim() : '';
  if (!url) return undefined;
  return {
    name,
    transport: type,
    url,
    headers: stringEntries(transport.headers),
  };
};

/** Restore only explicitly selected MCP snapshots; unrelated extra fields remain inaccessible. */
const conversationMcpServersFor = (conversation: TChatConversation): CoreMcpServer[] => {
  const extra = conversation.extra as Record<string, unknown>;
  const snapshots = [extra.selected_session_mcp_servers, extra.session_mcp_servers].flatMap((value) =>
    Array.isArray(value) ? value : []
  );
  const byName = new Map<string, CoreMcpServer>();
  for (const snapshot of snapshots) {
    const server = coreMcpServerFromSnapshot(snapshot);
    if (server) byName.set(server.name.toLowerCase(), server);
  }
  return [...byName.values()];
};

/** Restores the surface grants and bounded host guidance selected by the conversation UI. */
const contextIdentityFor = (
  conversation: TChatConversation,
  savedMemoryContext = ''
): ExperimentalCoreContextIdentity => {
  const extra = conversation.extra as Record<string, unknown>;
  const surface = typeof extra.surface === 'string' && extra.surface.trim() ? extra.surface.trim() : 'chat';
  const permissionMode = permissionFor(conversation);
  const permissionScopes = stringList(extra.permission_scopes);
  const capabilityGrants = stringList(extra.capability_grants);
  const availableCapabilities = stringList(extra.available_capabilities);
  const conversationContext = conversationContextFor(conversation);
  const mcpServers = conversationMcpServersFor(conversation);
  const context = {
    surface,
    permissionScopes,
    capabilityGrants,
    availableCapabilities,
    superMode:
      extra.super_mode === true ||
      (typeof extra.preset_rules === 'string' && extra.preset_rules.includes('## Super capabilities (Super is ON)')),
    ...(conversationContext ? { conversationContext } : {}),
    ...(savedMemoryContext ? { savedMemoryContext } : {}),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
  };
  if (surface !== 'ide' || permissionMode === 'read-only') return context;
  return {
    ...context,
    permissionScopes: permissionScopes.length > 0 ? permissionScopes : ['workspace.read', 'workspace.write'],
    capabilityGrants: capabilityGrants.length > 0 ? capabilityGrants : ['surface.ide'],
    availableCapabilities: availableCapabilities.length > 0 ? availableCapabilities : ['surface.ide'],
  };
};

const textMessage = (
  id: string,
  conversationId: string,
  content: string,
  position: 'left' | 'right',
  createdAt: number,
  status: TMessage['status'] = 'finish'
): TMessage => ({
  id,
  msg_id: id,
  type: 'text',
  conversation_id: conversationId,
  position,
  created_at: createdAt,
  status,
  content: { content },
});

const contextBranchesFor = (conversation: TChatConversation): AionrsContextBranch[] => {
  const value = (conversation.extra as Record<string, unknown>).tomny_context_branches;
  if (!Array.isArray(value)) return [];
  return value.flatMap((branch): AionrsContextBranch[] => {
    if (!branch || typeof branch !== 'object') return [];
    const item = branch as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.summary !== 'string' ||
      typeof item.content !== 'string'
    )
      return [];
    return [{ id: item.id, title: item.title, summary: item.summary, content: item.content }];
  });
};

const MAX_NATIVE_CONVERSATION_CONTEXT_CHARS = 24_000;
const stringField = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Compose only context explicitly managed by the user. Generated presets are
 * metadata for the host UI; the Core and surface harness already provide the
 * model's identity and IDE guidance without duplicating project-wide rules.
 */
const conversationContextFor = (conversation: TChatConversation): string => {
  const extra = conversation.extra as Record<string, unknown>;
  const sections: string[] = [];
  const append = (title: string, value: unknown): void => {
    const text = stringField(value);
    if (text) sections.push(`${title}\n${text}`);
  };
  append('## User-managed conversation context', extra.tomny_custom_context);

  const branches = contextBranchesFor(conversation);
  if (branches.length > 0) {
    sections.push(
      [
        '## Active context branches',
        ...branches.map((branch) => `### ${branch.title}\nSummary: ${branch.summary}\n${branch.content}`),
      ].join('\n\n')
    );
  }

  const rendered = sections.join('\n\n').trim();
  if (rendered.length <= MAX_NATIVE_CONVERSATION_CONTEXT_CHARS) return rendered;
  const marker = '\n\n[Conversation context truncated by Tomny Core.]';
  return rendered.slice(0, MAX_NATIVE_CONVERSATION_CONTEXT_CHARS - marker.length) + marker;
};

const renderSavedMemoryItem = (item: SuperMemoryItem, title: string): string =>
  `### ${title} (${item.id}, ${item.kind})\n${item.text}`;

const isStartAction = (tool: string): boolean => tool.toLowerCase().replaceAll(/[^a-z0-9]/gu, '') === 'startaction';

type ToolMapSummary = {
  count: number;
  deferred: string[];
  recommended: string[];
  tools: string[];
};

type StartActionToolMap = {
  output: string;
  summary: ToolMapSummary;
};

/**
 * Tomny returns the action's ToolMap inside StartAction's text result. Split
 * that protocol payload into compact display metadata so the renderer can show
 * ToolMap as a first-class View Step without repeating every description.
 */
const extractStartActionToolMap = (output: string): StartActionToolMap | undefined => {
  const match = /(?:^|\r?\n)ToolMap:\s*(\[[^\r\n]*\])(?=\r?\n|$)/u.exec(output);
  if (!match?.[1]) return undefined;
  let rawEntries: unknown;
  try {
    rawEntries = JSON.parse(match[1]);
  } catch {
    return undefined;
  }
  if (!Array.isArray(rawEntries)) return undefined;

  const entries = rawEntries.flatMap(
    (value): Array<Record<string, unknown>> =>
      value && typeof value === 'object' && !Array.isArray(value) ? [value as Record<string, unknown>] : []
  );
  const tools = entries.flatMap((entry) => {
    const name = stringValue(entry.name)?.trim();
    return name ? [name] : [];
  });
  if (tools.length === 0 && rawEntries.length > 0) return undefined;

  const namesWithFlag = (flag: 'deferred' | 'recommended'): string[] =>
    entries.flatMap((entry) => {
      const name = stringValue(entry.name)?.trim();
      return name && entry[flag] === true ? [name] : [];
    });
  const before = output.slice(0, match.index).trimEnd();
  const after = output.slice(match.index + match[0].length).trimStart();
  return {
    output: [before, after].filter(Boolean).join('\n'),
    summary: {
      count: tools.length,
      recommended: namesWithFlag('recommended'),
      deferred: namesWithFlag('deferred'),
      tools,
    },
  };
};

const actionGoalFrom = (input: unknown, fallback: string): string => {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of ['goal', 'task', 'intent', 'description']) {
      const value = stringValue(record[key])?.trim();
      if (value) return value.slice(0, 400);
    }
  }
  return fallback.trim().slice(0, 400);
};

const compactCapsuleText = (text: string, maxChars: number): string => {
  const compact = text.replaceAll(/\s+/gu, ' ').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 18)).trimEnd()} [truncated]`;
};

const lexicalTokens = (text: string): Set<string> =>
  new Set(
    Array.from(text.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu), (match) => match[0]).filter(
      (token) => token.length >= 3
    )
  );

/**
 * Prefer strong lexical matches when recall found one, while retaining the
 * whole hybrid result for paraphrases that have no strong lexical anchor.
 */
const stronglyRelevantItems = (items: SuperMemoryItem[], query: string): SuperMemoryItem[] => {
  const queryTokens = lexicalTokens(query);
  if (queryTokens.size < 2 || items.length < 2) return items;
  const scored = items.map((item) => ({
    item,
    overlap: [...queryTokens].filter((token) => lexicalTokens(item.text).has(token)).length,
  }));
  const strong = scored.filter(({ overlap }) => overlap >= 2).map(({ item }) => item);
  return strong.length > 0 ? strong : items;
};

/** Query-scoped Save payload supplied to the model; secret metadata/values are excluded. */
const savedMemoryContextFor = (conversation: TChatConversation, memory?: ISessionMemoryStore, query = ''): string => {
  if (!memory) return '';
  const extra = conversation.extra as Record<string, unknown>;
  const memoryId = typeof extra.ide_memory_id === 'string' ? extra.ide_memory_id.trim() : '';
  if (!memoryId) return '';
  const recalled = memory.recall(memoryId, { query });
  const relevantRecent = stronglyRelevantItems(recalled.recent, query);
  const sections = [
    ...recalled.pinned.map((item) => renderSavedMemoryItem(item, 'Pinned Save item')),
    ...recalled.summaries.map((item) => renderSavedMemoryItem(item, 'Compacted Save summary')),
    ...relevantRecent.map((item) => renderSavedMemoryItem(item, 'Save item')),
  ];
  if (sections.length === 0) return '';
  return [
    '## Save — session-scoped historical context',
    'This is the only remembered historical context. Treat each pinned item as an independent retained fact.',
    ...sections,
  ].join('\n\n');
};

const textFromMessage = (message: TMessage): string => {
  const content = message.content;
  if (content && typeof content === 'object' && 'content' in content) {
    const text = (content as { content?: unknown }).content;
    if (typeof text === 'string') return text;
  }
  return typeof content === 'string' ? content : JSON.stringify(content);
};

/** Owns the normal chat lifecycle without any AionCore HTTP/WebSocket dependency. */
export class NativeConversationService {
  private readonly activeByConversation = new Map<string, ActiveTurn>();
  private readonly activeByRequest = new Map<string, ActiveTurn>();
  private readonly orchestrationProposalMessages = new Map<string, { conversationId: string; messageId: string }>();

  private readonly eventQueues = new Map<string, Promise<void>>();

  public constructor(
    private readonly repository: NativeConversationRepository,
    private readonly runtime: NativeConversationRuntime,
    private readonly events: NativeConversationEvents,
    private readonly workspaceProvisioner?: NativeConversationWorkspaceProvisioner,
    private readonly memory?: ISessionMemoryStore
  ) {}

  public initialize(): Promise<void> {
    return this.repository.initialize();
  }

  public async create(params: ICreateConversationParams): Promise<TChatConversation> {
    const now = Date.now();
    const conversation = {
      id: params.id?.trim() || crypto.randomUUID(),
      created_at: now,
      modified_at: now,
      name: params.name?.trim() || 'New conversation',
      type: params.type,
      extra: {
        ...clone(params.extra),
        tomny_core_session_id: params.id?.trim() || undefined,
      },
      model: clone(params.model),
      status: 'pending',
      source: 'aionui',
    } as TChatConversation;
    const preparedConversation = await this.provisionWorkspaceIfNeeded(conversation);
    (preparedConversation.extra as Record<string, unknown>).tomny_core_session_id = preparedConversation.id;
    (preparedConversation.extra as Record<string, unknown>).tomny_core_target_id = targetFor(preparedConversation);
    (preparedConversation.extra as Record<string, unknown>).tomny_core_model_key = modelKeyFor(preparedConversation);
    await this.repository.saveConversation(preparedConversation);
    this.events.listChanged({
      conversation_id: preparedConversation.id,
      action: 'created',
      source: preparedConversation.source,
    });
    return clone(preparedConversation);
  }

  public async cloneConversation(conversation: TChatConversation): Promise<TChatConversation> {
    const copy = clone(conversation);
    (copy.extra as Record<string, unknown>).tomny_core_session_id = copy.id;
    if (typeof (copy.extra as Record<string, unknown>).ide_memory_id === 'string') {
      (copy.extra as Record<string, unknown>).ide_memory_id = crypto.randomUUID();
    }
    await this.repository.saveConversation(copy);
    this.events.listChanged({ conversation_id: copy.id, action: 'created', source: copy.source });
    return copy;
  }

  public get(id: string): Promise<TChatConversation | undefined> {
    return this.repository.getConversation(id);
  }

  /** Returns the renderer-compatible per-conversation context without legacy HTTP. */
  public async getAionrsContext(conversationId: string): Promise<AionrsContextSnapshot> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    const messages = await this.repository.listMessages(conversationId);
    const extra = conversation.extra as Record<string, unknown>;
    const customContext = typeof extra.tomny_custom_context === 'string' ? extra.tomny_custom_context : '';
    const sessionId =
      (typeof extra.tomny_core_session_id === 'string' && extra.tomny_core_session_id.trim()) || conversation.id;
    const savedMemoryContext = savedMemoryContextFor(conversation, this.memory);
    const coreContext = await this.runtime.inspectContext({
      sessionId,
      targetId: targetFor(conversation),
      workspace: workspaceFor(conversation),
      modelKey: modelKeyFor(conversation),
      permissionMode: permissionFor(conversation),
      contextIdentity: contextIdentityFor(conversation, savedMemoryContext),
    });
    const branches = contextBranchesFor(conversation);
    // The renderer message list is an archive/search surface, never prompt context.
    const contextMessages: AionrsContextSnapshot['messages'] = [];
    const archivedMessageTokens = messages.reduce(
      (total, message) => total + Math.ceil(textFromMessage(message).length / 4),
      0
    );
    const branchTokens = branches.reduce((total, branch) => total + Math.ceil(branch.content.length / 4), 0);
    const systemTokens = Math.ceil(coreContext.system.length / 4);
    // StartAction belongs to the Tomny control plane. The IDE context should
    // expose only the concrete schemas selected through ToolSearch.
    const contextTools = coreContext.toolCache ?? [];
    const toolTokens = Math.ceil(JSON.stringify(contextTools).length / 4);
    const coreContextTools = coreContext.tools;
    const coreHistory: NonNullable<typeof coreContext.history> = [];
    const agentContext = coreContext.agentContext ?? '';
    const personalContext = coreContext.personalContext ?? '';
    const promptMessageTokens = 0;
    const savedMemoryTokens = Math.ceil(savedMemoryContext.length / 4);
    const coreTokens =
      Math.ceil(agentContext.length / 4) +
      Math.ceil(personalContext.length / 4) +
      Math.ceil(JSON.stringify(coreContextTools).length / 4);
    const model = modelKeyFor(conversation) ?? 'default';
    const workingMemory =
      coreContext.workingMemory &&
      typeof coreContext.workingMemory === 'object' &&
      !Array.isArray(coreContext.workingMemory)
        ? (coreContext.workingMemory as Record<string, unknown>)
        : {};
    const toolCache = Object.fromEntries((coreContext.toolCache ?? []).map((tool) => [tool.name, clone(tool)]));
    return {
      model,
      system: coreContext.system,
      messages: contextMessages,
      tools: clone(contextTools),
      core_context: {
        agent: agentContext,
        personal: personalContext,
        control_tools: clone(coreContextTools),
        history: clone(coreHistory),
        saved_memory: savedMemoryContext,
      },
      max_tokens: 0,
      thinking: null,
      custom_context: customContext,
      context_branches: branches,
      active_context_branch_ids: branches.map((branch) => branch.id),
      working_memory: workingMemory,
      full_message_count: messages.length,
      tool_cache: toolCache,
      session_experience: coreContext.capabilitySummary ? { capability_summary: coreContext.capabilitySummary } : {},
      token_estimate: {
        system: systemTokens,
        prompt_messages: promptMessageTokens,
        archived_messages: archivedMessageTokens,
        saved_memory: savedMemoryTokens,
        context_branches: branchTokens,
        messages: 0,
        tools: toolTokens,
        core: coreTokens,
        // The searchable renderer archive is intentionally excluded. Total is
        // The searchable message archive is excluded. Save is the sole durable
        // historical context and is counted exactly as rendered above.
        total: systemTokens + savedMemoryTokens + branchTokens + toolTokens + coreTokens,
      },
    };
  }

  public async updateAionrsContext(
    conversationId: string,
    customContext: string,
    branches: AionrsContextBranch[]
  ): Promise<AionrsContextSnapshot> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    await this.update(conversationId, {
      extra: {
        ...conversation.extra,
        tomny_custom_context: customContext,
        tomny_context_branches: clone(branches),
      },
    } as Partial<TChatConversation>);
    return this.getAionrsContext(conversationId);
  }

  public async getSessionMode(conversationId: string): Promise<{ mode: string; initialized: boolean }> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) return { mode: 'default', initialized: false };
    const extra = conversation.extra as Record<string, unknown>;
    const sessionId =
      (typeof extra.tomny_core_session_id === 'string' && extra.tomny_core_session_id) || conversation.id;
    const checkpoint = await this.runtime.getSession(sessionId);
    const persisted = typeof extra.session_mode === 'string' ? extra.session_mode : undefined;
    return { mode: checkpoint?.sessionMode ?? persisted ?? 'default', initialized: Boolean(checkpoint) };
  }

  public async setSessionMode(conversationId: string, mode: string): Promise<void> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    const normalized = mode.trim();
    if (!normalized) throw new Error('Session mode is required.');
    const extra = conversation.extra as Record<string, unknown>;
    const sessionId =
      (typeof extra.tomny_core_session_id === 'string' && extra.tomny_core_session_id) || conversation.id;
    await this.update(conversationId, {
      extra: { ...conversation.extra, session_mode: normalized },
    } as Partial<TChatConversation>);
    await this.runtime.updateSessionConfig(sessionId, { sessionMode: normalized });
  }

  public async getSessionModel(conversationId: string): Promise<{ model_info: AcpModelInfo | null }> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) return { model_info: null };
    const extra = conversation.extra as Record<string, unknown>;
    const sessionId =
      (typeof extra.tomny_core_session_id === 'string' && extra.tomny_core_session_id) || conversation.id;
    const checkpoint = await this.runtime.getSession(sessionId);
    const current = checkpoint?.modelKey ?? modelKeyFor(conversation) ?? null;
    const models = await this.runtime
      .listModels(targetFor(conversation), workspaceFor(conversation))
      .catch((): ExperimentalCoreModel[] => []);
    if (!current && models.length === 0) return { model_info: null };
    const available = models.map((model) => ({ id: model.modelId, label: model.label }));
    if (current && !available.some((model) => model.id === current)) available.unshift({ id: current, label: current });
    return {
      model_info: {
        current_model_id: current,
        current_model_label: available.find((model) => model.id === current)?.label ?? current,
        available_models: available,
      },
    };
  }

  public async setSessionModel(conversationId: string, modelId: string): Promise<void> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    const normalized = modelId.trim();
    if (!normalized) throw new Error('Model id is required.');
    const extra = conversation.extra as Record<string, unknown>;
    const sessionId =
      (typeof extra.tomny_core_session_id === 'string' && extra.tomny_core_session_id) || conversation.id;
    await this.update(conversationId, {
      extra: {
        ...conversation.extra,
        current_model_id: normalized,
        tomny_core_model_key: normalized,
      },
    } as Partial<TChatConversation>);
    await this.runtime.updateSessionConfig(sessionId, { modelKey: normalized });
  }

  public async getOpenClawRuntime(conversationId: string): Promise<NativeOpenClawRuntime> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    const extra = conversation.extra as Record<string, unknown>;
    const gateway =
      extra.gateway && typeof extra.gateway === 'object' ? (extra.gateway as Record<string, unknown>) : {};
    const validation =
      extra.runtimeValidation && typeof extra.runtimeValidation === 'object'
        ? (extra.runtimeValidation as Record<string, unknown>)
        : {};
    const sessionId =
      (typeof extra.tomny_core_session_id === 'string' && extra.tomny_core_session_id) || conversation.id;
    const checkpoint = await this.runtime.getSession(sessionId);
    return {
      conversation_id: conversationId,
      runtime: {
        workspace: checkpoint?.workspace || stringValue(extra.workspace),
        backend: checkpoint?.targetId || stringValue(extra.backend),
        agent_name: stringValue(extra.agent_name),
        cli_path: stringValue(gateway.cli_path),
        model: checkpoint?.modelKey ?? modelKeyFor(conversation),
        session_key: stringValue(extra.sessionKey) ?? null,
        is_connected: Boolean(checkpoint && checkpoint.status !== 'error' && checkpoint.status !== 'cancelled'),
        has_active_session: checkpoint?.status === 'running',
        identity_hash: stringValue(validation.expectedIdentityHash) ?? null,
      },
      expected: {
        expected_workspace: stringValue(validation.expectedWorkspace),
        expected_backend: stringValue(validation.expectedBackend),
        expected_agent_name: stringValue(validation.expectedAgentName),
        expected_cli_path: stringValue(validation.expectedCliPath),
        expected_model: stringValue(validation.expectedModel),
        expected_identity_hash: stringValue(validation.expectedIdentityHash) ?? null,
        switched_at: numberValue(validation.switchedAt),
      },
    };
  }

  public async list(
    cursor?: string,
    limit = 50
  ): Promise<{ items: TChatConversation[]; total: number; has_more: boolean }> {
    const all = await this.repository.listConversations();
    const start = cursor ? Math.max(0, all.findIndex((item) => item.id === cursor) + 1) : 0;
    const size = Math.max(1, Math.min(200, Math.trunc(limit)));
    return { items: all.slice(start, start + size), total: all.length, has_more: start + size < all.length };
  }

  public async update(id: string, updates: Partial<TChatConversation>, mergeExtra = false): Promise<boolean> {
    const current = await this.repository.getConversation(id);
    if (!current) return false;
    const next = {
      ...current,
      ...clone(updates),
      id,
      modified_at: Date.now(),
      ...(mergeExtra && updates.extra ? { extra: { ...current.extra, ...clone(updates.extra) } } : {}),
    } as TChatConversation;
    await this.repository.saveConversation(next);
    this.events.listChanged({ conversation_id: id, action: 'updated', source: next.source });
    return true;
  }

  public async remove(id: string): Promise<boolean> {
    const conversation = await this.repository.getConversation(id);
    await this.cancel(id);
    const removed = await this.repository.removeConversation(id);
    if (removed) {
      const extra = conversation?.extra as Record<string, unknown> | undefined;
      const memoryId = typeof extra?.ide_memory_id === 'string' ? extra.ide_memory_id.trim() : '';
      if (memoryId) this.memory?.clearSession(memoryId);
      this.events.listChanged({ conversation_id: id, action: 'deleted' });
    }
    return removed;
  }

  public async reset(id: string): Promise<void> {
    await this.cancel(id);
    await this.repository.clearMessages(id);
    const conversation = await this.repository.getConversation(id);
    if (!conversation) return;
    await this.update(id, {
      status: 'pending',
      extra: { ...conversation.extra, tomny_core_session_id: crypto.randomUUID() },
    } as Partial<TChatConversation>);
  }

  public async history(
    conversationId: string,
    page = 1,
    pageSize = 50,
    order = 'asc'
  ): Promise<{ items: TMessage[]; total: number; has_more: boolean }> {
    const all = await this.repository.listMessages(conversationId);
    const ordered = order.toLowerCase() === 'desc' ? all.toReversed() : all;
    const size = Math.max(1, Math.min(500, Math.trunc(pageSize)));
    const start = Math.max(0, Math.trunc(page) - 1) * size;
    return { items: ordered.slice(start, start + size), total: all.length, has_more: start + size < all.length };
  }

  public async message(conversationId: string, messageId: string): Promise<TMessage> {
    const result = await this.repository.getMessage(conversationId, messageId);
    if (!result) throw new Error(`Message not found: ${messageId}`);
    return result;
  }

  public activeCount(): number {
    return this.activeByRequest.size;
  }

  public async send(params: NativeSendMessageParams): Promise<ISendMessageResult> {
    if (this.activeByConversation.has(params.conversation_id)) {
      throw new Error('This conversation is already generating a response.');
    }
    const input = params.input.trim();
    if (!input) throw new Error('Message cannot be empty.');
    const existingConversation = await this.repository.getConversation(params.conversation_id);
    if (!existingConversation) throw new Error(`Conversation not found: ${params.conversation_id}`);
    const conversation = await this.provisionWorkspaceIfNeeded(existingConversation, true);
    const workspace = workspaceFor(conversation);
    if (!workspace.trim()) throw new Error('Select a workspace before starting the agent.');

    const now = Date.now();
    const userMessageId = params.loading_id?.trim() || crypto.randomUUID();
    const userMessage = textMessage(userMessageId, conversation.id, input, 'right', now);
    await this.repository.saveMessage(userMessage);
    this.events.response({
      type: 'user_content',
      data: { content: input },
      msg_id: userMessageId,
      conversation_id: conversation.id,
      created_at: now,
    });

    const requestId = `${conversation.id}:${crypto.randomUUID()}`;
    const active: ActiveTurn = {
      conversationId: conversation.id,
      requestId,
      userPrompt: input,
      assistantMessageId: `${requestId}:assistant`,
      assistantText: '',
      toolInputs: new Map(),
    };
    this.activeByConversation.set(conversation.id, active);
    this.activeByRequest.set(requestId, active);
    await this.update(conversation.id, { status: 'running' } as Partial<TChatConversation>);

    const requestedDeepDebug = isDeepDebugRequest(input) || isDeepDebugRequest(params.model_input ?? '');
    const modelPrompt = params.model_input?.trim() || input;
    const taskPrompt = requestedDeepDebug
      ? deepDebugTask(input) || deepDebugTask(modelPrompt) || modelPrompt
      : modelPrompt;
    const effectivePrompt = requestedDeepDebug
      ? [
          '[Deep Debug control: explicitly requested by the user]',
          `Task: ${taskPrompt}`,
          'After StartAction, call ide_research with mode="bug" and deepDebug=true.',
          'Use a stable reproduction before edits. Keep at most three independent hypotheses and choose the cheapest discriminating test.',
          'Treat failed fixes as negative evidence, backtrack across boundaries, and remove unproven patches before repeating a same-layer fix.',
          'Verify with the identical fast test; use saved Quick Test replay/compare when runtime, network, console, screenshot or cross-process evidence matters.',
        ].join('\n')
      : modelPrompt;
    const prompt = [effectivePrompt, ...(params.files ?? []).map((file) => `\n[Attached file: ${file}]`)].join('');
    try {
      this.runtime.start(
        requestId,
        targetFor(conversation),
        prompt,
        workspace,
        modelKeyFor(conversation),
        permissionFor(conversation),
        ((conversation.extra as Record<string, unknown>).tomny_core_session_id as string | undefined) ??
          conversation.id,
        undefined,
        contextIdentityFor(conversation, savedMemoryContextFor(conversation, this.memory, prompt))
      );
    } catch (error) {
      this.activeByConversation.delete(conversation.id);
      this.activeByRequest.delete(requestId);
      await this.update(conversation.id, { status: 'finished' } as Partial<TChatConversation>);
      throw error;
    }
    return { msg_id: userMessageId };
  }

  /** Supplies an isolated scratch workspace when the user starts a normal chat without choosing a project. */
  private async provisionWorkspaceIfNeeded(
    conversation: TChatConversation,
    persist = false
  ): Promise<TChatConversation> {
    if (workspaceFor(conversation).trim() || !this.workspaceProvisioner) return conversation;

    const workspace = (await this.workspaceProvisioner(clone(conversation))).trim();
    if (!workspace) return conversation;

    const next = {
      ...conversation,
      modified_at: Date.now(),
      extra: {
        ...conversation.extra,
        workspace,
        custom_workspace: false,
        is_temporary_workspace: true,
      },
    } as TChatConversation;
    if (persist) {
      await this.repository.saveConversation(next);
      this.events.listChanged({ conversation_id: next.id, action: 'updated', source: next.source });
    }
    return next;
  }

  public async cancel(conversationId: string): Promise<void> {
    const active = this.activeByConversation.get(conversationId);
    if (active) await this.runtime.cancel(active.requestId);
  }

  /** Resolves a permission produced by the direct Tomni Core runtime. */
  public resolvePermission(
    permissionId: string,
    approved: boolean,
    lifetime: 'allow-once' | 'session' | 'persistent' = 'allow-once'
  ): Promise<boolean> {
    return this.runtime.resolvePermission(permissionId, approved, lifetime);
  }

  public async resolveOrchestrationProposal(proposalId: string, approved: boolean): Promise<boolean> {
    const resolved = await this.runtime.resolveOrchestrationProposal(proposalId, approved);
    if (!resolved) return false;
    const reference = this.orchestrationProposalMessages.get(proposalId);
    if (!reference) return true;
    this.orchestrationProposalMessages.delete(proposalId);
    const message = await this.repository.getMessage(reference.conversationId, reference.messageId);
    if (message?.type !== 'orchestration_proposal') return true;
    const updated: TMessage = {
      ...message,
      status: 'finish',
      content: { ...message.content, decision: approved ? 'approved' : 'declined' },
    };
    await this.repository.saveMessage(updated);
    this.events.response({
      type: 'orchestration_proposal',
      data: updated.content,
      msg_id: updated.msg_id ?? updated.id,
      conversation_id: reference.conversationId,
      created_at: Date.now(),
    });
    return true;
  }

  public handleCoreEvent(event: ExperimentalCoreEvent): void {
    const active = this.activeByRequest.get(event.requestId);
    if (!active) return;
    const previous = this.eventQueues.get(event.requestId) ?? Promise.resolve();
    const next = previous
      .then(() => this.processCoreEvent(active, event))
      .catch((error) => console.error('[NativeConversation] Failed to persist core event:', error));
    this.eventQueues.set(event.requestId, next);
    void next.finally(() => {
      if (this.eventQueues.get(event.requestId) === next) this.eventQueues.delete(event.requestId);
    });
  }

  private async processCoreEvent(active: ActiveTurn, event: ExperimentalCoreEvent): Promise<void> {
    const base = {
      msg_id: active.assistantMessageId,
      conversation_id: active.conversationId,
      created_at: event.timestamp,
    };
    if (event.type === 'started') {
      this.events.response({ ...base, type: 'start', data: null });
      return;
    }
    if (event.type === 'delta') {
      if (event.mode === 'replace') active.assistantText = event.text ?? '';
      else active.assistantText += event.text ?? '';
      this.events.response({
        ...base,
        type: 'content',
        data: { content: event.text ?? '', ...(event.mode === 'replace' ? { replace: true } : {}) },
        replace: event.mode === 'replace',
      });
      await this.repository.saveMessage(
        textMessage(
          active.assistantMessageId,
          active.conversationId,
          active.assistantText,
          'left',
          event.timestamp,
          'work'
        )
      );
      return;
    }
    if (event.type === 'thinking' || event.type === 'step' || event.type === 'status') {
      this.events.response({
        ...base,
        type: 'thinking',
        data: { content: event.text ?? '', subject: event.type === 'step' ? 'Step' : undefined, status: 'thinking' },
      });
      return;
    }
    if (event.type === 'tool-call' || event.type === 'tool-result') {
      const tool = event.tool?.trim() || 'Tomny';
      const callId = event.callId?.trim();
      // call_id is the canonical lifecycle identity. Falling back to the tool
      // name merges parallel or repeated calls of the same tool into one step.
      if (!callId) return;
      const completed = event.type === 'tool-result';
      if (event.type === 'tool-call') {
        if (isStartAction(tool)) {
          const goal = actionGoalFrom(event.input, active.userPrompt);
          active.action = {
            goal,
            kind: classifyWorkKind(goal),
            deepDebug: isDeepDebugRequest(active.userPrompt),
            tools: [],
            evidence: emptyActionEvidence(),
          };
        } else if (active.action && !active.action.tools.includes(tool) && active.action.tools.length < 24) {
          active.action.tools.push(tool);
        }
      }
      if (event.input !== undefined) active.toolInputs.set(callId, clone(event.input));
      const retainedInput = event.input !== undefined ? event.input : active.toolInputs.get(callId);
      if (active.action && event.type === 'tool-call') {
        recordActionEvidence(active.action.evidence, tool, retainedInput);
      }
      if (active.action && completed) {
        recordActionEvidence(active.action.evidence, tool, retainedInput, event.text ?? event.detail);
      }
      const toolMap = completed && isStartAction(tool) ? extractStartActionToolMap(event.text ?? '') : undefined;
      const resultDisplay = toolMap?.output ?? event.text ?? '';
      const toolGroupItems = [
        {
          call_id: callId,
          name: tool,
          ...(event.agentId ? { agent_id: event.agentId } : {}),
          description: completed ? '' : (event.text ?? ''),
          render_output_as_markdown: false,
          ...(retainedInput !== undefined ? { input: clone(retainedInput) } : {}),
          ...(completed ? { result_display: resultDisplay } : {}),
          status: completed ? (isMcpToolResultError(event) ? 'Error' : 'Success') : 'Executing',
        },
        ...(toolMap
          ? [
              {
                call_id: `${callId}:tool-map`,
                name: 'ToolMap',
                description: String(toolMap.summary.count),
                render_output_as_markdown: false,
                result_display: JSON.stringify(toolMap.summary, null, 2),
                status: 'Success',
              },
            ]
          : []),
      ];
      this.events.response({
        ...base,
        type: 'tool_group',
        data: toolGroupItems,
      });
      if (completed) active.toolInputs.delete(callId);
      return;
    }
    if (event.type === 'orchestration-proposal') {
      if (!event.orchestrationProposalId || !event.orchestrationProposal) {
        this.events.response({
          ...base,
          type: 'error',
          data: { message: 'Tomni Core emitted an invalid orchestration proposal.' },
        });
        return;
      }
      const proposalMessageId = `${active.assistantMessageId}:orchestration:${event.orchestrationProposalId}`;
      this.orchestrationProposalMessages.set(event.orchestrationProposalId, {
        conversationId: active.conversationId,
        messageId: proposalMessageId,
      });
      const content = {
        id: event.orchestrationProposalId,
        proposal_id: event.orchestrationProposalId,
        proposal: event.orchestrationProposal,
      };
      await this.repository.saveMessage({
        id: proposalMessageId,
        msg_id: proposalMessageId,
        type: 'orchestration_proposal',
        position: 'left',
        conversation_id: active.conversationId,
        created_at: event.timestamp,
        status: 'pending',
        content,
      });
      this.events.response({
        ...base,
        msg_id: proposalMessageId,
        type: 'orchestration_proposal',
        data: content,
      });
      return;
    }
    if (event.type === 'permission') {
      if (!event.permissionId) {
        this.events.response({
          ...base,
          type: 'error',
          data: { message: 'Tomni Core emitted a permission request without a permission id.' },
        });
        return;
      }
      this.events.response({
        ...base,
        type: 'permission',
        data: {
          id: event.permissionId,
          call_id: event.permissionId,
          native_core_permission_id: event.permissionId,
          title: event.tool,
          description: event.detail ?? event.text ?? '',
          options:
            event.tool === 'orchestration.create.team' || event.tool === 'orchestration.create.company'
              ? [
                  { label: 'messages.confirmation.yesAllowOnce', value: 'proceed_once' },
                  { label: 'messages.confirmation.no', value: 'cancel' },
                ]
              : [
                  { label: 'messages.confirmation.yesAllowOnce', value: 'proceed_once' },
                  { label: 'messages.confirmation.yesAllowAlways', value: 'proceed_always' },
                  { label: 'messages.confirmation.no', value: 'cancel' },
                ],
        },
      });
      return;
    }
    if (event.type === 'completed') {
      await this.finish(active, event, 'ai_waiting_input');
      return;
    }
    if (event.type === 'cancelled') {
      await this.finish(active, event, 'stopped');
      return;
    }
    if (event.type === 'error') {
      this.events.response({ ...base, type: 'error', data: { message: event.text ?? 'Agent failed.' } });
      await this.finish(active, event, 'error');
    }
  }

  private async finish(
    active: ActiveTurn,
    event: ExperimentalCoreEvent,
    state: IConversationTurnCompletedEvent['state']
  ): Promise<void> {
    if (active.assistantText) {
      await this.repository.saveMessage(
        textMessage(
          active.assistantMessageId,
          active.conversationId,
          active.assistantText,
          'left',
          event.timestamp,
          state === 'error' ? 'error' : 'finish'
        )
      );
    }
    await this.persistActionCapsule(active, event, state);
    this.activeByConversation.delete(active.conversationId);
    this.activeByRequest.delete(active.requestId);
    await this.update(active.conversationId, { status: 'finished' } as Partial<TChatConversation>);
    this.events.response({
      type: 'finish',
      data: { state },
      msg_id: active.assistantMessageId,
      conversation_id: active.conversationId,
      created_at: event.timestamp,
    });
    const conversation = await this.repository.getConversation(active.conversationId);
    this.events.turnCompleted({
      session_id: active.conversationId,
      status: 'finished',
      state,
      detail: event.text ?? '',
      can_send_message: true,
      runtime: { has_task: false, is_processing: false, pending_confirmations: 0, db_status: 'finished' },
      workspace: conversation ? workspaceFor(conversation) : '',
      model: {
        platform: providerModel(conversation as TChatConversation)?.platform ?? '',
        name: providerModel(conversation as TChatConversation)?.name ?? '',
        use_model: providerModel(conversation as TChatConversation)?.use_model ?? '',
      },
      last_message: {
        id: active.assistantMessageId,
        type: 'text',
        content: { content: active.assistantText },
        status: state === 'error' ? 'error' : 'finish',
        created_at: event.timestamp,
      },
    });
  }

  /** Close the bounded StartAction journal into a compact, queryable Save capsule. */
  private async persistActionCapsule(
    active: ActiveTurn,
    event: ExperimentalCoreEvent,
    state: IConversationTurnCompletedEvent['state']
  ): Promise<void> {
    if (!this.memory || !active.action) return;
    const conversation = await this.repository.getConversation(active.conversationId);
    const extra = conversation?.extra as Record<string, unknown> | undefined;
    const memoryId = typeof extra?.ide_memory_id === 'string' ? extra.ide_memory_id.trim() : '';
    if (!memoryId) return;

    const outcome = compactCapsuleText(active.assistantText || event.text || 'No final response was recorded.', 900);
    const tools = active.action.tools.length > 0 ? active.action.tools.join(', ') : 'none';
    const capsule = [
      'Action capsule',
      `Goal: ${compactCapsuleText(active.action.goal, 400)}`,
      `Work kind: ${active.action.kind}${active.action.deepDebug ? ' · deep-debug' : ''}`,
      `State: ${state}`,
      `Tools: ${compactCapsuleText(tools, 300)}`,
      ...renderActionEvidence(active.action.evidence).map((line) => compactCapsuleText(line, 1_800)),
      `Outcome: ${outcome}`,
    ].join('\n');
    const text = compactCapsuleText(capsule, 7_500);
    try {
      await this.memory.remember(memoryId, { text, kind: 'note' });
    } catch (error) {
      console.error('[NativeConversation] Failed to persist action capsule:', error);
    }
  }
}
