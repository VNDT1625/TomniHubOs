/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { parse as parseToml } from 'smol-toml';
import {
  errorMessage,
  dedupeCoreMcpServers,
  formatSpawnLabel,
  requireWorkspace,
  throwIfAborted,
  type CoreAdapter,
  type CoreAdapterEvent,
  type CoreContextInspectionInput,
  type CoreContextSnapshot,
  type CoreContextTool,
  type CoreMcpServer,
  type CoreRunInput,
  type CoreToolCatalogPolicy,
  type DetectedCoreTarget,
} from './coreAdapter';
import type {
  ExperimentalCoreModel,
  ExperimentalPermissionMode,
  ExperimentalSessionIdentity,
} from '../experimentalCoreProtocol';
import type { IProvider } from '@/common/config/storage';
import { getReadyProviderStore } from '@process/services/tomnyProviderBridge';
import type { IProviderStore } from '@process/services/tomnyProviderStore';
import { withPersistentAgentRetry } from '@process/agentRuntime/retryPolicy';

import { promptWithAttachmentToolNotice } from './attachmentPayload';

import { createCoreWorkspaceServer } from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';

import { BoundedSessionPool } from '../sessionPool';
import { redactCheckpointText } from '../sessionCheckpointStore';

type TomnyStreamEvent = Record<string, unknown> & { type?: string };

export type TomnySessionActionHistoryQuery = { limit: number; afterSequence?: number; query?: string };
export type TomnySessionActionHistorySource = (
  sessionId: string,
  query: TomnySessionActionHistoryQuery
) => Promise<Array<Record<string, unknown>>>;

type PendingTurn = {
  msgId: string;
  emit: (event: CoreAdapterEvent) => void;
  permissionMode: ExperimentalPermissionMode;
  requestPermission: (request: { tool: string; detail?: string }) => Promise<boolean>;
  lastActivityAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
};

type PendingContextSnapshot = {
  resolve: (snapshot: CoreContextSnapshot) => void;
  reject: (error: Error) => void;
};

type TomnyProcess = {
  sessionId: string;
  child: ChildProcessWithoutNullStreams;
  toolClient: Client;
  ready: Promise<void>;
  pending?: PendingTurn;
  pendingContext?: PendingContextSnapshot;
  contextSnapshot?: CoreContextSnapshot;
  stderrTail: string;
  isBusy: () => boolean;
  dispose: () => void;
};

const READY_TIMEOUT_MS = 30_000;
const CONTEXT_SNAPSHOT_TIMEOUT_MS = 5_000;
const TURN_TIMEOUT_MS = 90_000;
const STDERR_TAIL_LIMIT = 4_000;

export const waitForTomnyTurn = (
  turn: Promise<void>,
  onTimeout: () => void,
  timeoutMs = TURN_TIMEOUT_MS,
  getLastActivityAt?: () => number
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const startedAt = Date.now();
    const lastActivityAt = getLastActivityAt ?? (() => startedAt);
    const schedule = (): void => {
      if (settled) return;
      const idleMs = Date.now() - lastActivityAt();
      if (idleMs >= timeoutMs) {
        settled = true;
        onTimeout();
        reject(
          new Error(
            `Tomny produced no activity for ${Math.ceil(timeoutMs / 1000)}s. The selected provider, model, or tool may be stalled.`
          )
        );
        return;
      }
      timer = setTimeout(schedule, timeoutMs - idleMs);
    };
    schedule();
    void turn.then(
      () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });

const execFileAsync = promisify(execFile);

type TomnyEnvironment = Record<string, string | undefined>;
type TomnyConfigRecord = Record<string, unknown>;
type TomnyProviderSource = Pick<IProviderStore, 'list' | 'get'>;

const APP_PROVIDER_RUNTIME_ENVIRONMENT_KEYS = [
  'APPDATA',
  'ComSpec',
  'COMSPEC',
  'LOCALAPPDATA',
  'Path',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'WINDIR',
] as const;

const defaultProviderSource: TomnyProviderSource = {
  list: async () => (await getReadyProviderStore()).list(),
  get: async (id) => (await getReadyProviderStore()).get(id),
};

const appProviderModelKey = (providerId: string, modelId: string): string =>
  `app-provider:${encodeURIComponent(providerId)}:${encodeURIComponent(modelId)}`;

const parseAppProviderModelKey = (modelKey?: string): { providerId: string; modelId: string } | undefined => {
  const match = /^app-provider:([^:]+):(.+)$/u.exec(modelKey ?? '');
  if (!match?.[1] || !match[2]) return undefined;
  return { providerId: decodeURIComponent(match[1]), modelId: decodeURIComponent(match[2]) };
};

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '::1' || hostname === '127.0.0.1' || hostname.startsWith('127.');

/**
 * Normalize a credential-bearing provider endpoint before it reaches the child
 * environment. Plain HTTP is allowed only for a local engine; an arbitrary
 * network host would expose the selected API key in transit.
 */
const appProviderNetworkHostForProvider = (provider: IProvider): string => {
  let endpoint: URL;
  try {
    endpoint = new URL(provider.base_url.trim());
  } catch {
    throw new Error('APP_PROVIDER_BASE_URL_INVALID');
  }
  const hostname = endpoint.hostname.toLowerCase();
  if (!hostname || endpoint.username || endpoint.password) throw new Error('APP_PROVIDER_BASE_URL_INVALID');
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && isLoopbackHostname(hostname))) {
    throw new Error('APP_PROVIDER_BASE_URL_NOT_ALLOWED');
  }
  return hostname;
};

export const appProviderNetworkHost = async (
  modelKey: string | undefined,
  source: TomnyProviderSource
): Promise<string | undefined> => {
  const selected = parseAppProviderModelKey(modelKey);
  if (!selected) return undefined;
  const provider = await source.get(selected.providerId);
  if (!provider) throw new Error(`The selected Tomny provider no longer exists: ${selected.providerId}`);
  return appProviderNetworkHostForProvider(provider);
};

export const appProviderModels = (providers: IProvider[]): ExperimentalCoreModel[] => {
  const models: ExperimentalCoreModel[] = [];
  for (const provider of providers) {
    if (provider.enabled === false) continue;
    for (const modelId of provider.models) {
      if (provider.model_enabled?.[modelId] === false) continue;
      models.push({
        key: appProviderModelKey(provider.id, modelId),
        modelId,
        label: `${modelId} (${provider.name})`,
        providerId: provider.id,
        isDefault: models.length === 0,
      });
    }
  }
  return models;
};

const tomnyProviderType = (platform: string): string => {
  const normalized = platform.toLowerCase();
  if (normalized.includes('anthropic') || normalized === 'claude') return 'anthropic';
  if (normalized.includes('bedrock')) return 'bedrock';
  if (normalized.includes('vertex')) return 'vertex';
  return 'openai';
};

/**
 * App-provider runs receive only the selected credential and OS execution primitives.
 * Inherited proxy, cloud, and unrelated application credentials must not cross this boundary.
 */
