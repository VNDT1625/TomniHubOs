/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `teamEditService` — the Main-process service that turns the pure
 * {@link TeamEditCoordinator} into a usable Agent Team Edit feature.
 *
 * Responsibilities:
 *  - keep ONE coordinator per workspace root (so two projects don't share
 *    leases), creating it lazily;
 *  - perform the actual **guarded write**: check the lease, then write through
 *    the MTUI gateway ({@link writeTextFileWithMtui}) so every team edit is
 *    backed-up / undoable exactly like the IDE's own writes;
 *  - notify a listener whenever presence / leases / activity change, so the
 *    bridge can push a live snapshot to the renderer.
 *
 * The coordinator stays pure; this layer owns the side effects (fs via MTUI,
 * change notifications). The MTUI writer is injected so the service is
 * unit-testable without spawning the real CLI.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import {
  createViuPreCodeReviewService,
  type CreateViuPreviewFeedbackInput,
  type CreateViuPreviewSnapshotInput,
  type CreateViuTeamPreviewPackageInput,
  type ViuPreCodeReviewArchive,
  type ViuPreviewFeedbackEvent,
  type ViuProjectState,
  type ViuTeamPreviewPackage,
} from '@/common/viu';
import { editReplaceWithMtui, writeTextFileWithMtui, type MtuiResponse } from '@process/terminal/mtuiBridge';
import { getDataPath } from '@process/utils/utils';
import {
  createTeamEditCoordinator,
  normalizeRelPath,
  type FileLease,
  type TeamActivity,
  type TeamEditCoordinator,
  type TeamParticipant,
} from './teamEditCoordinator';

// Re-export so consumers (the bridge, the remote client) can borrow these types
// from the service module without reaching into the coordinator.
export type { FileLease, TeamActivity, TeamParticipant } from './teamEditCoordinator';

export type IdeTeamTaskStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type IdeTeamTaskScope = 'personal' | 'group';

export type IdeTeamGroup = {
  id: string;
  name: string;
  parentGroupId: string | null;
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type IdeTeamTask = {
  id: string;
  title: string;
  description: string;
  scope: IdeTeamTaskScope;
  groupId: string | null;
  parentTaskId: string | null;
  creatorId: string;
  assigneeId: string | null;
  pinnedAgentId: string | null;
  status: IdeTeamTaskStatus;
  createdAt: number;
  updatedAt: number;
};

export type IdeTeamMessage = {
  id: string;
  senderId: string;
  body: string;
  taskId: string | null;
  createdAt: number;
};

export type IdeTeamTaskInput = Omit<IdeTeamTask, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export type IdeTeamGroupInput = Omit<IdeTeamGroup, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

/** A point-in-time view of one workspace's team-edit state (pushed to the UI). */
export type TeamEditSnapshot = {
  /** Absolute workspace root this snapshot belongs to. */
  rootPath: string;
  /** Everyone currently in the session. */
  participants: TeamParticipant[];
  /** Every live (non-expired) file lease. */
  leases: FileLease[];
  /** The tail of the activity feed (newest last). */
  activity: TeamActivity[];
  /** Nested organization groups for this workspace. */
  groups: IdeTeamGroup[];
  /** Personal and group tasks visible to the workspace. */
  tasks: IdeTeamTask[];
  /** Workspace communication messages. */
  messages: IdeTeamMessage[];
};

/** Result of a guarded write attempt. */
export type GuardedWriteResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: 'held'; lease: FileLease }
  | { ok: false; reason: 'error'; error: string };

/**
 * Result of an anchor-based collaborative edit (`team_edit_file`).
 *
 * - `ok` — the replacement landed.
 * - `held` — another agent holds the file's lease (refused before touching disk).
 * - `stale` — the anchor text no longer matches (someone changed that region
 *   since the agent read it) OR MTUI blocked an overlapping concurrent edit;
 *   the agent must re-read and rebase. `detail` carries MTUI's guidance.
 * - `ambiguous` — the anchor matches multiple places; the agent must use a
 *   longer, unique anchor.
 * - `error` — any other failure (parsed from MTUI).
 */
