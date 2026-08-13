/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExperimentalCoreModel, ExperimentalPermissionMode } from '../experimentalCoreProtocol';

import type { ResolvedAttachmentDelivery } from '@process/services/agentChat/attachments';

export type CoreAdapterProtocol =
  | 'tomny-json-stream'
  | 'codex-app-server'
  | 'acp'
  | 'openclaw-gateway'
  | 'tomny-remote-v1';

export type CoreAdapterDefinition = {
  id: string;
  name: string;
  protocol: CoreAdapterProtocol;
  candidates: string[];
  args: string[];
  detail: string;
  runnable: boolean;
};

export type DetectedCoreTarget = CoreAdapterDefinition & {
  detected: boolean;
  available: boolean;
  command?: string;
};

export type CoreAdapterEvent =
  | { type: 'delta'; text: string; mode?: 'append' | 'replace' }
  | { type: 'status'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'step'; text: string }
  | {
      type: 'tool-call';
      text: string;
      tool: string;
      callId?: string;
      phase?: 'requested' | 'running';
      /** Original arguments supplied to the tool. Kept separate from the human-readable text. */
      input?: unknown;
    }
  | {
      type: 'tool-result';
      text: string;
      tool: string;
      callId?: string;
      outcome: 'success' | 'error';
      /** Arguments echoed by the provider, when the protocol includes them. */
      input?: unknown;
    };

export type CoreMcpServer =
  | {
      name: string;
      transport?: 'sse' | 'http' | 'streamable_http';
      url: string;
      headers?: Array<{ name: string; value: string }>;
      deferred?: boolean;
    }
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Array<{ name: string; value: string }>;
      deferred?: boolean;
    };

export type CoreContextTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  deferred: boolean;
};

export type CoreContextSnapshot = {
  system: string;
  tools: CoreContextTool[];
  messages?: Array<Record<string, unknown>>;
  capabilitySummary?: string;
  workingMemory?: unknown;
  toolCache?: CoreContextTool[];
  agentContext?: string;
  personalContext?: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>;
};

export type CoreToolCatalogPolicy = {
  /** Surface mode exposes only the active surface patterns; Super aliases the unified catalog as tomny_*. */
  mode: 'surface' | 'super';
  patterns: string[];
};

/**
 * Keep one MCP server per case-insensitive name. The first source wins so a
 * surface capability cannot be shadowed by a later catalog duplicate.
 */
export const dedupeCoreMcpServers = (servers: readonly CoreMcpServer[]): CoreMcpServer[] => {
  const names = new Set<string>();
  const result: CoreMcpServer[] = [];
  for (const server of servers) {
    const name = server.name.trim();
    if (!name) throw new Error('MCP server name cannot be empty.');
    const key = name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    result.push({ ...server, name });
  }
  return result;
};

export type CoreCapabilityPermissionRequest = {
  tool: string;
  detail?: string;
};

/** Immutable parent execution boundary used only while resolving trusted live capability hosts. */
export type CoreCapabilityHostContext = Readonly<{
  sessionId: string;
  workspace: string;
  surface: string;
  permissionMode: Exclude<ExperimentalPermissionMode, 'full-access'>;
  requestPermission?: (request: CoreCapabilityPermissionRequest) => Promise<boolean>;
}>;

export type CoreRunInput = {
  sessionId: string;
  target: DetectedCoreTarget;
  prompt: string;
  workspace: string;
  modelKey?: string;
  permissionMode: ExperimentalPermissionMode;
  /** Surface selected by the host UI; adapters may use it to resolve a capability harness. */
  surface?: string;
  mcpServers?: CoreMcpServer[];
  toolCatalog?: CoreToolCatalogPolicy;

  /** Integrity-checked, per-run attachment payload; never persisted or exposed through IPC. */
  attachments?: ResolvedAttachmentDelivery;
  signal: AbortSignal;
  emit: (event: CoreAdapterEvent) => void;
  requestPermission: (request: { tool: string; detail?: string }) => Promise<boolean>;
};

export type CoreContextInspectionInput = {
  sessionId: string;
  target: DetectedCoreTarget;
  workspace: string;
  modelKey?: string;
  permissionMode: ExperimentalPermissionMode;
  surface?: string;
  mcpServers?: CoreMcpServer[];
  toolCatalog?: CoreToolCatalogPolicy;
};

export type CoreAdapter = {
  protocol: CoreAdapterProtocol;
  /** False when the host must rehydrate canonical session history on every turn. */
  retainsConversationHistory?: boolean;
  listModels: (target: DetectedCoreTarget, workspace?: string) => Promise<ExperimentalCoreModel[]>;
  inspectContext?: (input: CoreContextInspectionInput) => Promise<CoreContextSnapshot>;
  run: (input: CoreRunInput) => Promise<void>;
  dispose: () => Promise<void>;
};

export type ExecutableResolver = (candidates: string[]) => Promise<string | null>;

/** Quote only for the diagnostic label; commands are spawned without interpolating prompts. */
export const formatSpawnLabel = (target: DetectedCoreTarget): string =>
  [target.command ?? target.candidates[0], ...target.args].filter(Boolean).join(' ');

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
};

export const emptyModels = async (): Promise<ExperimentalCoreModel[]> => [];

/** Resolve the explicit workspace selected by the user; never fall back to the app directory. */
export const requireWorkspace = (workspace: string): string => {
  const resolved = workspace.trim();
  if (!resolved) throw new Error('Select a workspace before starting the agent.');
  return resolved;
};

export const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new Error('The request was cancelled.');
};