export const appProviderEnvironment = async (
  modelKey: string | undefined,
  source: TomnyProviderSource,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env
): Promise<NodeJS.ProcessEnv> => {
  const selected = parseAppProviderModelKey(modelKey);
  if (!selected) return inheritedEnvironment;
  const provider = await source.get(selected.providerId);
  if (!provider) throw new Error(`The selected Tomny provider no longer exists: ${selected.providerId}`);
  appProviderNetworkHostForProvider(provider);
  const runtimeEnvironment: NodeJS.ProcessEnv = {};
  for (const key of APP_PROVIDER_RUNTIME_ENVIRONMENT_KEYS) {
    const value = inheritedEnvironment[key];
    if (value !== undefined) runtimeEnvironment[key] = value;
  }
  return {
    ...runtimeEnvironment,
    PROVIDER: tomnyProviderType(provider.platform),
    MODEL: selected.modelId,
    API_KEY: provider.api_key.split(/[,\n]/u)[0]?.trim() ?? '',
    BASE_URL: provider.base_url.trim(),
  };
};

const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  bedrock: 'anthropic.claude-sonnet-4-20250514-v1:0',
  vertex: 'claude-sonnet-4@20250514',
};

const objectRecord = (value: unknown): TomnyConfigRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as TomnyConfigRecord) : {};

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const configuredModel = (providerName: string, section: TomnyConfigRecord, fallbackModel = ''): string => {
  const providerType = stringValue(section.provider) || providerName;
  return stringValue(section.model) || fallbackModel || DEFAULT_PROVIDER_MODELS[providerType] || '';
};

export const parseTomnyModelCatalog = (
  configText: string,
  environment: TomnyEnvironment = {}
): ExperimentalCoreModel[] => {
  let config: TomnyConfigRecord;
  try {
    config = configText.trim() ? (parseToml(configText) as TomnyConfigRecord) : {};
  } catch {
    return [];
  }

  const defaultConfig = objectRecord(config.default);
  const providers = objectRecord(config.providers);
  const profiles = objectRecord(config.profiles);
  const defaultProvider = environment.PROVIDER?.trim() || stringValue(defaultConfig.provider) || 'anthropic';
  const defaultProviderConfig = objectRecord(providers[defaultProvider]);
  const defaultModel =
    environment.MODEL?.trim() ||
    stringValue(defaultConfig.model) ||
    configuredModel(defaultProvider, defaultProviderConfig);

  const models: ExperimentalCoreModel[] = [];
  const keys = new Set<string>();
  const add = (model: ExperimentalCoreModel): void => {
    if (!model.modelId || keys.has(model.key)) return;
    keys.add(model.key);
    models.push(model);
  };

  if (defaultModel) {
    add({
      key: `provider:${defaultProvider}:${defaultModel}`,
      modelId: defaultModel,
      label: `${defaultModel} (${defaultProvider})`,
      providerId: defaultProvider,
      isDefault: true,
    });
  }

  for (const [providerName, value] of Object.entries(providers)) {
    const section = objectRecord(value);
    const model = configuredModel(providerName, section);
    if (!model) continue;
    add({
      key: `provider:${providerName}:${model}`,
      modelId: model,
      label: `${model} (${providerName})`,
      providerId: providerName,
      isDefault: false,
    });
  }

  for (const [profileName, value] of Object.entries(profiles)) {
    const profile = objectRecord(value);
    const providerName = stringValue(profile.provider) || defaultProvider;
    const providerConfig = objectRecord(providers[providerName]);
    const model = configuredModel(providerName, profile, configuredModel(providerName, providerConfig, defaultModel));
    if (!model) continue;
    add({
      key: `profile:${profileName}`,
      modelId: model,
      label: `${model} (${profileName})`,
      providerId: providerName,
      isDefault: false,
    });
  }

  return models;
};

/** Keep every tool call visible to the host; shared permissions are enforced below. */
export const tomnyModeForPermission = (_permissionMode: ExperimentalPermissionMode): 'default' | 'auto_edit' | 'yolo' =>
  'default';

const tomnyRuntimeScope = (modelKey?: string): string => {
  const appProvider = parseAppProviderModelKey(modelKey);
  if (appProvider) return 'app-provider:' + appProvider.providerId;
  const provider = /^provider:([^:]+):/u.exec(modelKey ?? '');
  if (provider?.[1]) return 'provider:' + provider[1];
  const profile = /^profile:(.+)$/u.exec(modelKey ?? '');
  if (profile?.[1]) return 'profile:' + profile[1];
  return 'default';
};

const tomnyMcpRuntimeFingerprint = (server: CoreMcpServer): string => {
  const connection =
    server.transport === 'stdio'
      ? [
          server.name.trim().toLowerCase(),
          'stdio',
          server.command,
          server.args ?? [],
          (server.env ?? []).map(({ name, value }) => `${name}\u0000${value}`).toSorted(),
          server.deferred ?? true,
        ]
      : [
          server.name.trim().toLowerCase(),
          server.transport ?? 'sse',
          server.url,
          (server.headers ?? []).map(({ name, value }) => `${name}\u0000${value}`).toSorted(),
          server.deferred ?? true,
        ];
  return createHash('sha256').update(JSON.stringify(connection)).digest('hex');
};

/**
 * Keep one Tomny engine per workspace/provider while model and permission remain hot-swappable.
 *
 * The deferred MCP catalog is part of the engine's ToolMap. When Super adds or
 * removes a surface, use a fresh runtime so StartAction receives the matching
 * capability summary rather than retaining the previous catalog.
 */
export const tomnyRuntimeKey = (
  identity: ExperimentalSessionIdentity,
  mcpServers: readonly CoreMcpServer[] = [],
  toolCatalog: CoreToolCatalogPolicy = { mode: 'surface', patterns: [] }
): string =>
  JSON.stringify([
    identity.sessionId ?? '',
    identity.targetId,
    identity.workspace.trim(),
    tomnyRuntimeScope(identity.modelKey),
    identity.surface ?? 'chat',
    dedupeCoreMcpServers(mcpServers).map(tomnyMcpRuntimeFingerprint).toSorted(),
    toolCatalog.mode,
    [...new Set(toolCatalog.patterns.map((pattern) => pattern.trim()).filter(Boolean))].toSorted(),
  ]);

const tomnyDynamicModel = (modelKey?: string): string | undefined => {
  const appProvider = parseAppProviderModelKey(modelKey);
  if (appProvider) return appProvider.modelId;
  const provider = /^provider:[^:]+:(.+)$/u.exec(modelKey ?? '');
  if (provider?.[1]) return provider[1];
  if (!modelKey || modelKey.startsWith('profile:')) return undefined;
  return modelKey;
};

export const tomnyModelArgs = (modelKey?: string): string[] => {
  if (!modelKey || parseAppProviderModelKey(modelKey)) return [];
  const profile = /^profile:(.+)$/u.exec(modelKey);
  if (profile?.[1]) return ['--profile', profile[1]];
  const provider = /^provider:([^:]+):(.+)$/u.exec(modelKey);
  if (provider?.[1] && provider[2]) return ['--provider', provider[1], '--model', provider[2]];
  return ['--model', modelKey];
};

const renderUnknownValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const textField = (event: TomnyStreamEvent, key: string): string => renderUnknownValue(event[key]);

const MAX_EVENT_TEXT = 12_000;

const truncateEventText = (text: string): string =>
  text.length <= MAX_EVENT_TEXT ? text : `${text.slice(0, MAX_EVENT_TEXT)}\n...\n[Event text truncated]`;

const compactLine = (value: string): string => value.replace(/\s+/gu, ' ').trim();

const TOMNY_CONTROL_PLANE_TOOLS = new Set(['startaction', 'toolsearch', 'tool_search', 'tool-search']);

export const isTomnyControlPlaneTool = (toolName: string): boolean =>
  TOMNY_CONTROL_PLANE_TOOLS.has(toolName.trim().toLowerCase());