export type GuardedEditResult =
  | { ok: true; matches: number }
  | { ok: false; reason: 'held'; lease: FileLease }
  | { ok: false; reason: 'stale'; detail: string }
  | { ok: false; reason: 'ambiguous'; detail: string }
  | { ok: false; reason: 'error'; error: string };

export type TeamPreviewPersistence = {
  load: (rootPath: string) => ViuPreCodeReviewArchive | undefined;
  save: (rootPath: string, archive: ViuPreCodeReviewArchive) => void;
};

const isPreviewArchive = (value: unknown): value is ViuPreCodeReviewArchive => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    Array.isArray(record.packages) &&
    Boolean(record.feedback) &&
    typeof record.feedback === 'object'
  );
};

/** Atomic machine-local persistence for immutable Team preview packages and feedback. */
export const createTeamPreviewFilePersistence = (directory?: string): TeamPreviewPersistence => {
  const resolveDirectory = (): string => directory ?? path.join(getDataPath(), 'viu-team-previews');
  const filePath = (rootPath: string): string => {
    const key = createHash('sha256').update(path.resolve(rootPath)).digest('hex');
    return path.join(resolveDirectory(), `${key}.json`);
  };
  return {
    load: (rootPath) => {
      const target = filePath(rootPath);
      if (!existsSync(target)) return undefined;
      const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'));
      if (!isPreviewArchive(parsed)) throw new Error('The stored VIU Team preview archive is invalid.');
      return parsed;
    },
    save: (rootPath, archive) => {
      const target = filePath(rootPath);
      mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(archive), { encoding: 'utf8', mode: 0o600 });
        renameSync(temporary, target);
      } finally {
        rmSync(temporary, { force: true });
      }
    },
  };
};

/** Injected collaborators for {@link createTeamEditService}. */
export type TeamEditServiceDeps = {
  /** MTUI-backed text writer (diff/undo). Defaults to the real {@link writeTextFileWithMtui}. */
  writeFile?: (filePath: string, data: string) => Promise<MtuiResponse>;
  /**
   * MTUI anchor-based editor (the collaborative-edit primitive). Defaults to the
   * real {@link editReplaceWithMtui}. Injected so tests need no CLI.
   */
  editReplace?: (filePath: string, oldText: string, newText: string) => Promise<MtuiResponse>;
  /** Lease TTL passed to each per-workspace coordinator. */
  leaseTtlMs?: number;
  /** Notified after any state change for `rootPath`, with a fresh snapshot. */
  onChange?: (snapshot: TeamEditSnapshot) => void;
  /** Time source forwarded to coordinators (tests). */
  now?: () => number;
  /** Optional durable storage. The production singleton uses a machine-local atomic JSON archive. */
  previewPersistence?: TeamPreviewPersistence;
};

