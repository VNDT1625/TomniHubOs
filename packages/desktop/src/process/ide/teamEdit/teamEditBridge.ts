/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent Team Edit IPC bridge — the renderer-facing surface of the per-workspace
 * {@link getTeamEditService}.
 *
 * The IDE "Team" panel shows WHO (agents + the user) is working on the open
 * folder and WHICH files each one currently holds (an advisory lease), plus a
 * live activity feed. The same service backs the agent-facing MCP tools
 * (`team_*` on `tomny-ide`), so an agent claiming a file and the panel showing
 * that claim hit ONE source of truth.
 *
 * Channels (always-resolving envelopes so a renderer await never hangs):
 *  - `ide.team-snapshot` — point-in-time view (participants + leases + activity).
 *  - `ide.team-join`     — register/refresh the human user as a participant.
 *  - `ide.team-claim`    — claim/renew a lease (used by the panel's manual grab).
 *  - `ide.team-release`  — drop a lease the user holds.
 *  - `ide.team-reset`    — drop the whole workspace session (folder closed).
 *  - `ide.team-changed`  — emitter: pushes a fresh snapshot on every change.
 *
 * The global bootstrap calls {@link registerTeamEditBridge} once.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { bridge } from '@office-ai/platform';
import type {
  CreateViuPreviewFeedbackInput,
  CreateViuPreviewSnapshotInput,
  CreateViuTeamPreviewPackageInput,
  ViuPreviewFeedbackEvent,
  ViuProjectState,
  ViuTeamPreviewPackage,
} from '@/common/viu';
import {
  getTeamEditService,
  setTeamEditChangeListener,
  type FileLease,
  type GuardedEditResult,
  type GuardedWriteResult,
  type IdeTeamGroup,
  type IdeTeamGroupInput,
  type IdeTeamMessage,
  type IdeTeamTask,
  type IdeTeamTaskInput,
  type TeamEditSnapshot,
} from './teamEditService';

/** IPC channel names for the team-edit surface (renderer-safe contract). */
export const TEAM_EDIT_CHANNELS = {
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

/** Always-resolving result envelope. */
export type TeamEditResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Request carrying just the workspace root. */
export type TeamRootRequest = { rootPath: string };

/** Request to register the human user as a participant. */
export type TeamJoinRequest = { rootPath: string; agentId: string; label: string; isUser?: boolean };

/** Request to claim / renew a lease from the UI. */
export type TeamClaimRequest = { rootPath: string; agentId: string; relPath: string; intent?: string };

/** Request to release a lease from the UI. */
export type TeamReleaseRequest = { rootPath: string; agentId: string; relPath: string };

/** Request to write a file through the guarded team-edit service. */
export type TeamWriteRequest = { rootPath: string; agentId: string; relPath: string; data: string };

/** Request to replace exact text through the guarded team-edit service. */
export type TeamEditRequest = { rootPath: string; agentId: string; relPath: string; oldText: string; newText: string };
export type TeamSaveTaskRequest = { rootPath: string; task: IdeTeamTaskInput };
export type TeamRemoveTaskRequest = { rootPath: string; taskId: string };
export type TeamSaveGroupRequest = { rootPath: string; group: IdeTeamGroupInput };
export type TeamRemoveGroupRequest = { rootPath: string; groupId: string };
export type TeamPostMessageRequest = { rootPath: string; senderId: string; body: string; taskId?: string | null };

export type TeamPublishPreviewRequest = {
  rootPath: string;
  state: ViuProjectState;
  snapshot: CreateViuPreviewSnapshotInput;
  share: CreateViuTeamPreviewPackageInput;
};
export type TeamGetPreviewRequest = {
  rootPath: string;
  packageId: string;
  consumer: 'user-preview' | 'agent-preview';
};
export type TeamAppendPreviewFeedbackRequest = {
  rootPath: string;
  packageId: string;
  feedback: CreateViuPreviewFeedbackInput;
};
export type TeamListPreviewFeedbackRequest = { rootPath: string; packageId: string };

/** Claim result shape returned to the renderer. */
export type TeamClaimResult =
  | { ok: true; lease: FileLease; renewed: boolean }
  | { ok: false; reason: 'held'; lease: FileLease };

/** Envelope wrapping a snapshot for the `changed` emitter (avoids union collapse). */
export type TeamChangedEnvelope = { snapshot: TeamEditSnapshot };

/** Typed channels. Exported for bootstrap registration wiring. */
export const teamEditChannels = {
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

/**
 * Register the team-edit IPC handlers. Idempotent. Intended to be called once
 * during Main-process bootstrap. Wires the service's change listener to the
 * `changed` emitter so the renderer gets a live snapshot on every mutation.
 */
export function registerTeamEditBridge(): void {
  // Push every service-side change out to the renderer as a fresh snapshot.
  setTeamEditChangeListener((snapshot) => teamEditChannels.changed.emit({ snapshot }));
  const service = getTeamEditService();

  teamEditChannels.snapshot.provider(async (req): Promise<TeamEditResult<TeamEditSnapshot>> => {
    try {
      return { ok: true, data: service.snapshot(req.rootPath) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.join.provider(async (req): Promise<TeamEditResult<boolean>> => {
    try {
      service.join(req.rootPath, req.agentId, req.label, req.isUser);
      return { ok: true, data: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.claim.provider(async (req): Promise<TeamEditResult<TeamClaimResult>> => {
    try {
      return { ok: true, data: service.claim(req.rootPath, req.agentId, req.relPath, req.intent) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.release.provider(async (req): Promise<TeamEditResult<boolean>> => {
    try {
      return { ok: true, data: service.release(req.rootPath, req.agentId, req.relPath) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.reset.provider(async (req): Promise<TeamEditResult<boolean>> => {
    try {
      service.reset(req.rootPath);
      return { ok: true, data: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.write.provider(async (req): Promise<TeamEditResult<GuardedWriteResult>> => {
    try {
      return { ok: true, data: await service.write(req.rootPath, req.agentId, req.relPath, req.data) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.edit.provider(async (req): Promise<TeamEditResult<GuardedEditResult>> => {
    try {
      return {
        ok: true,
        data: await service.editReplace(req.rootPath, req.agentId, req.relPath, req.oldText, req.newText),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.saveTask.provider(async (req): Promise<TeamEditResult<IdeTeamTask>> => {
    try {
      return { ok: true, data: service.saveTask(req.rootPath, req.task) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.removeTask.provider(async (req): Promise<TeamEditResult<boolean>> => {
    try {
      return { ok: true, data: service.removeTask(req.rootPath, req.taskId) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.saveGroup.provider(async (req): Promise<TeamEditResult<IdeTeamGroup>> => {
    try {
      return { ok: true, data: service.saveGroup(req.rootPath, req.group) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.removeGroup.provider(async (req): Promise<TeamEditResult<boolean>> => {
    try {
      return { ok: true, data: service.removeGroup(req.rootPath, req.groupId) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.publishPreview.provider(async (req): Promise<TeamEditResult<ViuTeamPreviewPackage>> => {
    try {
      return { ok: true, data: service.publishPreview(req.rootPath, req.state, req.snapshot, req.share) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.listPreviews.provider(async (req): Promise<TeamEditResult<readonly ViuTeamPreviewPackage[]>> => {
    try {
      return { ok: true, data: service.listPreviews(req.rootPath) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.getPreview.provider(async (req): Promise<TeamEditResult<ViuTeamPreviewPackage>> => {
    try {
      return { ok: true, data: service.getPreview(req.rootPath, req.packageId, req.consumer) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.appendPreviewFeedback.provider(async (req): Promise<TeamEditResult<ViuPreviewFeedbackEvent>> => {
    try {
      return {
        ok: true,
        data: service.appendPreviewFeedback(req.rootPath, req.packageId, req.feedback),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  teamEditChannels.listPreviewFeedback.provider(
    async (req): Promise<TeamEditResult<readonly ViuPreviewFeedbackEvent[]>> => {
      try {
        return { ok: true, data: service.listPreviewFeedback(req.rootPath, req.packageId) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  teamEditChannels.postMessage.provider(async (req): Promise<TeamEditResult<IdeTeamMessage>> => {
    try {
      return { ok: true, data: service.postMessage(req.rootPath, req.senderId, req.body, req.taskId) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
