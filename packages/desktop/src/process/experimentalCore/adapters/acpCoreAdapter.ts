/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionModelState,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { withPersistentAgentRetry } from '@process/agentRuntime/retryPolicy';

import { buildAcpPromptBlocks } from './attachmentPayload';
import type { CliCommandDiscovery, DiscoveredCliCommand } from '@/common/chat/slash/types';

import { evaluateAcpCompatibility } from './acpCompatibility';
import {
  dedupeCoreMcpServers,
  formatSpawnLabel,
  requireWorkspace,
  throwIfAborted,
  type CoreAdapter,
  type CoreAdapterEvent,
  type CoreRunInput,
  type DetectedCoreTarget,
} from './coreAdapter';
import type { ExperimentalCoreModel, ExperimentalPermissionMode } from '../experimentalCoreProtocol';

type AcpPermissionHandler = {
  mode: ExperimentalPermissionMode;
  request: (request: { tool: string; detail?: string }) => Promise<boolean>;
};

const ACP_HANDSHAKE_TIMEOUT_MS = 15_000;
const MAX_ACP_COMMAND_SESSIONS = 128;
// One ACP catalog can contain thousands of installed skills; never mistake its first 128 items for the full list.
const MAX_ACP_COMMAND_ITEMS = 2_048;
const MAX_ACP_COMMAND_SCAN = 4_096;
const ACP_COMMAND_DISCOVERY_TIMEOUT_MS = 10_000;

/** ACP session/new metadata is untrusted: constrain names, sizes and count before renderer IPC. */
export const parseAcpCommands = (value: unknown): CliCommandDiscovery => {
  if (!Array.isArray(value)) return { status: 'unsupported', commands: [] };
  const commands: DiscoveredCliCommand[] = [];
  const names = new Set<string>();
    for (const raw of value.slice(0, MAX_ACP_COMMAND_SCAN)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.replace(/^\//u, '').trim() : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/u.test(name) || names.has(name)) continue;
    names.add(name);
    commands.push({
      name,
      description: typeof entry.description === 'string' ? entry.description.slice(0, 300) : '',
    });
        if (commands.length >= MAX_ACP_COMMAND_ITEMS) break;
  }
  return { status: 'available', commands };
};

type AcpCommandSession = {
  targetId: string;
  workspace: string;
  logicalSessionId: string;
  providerSessionId: string;
  value: CliCommandDiscovery;
};

type AcpProcess = {
  child: ChildProcessWithoutNullStreams;
  connection: ClientSideConnection;
  permissions: Map<string, AcpPermissionHandler>;

  toolCalls: Map<string, string>;
  stderrTail: string;
};

const textUpdate = (params: SessionNotification): string => {
  const update = params.update;
  if (update.sessionUpdate !== 'agent_message_chunk') return '';
  return update.content.type === 'text' ? update.content.text : '';
};

const selectedPermission = (
  params: RequestPermissionRequest,
  kinds: Array<'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'>
): RequestPermissionResponse => {
  const selected = kinds.flatMap((kind) => params.options.filter((option) => option.kind === kind))[0];
  if (!selected) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId: selected.optionId } };
};

export const resolveAcpPermission = async (
  params: RequestPermissionRequest,
  handler: AcpPermissionHandler | undefined
): Promise<RequestPermissionResponse> => {
  if (!handler || handler.mode === 'read-only') {
    return selectedPermission(params, ['reject_once', 'reject_always']);
  }
  if (handler.mode === 'full-access') {
    return selectedPermission(params, ['allow_always', 'allow_once']);
  }
  const detail = params.toolCall.rawInput === undefined ? undefined : JSON.stringify(params.toolCall.rawInput);
  const approved = await handler.request({
    tool: params.toolCall.title ?? params.toolCall.kind ?? 'ACP tool',
    detail,
  });
  return approved
    ? selectedPermission(params, ['allow_once', 'allow_always'])
    : selectedPermission(params, ['reject_once', 'reject_always']);
};

