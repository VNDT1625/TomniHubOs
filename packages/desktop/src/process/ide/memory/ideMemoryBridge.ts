/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IDE session super-memory IPC bridge — the renderer-facing surface of the
 * durable, per-session Save scratchpad ({@link getSessionMemoryStore}).
 *
 * The agent WRITES to the memory through the IDE MCP server (`ide_memory_*`
 * tools, see `mcp/ideServer.ts`); the renderer only needs two things:
 *
 *  - `ide.memory-snapshot` — read a point-in-time view to render a status badge
 *    ("N notes, X% of budget, secrets: …") next to the chat tab. Secret VALUES
 *    are never exposed — only the key names.
 *  - `ide.memory-clear` — drop a whole session. The IDE chat panel calls this
 *    when a tab is explicitly closed, removing its persisted session Save.
 *
 * Both consumers (this bridge and the MCP wiring) import the SAME singleton, so
 * the agent's writes and the UI's snapshot/clear all hit the same store.
 *
 * Channels use always-resolving envelopes so a renderer await never hangs.
 *
 * The global bootstrap calls {@link registerIdeMemoryBridge} once.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { bridge } from '@office-ai/platform';
import {
  getSessionMemoryStore,
  type RememberResult,
  type SuperMemoryKind,
  type SuperMemorySnapshot,
} from './sessionMemoryStore';
import {
  getRepoSecretStore,
  type RepoSecretCombo,
  type RepoSecretComboInput,
  type RepoSecretContext,
  type RepoSecretMarkerRender,
  type RepoSecretScopeSummary,
} from './repoSecretStore';

/** IPC channel names for the IDE session-memory surface. */
export const IDE_MEMORY_CHANNELS = {
  snapshot: 'ide.memory-snapshot',
  clear: 'ide.memory-clear',
  remember: 'ide.memory-remember',
  repoSecretList: 'ide.repo-secret-list',
  repoSecretScopes: 'ide.repo-secret-scopes',
  repoSecretSave: 'ide.repo-secret-save',
  repoSecretDeclare: 'ide.repo-secret-declare',
  repoSecretComboList: 'ide.repo-secret-combo-list',
  repoSecretComboSave: 'ide.repo-secret-combo-save',
  repoSecretComboRemove: 'ide.repo-secret-combo-remove',
  repoSecretRemove: 'ide.repo-secret-remove',
  repoSecretReveal: 'ide.repo-secret-reveal',
  repoSecretRenderMarkers: 'ide.repo-secret-render-markers',
} as const;

/** Always-resolving result envelope. */
export type IdeMemoryResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Request carrying the session id (the IDE chat conversation id). */
export type IdeMemoryRequest = { sessionId: string };

/** Kinds a user may record from the UI (the `summary` kind is reserved for compaction). */
export type IdeMemoryRecordableKind = Exclude<SuperMemoryKind, 'summary'>;

/** Request to manually jot a note into a session from the memory drawer. */
export type IdeMemoryRememberRequest = {
  sessionId: string;
  text: string;
  kind?: IdeMemoryRecordableKind;
  pinned?: boolean;
};

/** Repository-scoped secret metadata. Values never cross this IPC boundary. */
export type RepoSecretListRequest = { repository: string };
export type RepoSecretScopesRequest = Record<string, never>;
export type RepoSecretSaveRequest = {
  repository: string;
  alias: string;
  description: string;
  value: string;
};
export type RepoSecretDeclareRequest = { repository: string; alias: string; description: string };
export type RepoSecretComboSaveRequest = { repository: string; combo: RepoSecretComboInput };
export type RepoSecretComboRemoveRequest = { repository: string; comboId: string };
export type RepoSecretRemoveRequest = { repository: string; alias: string };
/**
 * Deliberate local UI reveal. It is intentionally not exposed to MCP or any
 * agent-facing bridge, so secret values cannot enter prompts or tool output.
 */
export type RepoSecretRevealRequest = { repository: string; alias: string };
/** Explicit renderer request; values never enter MCP, model requests, history, or logs. */
export type RepoSecretRenderMarkersRequest = { repository: string; text: string };

