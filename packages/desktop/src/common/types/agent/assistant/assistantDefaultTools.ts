/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Default tools of an assistant: tool schemas the assistant carries so the agent has them from the first turn,
 * without tool search. Pure logic only, shared by the renderer (editor, apply) and the main process (storage,
 * bundle, pipeline). Nothing here enables anything: a tool is attached only when its server is enabled and approved.
 */

/** Caps for pre-attached schemas. Above either cap the extra tools are not attached and an over-limit notice is shown. */
export const ASSISTANT_DEFAULT_TOOL_LIMITS = {
  maxTools: 24,
  maxSchemaBytes: 8 * 1024,
} as const;

/** A default tool id is `<serverId>::<toolName>`: the MCP server (or built-in server) and the tool name. */
const DEFAULT_TOOL_ID = /^[A-Za-z0-9_.-]{1,120}::[A-Za-z0-9_.:-]{1,120}$/u;

/** Builds the stable id of one tool. */
export const defaultToolId = (serverId: string, toolName: string): string => `${serverId}::${toolName}`;

/** True when a value has the shape of a default tool id. Strict input check for IPC and storage. */
export const isDefaultToolId = (value: string): boolean => DEFAULT_TOOL_ID.test(value);

/** One tool the person can pick, with the facts needed to decide whether it may be attached. */
export type DefaultToolCandidate = {
  id: string;
  /** Display name of the tool. */
  name: string;
  /** MCP server (plugin) that provides the tool: its id and display name. */
  serverId: string;
  serverName: string;
  /** Measured or estimated size of the tool schema sent to the model, in bytes. */
  schemaBytes: number;
  /** The server is turned on by the person. */
  serverEnabled: boolean;
  /** The server is approved to run: built-in, or it last connected successfully. */
  approved: boolean;
};

export type DefaultToolNoticeReason = 'not-installed' | 'not-enabled' | 'not-approved' | 'over-limit';

export type DefaultToolNotice = { kind: 'tool'; id: string; reason: DefaultToolNoticeReason };

/** Result of planning the default tools against what is available. */
export type DefaultToolPlan = {
  /** Tool ids to attach, in the order the assistant lists them. */
  toolIds: string[];
  /** Total schema bytes of the attached tools. */
  schemaBytes: number;
  notices: DefaultToolNotice[];
};

/** Schema size of one tool as the model would see it: name, description and input schema as JSON. */
export const estimateToolSchemaBytes = (tool: {
  name: string;
  description?: string;
  input_schema?: unknown;
}): number => {
  const json = JSON.stringify({
    name: tool.name,
    description: tool.description ?? '',
    input_schema: tool.input_schema ?? {},
  });
  return new TextEncoder().encode(json).byteLength;
};

/** Whether a selection is over either cap. The editor warns; the planner refuses the extra tools. */
export const isOverDefaultToolLimit = (count: number, schemaBytes: number): boolean =>
  count > ASSISTANT_DEFAULT_TOOL_LIMITS.maxTools || schemaBytes > ASSISTANT_DEFAULT_TOOL_LIMITS.maxSchemaBytes;

/**
 * Plans the default tools of one assistant. Unknown ids, disabled servers and unapproved servers never attach. A tool
 * that would exceed a cap is left out with an `over-limit` notice, so the caps hold even for a hand-edited file.
 */
export const planDefaultTools = (
  requested: readonly string[] | undefined,
  available: readonly DefaultToolCandidate[]
): DefaultToolPlan => {
  const byId = new Map(available.map((candidate) => [candidate.id, candidate] as const));
  const toolIds: string[] = [];
  const notices: DefaultToolNotice[] = [];
  let schemaBytes = 0;
  for (const id of new Set(requested ?? [])) {
    if (!isDefaultToolId(id)) {
      notices.push({ kind: 'tool', id, reason: 'not-installed' });
      continue;
    }
    const candidate = byId.get(id);
    if (!candidate) {
      notices.push({ kind: 'tool', id, reason: 'not-installed' });
      continue;
    }
    if (!candidate.serverEnabled) {
      notices.push({ kind: 'tool', id, reason: 'not-enabled' });
      continue;
    }
    if (!candidate.approved) {
      notices.push({ kind: 'tool', id, reason: 'not-approved' });
      continue;
    }
    const nextBytes = schemaBytes + candidate.schemaBytes;
    if (isOverDefaultToolLimit(toolIds.length + 1, nextBytes)) {
      notices.push({ kind: 'tool', id, reason: 'over-limit' });
      continue;
    }
    toolIds.push(id);
    schemaBytes = nextBytes;
  }
  return { toolIds, schemaBytes, notices };
};

/** Keeps only well-formed, unique ids in the first-seen order. Used on storage and IPC input. */
export const sanitizeDefaultToolIds = (values: readonly unknown[] | undefined): string[] => {
  const out: string[] = [];
  for (const value of values ?? []) {
    if (typeof value === 'string' && isDefaultToolId(value) && !out.includes(value)) out.push(value);
  }
  return out;
};
