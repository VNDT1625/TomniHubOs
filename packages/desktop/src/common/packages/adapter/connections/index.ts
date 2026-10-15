/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { shapedFor } from '../primitives';
import { buildExtensionConnection } from './extension';
import {
  buildAgentConnection,
  buildCommandConnection,
  buildKnowledgeConnection,
  buildRulesConnection,
  buildSkillConnection,
  buildVscodeConnection,
} from './files';
import { buildHookConnection } from './hook';
import { buildMcpConnection } from './mcp';
import {
  buildBridgeConnection,
  buildCliConnection,
  buildLauncherConnection,
  buildServiceConnection,
  buildToolConnection,
  buildWebEmbedConnection,
} from './process';

export { ADAPTER_MCP_COMMANDS } from './mcp';
export { ADAPTER_HOOK_EVENTS } from './hook';

/** Builds every connection schema, strict for the writer or tolerant for the reader. */
const buildConnectionSchemas = (tolerant: boolean) => {
  const shaped = shapedFor(tolerant);
  return {
    mcp: buildMcpConnection(shaped),
    skill: buildSkillConnection(shaped),
    tool: buildToolConnection(shaped),
    cli: buildCliConnection(shaped),
    'web-embed': buildWebEmbedConnection(shaped),
    launcher: buildLauncherConnection(shaped),
    bridge: buildBridgeConnection(shaped),
    command: buildCommandConnection(shaped),
    agent: buildAgentConnection(shaped),
    hook: buildHookConnection(shaped),
    rules: buildRulesConnection(shaped),
    extension: buildExtensionConnection(shaped),
    knowledge: buildKnowledgeConnection(shaped),
    service: buildServiceConnection(shaped),
    vscode: buildVscodeConnection(shaped),
  } as const;
};

const strictSchemas = buildConnectionSchemas(false);
const tolerantSchemas = buildConnectionSchemas(true);

const unionOf = (schemas: typeof strictSchemas) =>
  z.union([
    schemas.mcp,
    schemas.skill,
    schemas.tool,
    schemas.cli,
    schemas['web-embed'],
    schemas.launcher,
    schemas.bridge,
    schemas.command,
    schemas.agent,
    schemas.hook,
    schemas.rules,
    schemas.extension,
    schemas.knowledge,
    schemas.service,
    schemas.vscode,
  ]);

/** Strict: unknown fields are rejected. Used when a package is written. */
export const connectionSchema = unionOf(strictSchemas);

export type AdapterConnection = z.infer<typeof connectionSchema>;
export type AdapterConnectionKind = AdapterConnection['kind'];

/** Every connection kind this version of the app understands, including those the host cannot install yet. */
export const ADAPTER_CONNECTION_KINDS = Object.keys(strictSchemas) as readonly AdapterConnectionKind[];

const KNOWN_KINDS: ReadonlySet<string> = new Set(ADAPTER_CONNECTION_KINDS);

export const isKnownConnectionKind = (kind: string): kind is AdapterConnectionKind => KNOWN_KINDS.has(kind);

/** Tolerant read of one connection whose kind is already known: unknown fields are dropped, known ones checked. */
export const parseTolerantConnection = (kind: AdapterConnectionKind, item: unknown) => {
  const parsed = tolerantSchemas[kind].safeParse(item);
  return parsed.success
    ? ({ success: true, data: parsed.data as AdapterConnection } as const)
    : ({ success: false, message: parsed.error.issues[0]?.message ?? 'invalid connection' } as const);
};

/**
 * The identity of a connection inside one package. A skill has no id, so its path is its identity; every other
 * kind is `${kind}:${id}` (a hook included, so `hook:format` and `mcp:format` never collide).
 */
export const connectionKey = (connection: AdapterConnection): string =>
  connection.kind === 'skill' ? `skill:${connection.path}` : `${connection.kind}:${connection.id}`;