/** Typed channels. Exported for bootstrap registration wiring. */
export const ideMemoryChannels = {
  snapshot: bridge.buildProvider<IdeMemoryResult<SuperMemorySnapshot>, IdeMemoryRequest>(IDE_MEMORY_CHANNELS.snapshot),
  clear: bridge.buildProvider<IdeMemoryResult<boolean>, IdeMemoryRequest>(IDE_MEMORY_CHANNELS.clear),
  remember: bridge.buildProvider<IdeMemoryResult<RememberResult>, IdeMemoryRememberRequest>(
    IDE_MEMORY_CHANNELS.remember
  ),
  repoSecretList: bridge.buildProvider<IdeMemoryResult<RepoSecretContext[]>, RepoSecretListRequest>(
    IDE_MEMORY_CHANNELS.repoSecretList
  ),
  repoSecretScopes: bridge.buildProvider<IdeMemoryResult<RepoSecretScopeSummary[]>, RepoSecretScopesRequest>(
    IDE_MEMORY_CHANNELS.repoSecretScopes
  ),
  repoSecretSave: bridge.buildProvider<IdeMemoryResult<RepoSecretContext>, RepoSecretSaveRequest>(
    IDE_MEMORY_CHANNELS.repoSecretSave
  ),
  repoSecretDeclare: bridge.buildProvider<IdeMemoryResult<RepoSecretContext>, RepoSecretDeclareRequest>(
    IDE_MEMORY_CHANNELS.repoSecretDeclare
  ),
  repoSecretComboList: bridge.buildProvider<IdeMemoryResult<RepoSecretCombo[]>, RepoSecretListRequest>(
    IDE_MEMORY_CHANNELS.repoSecretComboList
  ),
  repoSecretComboSave: bridge.buildProvider<IdeMemoryResult<RepoSecretCombo>, RepoSecretComboSaveRequest>(
    IDE_MEMORY_CHANNELS.repoSecretComboSave
  ),
  repoSecretComboRemove: bridge.buildProvider<IdeMemoryResult<boolean>, RepoSecretComboRemoveRequest>(
    IDE_MEMORY_CHANNELS.repoSecretComboRemove
  ),
  repoSecretRemove: bridge.buildProvider<IdeMemoryResult<boolean>, RepoSecretRemoveRequest>(
    IDE_MEMORY_CHANNELS.repoSecretRemove
  ),
  repoSecretReveal: bridge.buildProvider<IdeMemoryResult<string>, RepoSecretRevealRequest>(
    IDE_MEMORY_CHANNELS.repoSecretReveal
  ),
  repoSecretRenderMarkers: bridge.buildProvider<
    IdeMemoryResult<RepoSecretMarkerRender>,
    RepoSecretRenderMarkersRequest
  >(IDE_MEMORY_CHANNELS.repoSecretRenderMarkers),
};

/**
 * Register the IDE session-memory IPC handlers. Idempotent. Intended to be
 * called once during Main-process bootstrap.
 */
export function registerIdeMemoryBridge(): void {
  ideMemoryChannels.snapshot.provider(async (req): Promise<IdeMemoryResult<SuperMemorySnapshot>> => {
    try {
      return { ok: true, data: getSessionMemoryStore().snapshot(req.sessionId) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.remember.provider(async (req): Promise<IdeMemoryResult<RememberResult>> => {
    try {
      const data = await getSessionMemoryStore().remember(req.sessionId, {
        text: req.text,
        kind: req.kind,
        pinned: req.pinned,
      });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.clear.provider(async (req): Promise<IdeMemoryResult<boolean>> => {
    try {
      getSessionMemoryStore().clearSession(req.sessionId);
      return { ok: true, data: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretList.provider(async (req): Promise<IdeMemoryResult<RepoSecretContext[]>> => {
    try {
      return { ok: true, data: await getRepoSecretStore().list(req.repository) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretScopes.provider(async (): Promise<IdeMemoryResult<RepoSecretScopeSummary[]>> => {
    try {
      return { ok: true, data: await getRepoSecretStore().listScopes() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretSave.provider(async (req): Promise<IdeMemoryResult<RepoSecretContext>> => {
    try {
      return { ok: true, data: await getRepoSecretStore().save(req.repository, req.alias, req.description, req.value) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretDeclare.provider(async (req): Promise<IdeMemoryResult<RepoSecretContext>> => {
    try {
      return { ok: true, data: await getRepoSecretStore().declare(req.repository, req.alias, req.description) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretComboList.provider(async (req): Promise<IdeMemoryResult<RepoSecretCombo[]>> => {
    try {
      return { ok: true, data: await getRepoSecretStore().listCombos(req.repository) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretComboSave.provider(async (req): Promise<IdeMemoryResult<RepoSecretCombo>> => {
    try {
      return { ok: true, data: await getRepoSecretStore().saveCombo(req.repository, req.combo) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretComboRemove.provider(async (req): Promise<IdeMemoryResult<boolean>> => {
    try {
      await getRepoSecretStore().removeCombo(req.repository, req.comboId);
      return { ok: true, data: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretRemove.provider(async (req): Promise<IdeMemoryResult<boolean>> => {
    try {
      await getRepoSecretStore().remove(req.repository, req.alias);
      return { ok: true, data: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretReveal.provider(async (req): Promise<IdeMemoryResult<string>> => {
    try {
      return { ok: true, data: await getRepoSecretStore().reveal(req.repository, req.alias) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ideMemoryChannels.repoSecretRenderMarkers.provider(async (req): Promise<IdeMemoryResult<RepoSecretMarkerRender>> => {
    try {
      return { ok: true, data: await getRepoSecretStore().renderMarkers(req.repository, req.text) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