/**
 * StartAction embeds the whole capability map in a text result. Drop verbose
 * descriptions before the generic event-size guard runs; otherwise a large
 * IDE/Super catalog is truncated into invalid JSON and disappears from the UI.
 */
const compactStartActionToolMapOutput = (toolName: string, output: string): string => {
  if (toolName.trim().toLowerCase() !== 'startaction') return output;
  const match = /(?:^|\r?\n)ToolMap:\s*(\[[^\r\n]*\])(?=\r?\n|$)/u.exec(output);
  if (!match?.[1]) return output;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return output;
  }
  if (!Array.isArray(parsed)) return output;
  const compact = parsed.flatMap((value): Array<Record<string, unknown>> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const entry = value as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) return [];
    return [
      {
        name,
        ...(entry.recommended === true ? { recommended: true } : {}),
        ...(entry.deferred === true ? { deferred: true } : {}),
      },
    ];
  });
  return `${output.slice(0, match.index)}\nToolMap: ${JSON.stringify(compact)}${output.slice(match.index + match[0].length)}`;
};

const isTomnyInternalInfo = (message: string): boolean =>
  /^(?:token watermark override|loaded into the startaction sub-schema|action gate (?:opened|is already open))/iu.test(
    message.trim()
  );

/** Preserve the worklog fields actually emitted by the provider; never synthesize hidden reasoning. */
const richEventText = (event: TomnyStreamEvent, primaryKeys: readonly string[]): string => {
  const blocks: string[] = [];
  const pushBlock = (value: unknown): void => {
    const rendered = renderUnknownValue(value);
    if (!rendered.trim() || blocks.includes(rendered)) return;
    blocks.push(rendered);
  };
  const pushField = (label: string, value: unknown, compact = false): void => {
    const rendered = renderUnknownValue(value);
    if (!rendered.trim()) return;
    const field = compact ? `${label}: ${compactLine(rendered)}` : `${label}:\n${rendered}`;
    if (!blocks.includes(field)) blocks.push(field);
  };

  for (const key of primaryKeys) pushBlock(event[key]);
  pushField('Intent', event.intent, true);
  pushField('Reason', event.reason);
  pushField('Action', event.action);
  pushField('Tool', event.tool ?? event.tool_name, true);
  pushField('Target', event.target ?? event.file ?? event.path ?? event.workspace, true);
  pushField('Input', event.input ?? event.args ?? event.arguments);
  pushField('Output', event.output ?? event.result);
  pushField('Next', event.next ?? event.next_step);
  pushField('Detail', event.detail);

  return blocks.join('\n\n');
};

const parseTomnyContextTools = (values: unknown): CoreContextTool[] | null => {
  if (!Array.isArray(values)) return null;
  const tools: CoreContextTool[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const tool = value as Record<string, unknown>;
    if (
      typeof tool.name !== 'string' ||
      typeof tool.description !== 'string' ||
      !tool.input_schema ||
      typeof tool.input_schema !== 'object' ||
      Array.isArray(tool.input_schema) ||
      typeof tool.deferred !== 'boolean'
    ) {
      return null;
    }
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      deferred: tool.deferred,
    });
  }
  return tools;
};

export const parseTomnyContextSnapshot = (event: TomnyStreamEvent): CoreContextSnapshot | null => {
  if (event.type !== 'context_snapshot' || typeof event.system !== 'string') return null;
  const tools = parseTomnyContextTools(event.tools);
  const toolCache = event.tool_cache === undefined ? [] : parseTomnyContextTools(event.tool_cache);
  const messages = event.messages === undefined ? [] : event.messages;
  if (!tools || !toolCache || !Array.isArray(messages)) return null;
  if (messages.some((message) => !message || typeof message !== 'object' || Array.isArray(message))) return null;
  return {
    system: event.system,
    tools,
    messages: messages as Array<Record<string, unknown>>,
    capabilitySummary: textField(event, 'capability_summary'),
    workingMemory: event.working_memory ?? {},
    toolCache,
  };
};

export const normalizeTomnyStreamEvent = (event: TomnyStreamEvent): CoreAdapterEvent | null => {
  if (event.type === 'text_delta') {
    const text = textField(event, 'text');
    return text ? { type: 'delta', text, mode: 'append' } : null;
  }
  if (event.type === 'thinking') {
    const text = richEventText(event, ['text', 'message', 'summary']);
    return text ? { type: 'thinking', text } : null;
  }
  if (event.type === 'info') {
    const rawMessage = textField(event, 'message') || textField(event, 'text') || textField(event, 'summary');
    if (isTomnyInternalInfo(rawMessage)) return null;
    const text = richEventText(event, ['message', 'text', 'summary']);
    if (!text) return null;
    const call = /^Tool call:\s*(.+)$/u.exec(rawMessage.trim());
    if (call?.[1]) {
      const tool = call[1].trim();

      const input = tomnyToolRequestInput(event);
      return {
        type: 'tool-call',
        tool,
        text,
        phase: 'requested',
        ...(textField(event, 'call_id') ? { callId: textField(event, 'call_id') } : {}),
        ...(input !== undefined ? { input: sanitizeTomnyToolInput(tool, input) } : {}),
      };
    }
    const result = /^\[([^\]]+?)\s+(success|error)\]\s*([\s\S]*)$/u.exec(rawMessage.trim());
    if (result?.[1] && (result[2] === 'success' || result[2] === 'error')) {
      const callId = textField(event, 'call_id');
      const tool = result[1].trim();
      if (!callId) return null;
      return {
        type: 'tool-result',
        tool,
        outcome: result[2],
        ...(textField(event, 'call_id') ? { callId: textField(event, 'call_id') } : {}),
        text: truncateEventText(compactStartActionToolMapOutput(tool, result[3]?.trim() || text)),
        ...(tomnyToolRequestInput(event) !== undefined
          ? { input: sanitizeTomnyToolInput(tool, tomnyToolRequestInput(event)) }
          : {}),
      };
    }
    return { type: 'step', text };
  }
  if (event.type === 'tool_result') {
    const tool = textField(event, 'tool_name') || 'Tomny tool';

    const output = textField(event, 'output') || textField(event, 'content') || '(no output)';
    const status = textField(event, 'status').toLowerCase();
    // MCP validation failures can be returned as a normal tool-result payload
    // (for example, `MCP error -32602: Input validation error...`) without an
    // explicit `status` field. Treat the protocol error marker and both naming
    // variants used by MCP/Rust as failures so the renderer does not display a
    // failed call as green/"Hoàn tất".
    const isError =
      status === 'error' ||
      event.is_error === true ||
      event.isError === true ||
      /^MCP\s+error\s+-\d+\s*:/iu.test(output);
    return {
      type: 'tool-result',
      tool,
      outcome: isError ? 'error' : 'success',
      ...(textField(event, 'call_id') ? { callId: textField(event, 'call_id') } : {}),
      text: truncateEventText(compactStartActionToolMapOutput(tool, output)),
      ...(tomnyToolRequestInput(event) !== undefined
        ? { input: sanitizeTomnyToolInput(tool, tomnyToolRequestInput(event)) }
        : {}),
    };
  }
  if (event.type === 'tool_running') {
    const tool = textField(event, 'tool_name');

    const text = richEventText(event, ['message', 'text', 'summary']);
    const rendered = text && text !== `Tool: ${tool}` ? text : `Tomny is running ${tool}`;
    return tool
      ? {
          type: 'tool-call',
          tool,
          text: rendered,
          phase: 'running',
          ...(textField(event, 'call_id') ? { callId: textField(event, 'call_id') } : {}),
          ...(tomnyToolRequestInput(event) !== undefined
            ? { input: sanitizeTomnyToolInput(tool, tomnyToolRequestInput(event)) }
            : {}),
        }
      : null;
  }
  return null;
};