/** The team-edit service surface (per-workspace coordination + guarded writes). */
export type TeamEditService = {
  /** Register / refresh a participant in a workspace. */
  join: (rootPath: string, agentId: string, label: string, isUser?: boolean) => TeamParticipant;
  /** Claim (or renew) a file lease. Returns the holder on conflict. */
  claim: (
    rootPath: string,
    agentId: string,
    relPath: string,
    intent?: string
  ) => { ok: true; lease: FileLease; renewed: boolean } | { ok: false; reason: 'held'; lease: FileLease };
  /** Renew an agent's leases + presence. */
  heartbeat: (rootPath: string, agentId: string) => void;
  /** Release one lease. */
  release: (rootPath: string, agentId: string, relPath: string) => boolean;
  /** Release every lease an agent holds (its tab closed / it finished). */
  releaseAll: (rootPath: string, agentId: string) => void;
  /**
   * Write a file ON BEHALF of an agent, guarded by the lease: if another agent
   * holds the file the write is refused (returns the holder); otherwise the
   * writer's lease is auto-acquired/renewed and the bytes are written via MTUI.
   */
  write: (rootPath: string, agentId: string, relPath: string, data: string) => Promise<GuardedWriteResult>;
  /**
   * Collaboratively edit a file by replacing an EXACT anchor text, guarded by
   * the lease AND by MTUI's anchor/stale-edit checks. Two agents editing
   * DIFFERENT anchors of the same file both succeed; a stale or ambiguous anchor
   * is refused (no clobber). This is the recommended primitive for several
   * agents working the SAME file at once.
   */
  editReplace: (
    rootPath: string,
    agentId: string,
    relPath: string,
    oldText: string,
    newText: string
  ) => Promise<GuardedEditResult>;
  /** Create or update a workspace task. */
  saveTask: (rootPath: string, input: IdeTeamTaskInput) => IdeTeamTask;
  /** Remove a task and every descendant task. */
  removeTask: (rootPath: string, taskId: string) => boolean;
  /** Create or update a nested workspace group. */
  saveGroup: (rootPath: string, input: IdeTeamGroupInput) => IdeTeamGroup;
  /** Remove a group and its descendants; affected tasks become ungrouped. */
  removeGroup: (rootPath: string, groupId: string) => boolean;
  /** Add a message to workspace communication. */
  postMessage: (rootPath: string, senderId: string, body: string, taskId?: string | null) => IdeTeamMessage;
  /** Register one immutable VIU snapshot for local Team testing. */
  publishPreview: (
    rootPath: string,
    state: ViuProjectState,
    snapshot: CreateViuPreviewSnapshotInput,
    share: CreateViuTeamPreviewPackageInput
  ) => ViuTeamPreviewPackage;
  /** List immutable VIU packages registered in this workspace. */
  listPreviews: (rootPath: string) => readonly ViuTeamPreviewPackage[];
  /** Open the exact package shared by both user and agent preview consumers. */
  getPreview: (
    rootPath: string,
    packageId: string,
    consumer: 'user-preview' | 'agent-preview'
  ) => ViuTeamPreviewPackage;
  /** Append feedback anchored to the package's immutable snapshot. */
  appendPreviewFeedback: (
    rootPath: string,
    packageId: string,
    input: CreateViuPreviewFeedbackInput
  ) => ViuPreviewFeedbackEvent;
  /** List append-only feedback for one immutable package. */
  listPreviewFeedback: (rootPath: string, packageId: string) => readonly ViuPreviewFeedbackEvent[];
  /** A fresh snapshot of a workspace's team-edit state. */
  snapshot: (rootPath: string) => TeamEditSnapshot;
  /** Drop a workspace's coordinator entirely (folder closed). */
  reset: (rootPath: string) => void;
};

/** Resolve an absolute path from a workspace root + a (possibly relative) path. */
const resolveAbs = (rootPath: string, relPath: string): string => {
  // Check the ORIGINAL path for absoluteness — normalizeRelPath strips the
  // leading slash, which would otherwise make an absolute path look relative
  // and get joined onto the root twice.
  if (path.isAbsolute(relPath)) return relPath;
  return path.join(rootPath, normalizeRelPath(relPath));
};

/** Make a path workspace-relative (forward-slash) when it sits under the root. */
const toRel = (rootPath: string, filePath: string): string => {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
  const rel = path.relative(rootPath, abs);
  return normalizeRelPath(rel.startsWith('..') ? filePath : rel);
};

/**
 * Create a {@link TeamEditService}. Coordinators are created per workspace on
 * first use; the MTUI writer + clock are injected so the service is testable.
 */
