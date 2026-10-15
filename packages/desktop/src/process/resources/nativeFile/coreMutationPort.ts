/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Composition of the core workspace server's guarded mutation port from the team-edit service.
 *
 * Chat agents and IDE agents share one lease table per workspace, so a chat turn cannot overwrite
 * a file another agent is editing. Every byte is persisted through MTUI (backup, diff, undo), and
 * `editReplace` changes only the named region so several agents can work one file at once.
 */

import type {
  CoreMutationOutcome,
  CoreWorkspaceMutationPort,
} from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';

type TeamLease = { relPath: string; agentId: string; intent?: string };

/** The part of the team-edit service the core needs; kept structural so the core owns no package type. */
export type TeamMutationService = Readonly<{
  write: (
    rootPath: string,
    agentId: string,
    relPath: string,
    data: string
  ) => Promise<
    | { ok: true; bytes: number }
    | { ok: false; reason: 'held'; lease: TeamLease }
    | { ok: false; reason: 'error'; error: string }
  >;
  editReplace: (
    rootPath: string,
    agentId: string,
    relPath: string,
    oldText: string,
    newText: string
  ) => Promise<
    | { ok: true; matches: number }
    | { ok: false; reason: 'held'; lease: TeamLease }
    | { ok: false; reason: 'stale'; detail: string }
    | { ok: false; reason: 'ambiguous'; detail: string }
    | { ok: false; reason: 'error'; error: string }
  >;
}>;

const heldMessage = (lease: TeamLease, verb: string): string =>
  `CONFLICT: ${lease.relPath} is held by ${lease.agentId}${lease.intent ? ` (${lease.intent})` : ''}. ` +
  `The ${verb} was refused so that agent's work is not overwritten. Coordinate, or change a different file.`;

const fail = (message: string): CoreMutationOutcome => ({ ok: false, message });

/**
 * Agents share the human Explorer's block list: a write or edit whose resolved absolute target
 * lies inside a blocked tree is refused before any lease or MTUI work. The checker is
 * Main-owned (a shared `ExplorerBlockStore`), never supplied by the model.
 */
export type TeamMutationPortOptions = Readonly<{
  isBlocked?: (workspace: string, relPath: string) => Promise<boolean>;
}>;

const blockedMessage = (relPath: string): CoreMutationOutcome =>
  fail(
    `BLOCKED: ${relPath} is on the block list. The owner locked it against agent changes, so the ` +
      `write/edit was refused. Ask the owner to unblock it in the Explorer before trying again.`
  );

/** `getTeam` is resolved on every call so the port can be registered before the service exists. */
export const createTeamMutationPort = (
  getTeam: () => TeamMutationService,
  options: TeamMutationPortOptions = {}
): CoreWorkspaceMutationPort => ({
  write: async ({ workspace, agentId, relPath, content }) => {
    if (options.isBlocked && (await options.isBlocked(workspace, relPath))) return blockedMessage(relPath);
    const result = await getTeam().write(workspace, agentId, relPath, content);
    if (result.ok === true) return { ok: true, message: `Wrote ${relPath} (${result.bytes} bytes) via MTUI.` };
    if (result.reason === 'held') return fail(heldMessage(result.lease, 'write'));
    return fail(`Write failed: ${result.error}`);
  },
  editReplace: async ({ workspace, agentId, relPath, oldText, newText }) => {
    if (options.isBlocked && (await options.isBlocked(workspace, relPath))) return blockedMessage(relPath);
    const result = await getTeam().editReplace(workspace, agentId, relPath, oldText, newText);
    if (result.ok === true)
      return { ok: true, message: `Edited ${relPath} (${result.matches} match replaced) via MTUI.` };
    if (result.reason === 'held') return fail(heldMessage(result.lease, 'edit'));
    if (result.reason === 'stale') {
      return fail(
        `STALE: ${result.detail}\nThe text no longer matches (someone changed that region). Re-read the file, rebase your edit on the new content, then try again. Do not force it.`
      );
    }
    if (result.reason === 'ambiguous') {
      return fail(
        `AMBIGUOUS: ${result.detail}\noldText matches more than one place. Use a longer, unique anchor that includes surrounding lines.`
      );
    }
    return fail(`Edit failed: ${result.error}`);
  },
});