const eventError = (event: TomnyStreamEvent): string => {
  const value = event.error;
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return 'Tomny CLI reported an unknown error.';
  const message = (value as Record<string, unknown>).message;
  return typeof message === 'string' && message.trim() ? message : 'Tomny CLI reported an unknown error.';
};

const writeCommand = (runtime: TomnyProcess, command: Record<string, unknown>): void => {
  runtime.child.stdin.write(`${JSON.stringify(command)}\n`);
};

const TOMNY_TOOL_SERVER_NAME = 'tomny-tools';
const TOMNY_STRICT_CONFIG_DIRECTORY = join(tmpdir(), 'tomny-core', 'strict-tools-v1');

/** Project-level config removes Tomny's default Read/Grep/Glob bypass. */
export const tomnyStrictToolsConfig = `[tools]
auto_approve = false
allow_list = []
`;

export const tomnyStrictProjectArgs = (directory: string): string[] => ['--project-dir', directory];

const ensureTomnyStrictProject = async (): Promise<string> => {
  await mkdir(TOMNY_STRICT_CONFIG_DIRECTORY, { recursive: true });
  await writeFile(join(TOMNY_STRICT_CONFIG_DIRECTORY, '.tomny.toml'), tomnyStrictToolsConfig, 'utf8');
  return TOMNY_STRICT_CONFIG_DIRECTORY;
};

type TomnyToolAccess = 'approve' | 'prompt' | 'deny';

const NATIVE_TOOL_REPLACEMENTS = new Map([
  ['read', 'tomny_read'],
  ['write', 'tomny_write'],
  ['edit', 'tomny_edit'],
  ['execcommand', 'tomny_command'],
  ['grep', 'tomny_search'],
  ['glob', 'tomny_glob'],
  ['spawn', 'the Tomny Team or Company proposal flow'],
]);

const normalizedToolName = (toolName: string): string => toolName.trim().toLowerCase();

export const tomnyNativeToolDenialReason = (toolName: string): string => {
  const replacement = NATIVE_TOOL_REPLACEMENTS.get(normalizedToolName(toolName));
  if (!replacement) return `Native tool ${toolName} is disabled by the Tomny core tool policy.`;
  return `Native tool ${toolName} is disabled. Retry this operation with ${replacement}.`;
};

export type TomnyToolTranslation = {
  name: 'tomny_read' | 'tomny_search' | 'tomny_glob' | 'tomny_command' | 'tomny_write' | 'tomny_edit';
  arguments: Record<string, unknown>;
};

export type SkillWorkflowToolPreflight = { kind: 'error'; message: string };

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const resolveToolPath = (cwd: string, value: unknown): string => {
  const candidate = stringValue(value);
  return !candidate ? cwd : isAbsolute(candidate) ? candidate : resolvePath(cwd, candidate);
};

/** Translate native calls into the bounded Core workspace capability vocabulary. */
export const translateNativeTomnyTool = (
  toolName: string,
  input: unknown,
  cwd: string
): TomnyToolTranslation | null => {
  const args = objectRecord(input);
  const normalized = normalizedToolName(toolName);
  if (normalized === 'read') {
    const filePath = stringValue(args.file_path ?? args.filePath);
    if (!filePath) return null;
    const offset = Math.max(0, Math.trunc(finiteNumber(args.offset) ?? 0));
    const limit = finiteNumber(args.limit);
    const from = offset + 1;
    return {
      name: 'tomny_read',
      arguments: {
        filePath,
        ...(offset > 0 || limit !== undefined ? { from } : {}),
        ...(limit !== undefined && limit > 0 ? { to: from + Math.trunc(limit) - 1 } : {}),
        lineNumbers: true,
      },
    };
  }
  if (normalized === 'grep') {
    const pattern = stringValue(args.pattern);
    if (!pattern) return null;
    return {
      name: 'tomny_search',
      arguments: {
        rootPath: resolveToolPath(cwd, args.path),
        pattern,
        ...(stringValue(args.glob) ? { glob: stringValue(args.glob) } : {}),
        regex: false,
        ...(typeof args.case_insensitive === 'boolean' ? { caseSensitive: !args.case_insensitive } : {}),
      },
    };
  }
  if (normalized === 'glob') {
    const pattern = stringValue(args.pattern);
    if (!pattern) return null;
    return {
      name: 'tomny_glob',
      arguments: { dir: resolveToolPath(cwd, args.path), pattern, recursive: true },
    };
  }
  if (normalized === 'execcommand') {
    const command = stringValue(args.cmd ?? args.command);
    const shell = stringValue(args.shell).toLowerCase();
    if (!command || (shell && shell !== 'auto')) return null;
    return {
      name: 'tomny_command',
      arguments: {
        rootPath: cwd,
        command,
        cwd,
        ...(finiteNumber(args.timeout) !== undefined ? { timeoutMs: finiteNumber(args.timeout) } : {}),
      },
    };
  }
  if (normalized === 'write') {
    const filePath = stringValue(args.file_path ?? args.filePath);
    const content = typeof args.content === 'string' ? args.content : undefined;
    if (!filePath || content === undefined) return null;
    return { name: 'tomny_write', arguments: { filePath, content } };
  }
  if (normalized === 'edit') {
    const filePath = stringValue(args.file_path ?? args.filePath);
    const oldText = stringValue(args.old_string ?? args.oldText);
    const newText =
      typeof (args.new_string ?? args.newText) === 'string' ? (args.new_string ?? args.newText) : undefined;
    if (!filePath || !oldText || typeof newText !== 'string') return null;
    return { name: 'tomny_edit', arguments: { filePath, oldText, newText } };
  }
  return null;
};

const invalidSkillWorkflowArguments = (toolName: string, field: string, retry: string): SkillWorkflowToolPreflight => ({
  kind: 'error',
  message: `Invalid skill workflow arguments for ${toolName}: ${field} is required. The host rejected this call before MCP dispatch. ${retry}`,
});

/**
 * Reject missing required skill-workflow arguments at the host boundary. The
 * model cannot safely invent a skill name, so malformed calls must become real
 * failed tool results with an actionable retry instead of MCP -32602 errors.
 */
export const preflightSkillWorkflowTool = (toolName: string, input: unknown): SkillWorkflowToolPreflight | null => {
  const normalized = normalizedToolName(toolName);
  const args = objectRecord(input);
  if (normalized === 'tools_search' && !stringValue(args.query)) {
    return invalidSkillWorkflowArguments(toolName, 'query', 'Retry with {"query":"<current task>"}.');
  }
  if (normalized === 'tools_recall' && !stringValue(args.query)) {
    return invalidSkillWorkflowArguments(toolName, 'query', 'Retry with {"query":"<current task>"}.');
  }
  if (normalized === 'skills_read' && !stringValue(args.name)) {
    return invalidSkillWorkflowArguments(
      toolName,
      'name',
      'First use tools_search, then retry with {"name":"<exact returned skill name>","resource":"SKILL.md"}.'
    );
  }
  if (normalized === 'skills_select') {
    if (!stringValue(args.goal)) {
      return invalidSkillWorkflowArguments(
        toolName,
        'goal',
        'Retry with {"goal":"<current task>","names":["<exact skill name>"]}.'
      );
    }
    if (!Array.isArray(args.names)) {
      return invalidSkillWorkflowArguments(
        toolName,
        'names',
        'Retry with {"goal":"<current task>","names":["<exact skill name>"]}.'
      );
    }
  }
  if (normalized === 'skills_finish') {
    if (!stringValue(args.goal)) {
      return invalidSkillWorkflowArguments(
        toolName,
        'goal',
        'Retry with {"goal":"<current task>","succeeded":true|false}.'
      );
    }
    if (typeof args.succeeded !== 'boolean') {
      return invalidSkillWorkflowArguments(
        toolName,
        'succeeded',
        'Retry with {"goal":"<current task>","succeeded":true|false}.'
      );
    }
  }
  return null;
};

