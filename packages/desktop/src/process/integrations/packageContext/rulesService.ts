/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rules that installed packages offer, and which workspace they apply to (docs/platform/repotopackage-design.md
 * sections 10.6, 14 S11, 15.1, task T6.3).
 *
 * - A turned-on `rules` connection is only available. It reaches the chat of a workspace after the person attaches it to
 *   that workspace (`attach`), never to every conversation and never by itself. The attachment is state of this
 *   machine, kept per workspace in a small JSON file; it only counts while the connection is on, so turning a
 *   connection off (or updating its package, which turns data kinds off and on again) loses nothing, and `prune`
 *   forgets attachments whose package or connection no longer exists.
 * - `contextFor` is what the context composer adds for a workspace: the attached files, read through the registry's
 *   guarded reader, passed through the outbound text inspection (the same check as any other text bound for the model;
 *   a secret is masked, a blocked text is left out) and cut to {@link MAX_RULES_BYTES} in total with a visible note.
 *   Rules are untrusted data: they are guidance for the agent and grant no permission.
 * - The workspace is named by Main (the composer's resolved workspace); a renderer-supplied path is only ever compared.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ConnectionRegistry } from '@process/integrations/connections/core/registry';
import { inspectOutboundText } from '@process/services/security/outboundTextInspection';
import type {
  OutboundInspectionRequest,
  OutboundInspectionResult,
  OutboundPolicyContext,
} from '@process/services/security/types';
import { createJsonFile, type JsonFile } from './jsonFile';

/** Most rules text one workspace gets, in total (design 10.6). */
export const MAX_RULES_BYTES = 16 * 1024;
/** Longest rules file the host accepts; the text used is still cut to {@link MAX_RULES_BYTES}. */
export const MAX_RULES_FILE_BYTES = 1024 * 1024;
const MAX_ATTACHMENTS = 2_000;
const MAX_WORKSPACE_CHARS = 1_000;
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CONNECTION_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TRUNCATION_NOTE = '\n[Rules cut: more than 16 KB are attached to this workspace.]';
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

export type RulesRef = Readonly<{ packageId: string; connectionId: string }>;

export type RulesAttachment = RulesRef &
  Readonly<{
    /** Normalized workspace identity used for matching. */
    workspaceKey: string;
    /** The workspace path as it was attached, for display. */
    workspace: string;
    attachedAt: number;
  }>;

/** One rules connection that is on, as the Library shows it. No file path, no content. */
export type RulesLibraryEntry = RulesRef &
  Readonly<{
    title: string;
    format: string;
    /** Workspaces it is attached to (as attached, for display). */
    workspaces: readonly string[];
  }>;

export type RulesContext = Readonly<{
  /** Inspected, cut to {@link MAX_RULES_BYTES}. */
  text: string;
  sources: readonly RulesRef[];
  truncated: boolean;
}>;

export class RulesError extends Error {
  readonly code: 'NOT_ENABLED' | 'INVALID_WORKSPACE';
  constructor(code: 'NOT_ENABLED' | 'INVALID_WORKSPACE', message?: string) {
    super(message ?? code);
    this.name = 'RulesError';
    this.code = code;
  }
}

export type RulesService = Readonly<{
  /** Rules connections that are on, with the workspaces each is attached to. */
  list: () => Promise<readonly RulesLibraryEntry[]>;
  /** Attaches rules to one workspace. Rejects with `NOT_ENABLED` unless the connection is on. Idempotent. */
  attach: (input: RulesRef & Readonly<{ workspace: string }>) => Promise<void>;
  /** Idempotent. */
  detach: (input: RulesRef & Readonly<{ workspace: string }>) => Promise<void>;
  /** The rules attached to a workspace (on or off). */
  attachedTo: (workspace: string) => Promise<readonly RulesRef[]>;
  /** What the context composer adds for a workspace; `undefined` when nothing is attached and on, or all of it is empty. */
  contextFor: (workspace: string, signal?: AbortSignal) => Promise<RulesContext | undefined>;
  /** Forgets attachments of packages or connections that no longer exist. */
  prune: () => Promise<void>;
}>;

export type RulesServiceOptions = Readonly<{
  registry: Pick<ConnectionRegistry, 'view' | 'enabledOfKind'>;
  /** JSON file for the attachments. Omit for attachments that live in memory only. */
  file?: string;
  jsonFile?: JsonFile;
  now?: () => number;
  /** The outbound text check. Defaults to the application's. */
  inspect?: (request: OutboundInspectionRequest, context: OutboundPolicyContext) => Promise<OutboundInspectionResult>;
}>;

/** A comparison key for a workspace path: absolute, forward slashes, no trailing slash, lower case on Windows. */
export const workspaceKeyOf = (workspace: string): string | undefined => {
  if (typeof workspace !== 'string' || workspace === '' || workspace.length > MAX_WORKSPACE_CHARS) return undefined;
  if (workspace.includes('\u0000') || !path.isAbsolute(workspace)) return undefined;
  const slashed = path.resolve(workspace).replace(/\\/gu, '/').replace(/\/+$/u, '');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
};

const parseAttachments = (raw: unknown): RulesAttachment[] => {
  const file = raw as { schemaVersion?: unknown; attachments?: unknown } | null | undefined;
  if (file === null || file === undefined || typeof file !== 'object' || file.schemaVersion !== 1) return [];
  if (!Array.isArray(file.attachments)) return [];
  const found: RulesAttachment[] = [];
  for (const item of file.attachments.slice(0, MAX_ATTACHMENTS)) {
    const record = item as Record<string, unknown> | null;
    if (record === null || typeof record !== 'object') continue;
    const { packageId, connectionId, workspace, attachedAt } = record;
    if (typeof packageId !== 'string' || !PACKAGE_ID.test(packageId)) continue;
    if (typeof connectionId !== 'string' || !CONNECTION_ID.test(connectionId)) continue;
    if (typeof workspace !== 'string') continue;
    const workspaceKey = workspaceKeyOf(workspace);
    if (workspaceKey === undefined) continue;
    found.push({
      packageId,
      connectionId,
      workspace,
      workspaceKey,
      attachedAt: typeof attachedAt === 'number' && Number.isFinite(attachedAt) ? attachedAt : 0,
    });
  }
  return found;
};

/** Cuts text to at most `maxBytes` of UTF-8 without leaving half a character at the end. */
export const truncateUtf8 = (value: string, maxBytes: number): string => {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString('utf8').replace(/�+$/u, '');
};

/** A Cursor rule starts with a YAML header (globs, alwaysApply) that is for the editor, not for the model. */
const stripFrontmatter = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '');

