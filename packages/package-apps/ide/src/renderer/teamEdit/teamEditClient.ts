/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer-safe client for the Agent Team Edit IPC surface.
 *
 * The Main-process bridge (`process/ide/teamEdit/teamEditBridge.ts`) imports
 * Node-only modules, so it must not be loaded in the renderer. Mirroring
 * `ideClient.ts`, this module re-declares the channel-name strings, rebuilds
 * matching `bridge.buildProvider` / `buildEmitter` handles, and borrows only
 * **types** via `import type`.
 *
 * Every invoke is timeout-guarded so an unregistered channel (bridge not wired)
 * rejects fast instead of leaving the panel spinning.
 *
 * Process boundary: Renderer module. No Node.js APIs.
 */

import { bridge } from '@office-ai/platform';
import type {
  TeamAppendPreviewFeedbackRequest,
  TeamChangedEnvelope,
  TeamClaimRequest,
  TeamClaimResult,
  TeamEditResult,
  TeamEditRequest,
  TeamGetPreviewRequest,
  TeamJoinRequest,
  TeamListPreviewFeedbackRequest,
  TeamPostMessageRequest,
  TeamPublishPreviewRequest,
  TeamReleaseRequest,
  TeamRemoveGroupRequest,
  TeamRemoveTaskRequest,
  TeamRootRequest,
  TeamSaveGroupRequest,
  TeamSaveTaskRequest,
  TeamWriteRequest,
} from '@package-apps/ide/process/collaboration/teamEdit/teamEditBridge';
import type {
  CreateViuPreviewFeedbackInput,
  CreateViuPreviewSnapshotInput,
  CreateViuTeamPreviewPackageInput,
  ViuPreviewFeedbackEvent,
  ViuProjectState,
  ViuTeamPreviewPackage,
} from '@/common/viu';
import type {
  GuardedEditResult,
  GuardedWriteResult,
  IdeTeamGroup,
  IdeTeamGroupInput,
  IdeTeamMessage,
  IdeTeamTask,
  IdeTeamTaskInput,
  TeamEditSnapshot,
} from '@package-apps/ide/process/collaboration/teamEdit/teamEditService';

/** Team-edit IPC channel names (mirror of the bridge channel consts). */
const TEAM_EDIT_CHANNELS = {
  snapshot: 'ide.team-snapshot',
  join: 'ide.team-join',
  claim: 'ide.team-claim',
  release: 'ide.team-release',
  reset: 'ide.team-reset',
  changed: 'ide.team-changed',
  write: 'ide.team-write',
  edit: 'ide.team-edit',
  saveTask: 'ide.team-task-save',
  removeTask: 'ide.team-task-remove',
  saveGroup: 'ide.team-group-save',
  removeGroup: 'ide.team-group-remove',
  postMessage: 'ide.team-message-post',
  publishPreview: 'ide.team-preview-publish',
  listPreviews: 'ide.team-preview-list',
  getPreview: 'ide.team-preview-get',
  appendPreviewFeedback: 'ide.team-preview-feedback-append',
  listPreviewFeedback: 'ide.team-preview-feedback-list',
} as const;

/** Timeout (ms) for a team-edit IPC round-trip (in-memory; fast). */
const TEAM_OP_TIMEOUT_MS = 10000;