export const tomnyProvidedToolResultCommand = (
  callId: string,
  content: string,
  isError: boolean,
  toolName?: string
): Record<string, unknown> => ({
  type: 'tool_result',
  call_id: callId,
  content,
  is_error: isError,
  ...(toolName ? { tool_name: toolName } : {}),
});

const renderTranslatedToolResult = (result: unknown): { content: string; isError: boolean } => {
  const record = objectRecord(result);
  const blocks = Array.isArray(record.content) ? record.content : [];
  const rendered = blocks
    .map((block) => {
      const item = objectRecord(block);
      return stringValue(item.text) || renderUnknownValue(item);
    })
    .filter(Boolean)
    .join('\n');
  return {
    content: rendered || renderUnknownValue(result) || '(Tomny tool returned no content.)',
    isError: record.isError === true,
  };
};

const READ_ONLY_TOOLS = new Set([
  // ToolSearch only discovers deferred definitions; it does not access the
  // workspace or mutate state by itself.
  'startaction',
  'toolsearch',
  'tool_search',
  'tool-search',
  'tool search',
  'tomny_session_actions',
  'tomny_glob',
  'tomny_read',
  'tomny_search',
  'tomny_context',
  'tomny_map',
  'tomny_analyze',
  'tomny_analyze_image',
  'tomny_visual_analyze',
  'tomny_compact',
  'tomny_team_status',
  'agent_targets',
  'agent_track',
  'agent_result',
  'agent_sessions',
  'test_list',
  'test_report',
  'browser_read_text',
  'browser_screenshot',
  'browser_summarize_video',
  'browser_list_tabs',
  'extract_content',
  'quick_test_observe',
  'quick_test_status',
  'quick_test_audit',
  'quick_test_capture',
  'editor_read',
  'editor_list',
  'ide_list_dir',
  'ide_glob',
  'ide_read_file',
  'ide_search',
  'ide_grep',
  'ide_find_definition',
  'ide_find_references',
  'ide_scan_repo',
  'ide_summary',
  'ide_info',
  'ide_compass',
  'ide_context',
  'ide_research',
  'ide_map',
  'ide_analyze',
  'ide_analyze_image',
  'ide_compact',
  'ide_memory_recall',
  'ide_memory_status',
  'ide_quick_test_list',
  'ide_quick_test_describe',
  'ide_quick_test_status',
  'ide_quick_test_compare',
  'team_status',
  'db_list_connections',
  'db_list_tables',
  'db_describe_table',
  'db_profile_table',
]);

/** Decide host approval while native filesystem and shell tools remain disabled. */
export const tomnyToolAccessForPermission = (
  permissionMode: ExperimentalPermissionMode,
  toolName: string,
  category = ''
): TomnyToolAccess => {
  const normalized = normalizedToolName(toolName);
  if (NATIVE_TOOL_REPLACEMENTS.has(normalized)) return 'deny';
  if (READ_ONLY_TOOLS.has(normalized)) return 'approve';
  if (permissionMode === 'full-access') return 'approve';
  if (permissionMode === 'workspace-write') return 'prompt';
  if (category.trim().toLowerCase() === 'info') return 'approve';
  return 'deny';
};

/** Read arguments from every JSON-stream shape emitted by supported Tomny builds. */
export const tomnyToolRequestInput = (event: TomnyStreamEvent): unknown => {
  const tool = objectRecord(event.tool);
  return (
    event.input ??
    event.arguments ??
    event.args ??
    event.raw_input ??
    event.rawInput ??
    event.tool_input ??
    event.toolInput ??
    tool.input ??
    tool.arguments ??
    tool.args ??
    tool.raw_input ??
    tool.rawInput
  );
};

const tomnyToolRequest = (
  event: TomnyStreamEvent
): { name: string; category: string; input: unknown; detail?: string } => {
  const tool = objectRecord(event.tool);
  const name = textField(event, 'tool_name') || textField(tool, 'name') || 'Tomny tool';
  const category = textField(event, 'category') || textField(tool, 'category');
  const input = tomnyToolRequestInput(event);
  return { name, category, input, detail: input === undefined ? undefined : sanitizeTomnyToolDetail(name, input) };
};

export const tomnySessionActionHistoryQuery = (input: unknown): TomnySessionActionHistoryQuery => {
  const record = objectRecord(input);
  const rawLimit = finiteNumber(record.limit);
  const rawAfter = finiteNumber(record.after_sequence);
  const query = stringValue(record.query).trim().slice(0, 500);
  return {
    limit: Math.min(100, Math.max(1, Math.trunc(rawLimit ?? 20))),
    ...(rawAfter !== undefined && rawAfter >= 0 ? { afterSequence: Math.trunc(rawAfter) } : {}),
    ...(query ? { query } : {}),
  };
};

const provideSessionActionHistory = async (
  runtime: TomnyProcess,
  pending: PendingTurn,
  callId: string,
  input: unknown,
  source: TomnySessionActionHistorySource | undefined
): Promise<void> => {
  pending.lastActivityAt = Date.now();
  pending.emit({
    type: 'tool-call',
    tool: 'tomny_session_actions',
    callId,
    text: 'Reading this session action journal',
    phase: 'running',
    input: sanitizeTomnyToolInput('tomny_session_actions', input),
  });
  if (!source) {
    writeCommand(
      runtime,
      tomnyProvidedToolResultCommand(callId, 'Session action history is unavailable in this runtime.', true)
    );
    return;
  }
  try {
    const actions = await source(runtime.sessionId, tomnySessionActionHistoryQuery(input));
    if (runtime.pending !== pending) return;
    writeCommand(
      runtime,
      tomnyProvidedToolResultCommand(
        callId,
        JSON.stringify({ session_scoped: true, entries: actions }).slice(0, 64_000),
        false,
        'tomny_session_actions'
      )
    );
  } catch (error) {
    if (runtime.pending !== pending) return;
    writeCommand(
      runtime,
      tomnyProvidedToolResultCommand(callId, `Session action history failed: ${errorMessage(error)}`, true)
    );
  }
};

const SENSITIVE_TOOL_FIELD =
  /(?:pass(?:word|wd)?|secret|token|api.?key|authorization|cookie|credential|private.?key|access.?key)/iu;
const SENSITIVE_TYPING_FIELD = /^(?:text|value|input|keys)$/iu;
const SENSITIVE_TYPING_TOOL = /(?:browser.*(?:type|fill|input)|(?:type|fill|input).*browser)/iu;

const sanitizeToolValue = (value: unknown, redactTypedValues: boolean, key = ''): unknown => {
  if (SENSITIVE_TOOL_FIELD.test(key) || (redactTypedValues && SENSITIVE_TYPING_FIELD.test(key))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitizeToolValue(item, redactTypedValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([field, item]) => [
        field,
        sanitizeToolValue(item, redactTypedValues, field),
      ])
    );
  }
  return typeof value === 'string' ? redactCheckpointText(value) : value;
};