export const createTeamEditService = (deps: TeamEditServiceDeps = {}): TeamEditService => {
  const writeFile = deps.writeFile ?? writeTextFileWithMtui;
  const editReplaceFile = deps.editReplace ?? editReplaceWithMtui;
  const coordinators = new Map<string, TeamEditCoordinator>();
  const workspaceData = new Map<
    string,
    {
      groups: IdeTeamGroup[];
      tasks: IdeTeamTask[];
      messages: IdeTeamMessage[];
      previewReview: ReturnType<typeof createViuPreCodeReviewService>;
    }
  >();

  const dataFor = (rootPath: string) => {
    let data = workspaceData.get(rootPath);
    if (!data) {
      let previewReview: ReturnType<typeof createViuPreCodeReviewService>;
      try {
        previewReview = createViuPreCodeReviewService(deps.previewPersistence?.load(rootPath));
      } catch (error) {
        console.error('[teamEditService] Ignoring an invalid VIU preview archive:', error);
        previewReview = createViuPreCodeReviewService();
      }
      data = { groups: [], tasks: [], messages: [], previewReview };
      workspaceData.set(rootPath, data);
    }
    return data;
  };

  const mutatePreviewReview = <T>(
    rootPath: string,
    mutation: (review: ReturnType<typeof createViuPreCodeReviewService>) => T
  ): T => {
    const data = dataFor(rootPath);
    if (!deps.previewPersistence) return mutation(data.previewReview);
    const candidate = createViuPreCodeReviewService(data.previewReview.exportArchive());
    const result = mutation(candidate);
    deps.previewPersistence.save(rootPath, candidate.exportArchive());
    data.previewReview = candidate;
    return result;
  };

  const coordinatorFor = (rootPath: string): TeamEditCoordinator => {
    let c = coordinators.get(rootPath);
    if (!c) {
      c = createTeamEditCoordinator({ now: deps.now, leaseTtlMs: deps.leaseTtlMs });
      coordinators.set(rootPath, c);
    }
    return c;
  };

  const snapshot = (rootPath: string): TeamEditSnapshot => {
    const c = coordinatorFor(rootPath);
    const data = dataFor(rootPath);
    return {
      rootPath,
      participants: c.listParticipants(),
      leases: c.listLeases(),
      activity: c.listActivity(50),
      groups: structuredClone(data.groups),
      tasks: structuredClone(data.tasks),
      messages: structuredClone(data.messages),
    };
  };

  const emitChange = (rootPath: string): void => {
    if (deps.onChange) deps.onChange(snapshot(rootPath));
  };

  const join = (rootPath: string, agentId: string, label: string, isUser = false): TeamParticipant => {
    const participant = coordinatorFor(rootPath).join(agentId, label, isUser);
    emitChange(rootPath);
    return participant;
  };

  const claim = (
    rootPath: string,
    agentId: string,
    relPath: string,
    intent?: string
  ): { ok: true; lease: FileLease; renewed: boolean } | { ok: false; reason: 'held'; lease: FileLease } => {
    const result = coordinatorFor(rootPath).claim(agentId, toRel(rootPath, relPath), intent);
    emitChange(rootPath);
    return result;
  };

  const heartbeat = (rootPath: string, agentId: string): void => {
    coordinatorFor(rootPath).heartbeat(agentId);
    emitChange(rootPath);
  };

  const release = (rootPath: string, agentId: string, relPath: string): boolean => {
    const released = coordinatorFor(rootPath).release(agentId, toRel(rootPath, relPath));
    if (released) emitChange(rootPath);
    return released;
  };

  const releaseAll = (rootPath: string, agentId: string): void => {
    coordinatorFor(rootPath).releaseAll(agentId);
    emitChange(rootPath);
  };

  const write = async (
    rootPath: string,
    agentId: string,
    relPath: string,
    data: string
  ): Promise<GuardedWriteResult> => {
    const c = coordinatorFor(rootPath);
    const rel = toRel(rootPath, relPath);
    // ATOMIC GUARD: acquire (or renew) the lease SYNCHRONOUSLY before the await.
    // `canWrite` alone is a TOCTOU hole — two agents writing the SAME unclaimed
    // file would both pass the check (no lease yet) and clobber each other,
    // because the lease was only recorded AFTER the async write. Claiming first
    // closes the window: the second concurrent writer sees the first's lease and
    // is refused. `claim` returns a conflict iff another agent already holds it.
    const claimed = c.claim(agentId, rel, `${data.length} bytes`);
    if (!claimed.ok) {
      c.noteConflict(agentId, rel, claimed.lease);
      emitChange(rootPath);
      return { ok: false, reason: 'held', lease: claimed.lease };
    }
    // Whether THIS call first acquired the lease (so we can release it if the
    // write fails and the agent had no prior hold — don't leave a lease behind
    // for a write that never landed).
    const newlyAcquired = !claimed.renewed;
    emitChange(rootPath);
    try {
      const result = await writeFile(resolveAbs(rootPath, relPath), data);
      if (!result.ok) {
        if (newlyAcquired) c.release(agentId, rel);
        emitChange(rootPath);
        return { ok: false, reason: 'error', error: String(result.message ?? 'MTUI write failed') };
      }
      c.noteWrite(agentId, rel, `${data.length} bytes`);
      emitChange(rootPath);
      return { ok: true, bytes: data.length };
    } catch (error) {
      if (newlyAcquired) c.release(agentId, rel);
      emitChange(rootPath);
      return { ok: false, reason: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  };

  /**
   * Collaborative anchor-based edit: replace an exact `oldText` with `newText`,
   * guarded by the lease AND by MTUI's own concurrency engine. Two agents
   * editing DIFFERENT regions of the SAME file both succeed (MTUI merges by
   * line/symbol); a stale anchor or an overlapping concurrent edit is refused
   * (the agent must re-read + rebase) rather than clobbering.
   */
  const editReplace = async (
    rootPath: string,
    agentId: string,
    relPath: string,
    oldText: string,
    newText: string
  ): Promise<GuardedEditResult> => {
    const c = coordinatorFor(rootPath);
    const rel = toRel(rootPath, relPath);
    // Same atomic lease guard as `write`: claim synchronously before any await.
    const claimed = c.claim(agentId, rel, 'edit');
    if (!claimed.ok) {
      c.noteConflict(agentId, rel, claimed.lease);
      emitChange(rootPath);
      return { ok: false, reason: 'held', lease: claimed.lease };
    }
    const newlyAcquired = !claimed.renewed;
    emitChange(rootPath);
    try {
      const result = await editReplaceFile(resolveAbs(rootPath, relPath), oldText, newText);
      if (result.ok) {
        const matches = typeof result.matches === 'number' ? result.matches : 1;
        c.noteWrite(agentId, rel, 'edit');
        emitChange(rootPath);
        return { ok: true, matches };
      }
      // Map MTUI's error taxonomy to actionable team-edit outcomes. A failed
      // edit must release a freshly-acquired lease (nothing landed).
      if (newlyAcquired) c.release(agentId, rel);
      const errorType = typeof result.error_type === 'string' ? result.error_type : '';
      const message = typeof result.message === 'string' ? result.message : 'MTUI edit failed';
      emitChange(rootPath);
      if (errorType === 'NO_MATCH' || errorType === 'CONFLICT') {
        return { ok: false, reason: 'stale', detail: message };
      }
      if (errorType === 'MULTIPLE_MATCHES') {
        return { ok: false, reason: 'ambiguous', detail: message };
      }
      return { ok: false, reason: 'error', error: message };
    } catch (error) {
      if (newlyAcquired) c.release(agentId, rel);
      emitChange(rootPath);
      return { ok: false, reason: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  };

  const saveTask = (rootPath: string, input: IdeTeamTaskInput): IdeTeamTask => {
    const data = dataFor(rootPath);
    const title = input.title.trim();
    if (!title) throw new Error('Task title is required.');
    if (input.parentTaskId && !data.tasks.some((task) => task.id === input.parentTaskId)) {
      throw new Error('Unknown parent task.');
    }
    if (input.groupId && !data.groups.some((group) => group.id === input.groupId)) {
      throw new Error('Unknown task group.');
    }
    const timestamp = deps.now?.() ?? Date.now();
    const existing = input.id ? data.tasks.find((task) => task.id === input.id) : undefined;
    if (existing && input.parentTaskId) {
      let cursor: string | null = input.parentTaskId;
      while (cursor) {
        if (cursor === existing.id) throw new Error('Task hierarchy cannot contain a cycle.');
        cursor = data.tasks.find((task) => task.id === cursor)?.parentTaskId ?? null;
      }
    }
    const task: IdeTeamTask = {
      id: existing?.id ?? randomUUID(),
      title,
      description: input.description.trim(),
      scope: input.scope,
      groupId: input.groupId,
      parentTaskId: input.parentTaskId,
      creatorId: input.creatorId,
      assigneeId: input.assigneeId,
      pinnedAgentId: input.pinnedAgentId,
      status: input.status,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (existing) Object.assign(existing, task);
    else data.tasks.push(task);
    emitChange(rootPath);
    return structuredClone(task);
  };

  const removeTask = (rootPath: string, taskId: string): boolean => {
    const data = dataFor(rootPath);
    if (!data.tasks.some((task) => task.id === taskId)) return false;
    const removed = new Set<string>([taskId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of data.tasks) {
        if (task.parentTaskId && removed.has(task.parentTaskId) && !removed.has(task.id)) {
          removed.add(task.id);
          changed = true;
        }
      }
    }
    data.tasks = data.tasks.filter((task) => !removed.has(task.id));
    data.messages = data.messages.filter((message) => !message.taskId || !removed.has(message.taskId));
    emitChange(rootPath);
    return true;
  };

  const saveGroup = (rootPath: string, input: IdeTeamGroupInput): IdeTeamGroup => {
    const data = dataFor(rootPath);
    const name = input.name.trim();
    if (!name) throw new Error('Group name is required.');
    if (input.parentGroupId && !data.groups.some((group) => group.id === input.parentGroupId)) {
      throw new Error('Unknown parent group.');
    }
    const timestamp = deps.now?.() ?? Date.now();
    const existing = input.id ? data.groups.find((group) => group.id === input.id) : undefined;
    if (existing && input.parentGroupId) {
      let cursor: string | null = input.parentGroupId;
      while (cursor) {
        if (cursor === existing.id) throw new Error('Group hierarchy cannot contain a cycle.');
        cursor = data.groups.find((group) => group.id === cursor)?.parentGroupId ?? null;
      }
    }
    const group: IdeTeamGroup = {
      id: existing?.id ?? randomUUID(),
      name,
      parentGroupId: input.parentGroupId,
      memberIds: [...new Set(input.memberIds)],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (existing) Object.assign(existing, group);
    else data.groups.push(group);
    emitChange(rootPath);
    return structuredClone(group);
  };

  const removeGroup = (rootPath: string, groupId: string): boolean => {
    const data = dataFor(rootPath);
    if (!data.groups.some((group) => group.id === groupId)) return false;
    const removed = new Set<string>([groupId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of data.groups) {
        if (group.parentGroupId && removed.has(group.parentGroupId) && !removed.has(group.id)) {
          removed.add(group.id);
          changed = true;
        }
      }
    }
    data.groups = data.groups.filter((group) => !removed.has(group.id));
    for (const task of data.tasks) {
      if (task.groupId && removed.has(task.groupId)) {
        task.groupId = null;
        task.scope = 'personal';
        task.updatedAt = deps.now?.() ?? Date.now();
      }
    }
    emitChange(rootPath);
    return true;
  };

  const postMessage = (rootPath: string, senderId: string, body: string, taskId?: string | null): IdeTeamMessage => {
    const data = dataFor(rootPath);
    const content = body.trim();
    if (!content) throw new Error('Message body is required.');
    if (taskId && !data.tasks.some((task) => task.id === taskId)) throw new Error('Unknown linked task.');
    const message: IdeTeamMessage = {
      id: randomUUID(),
      senderId,
      body: content,
      taskId: taskId ?? null,
      createdAt: deps.now?.() ?? Date.now(),
    };
    data.messages.push(message);
    if (data.messages.length > 500) data.messages.splice(0, data.messages.length - 500);
    emitChange(rootPath);
    return structuredClone(message);
  };

  const publishPreview = (
    rootPath: string,
    state: ViuProjectState,
    snapshotInput: CreateViuPreviewSnapshotInput,
    shareInput: CreateViuTeamPreviewPackageInput
  ): ViuTeamPreviewPackage => {
    const data = dataFor(rootPath);
    if (shareInput.teamWorkspaceKey !== rootPath) {
      throw new Error('Preview package workspace does not match the active Team workspace.');
    }
    if (shareInput.teamTaskId && !data.tasks.some((task) => task.id === shareInput.teamTaskId)) {
      throw new Error('Unknown Team task for preview package.');
    }
    const item = mutatePreviewReview(rootPath, (review) => review.publish(state, snapshotInput, shareInput));
    emitChange(rootPath);
    return item;
  };

  const listPreviews = (rootPath: string): readonly ViuTeamPreviewPackage[] =>
    dataFor(rootPath).previewReview.listTeamPackages(rootPath);

  const getPreview = (
    rootPath: string,
    packageId: string,
    consumer: 'user-preview' | 'agent-preview'
  ): ViuTeamPreviewPackage => dataFor(rootPath).previewReview.open(packageId, consumer);

  const appendPreviewFeedback = (
    rootPath: string,
    packageId: string,
    input: CreateViuPreviewFeedbackInput
  ): ViuPreviewFeedbackEvent => {
    const event = mutatePreviewReview(rootPath, (review) => review.appendFeedback(packageId, input));
    emitChange(rootPath);
    return event;
  };

  const listPreviewFeedback = (rootPath: string, packageId: string): readonly ViuPreviewFeedbackEvent[] =>
    dataFor(rootPath).previewReview.listFeedback(packageId);

  const reset = (rootPath: string): void => {
    const c = coordinators.get(rootPath);
    if (c) {
      c.reset();
      coordinators.delete(rootPath);
    }
    workspaceData.delete(rootPath);
    emitChange(rootPath);
  };

  return {
    join,
    claim,
    heartbeat,
    release,
    releaseAll,
    write,
    editReplace,
    saveTask,
    removeTask,
    saveGroup,
    removeGroup,
    postMessage,
    publishPreview,
    listPreviews,
    getPreview,
    appendPreviewFeedback,
    listPreviewFeedback,
    snapshot,
    reset,
  };
};

/** Lazily-built singleton so the UI bridge + the agent MCP tools share one service. */
let singleton: TeamEditService | undefined;

/** Options for the shared singleton (only honoured on first construction). */
let singletonOnChange: ((snapshot: TeamEditSnapshot) => void) | undefined;

/**
 * Register the change listener used by the shared singleton (the bridge emitter).
 *
 * Must NOT rebuild the singleton: the agent plane (the IDE MCP server) may have
 * already resolved it before the bridge registers, and discarding it here would
 * leave the agent holding one instance while the UI holds another — a split-brain
 * that breaks the "one source of truth" guarantee. The service's `onChange`
 * closure reads {@link singletonOnChange} LATE (at emit time), so simply setting
 * it wires the listener into the existing instance regardless of init order.
 */
export const setTeamEditChangeListener = (listener: (snapshot: TeamEditSnapshot) => void): void => {
  singletonOnChange = listener;
};

/** Resolve the shared {@link TeamEditService} singleton (both planes use it). */
export const getTeamEditService = (): TeamEditService => {
  if (!singleton) {
    singleton = createTeamEditService({
      onChange: (snapshot) => singletonOnChange?.(snapshot),
      previewPersistence: createTeamPreviewFilePersistence(),
    });
  }
  return singleton;
};