const singleLine = (value: string, max: number): string => value.replace(CONTROL_CHARACTERS, ' ').trim().slice(0, max);

const sameRef = (left: RulesRef, right: RulesRef): boolean =>
  left.packageId === right.packageId && left.connectionId === right.connectionId;

export const createRulesService = (options: RulesServiceOptions): RulesService => {
  const file = options.jsonFile ?? (options.file === undefined ? undefined : createJsonFile(options.file));
  const now = options.now ?? Date.now;
  const inspect = options.inspect ?? inspectOutboundText;
  let attachments: RulesAttachment[] = [];
  const ready: Promise<void> = (async () => {
    if (file !== undefined) attachments = parseAttachments(await file.read());
  })();

  /** Applies a change and writes it; a failed write puts the previous state back and rethrows. */
  const mutate = async (change: (current: RulesAttachment[]) => RulesAttachment[]): Promise<void> => {
    await ready;
    const before = attachments;
    const next = change(attachments);
    if (next.length === before.length && next.every((item, index) => item === before[index])) return;
    attachments = next;
    try {
      await file?.write({ schemaVersion: 1, attachments });
    } catch (error) {
      attachments = before;
      throw error;
    }
  };

  const enabledRules = async () =>
    (await options.registry.enabledOfKind('rules')).filter((item) => item.connection.kind === 'rules');

  const requireWorkspace = (workspace: string): { key: string } => {
    const key = workspaceKeyOf(workspace);
    if (key === undefined) throw new RulesError('INVALID_WORKSPACE', 'The workspace must be an absolute folder path.');
    return { key };
  };

  const requireEnabled = async (ref: RulesRef): Promise<void> => {
    if (!PACKAGE_ID.test(ref.packageId) || !CONNECTION_ID.test(ref.connectionId)) {
      throw new RulesError('NOT_ENABLED');
    }
    const found = (await enabledRules()).some(
      (item) => item.packageId === ref.packageId && item.key === `rules:${ref.connectionId}`
    );
    if (!found) throw new RulesError('NOT_ENABLED', 'The rules are not turned on.');
  };

  /** Reads one attached rules file through the guarded reader. `undefined` when it cannot be used. */
  const readRules = async (item: Awaited<ReturnType<typeof enabledRules>>[number]): Promise<string | undefined> => {
    const connection = item.connection;
    if (connection.kind !== 'rules') return undefined;
    try {
      const bytes = await item.context.readPackageFile(connection.path);
      let text = bytes
        .subarray(0, MAX_RULES_BYTES * 4)
        .toString('utf8')
        .replace(/^﻿/u, '');
      if (connection.format === 'cursor-mdc') text = stripFrontmatter(text);
      text = text.replace(/\r\n/gu, '\n').trim();
      return text === '' ? undefined : text;
    } catch {
      return undefined;
    }
  };

  return {
    list: async () => {
      await ready;
      const entries: RulesLibraryEntry[] = [];
      for (const item of await enabledRules()) {
        const connection = item.connection;
        if (connection.kind !== 'rules') continue;
        const ref = { packageId: item.packageId, connectionId: connection.id };
        entries.push({
          ...ref,
          title: connection.title,
          format: connection.format,
          workspaces: attachments
            .filter((attachment) => sameRef(attachment, ref))
            .map((attachment) => attachment.workspace),
        });
      }
      return entries;
    },
    attach: async (input) => {
      const { key } = requireWorkspace(input.workspace);
      await requireEnabled(input);
      await mutate((current) =>
        current.some((item) => item.workspaceKey === key && sameRef(item, input))
          ? current
          : [
              ...current,
              {
                packageId: input.packageId,
                connectionId: input.connectionId,
                workspace: path.resolve(input.workspace),
                workspaceKey: key,
                attachedAt: now(),
              },
            ]
      );
    },
    detach: async (input) => {
      const key = workspaceKeyOf(input.workspace);
      if (key === undefined) return;
      await mutate((current) =>
        current.some((item) => item.workspaceKey === key && sameRef(item, input))
          ? current.filter((item) => !(item.workspaceKey === key && sameRef(item, input)))
          : current
      );
    },
    attachedTo: async (workspace) => {
      await ready;
      const key = workspaceKeyOf(workspace);
      if (key === undefined) return [];
      return attachments
        .filter((item) => item.workspaceKey === key)
        .map((item) => ({ packageId: item.packageId, connectionId: item.connectionId }));
    },
    contextFor: async (workspace, signal) => {
      await ready;
      const key = workspaceKeyOf(workspace);
      if (key === undefined) return undefined;
      const attached = attachments
        .filter((item) => item.workspaceKey === key)
        .toSorted((a, b) => a.attachedAt - b.attachedAt);
      if (attached.length === 0) return undefined;
      const enabled = await enabledRules();

      const blocks: { ref: RulesRef; text: string }[] = [];
      for (const attachment of attached) {
        if (signal?.aborted === true) return undefined;
        const item = enabled.find(
          (candidate) =>
            candidate.packageId === attachment.packageId && candidate.key === `rules:${attachment.connectionId}`
        );
        if (item === undefined || item.connection.kind !== 'rules') continue;
        // oxlint-disable-next-line no-await-in-loop -- a few files, one after another
        const text = await readRules(item);
        if (text === undefined) continue;
        blocks.push({
          ref: { packageId: attachment.packageId, connectionId: attachment.connectionId },
          text: `### ${singleLine(item.connection.title, 120)} (${attachment.packageId})\n${truncateUtf8(text, MAX_RULES_BYTES)}`,
        });
      }
      if (blocks.length === 0) return undefined;

      // The same check as any text bound for the model: a secret is masked, anything the check blocks is left out.
      const inspection = await inspect(
        {
          schemaVersion: 1,
          requestId: randomUUID(),
          actorId: 'local-user',
          surface: 'file',
          target: { kind: 'model-context', id: 'package-rules' },
          parts: blocks.map((block, index) => ({ id: `rules-${index}`, text: block.text, source: 'file' as const })),
          sensitivity: 'normal',
        },
        { allowSanitize: true, requireApprovalForFindings: false, policyVersion: 'package-rules-v1' }
      );
      if (inspection.decision !== 'allow' && inspection.decision !== 'sanitize') return undefined;

      const kept: RulesRef[] = [];
      const texts: string[] = [];
      for (const [index, block] of blocks.entries()) {
        const safe = inspection.safeParts[index]?.text;
        if (safe === undefined || safe.trim() === '') continue;
        kept.push(block.ref);
        texts.push(safe);
      }
      if (texts.length === 0) return undefined;
      const joined = texts.join('\n\n');
      const truncated = Buffer.byteLength(joined, 'utf8') > MAX_RULES_BYTES;
      return {
        text: truncated ? `${truncateUtf8(joined, MAX_RULES_BYTES)}${TRUNCATION_NOTE}` : joined,
        sources: kept,
        truncated,
      };
    },
    prune: async () => {
      await ready;
      const keep = new Map<string, boolean>();
      const alive = async (item: RulesRef): Promise<boolean> => {
        const cacheKey = `${item.packageId}\u0000${item.connectionId}`;
        const cached = keep.get(cacheKey);
        if (cached !== undefined) return cached;
        let present = false;
        try {
          present = (await options.registry.view(item.packageId)).some(
            (view) => view.key === `rules:${item.connectionId}`
          );
        } catch {
          present = false;
        }
        keep.set(cacheKey, present);
        return present;
      };
      const survivors: RulesAttachment[] = [];
      for (const item of attachments) {
        // oxlint-disable-next-line no-await-in-loop -- a few packages, one after another
        if (await alive(item)) survivors.push(item);
      }
      await mutate((current) => (survivors.length === current.length ? current : survivors));
    },
  };
};