/** Render permission metadata without placing credentials or browser-typed text in the event journal/UI. */
export const sanitizeTomnyToolDetail = (toolName: string, input: unknown): string =>
  JSON.stringify(sanitizeToolValue(input, SENSITIVE_TYPING_TOOL.test(toolName)));

/**
 * Safe structured form used by the worklog/journal. Tool execution continues
 * to receive the original arguments; only the display/persistence copy is
 * redacted.
 */
export const sanitizeTomnyToolInput = (toolName: string, input: unknown): unknown =>
  sanitizeToolValue(input, SENSITIVE_TYPING_TOOL.test(toolName));

const provideTranslatedToolResult = async (
  runtime: TomnyProcess,
  pending: PendingTurn,
  callId: string,
  sourceName: string,
  translation: TomnyToolTranslation
): Promise<void> => {
  const access = tomnyToolAccessForPermission(pending.permissionMode, translation.name, 'mcp');
  if (access === 'deny') {
    writeCommand(runtime, {
      type: 'tool_deny',
      call_id: callId,
      reason: `Translation to ${translation.name} is not allowed by the current permission mode.`,
    });
    return;
  }
  if (access === 'prompt') {
    const approved = await pending.requestPermission({
      tool: `${sourceName} → ${translation.name}`,
      detail: sanitizeTomnyToolDetail(translation.name, translation.arguments),
    });
    if (!approved) {
      writeCommand(runtime, { type: 'tool_deny', call_id: callId, reason: 'Denied by user' });
      return;
    }
  }
  pending.lastActivityAt = Date.now();
  pending.emit({
    type: 'tool-call',
    tool: translation.name,
    callId,
    text: `Auto-translated ${sourceName} → ${translation.name}`,
    phase: 'running',
    input: sanitizeTomnyToolInput(translation.name, translation.arguments),
  });
  const heartbeat = setInterval(() => {
    if (runtime.pending === pending) pending.lastActivityAt = Date.now();
  }, 10_000);
  heartbeat.unref();
  try {
    const result = await runtime.toolClient.callTool({
      name: translation.name,
      arguments: translation.arguments,
    });
    if (runtime.pending !== pending) return;
    const rendered = renderTranslatedToolResult(result);
    writeCommand(runtime, tomnyProvidedToolResultCommand(callId, rendered.content, rendered.isError, translation.name));
  } catch (error) {
    if (runtime.pending !== pending) return;
    writeCommand(
      runtime,
      tomnyProvidedToolResultCommand(callId, `Translation failed: ${errorMessage(error)}`, true, translation.name)
    );
  } finally {
    clearInterval(heartbeat);
  }
};

/** Build the protocol command that injects the neutral Tomny tool layer before the first message. */
export const tomnyMcpInjectionCommand = (url: string, name = TOMNY_TOOL_SERVER_NAME): Record<string, unknown> => ({
  type: 'add_mcp_server',
  name,
  transport: 'sse',
  url,
  deferred: true,
});

const tomnyCompatibleMcpServer = (server: CoreMcpServer): CoreMcpServer => {
  if (server.transport !== 'streamable_http' || server.name.trim().toLowerCase() !== 'tomny-ide') return server;
  try {
    const endpoint = new URL(server.url);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname.toLowerCase());
    if (!loopback || !endpoint.pathname.endsWith('/mcp')) return server;
    endpoint.pathname = endpoint.pathname.replace(/\/mcp$/u, '/sse');
    return { ...server, transport: 'sse', url: endpoint.toString() };
  } catch {
    return server;
  }
};

export const tomnyMcpServerCommand = (server: CoreMcpServer): Record<string, unknown> => {
  const compatible = tomnyCompatibleMcpServer(server);
  if (compatible.transport === 'stdio') {
    return {
      type: 'add_mcp_server',
      name: compatible.name,
      transport: 'stdio',
      command: compatible.command,
      args: compatible.args ?? [],
      env: Object.fromEntries((compatible.env ?? []).map((entry) => [entry.name, entry.value])),
      deferred: compatible.deferred ?? true,
    };
  }
  if (compatible.transport === 'http' || compatible.transport === 'streamable_http') {
    throw new Error(
      `Tomny CLI does not support HTTP MCP transport for ${compatible.name}. Configure this server with SSE or stdio.`
    );
  }
  return {
    ...tomnyMcpInjectionCommand(compatible.url, compatible.name),
    headers: Object.fromEntries((compatible.headers ?? []).map((header) => [header.name, header.value])),
    deferred: compatible.deferred ?? true,
  };
};

/**
 * Tomny's ready flag describes whether MCP is already configured; it is not a
 * protocol-support flag. Selected IDE servers must still be injected during
 * the pre-message phase and acknowledged through `mcp_ready`.
 */
export const tomnyShouldInitializeMcpServers = (
  _event: TomnyStreamEvent,
  mcpServers: readonly CoreMcpServer[]
): boolean => mcpServers.length > 0;

export const tomnySurfaceSystemPrompt = (
  surface: string,
  cwd: string,
  toolCatalog: CoreToolCatalogPolicy = { mode: 'surface', patterns: [] }
): string => {
  const patterns = [...new Set(toolCatalog.patterns.map((pattern) => pattern.trim()).filter(Boolean))];
  return [
    '[TomnyExactSurfacePrompt]',
    `[TomnyToolCatalog] ${toolCatalog.mode}`,
    `[TomnyToolPatterns] ${patterns.join(',')}`,
    `You are Tomny Agentic in Tomny ${surface}; project: ${cwd}`,
    'Use StartAction only for tool/external turns, never casual chat. Once open, do not nest it.',
    'Use ToolSearch only for another exact schema; otherwise call loaded tools directly.',
    'For flow/bug/logic/purpose, call ide_research once; use its fresh Wiki test profile; follow up only for explicit gaps.',
    'Bug root-cause gate: exact file/symbol/condition plus expected/actual; broad hypotheses are insufficient.',
    'Before edits, ide_test_script phase=reproduce must assert failure. After the smallest fix, rerun the identical script as post-fix, then a focused framework test/typecheck.',
    'Use ide_quick_test only for hard/runtime-only network, console, exception, interaction, native, or screenshot evidence; failure reopens diagnosis.',
    `Required: rootPath=${JSON.stringify(cwd)}; ide_research.intent; ide_test_script.script+phase; never call tools with {}.`,
    toolCatalog.mode === 'super'
      ? 'Super is ON: the ToolMap is the unified catalog of every registered Surface capability, exposed through Tomny tool names. Use ToolSearch when you need an exact schema.'
      : 'ToolMap contains only active-surface tools; later turns retain a short capability summary.',
    'Skip skills for ordinary repo/bug work; use them when named or clearly specialized.',
    'tomny_session_actions reads the action journal, not messages. Save is sole historical conversation context.',
    'Secret Context values stay hidden; use safe aliases through authorized tools.',
    'In YOLO, continue without approval. Otherwise respect the active permission mode.',
  ].join('\n');
};