/** Raw typed invokers. */
const channels = {
  snapshot: bridge.buildProvider<TeamEditResult<TeamEditSnapshot>, TeamRootRequest>(TEAM_EDIT_CHANNELS.snapshot),
  join: bridge.buildProvider<TeamEditResult<boolean>, TeamJoinRequest>(TEAM_EDIT_CHANNELS.join),
  claim: bridge.buildProvider<TeamEditResult<TeamClaimResult>, TeamClaimRequest>(TEAM_EDIT_CHANNELS.claim),
  release: bridge.buildProvider<TeamEditResult<boolean>, TeamReleaseRequest>(TEAM_EDIT_CHANNELS.release),
  reset: bridge.buildProvider<TeamEditResult<boolean>, TeamRootRequest>(TEAM_EDIT_CHANNELS.reset),
  changed: bridge.buildEmitter<TeamChangedEnvelope>(TEAM_EDIT_CHANNELS.changed),
  write: bridge.buildProvider<TeamEditResult<GuardedWriteResult>, TeamWriteRequest>(TEAM_EDIT_CHANNELS.write),
  edit: bridge.buildProvider<TeamEditResult<GuardedEditResult>, TeamEditRequest>(TEAM_EDIT_CHANNELS.edit),
  saveTask: bridge.buildProvider<TeamEditResult<IdeTeamTask>, TeamSaveTaskRequest>(TEAM_EDIT_CHANNELS.saveTask),
  removeTask: bridge.buildProvider<TeamEditResult<boolean>, TeamRemoveTaskRequest>(TEAM_EDIT_CHANNELS.removeTask),
  saveGroup: bridge.buildProvider<TeamEditResult<IdeTeamGroup>, TeamSaveGroupRequest>(TEAM_EDIT_CHANNELS.saveGroup),
  removeGroup: bridge.buildProvider<TeamEditResult<boolean>, TeamRemoveGroupRequest>(TEAM_EDIT_CHANNELS.removeGroup),
  postMessage: bridge.buildProvider<TeamEditResult<IdeTeamMessage>, TeamPostMessageRequest>(
    TEAM_EDIT_CHANNELS.postMessage
  ),
  publishPreview: bridge.buildProvider<TeamEditResult<ViuTeamPreviewPackage>, TeamPublishPreviewRequest>(
    TEAM_EDIT_CHANNELS.publishPreview
  ),
  listPreviews: bridge.buildProvider<TeamEditResult<readonly ViuTeamPreviewPackage[]>, TeamRootRequest>(
    TEAM_EDIT_CHANNELS.listPreviews
  ),
  getPreview: bridge.buildProvider<TeamEditResult<ViuTeamPreviewPackage>, TeamGetPreviewRequest>(
    TEAM_EDIT_CHANNELS.getPreview
  ),
  appendPreviewFeedback: bridge.buildProvider<
    TeamEditResult<ViuPreviewFeedbackEvent>,
    TeamAppendPreviewFeedbackRequest
  >(TEAM_EDIT_CHANNELS.appendPreviewFeedback),
  listPreviewFeedback: bridge.buildProvider<
    TeamEditResult<readonly ViuPreviewFeedbackEvent[]>,
    TeamListPreviewFeedbackRequest
  >(TEAM_EDIT_CHANNELS.listPreviewFeedback),
};

/** Opaque local reference: contains only a package id, never a path, password, or token. */
export const createViuLocalTestReference = (packageId: string): string => {
  const id = packageId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new Error('Preview package id must be an opaque identifier.');
  }
  return 'viu-preview://team-test/' + encodeURIComponent(id);
};

/** Error thrown when a team-edit IPC call does not reply within its budget. */
export class TeamEditTimeoutError extends Error {
  constructor(channel: string, timeoutMs: number) {
    super(`[teamEditClient] No reply on "${channel}" after ${Math.round(timeoutMs / 1000)}s.`);
    this.name = 'TeamEditTimeoutError';
  }
}

/** Race an `invoke` against a timeout so an unregistered channel rejects fast. */
const invokeWithTimeout = <T>(channel: string, call: () => Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new TeamEditTimeoutError(channel, timeoutMs));
    }, timeoutMs);
    call().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });

/** Timeout-guarded team-edit invokers for the renderer. */
export const teamEditClient = {
  /** Read a point-in-time snapshot of the workspace's team-edit state. */
  snapshot: (rootPath: string): Promise<TeamEditResult<TeamEditSnapshot>> =>
    invokeWithTimeout(TEAM_EDIT_CHANNELS.snapshot, () => channels.snapshot.invoke({ rootPath }), TEAM_OP_TIMEOUT_MS),
  /** Register / refresh the human user as a participant. */
  join: (rootPath: string, agentId: string, label: string): Promise<TeamEditResult<boolean>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.join,
      () => channels.join.invoke({ rootPath, agentId, label, isUser: true }),
      TEAM_OP_TIMEOUT_MS
    ),
  /** Claim / renew a lease from the UI (the user's manual grab). */
  claim: (
    rootPath: string,
    agentId: string,
    relPath: string,
    intent?: string
  ): Promise<TeamEditResult<TeamClaimResult>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.claim,
      () => channels.claim.invoke({ rootPath, agentId, relPath, intent }),
      TEAM_OP_TIMEOUT_MS
    ),
  /** Release a lease the user holds. */
  release: (rootPath: string, agentId: string, relPath: string): Promise<TeamEditResult<boolean>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.release,
      () => channels.release.invoke({ rootPath, agentId, relPath }),
      TEAM_OP_TIMEOUT_MS
    ),
  /** Drop the whole workspace session (folder closed). */
  reset: (rootPath: string): Promise<TeamEditResult<boolean>> =>
    invokeWithTimeout(TEAM_EDIT_CHANNELS.reset, () => channels.reset.invoke({ rootPath }), TEAM_OP_TIMEOUT_MS),
  /** Write a file on behalf of an agent through the guarded MTUI team-edit path. */
  write: (
    rootPath: string,
    agentId: string,
    relPath: string,
    data: string
  ): Promise<TeamEditResult<GuardedWriteResult>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.write,
      () => channels.write.invoke({ rootPath, agentId, relPath, data }),
      TEAM_OP_TIMEOUT_MS
    ),
  /** Replace exact text on behalf of an agent through the guarded MTUI team-edit path. */
  edit: (
    rootPath: string,
    agentId: string,
    relPath: string,
    oldText: string,
    newText: string
  ): Promise<TeamEditResult<GuardedEditResult>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.edit,
      () => channels.edit.invoke({ rootPath, agentId, relPath, oldText, newText }),
      TEAM_OP_TIMEOUT_MS
    ),
  saveTask: (rootPath: string, task: IdeTeamTaskInput): Promise<TeamEditResult<IdeTeamTask>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.saveTask,
      () => channels.saveTask.invoke({ rootPath, task }),
      TEAM_OP_TIMEOUT_MS
    ),
  removeTask: (rootPath: string, taskId: string): Promise<TeamEditResult<boolean>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.removeTask,
      () => channels.removeTask.invoke({ rootPath, taskId }),
      TEAM_OP_TIMEOUT_MS
    ),
  saveGroup: (rootPath: string, group: IdeTeamGroupInput): Promise<TeamEditResult<IdeTeamGroup>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.saveGroup,
      () => channels.saveGroup.invoke({ rootPath, group }),
      TEAM_OP_TIMEOUT_MS
    ),
  removeGroup: (rootPath: string, groupId: string): Promise<TeamEditResult<boolean>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.removeGroup,
      () => channels.removeGroup.invoke({ rootPath, groupId }),
      TEAM_OP_TIMEOUT_MS
    ),
  postMessage: (
    rootPath: string,
    senderId: string,
    body: string,
    taskId?: string | null
  ): Promise<TeamEditResult<IdeTeamMessage>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.postMessage,
      () => channels.postMessage.invoke({ rootPath, senderId, body, taskId }),
      TEAM_OP_TIMEOUT_MS
    ),
  publishPreview: (
    rootPath: string,
    state: ViuProjectState,
    snapshot: CreateViuPreviewSnapshotInput,
    share: CreateViuTeamPreviewPackageInput
  ): Promise<TeamEditResult<ViuTeamPreviewPackage>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.publishPreview,
      () => channels.publishPreview.invoke({ rootPath, state, snapshot, share }),
      TEAM_OP_TIMEOUT_MS
    ),
  listPreviews: (rootPath: string): Promise<TeamEditResult<readonly ViuTeamPreviewPackage[]>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.listPreviews,
      () => channels.listPreviews.invoke({ rootPath }),
      TEAM_OP_TIMEOUT_MS
    ),
  getPreview: (
    rootPath: string,
    packageId: string,
    consumer: 'user-preview' | 'agent-preview'
  ): Promise<TeamEditResult<ViuTeamPreviewPackage>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.getPreview,
      () => channels.getPreview.invoke({ rootPath, packageId, consumer }),
      TEAM_OP_TIMEOUT_MS
    ),
  appendPreviewFeedback: (
    rootPath: string,
    packageId: string,
    feedback: CreateViuPreviewFeedbackInput
  ): Promise<TeamEditResult<ViuPreviewFeedbackEvent>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.appendPreviewFeedback,
      () => channels.appendPreviewFeedback.invoke({ rootPath, packageId, feedback }),
      TEAM_OP_TIMEOUT_MS
    ),
  listPreviewFeedback: (
    rootPath: string,
    packageId: string
  ): Promise<TeamEditResult<readonly ViuPreviewFeedbackEvent[]>> =>
    invokeWithTimeout(
      TEAM_EDIT_CHANNELS.listPreviewFeedback,
      () => channels.listPreviewFeedback.invoke({ rootPath, packageId }),
      TEAM_OP_TIMEOUT_MS
    ),
  /** Subscribe to live snapshot pushes (Main → renderer). Returns an unsubscribe fn. */
  onChanged: (listener: (snapshot: TeamEditSnapshot) => void): (() => void) =>
    channels.changed.on((envelope) => listener(envelope.snapshot)),
};

export type {
  GuardedEditResult,
  GuardedWriteResult,
  IdeTeamGroup,
  IdeTeamGroupInput,
  IdeTeamMessage,
  IdeTeamTask,
  IdeTeamTaskInput,
  IdeTeamTaskStatus,
  TeamEditSnapshot,
} from '@package-apps/ide/process/collaboration/teamEdit/teamEditService';
export type { CreateViuPreviewFeedbackInput, ViuPreviewFeedbackEvent, ViuTeamPreviewPackage } from '@/common/viu';
export type {
  FileLease,
  TeamActivity,
  TeamParticipant,
} from '@package-apps/ide/process/collaboration/teamEdit/teamEditCoordinator';
export type { TeamClaimResult } from '@package-apps/ide/process/collaboration/teamEdit/teamEditBridge';