const spawnTarget = (target: DetectedCoreTarget): ChildProcessWithoutNullStreams => {
  if (!target.command) throw new Error(`${target.name} executable was not found.`);
  return spawn(target.command, target.args, {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(target.command),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
};

export const mapAcpSessionModels = (state?: SessionModelState | null): ExperimentalCoreModel[] =>
  state?.availableModels.map((model) => ({
    key: model.modelId,
    modelId: model.modelId,
    label: model.name || model.modelId,
    isDefault: model.modelId === state.currentModelId,
  })) ?? [];

/** Keep an ACP turn logical while its provider/process is retried underneath. */
export const runAcpWithRetry = async (input: CoreRunInput, operation: () => Promise<void>): Promise<void> =>
  withPersistentAgentRetry({
    signal: input.signal,
    operation,
    agentLabel: input.target.name.trim() || 'ACP agent',
    onBeforeRetry: () => input.emit({ type: 'delta', text: '', mode: 'replace' }),
    onStatus: (status) => input.emit({ type: 'status', text: status.message }),
  });

export const acpMcpServers = (input: CoreRunInput) =>
  dedupeCoreMcpServers(input.mcpServers ?? []).map((server) => {
    if (server.transport === 'stdio') {
      return {
        name: server.name,
        command: server.command,
        args: server.args ?? [],
        ...(server.cwd ? { cwd: server.cwd } : {}),
        env: server.env ?? [],
      };
    }
    return {
      type:
        server.transport === 'http' || server.transport === 'streamable_http' ? ('http' as const) : ('sse' as const),
      name: server.name,
      url: server.url,
      headers: server.headers ?? [],
    };
  });

/** Generic ACP stdio host shared by Claude, OpenCode, Cursor, Hermes and compatible CLIs. */
export class AcpCoreAdapter implements CoreAdapter {
      public readonly protocol = 'acp' as const;
  private readonly modelCache = new Map<string, { models: ExperimentalCoreModel[]; expiresAt: number }>();
      private readonly commandSessions = new Map<string, AcpCommandSession>();
  private readonly commandSessionsByProvider = new Map<string, string>();
  private readonly commandListeners = new Map<string, (value: CliCommandDiscovery) => void>();
  private readonly pendingCommandUpdates = new Map<string, unknown>();
      private readonly pendingCommandDiscovery = new Map<string, Promise<CliCommandDiscovery>>();
    private readonly commandGenerations = new Map<string, number>();
  /** A discovery-only ACP session is not reusable for a chat run because it lacks the run's MCP grants. */
    private readonly runSessions = new Set<string>();
  private disposing = false;

  public async listModels(target: DetectedCoreTarget, workspace?: string): Promise<ExperimentalCoreModel[]> {
    const cached = this.modelCache.get(target.id);
    if (cached && cached.expiresAt > Date.now()) return cached.models;
    if (!workspace?.trim()) return cached?.models ?? [];
    try {
      const runtime = await this.getProcess(target);
                  const created = await runtime.connection.newSession({ cwd: requireWorkspace(workspace), mcpServers: [] });
                  const models = this.captureModels(target.id, created.models);
      // Model inspection creates a different ACP session; never mix its catalog into a chat session.
      return models;
    } catch {
      return cached?.models ?? [];
        }
  }

  /** Query one logical conversation without prompting the model; later notifications replace this catalog. */
  public async listCommands(
    target: DetectedCoreTarget,
    workspace: string,
    logicalSessionId = '',
    onUpdate?: (value: CliCommandDiscovery) => void
  ): Promise<CliCommandDiscovery> {
    if (!workspace.trim()) return { status: 'unsupported', commands: [] };
        const key = JSON.stringify([target.id, workspace, logicalSessionId]);
    const generation = this.commandGenerations.get(key) ?? 0;
    if (onUpdate) this.commandListeners.set(key, onUpdate);
    const current = this.commandSessions.get(key);
    if (current) return current.value;
    const pending = this.pendingCommandDiscovery.get(key);
    if (pending) return pending;
    const discovery = (async (): Promise<CliCommandDiscovery> => {
      try {
        const runtime = await this.getProcess(target);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('ACP_COMMAND_DISCOVERY_TIMEOUT')), ACP_COMMAND_DISCOVERY_TIMEOUT_MS);
        });
        try {
          const created = await Promise.race([
            runtime.connection.newSession({ cwd: requireWorkspace(workspace), mcpServers: [] }),
            expired,
          ]);
          this.captureModels(target.id, created.models);
                    // A deleted or reset conversation must not be resurrected by a late ACP response.
          if ((this.commandGenerations.get(key) ?? 0) !== generation) {
            return { status: 'unavailable', commands: [] };
          }
          // A real run may have started during discovery; its session is authoritative.
          const newer = this.commandSessions.get(key);
          if (newer) return newer.value;
          return this.rememberCommands(
            target.id, workspace, logicalSessionId, created.sessionId,
            (created as { availableCommands?: unknown }).availableCommands
          );
        } finally {
          if (timeout) clearTimeout(timeout);
        }
            } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/authentication|unauthoriz|auth_required|api.key|log.?in|sign.?in|credential/iu.test(message)) {
          return { status: 'authentication-required', commands: [] };
        }
        return { status: 'unavailable', commands: [] };
      }
    })();
    this.pendingCommandDiscovery.set(key, discovery);
    try {
      return await discovery;
    } finally {
      if (this.pendingCommandDiscovery.get(key) === discovery) this.pendingCommandDiscovery.delete(key);
    }
  }

  private notifyCommands(key: string, value: CliCommandDiscovery): void {
    try {
      this.commandListeners.get(key)?.(value);
    } catch (error) {
      console.warn('[AcpCoreAdapter] Command update listener failed:', error);
    }
  }

  private rememberCommands(
    targetId: string, workspace: string, logicalSessionId: string, providerSessionId: string, initial: unknown
  ): CliCommandDiscovery {
    const key = JSON.stringify([targetId, workspace, logicalSessionId]);
    const previous = this.commandSessions.get(key);
            if (previous) this.commandSessionsByProvider.delete(JSON.stringify([targetId, previous.providerSessionId]));
    const providerKey = JSON.stringify([targetId, providerSessionId]);
    const pending = this.pendingCommandUpdates.get(providerKey);
    this.pendingCommandUpdates.delete(providerKey);
    const value = parseAcpCommands(pending ?? initial);
    this.commandSessions.set(key, { targetId, workspace, logicalSessionId, providerSessionId, value });
            this.commandSessionsByProvider.set(providerKey, key);
    this.notifyCommands(key, value);
    while (this.commandSessions.size > MAX_ACP_COMMAND_SESSIONS) {
      const oldestKey = this.commandSessions.keys().next().value as string;
      const oldest = this.commandSessions.get(oldestKey);
                  if (oldest) this.commandSessionsByProvider.delete(JSON.stringify([oldest.targetId, oldest.providerSessionId]));
            this.commandSessions.delete(oldestKey);
      this.runSessions.delete(oldestKey);
      this.commandListeners.delete(oldestKey);
    }
    return value;
  }

      private updateCommandSession(targetId: string, providerSessionId: string, raw: unknown): void {
    if (!Array.isArray(raw)) return;
    const providerKey = JSON.stringify([targetId, providerSessionId]);
    const key = this.commandSessionsByProvider.get(providerKey);
    if (!key) {
                  this.pendingCommandUpdates.set(providerKey, raw);
      if (this.pendingCommandUpdates.size > MAX_ACP_COMMAND_SESSIONS) {
        this.pendingCommandUpdates.delete(this.pendingCommandUpdates.keys().next().value as string);
      }
      return;
    }
    const current = this.commandSessions.get(key);
    if (!current || current.providerSessionId !== providerSessionId) return;
    const value = parseAcpCommands(raw); // ACP updates replace the full catalog, including [].
    this.commandSessions.set(key, { ...current, value });
    this.notifyCommands(key, value);
  }

    public releaseCommands(logicalSessionId: string): void {
        const keys = new Set([
      ...this.commandSessions.keys(), ...this.runSessions.keys(),
      ...this.commandListeners.keys(), ...this.pendingCommandDiscovery.keys(),
    ]);
    for (const key of keys) {
      const identity: unknown = JSON.parse(key);
      if (!Array.isArray(identity) || identity[2] !== logicalSessionId) continue;
      const session = this.commandSessions.get(key);
      if (session) this.commandSessionsByProvider.delete(JSON.stringify([session.targetId, session.providerSessionId]));
            this.notifyCommands(key, { status: 'unavailable', commands: [] });
            this.commandSessions.delete(key);
      this.runSessions.delete(key);
      this.commandListeners.delete(key);
      this.pendingCommandDiscovery.delete(key);
      this.commandGenerations.set(key, (this.commandGenerations.get(key) ?? 0) + 1);
    }
    while (this.commandGenerations.size > MAX_ACP_COMMAND_SESSIONS) {
      this.commandGenerations.delete(this.commandGenerations.keys().next().value as string);
    }
  }

  private readonly processes = new Map<string, Promise<AcpProcess>>();
  private readonly emitters = new Map<string, (event: CoreAdapterEvent) => void>();

  public async run(input: CoreRunInput): Promise<void> {
    await runAcpWithRetry(input, () => this.runAttempt(input));
  }

    private async runAttempt(input: CoreRunInput): Promise<void> {
    throwIfAborted(input.signal);
    const runtime = await this.getProcess(input.target);
    throwIfAborted(input.signal);
    const cwd = requireWorkspace(input.workspace);
    const logicalKey = JSON.stringify([input.target.id, cwd, input.sessionId]);
    const existing = input.persistentSession && this.runSessions.has(logicalKey)
      ? this.commandSessions.get(logicalKey)
      : undefined;
    let providerSessionId = existing?.providerSessionId;
    if (!providerSessionId) {
      input.emit({ type: 'status', text: `Starting ${input.target.name} ACP session...` });
      const created = await runtime.connection.newSession({ cwd, mcpServers: acpMcpServers(input) });
      this.captureModels(input.target.id, created.models);
      providerSessionId = created.sessionId;
      this.rememberCommands(
        input.target.id, cwd, input.sessionId, providerSessionId,
        (created as { availableCommands?: unknown }).availableCommands
      );
      if (input.persistentSession) this.runSessions.add(logicalKey);
    }
    if (input.modelKey) {
      try {
        await runtime.connection.unstable_setSessionModel({
          sessionId: providerSessionId,
          modelId: input.modelKey,
        });
      } catch (error) {
        console.warn(`[AcpCoreAdapter] setSessionModel failed or not supported for ${input.target.name}:`, error);
      }
    }

    throwIfAborted(input.signal);

        this.emitters.set(JSON.stringify([input.target.id, providerSessionId]), input.emit);
    runtime.permissions.set(providerSessionId, {
      mode: input.permissionMode,
      request: input.requestPermission,
    });
    const onAbort = (): void => {
      void runtime.connection.cancel({ sessionId: providerSessionId }).catch((): void => undefined);
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
        try {
      await runtime.connection.prompt({
        sessionId: providerSessionId,
        prompt: buildAcpPromptBlocks(input.prompt, input.attachments),
      });
      throwIfAborted(input.signal);
    } catch (error) {
      // Failed/cancelled turns can leave provider context partially mutated: never reuse it.
      this.runSessions.delete(logicalKey);
      throw error;
    } finally {
      input.signal.removeEventListener('abort', onAbort);
            this.emitters.delete(JSON.stringify([input.target.id, providerSessionId]));
      runtime.permissions.delete(providerSessionId);
    }
  }

  private captureModels(targetId: string, state?: SessionModelState | null): ExperimentalCoreModel[] {
    if (!state) return this.modelCache.get(targetId)?.models ?? [];
    const models = mapAcpSessionModels(state);
    this.modelCache.set(targetId, { models, expiresAt: Date.now() + 5 * 60_000 });
    return models;
  }

    public async dispose(): Promise<void> {
    this.disposing = true;
    const processes = await Promise.allSettled(this.processes.values());
    await Promise.all(processes.map(async (result) => {
      if (result.status !== 'fulfilled') return;
      const child = result.value.child;
      if (child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1_000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
        child.kill();
      });
    }));
            this.processes.clear();
    this.emitters.clear();
            this.commandSessions.clear();
    this.commandSessionsByProvider.clear();
    this.commandListeners.clear();
    this.pendingCommandUpdates.clear();
        this.pendingCommandDiscovery.clear();
        this.commandGenerations.clear();
    this.runSessions.clear();
  }

  private getProcess(target: DetectedCoreTarget): Promise<AcpProcess> {
    const existing = this.processes.get(target.id);
    if (existing) return existing;
    const created = this.startProcess(target);
    this.processes.set(target.id, created);
    void created.then(
      (runtime) => {
                        runtime.child.once('exit', () => {
          if (this.processes.get(target.id) !== created) return;
          this.processes.delete(target.id);
          for (const [key, session] of this.commandSessions) {
            if (session.targetId !== target.id) continue;
                        this.commandSessions.delete(key);
            this.runSessions.delete(key);
            this.commandSessionsByProvider.delete(JSON.stringify([session.targetId, session.providerSessionId]));
                        this.notifyCommands(key, { status: 'unavailable', commands: [] });
            this.commandListeners.delete(key);
          }
        });
      },
      () => {
        if (this.processes.get(target.id) === created) this.processes.delete(target.id);
      }
    );
    return created;
  }

  private async startProcess(target: DetectedCoreTarget): Promise<AcpProcess> {
    const child = spawnTarget(target);
    const runtime: AcpProcess = {
      child,
      connection: undefined as unknown as ClientSideConnection,
      permissions: new Map(),

      toolCalls: new Map(),
      stderrTail: '',
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      runtime.stderrTail = `${runtime.stderrTail}${chunk}`.slice(-4000);
            if (!this.disposing) console.warn(`[AcpCoreAdapter:${target.id}] stderr:`, chunk.trim());
    });

    const client: Client = {
      requestPermission: async (params) => resolveAcpPermission(params, runtime.permissions.get(params.sessionId)),
                  sessionUpdate: async (params) => {
        // ACP may announce commands before session/new returns or while no turn is active.
        if (params.update.sessionUpdate === 'available_commands_update') {
                    this.updateCommandSession(target.id, params.sessionId, params.update.availableCommands);
          return;
        }
                const emit = this.emitters.get(JSON.stringify([target.id, params.sessionId]));
        if (!emit) return;
        const text = textUpdate(params);
        if (text) {
          emit({ type: 'delta', text, mode: 'append' });
          return;
        }
        const update = params.update;
        if (update.sessionUpdate === 'tool_call') {
          runtime.toolCalls.set(update.toolCallId, update.title);
          emit({
            type: 'tool-call',
            tool: update.title,
            callId: update.toolCallId,
            text: update.title,
            phase: update.status === 'in_progress' ? 'running' : 'requested',
            ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
          });
          return;
        }
        if (update.sessionUpdate === 'tool_call_update') {
          const title = update.title ?? runtime.toolCalls.get(update.toolCallId) ?? update.toolCallId;
          if (update.title) runtime.toolCalls.set(update.toolCallId, update.title);
          if (update.status === 'pending' || update.status === 'in_progress') {
            emit({
              type: 'tool-call',
              tool: title,
              callId: update.toolCallId,
              text: title,
              phase: update.status === 'in_progress' ? 'running' : 'requested',
              ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
            });
            return;
          }
          if (update.status !== 'completed' && update.status !== 'failed') return;
          emit({
            type: 'tool-result',
            tool: title,
            callId: update.toolCallId,
            text: title,
            outcome: update.status === 'failed' ? 'error' : 'success',
            ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
          });
          runtime.toolCalls.delete(update.toolCallId);
        }
      },
    };
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    );
    const connection = new ClientSideConnection(() => client, stream);
    runtime.connection = connection;

    const exited = new Promise<never>((_resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
                if (!this.disposing) console.warn(`[AcpCoreAdapter:${target.id}] process exited with code ${String(code)}`);
        const suffix = runtime.stderrTail.trim() ? `\n${runtime.stderrTail.trim()}` : '';
        reject(new Error(`${formatSpawnLabel(target)} exited with code ${String(code)}.${suffix}`));
      });
    });
    let timeout: NodeJS.Timeout | undefined;
    const handshakeTimeout = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error(formatSpawnLabel(target) + ' did not complete the ACP handshake within 15 seconds.')),
        ACP_HANDSHAKE_TIMEOUT_MS
      );
    });
    try {
      const initialized = await Promise.race([
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: 'tomny-direct-core', title: 'Tomny Direct Core', version: '0.1.0' },
          clientCapabilities: {},
        }),
        exited,
        handshakeTimeout,
      ]);
      const compatibility = evaluateAcpCompatibility({
        protocolVersion: initialized.protocolVersion,
        agentCapabilities: initialized.agentCapabilities,
      });
      if (compatibility.status === 'incompatible') {
        throw new Error(
          `${target.name} returned an incompatible ACP handshake: ${compatibility.reasons.join(' ') || 'unknown reason'}`
        );
      }
      return runtime;
    } catch (error) {
      child.kill();
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