const spawnTarget = (
  target: DetectedCoreTarget,
  cwd: string,
  modelKey: string | undefined,
  strictProjectDirectory: string,
  surface: string,
  toolCatalog: CoreToolCatalogPolicy,
  environment: NodeJS.ProcessEnv = process.env
): ChildProcessWithoutNullStreams => {
  if (!target.command) throw new Error('Tomny CLI executable was not found.');
  const args = [...target.args];
  const surfacePrompt = tomnySurfaceSystemPrompt(surface, cwd, toolCatalog);
  args.push(
    ...tomnyModelArgs(modelKey),
    ...tomnyStrictProjectArgs(strictProjectDirectory),
    '--system-prompt',
    surfacePrompt
  );
  return spawn(target.command, args, {
    cwd,
    env: environment,
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(target.command),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
};

/** Direct host for the bundled Tomny CLI JSON stream protocol. */
export class TomnyCoreAdapter implements CoreAdapter {
  public readonly protocol = 'tomny-json-stream' as const;
  public readonly retainsConversationHistory = false;

  public constructor(
    private readonly providerSource: TomnyProviderSource = defaultProviderSource,
    private readonly sessionActionHistory?: TomnySessionActionHistorySource
  ) {}

  public async listModels(target: DetectedCoreTarget): Promise<ExperimentalCoreModel[]> {
    if (!target.command) return [];
    const configuredProviders = appProviderModels(await this.providerSource.list());
    if (configuredProviders.length > 0) return configuredProviders;
    try {
      const { stdout } = await execFileAsync(target.command, ['config', 'path'], {
        windowsHide: true,
        timeout: 5_000,
        shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(target.command),
      });
      const configPath = stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find(Boolean);
      if (!configPath) return parseTomnyModelCatalog('', process.env);
      return parseTomnyModelCatalog(await readFile(configPath, 'utf8'), process.env);
    } catch {
      return parseTomnyModelCatalog('', process.env);
    }
  }
  public networkHostForModel(modelKey?: string): Promise<string | undefined> {
    return appProviderNetworkHost(modelKey, this.providerSource);
  }
  private readonly processes = new BoundedSessionPool<TomnyProcess>({ maxSessions: 8, idleTimeoutMs: 5 * 60_000 });

  public async inspectContext(input: CoreContextInspectionInput): Promise<CoreContextSnapshot> {
    const cwd = requireWorkspace(input.workspace);
    const mcpServers = dedupeCoreMcpServers(input.mcpServers ?? []);
    const toolCatalog = input.toolCatalog ?? { mode: 'surface', patterns: [] };
    const key = tomnyRuntimeKey(
      {
        sessionId: input.sessionId,
        targetId: input.target.id,
        workspace: cwd,
        modelKey: input.modelKey,
        surface: input.surface,
      },
      mcpServers,
      toolCatalog
    );
    const runtime = await this.getProcess(
      key,
      input.sessionId,
      input.target,
      cwd,
      input.modelKey,
      input.surface,
      mcpServers,
      toolCatalog
    );
    await runtime.ready;
    if (runtime.pending) {
      if (runtime.contextSnapshot) return structuredClone(runtime.contextSnapshot);
      throw new Error('Tomny context is unavailable while the first message is still running.');
    }
    if (runtime.pendingContext) throw new Error('Tomny context inspection is already running for this session.');

    const snapshot = await new Promise<CoreContextSnapshot>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const pending: PendingContextSnapshot = {
        resolve: (value) => {
          if (runtime.pendingContext !== pending) return;
          runtime.pendingContext = undefined;
          if (timer) clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          if (runtime.pendingContext !== pending) return;
          runtime.pendingContext = undefined;
          if (timer) clearTimeout(timer);
          reject(error);
        },
      };
      runtime.pendingContext = pending;
      timer = setTimeout(
        () => pending.reject(new Error('Tomny did not return its context snapshot within 5s.')),
        CONTEXT_SNAPSHOT_TIMEOUT_MS
      );
      timer.unref();
      try {
        writeCommand(runtime, { type: 'context_snapshot' });
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    runtime.contextSnapshot = snapshot;
    this.processes.touch(key);
    return structuredClone(snapshot);
  }

  public async run(input: CoreRunInput): Promise<void> {
    await withPersistentAgentRetry({
      signal: input.signal,
      operation: () => this.runAttempt(input),
      agentLabel: 'Tomny',
      onBeforeRetry: () => input.emit({ type: 'delta', text: '', mode: 'replace' }),
      onStatus: (status) => input.emit({ type: 'status', text: status.message }),
    });
  }

  private async runAttempt(input: CoreRunInput): Promise<void> {
    throwIfAborted(input.signal);
    const cwd = requireWorkspace(input.workspace);
    const mcpServers = dedupeCoreMcpServers(input.mcpServers ?? []);
    const toolCatalog = input.toolCatalog ?? { mode: 'surface', patterns: [] };
    const key = tomnyRuntimeKey(
      {
        sessionId: input.sessionId,
        targetId: input.target.id,
        workspace: cwd,
        modelKey: input.modelKey,
        surface: input.surface,
      },
      mcpServers,
      toolCatalog
    );
    const runtime = await this.getProcess(
      key,
      input.sessionId,
      input.target,
      cwd,
      input.modelKey,
      input.surface,
      mcpServers,
      toolCatalog
    );
    await runtime.ready;
    if (runtime.pending) throw new Error('Tomny CLI is already processing a message in this session.');

    const dynamicModel = tomnyDynamicModel(input.modelKey);
    if (dynamicModel) writeCommand(runtime, { type: 'set_config', model: dynamicModel });
    writeCommand(runtime, { type: 'set_mode', mode: tomnyModeForPermission(input.permissionMode) });
    const msgId = crypto.randomUUID();
    const turn = new Promise<void>((resolve, reject) => {
      runtime.pending = {
        msgId,
        emit: input.emit,
        permissionMode: input.permissionMode,
        requestPermission: input.requestPermission,
        lastActivityAt: Date.now(),
        resolve,
        reject,
      };
    });
    let abortTimer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      try {
        writeCommand(runtime, { type: 'stop' });
      } catch {
        this.processes.invalidate(key, runtime);
        return;
      }
      abortTimer = setTimeout(() => this.processes.invalidate(key, runtime), 1_500);
      abortTimer.unref();
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
    try {
      writeCommand(runtime, {
        type: 'message',
        msg_id: msgId,
        content: promptWithAttachmentToolNotice(input.prompt, input.attachments),
      });
      await waitForTomnyTurn(
        turn,
        () => {
          if (runtime.pending?.msgId !== msgId) return;
          runtime.pending = undefined;
          this.processes.invalidate(key, runtime);
        },
        TURN_TIMEOUT_MS,
        () => (runtime.pending?.msgId === msgId ? runtime.pending.lastActivityAt : Date.now())
      );
      this.processes.touch(key);
    } finally {
      input.signal.removeEventListener('abort', onAbort);
      if (abortTimer) clearTimeout(abortTimer);
    }
  }

  public async dispose(): Promise<void> {
    await this.processes.disposeAll();
  }

  private getProcess(
    key: string,
    sessionId: string,
    target: DetectedCoreTarget,
    cwd: string,
    modelKey: string | undefined,
    surface: string,
    mcpServers: CoreMcpServer[],
    toolCatalog: CoreToolCatalogPolicy
  ): Promise<TomnyProcess> {
    return this.processes.getOrCreate(key, () =>
      this.startProcess(key, sessionId, target, cwd, modelKey, surface, mcpServers, toolCatalog)
    );
  }

  private async startProcess(
    key: string,
    sessionId: string,
    target: DetectedCoreTarget,
    cwd: string,
    modelKey: string | undefined,
    surface: string,
    mcpServers: CoreMcpServer[],
    toolCatalog: CoreToolCatalogPolicy
  ): Promise<TomnyProcess> {
    const environment = await appProviderEnvironment(modelKey, this.providerSource);
    const strictProjectDirectory = await ensureTomnyStrictProject();
    const pendingMcpServers = new Set(mcpServers.map((server) => server.name));
    const toolServer = createCoreWorkspaceServer({ workspace: cwd });
    const toolClient = new Client({ name: 'tomny-core-translator', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([toolServer.connect(serverTransport), toolClient.connect(clientTransport)]);
    const child = spawnTarget(target, cwd, modelKey, strictProjectDirectory, surface, toolCatalog, environment);
    let resolveReady: (() => void) | undefined;
    let rejectReady: ((error: Error) => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const runtime: TomnyProcess = {
      sessionId,
      child,
      toolClient,
      ready,
      stderrTail: '',
      isBusy: () => Boolean(runtime.pending || runtime.pendingContext),
      dispose: () => {
        runtime.pendingContext?.reject(new Error('Tomny context inspection was interrupted.'));
        if (child.stdin.writable) child.stdin.end();
        if (!child.killed) child.kill();
        void toolClient.close();
        void toolServer.close();
      },
    };
    const readyTimer = setTimeout(
      () =>
        rejectReady?.(new Error(`${formatSpawnLabel(target)} did not emit ready within ${READY_TIMEOUT_MS / 1000}s.`)),
      READY_TIMEOUT_MS
    );

    child.stdin.on('error', () => this.processes.invalidate(key, runtime));

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      runtime.stderrTail = (runtime.stderrTail + chunk).slice(-STDERR_TAIL_LIMIT);
    });

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let event: TomnyStreamEvent;
      try {
        event = JSON.parse(line) as TomnyStreamEvent;
      } catch {
        return;
      }
      if (event.type === 'ready') {
        if (!tomnyShouldInitializeMcpServers(event, mcpServers)) {
          clearTimeout(readyTimer);
          resolveReady?.();
        } else {
          for (const server of mcpServers) writeCommand(runtime, tomnyMcpServerCommand(server));
        }
        return;
      }
      if (event.type === 'mcp_ready') {
        pendingMcpServers.delete(textField(event, 'name'));
        if (pendingMcpServers.size === 0) {
          clearTimeout(readyTimer);
          resolveReady?.();
        }
        return;
      }
      if (event.type === 'context_snapshot') {
        const pendingContext = runtime.pendingContext;
        if (!pendingContext) return;
        const snapshot = parseTomnyContextSnapshot(event);
        if (!snapshot) pendingContext.reject(new Error('Tomny returned an invalid context snapshot.'));
        else {
          runtime.contextSnapshot = snapshot;
          pendingContext.resolve(snapshot);
        }
        return;
      }
      if (event.type === 'tool_request') {
        const callId = textField(event, 'call_id');
        if (!callId) return;
        const pending = runtime.pending;
        if (!pending) {
          writeCommand(runtime, { type: 'tool_deny', call_id: callId, reason: 'No active turn' });
          return;
        }
        const request = tomnyToolRequest(event);
        // The `tool_request` envelope is the only guaranteed point where the
        // model's structured JSON arguments are available.  Emit it before
        // any host-side preflight/translation so the conversation worklog can
        // retain the exact input even when execution fails early.
        pending.emit({
          type: 'tool-call',
          tool: request.name,
          callId,
          text: `Calling ${request.name}`,
          phase: 'requested',
          ...(request.input !== undefined ? { input: sanitizeTomnyToolInput(request.name, request.input) } : {}),
        });
        const skillWorkflowPreflight = preflightSkillWorkflowTool(request.name, request.input);
        if (skillWorkflowPreflight) {
          writeCommand(
            runtime,
            tomnyProvidedToolResultCommand(callId, skillWorkflowPreflight.message, true, request.name)
          );
          return;
        }
        if (normalizedToolName(request.name) === 'tomny_session_actions') {
          void provideSessionActionHistory(runtime, pending, callId, request.input, this.sessionActionHistory).catch(
            () => {
              if (runtime.pending !== pending) return;
              try {
                writeCommand(
                  runtime,
                  tomnyProvidedToolResultCommand(callId, 'Session action history failed before execution.', true)
                );
              } catch {
                this.processes.invalidate(key, runtime);
              }
            }
          );
          return;
        }
        const translation = translateNativeTomnyTool(request.name, request.input, cwd);
        if (translation) {
          void provideTranslatedToolResult(runtime, pending, callId, request.name, translation).catch(() => {
            if (runtime.pending !== pending) return;
            try {
              writeCommand(runtime, {
                type: 'tool_deny',
                call_id: callId,
                reason: 'Tomny tool translation failed before execution.',
              });
            } catch {
              this.processes.invalidate(key, runtime);
            }
          });
          return;
        }
        const access = tomnyToolAccessForPermission(pending.permissionMode, request.name, request.category);
        if (access === 'deny') {
          writeCommand(runtime, {
            type: 'tool_deny',
            call_id: callId,
            reason: NATIVE_TOOL_REPLACEMENTS.has(normalizedToolName(request.name))
              ? tomnyNativeToolDenialReason(request.name)
              : 'Tool denied by the current permission mode.',
          });
          return;
        }
        if (access === 'approve') {
          writeCommand(runtime, {
            type: 'tool_approve',
            call_id: callId,
            scope: 'once',
          });
          return;
        }
        void pending
          .requestPermission({ tool: request.name, detail: request.detail })
          .then((approved) => {
            writeCommand(
              runtime,
              approved
                ? { type: 'tool_approve', call_id: callId, scope: 'once' }
                : { type: 'tool_deny', call_id: callId, reason: 'Denied by user' }
            );
          })
          .catch(() => {
            try {
              writeCommand(runtime, { type: 'tool_deny', call_id: callId, reason: 'Permission request failed' });
            } catch {
              this.processes.invalidate(key, runtime);
            }
          });
        return;
      }
      const pending = runtime.pending;
      if (!pending) {
        if (event.type === 'error') rejectReady?.(new Error(eventError(event)));
        return;
      }
      pending.lastActivityAt = Date.now();
      const normalized = normalizeTomnyStreamEvent(event);
      if (normalized) pending.emit(normalized);
      if (event.type === 'stream_end') {
        runtime.pending = undefined;
        pending.resolve();
      } else if (event.type === 'error') {
        runtime.pending = undefined;
        pending.reject(new Error(eventError(event)));
      }
    });

    child.once('exit', (code) => {
      clearTimeout(readyTimer);
      this.processes.invalidate(key, runtime);
      const suffix = runtime.stderrTail.trim() ? `\n${runtime.stderrTail.trim()}` : '';
      const error = new Error(`${formatSpawnLabel(target)} exited with code ${String(code)}.${suffix}`);
      rejectReady?.(error);
      runtime.pendingContext?.reject(error);
      runtime.pending?.reject(error);
      runtime.pending = undefined;
    });
    child.once('error', (error) => {
      clearTimeout(readyTimer);
      this.processes.invalidate(key, runtime);
      const wrapped = new Error(`Failed to start ${formatSpawnLabel(target)}: ${errorMessage(error)}`);
      rejectReady?.(wrapped);
      runtime.pendingContext?.reject(wrapped);
      runtime.pending?.reject(wrapped);
      runtime.pending = undefined;
    });

    await ready;
    return runtime;
  }
}
