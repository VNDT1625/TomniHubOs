/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { CompanyStructure, RoleNode } from '@process/company/companyOrchestrator';
import { flattenRoles, parseMentions, resolveAudience, selectReaders, type CompanyGroup } from '../companyGroups';
import { ensureRoleConversation } from '../companyRoleChat';
import { chatKey, newId, readMeta, type GroupEvent, type GroupWorkflow } from './groupMeta';
import { buildGroupPrompt, buildWorkflowStepPrompt, isPass, type GroupMessage } from './groupPrompts';

/**
 * Group chat engine.
 *
 * It lives at module level, not inside a component, so a conversation keeps
 * running when the user leaves the company page: replies, @ hand-offs, workflow
 * steps and calendar events all continue while the app is open. Each agent's
 * private 1-1 conversation is the transport; the group transcript is kept here
 * and every agent is fed the lines it has not seen yet.
 */

export type GroupContext = {
  companyId: string;
  companyName: string;
  group: CompanyGroup;
  structure: CompanyStructure;
  rules: readonly string[];
  language: string;
};

export type GroupSnapshot = {
  messages: readonly GroupMessage[];
  /** Role ids taking a turn. */
  busy: ReadonlySet<string>;
  /** Reply text streamed so far, per role. */
  drafts: ReadonlyMap<string, string>;
  /** Role ids waiting for the user to approve a permission in their private chat. */
  waiting: ReadonlySet<string>;
  /** A workflow run is in progress in this group. */
  workflowRunning: boolean;
};

type StoredChat = { messages: GroupMessage[]; seen: Record<string, number> };
type Live = { busy: Set<string>; drafts: Map<string, string>; waiting: Set<string>; workflow: boolean };

const STORAGE_KEY = 'tomni.hub.companyGroupChat';
const MAX_MESSAGES = 200;
/** How many recent lines a tagged-in guest gets to read. */
const GUEST_CONTEXT_LINES = 30;
/** A member that sat out several messages catches up on at most this many lines. */
const MAX_BACKLOG_LINES = 40;
/** How many times agents may hand work on to each other with @ after one message. */
const MAX_HANDOFF_HOPS = 2;
/** Without any sign of progress a turn is abandoned after this long. Waiting for an approval does not count. */
const TURN_TIMEOUT_MS = 180_000;

const EMPTY: GroupSnapshot = {
  messages: [],
  busy: new Set(),
  drafts: new Map(),
  waiting: new Set(),
  workflowRunning: false,
};

const chats = new Map<string, StoredChat>();
const lives = new Map<string, Live>();
const snapshots = new Map<string, GroupSnapshot>();
const listeners = new Map<string, Set<() => void>>();
/** One turn at a time per agent, across every group it belongs to. */
const queues = new Map<string, Promise<unknown>>();
/** Conversations currently answering a group turn, for streaming. */
const streams = new Map<string, { key: string; roleId: string }>();
let streamOff: (() => void) | null = null;

const readAll = (): Record<string, StoredChat> => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, StoredChat>) : {};
  } catch {
    return {};
  }
};

const chatFor = (key: string): StoredChat => {
  let chat = chats.get(key);
  if (!chat) {
    const stored = readAll()[key];
    chat = {
      messages: Array.isArray(stored?.messages) ? stored.messages : [],
      seen: stored?.seen && typeof stored.seen === 'object' ? stored.seen : {},
    };
    chats.set(key, chat);
  }
  return chat;
};

const persist = (key: string): void => {
  const chat = chatFor(key);
  const dropped = chat.messages.length - MAX_MESSAGES;
  if (dropped > 0) {
    chat.messages = chat.messages.slice(dropped);
    // `seen` counts lines from the start of the transcript, so it moves with every line cut off the front;
    // otherwise a full transcript would hand every agent an empty backlog forever.
    for (const roleId of Object.keys(chat.seen)) chat.seen[roleId] = Math.max(0, chat.seen[roleId] - dropped);
  }
  try {
    const all = readAll();
    all[key] = { messages: chat.messages, seen: chat.seen };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // History is a convenience; a storage failure only loses it on reload.
  }
};

const liveFor = (key: string): Live => {
  let live = lives.get(key);
  if (!live) {
    live = { busy: new Set(), drafts: new Map(), waiting: new Set(), workflow: false };
    lives.set(key, live);
  }
  return live;
};

const emit = (key: string): void => {
  const live = liveFor(key);
  snapshots.set(key, {
    messages: chatFor(key).messages,
    busy: new Set(live.busy),
    drafts: new Map(live.drafts),
    waiting: new Set(live.waiting),
    workflowRunning: live.workflow,
  });
  listeners.get(key)?.forEach((listener) => listener());
};

export const subscribeGroup = (key: string, listener: () => void): (() => void) => {
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => set.delete(listener);
};

export const getGroupSnapshot = (key: string): GroupSnapshot => {
  if (!key) return EMPTY;
  if (!snapshots.has(key)) emit(key);
  return snapshots.get(key) ?? EMPTY;
};

const append = (key: string, message: GroupMessage): void => {
  const chat = chatFor(key);
  chat.messages = [...chat.messages, message];
  persist(key);
  emit(key);
};

const patch = (key: string, id: string, update: Partial<GroupMessage>): void => {
  const chat = chatFor(key);
  chat.messages = chat.messages.map((message) => (message.id === id ? { ...message, ...update } : message));
  persist(key);
  emit(key);
};

export const clearGroupChat = (key: string): void => {
  chats.set(key, { messages: [], seen: {} });
  persist(key);
  emit(key);
};

const extractChunk = (data: unknown): string => {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && 'content' in data) {
    const content = (data as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }
  return '';
};

const ensureStreaming = (): void => {
  if (streamOff) return;
  streamOff = ipcBridge.conversation.responseStream.on((message) => {
    const target = streams.get(message.conversation_id);
    if (!target || message.hidden || (message.type !== 'content' && message.type !== 'text')) return;
    const chunk = extractChunk(message.data);
    if (!chunk) return;
    const drafts = liveFor(target.key).drafts;
    drafts.set(target.roleId, message.replace ? chunk : `${drafts.get(target.roleId) ?? ''}${chunk}`);
    emit(target.key);
  });
};

/**
 * Send one prompt and resolve with the agent's final reply. While the agent
 * waits for a permission the timeout is paused and `onWaiting` is told, so the
 * group can ask the user to approve it in the private chat.
 */
const waitForReply = (
  conversationId: string,
  send: () => Promise<unknown>,
  onWaiting: (waiting: boolean) => void
): Promise<string> =>
  new Promise((resolve, reject) => {
    let off: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = false;
    const finish = (settle: () => void): void => {
      if (timer) clearTimeout(timer);
      off?.();
      if (waiting) onWaiting(false);
      settle();
    };
    const arm = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(() => reject(new Error('timeout'))), TURN_TIMEOUT_MS);
    };
    arm();
    off = ipcBridge.conversation.turnCompleted.on((event) => {
      if (event.session_id !== conversationId) return;
      if (event.state === 'error') return finish(() => reject(new Error(event.detail || 'agent error')));
      const terminal = event.can_send_message === true || event.state === 'ai_waiting_input';
      if (terminal || event.state === 'stopped') {
        const content = event.last_message?.content;
        return finish(() => resolve(typeof content === 'string' ? content : ''));
      }
      const needsApproval = event.state === 'ai_waiting_confirmation' || event.runtime?.pending_confirmations > 0;
      if (needsApproval !== waiting) {
        waiting = needsApproval;
        onWaiting(needsApproval);
      }
      if (needsApproval) {
        if (timer) clearTimeout(timer);
        timer = undefined;
      } else {
        arm();
      }
    });
    send().catch((error: unknown) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))));
  });

type TurnOptions = {
  guest: boolean;
  hops: number;
  handoffFrom?: string;
  /** Set for a workflow step: the agent does this step and nothing is handed off. */
  step?: {
    workflow: GroupWorkflow;
    index: number;
    instruction: string;
    previous?: { name: string; output: string };
  };
};

const enqueue = (ctx: GroupContext, role: RoleNode, options: TurnOptions): Promise<string | null> => {
  const previous = queues.get(role.id) ?? Promise.resolve();
  const next = previous.then(() => takeTurn(ctx, role, options));
  queues.set(
    role.id,
    next.catch((): null => null)
  );
  return next;
};

/** One agent turn: build its prompt, wait for the reply, post it, follow its @ hand-offs. */
const takeTurn = async (ctx: GroupContext, role: RoleNode, options: TurnOptions): Promise<string | null> => {
  const { companyId, companyName, group, structure } = ctx;
  const key = chatKey(companyId, group.id);
  const live = liveFor(key);
  // Read the transcript when the turn starts, so replies that landed while it was queued are included.
  const chat = chatFor(key);
  const transcript = chat.messages;
  const backlog = options.guest ? transcript.slice(-GUEST_CONTEXT_LINES) : transcript.slice(chat.seen[role.id] ?? 0);
  const unseen = backlog.slice(-MAX_BACKLOG_LINES);
  const omitted = backlog.length - unseen.length;
  chat.seen[role.id] = transcript.length;
  persist(key);
  const goal = readMeta(key).goal;
  const step = options.step;
  const workflowTag = step
    ? { name: step.workflow.name, step: step.index + 1, total: step.workflow.steps.length }
    : undefined;

  live.busy.add(role.id);
  emit(key);
  let conversationId: string | null = null;
  try {
    conversationId = await ensureRoleConversation({
      companyId,
      companyName,
      role,
      structure,
      rules: ctx.rules,
      language: ctx.language,
    });
    if (!conversationId) throw new Error('no-executor');
    const prompt = step
      ? buildWorkflowStepPrompt({
          companyName,
          group,
          role,
          goal,
          workflowName: step.workflow.name,
          step: step.index + 1,
          total: step.workflow.steps.length,
          instruction: step.instruction,
          previous: step.previous,
          unseen,
          omitted,
        })
      : buildGroupPrompt({
          companyName,
          group,
          role,
          guest: options.guest,
          unseen,
          goal,
          omitted,
          handoffFrom: options.handoffFrom,
        });
    ensureStreaming();
    const id = conversationId;
    streams.set(id, { key, roleId: role.id });
    const reply = await waitForReply(
      id,
      () => ipcBridge.conversation.sendMessage.invoke({ conversation_id: id, input: prompt }),
      (waiting) => {
        if (waiting) live.waiting.add(role.id);
        else live.waiting.delete(role.id);
        emit(key);
      }
    );
    const answer = reply.trim();
    if (!answer || (!step && isPass(answer))) return step ? '' : null;
    append(key, {
      id: newId(),
      from: role.id,
      name: role.name,
      text: answer,
      at: Date.now(),
      guest: options.guest,
      workflow: workflowTag,
    });
    // Agents hand work to each other with @, as in a team chat. Hops are capped so they cannot loop.
    if (!step && options.hops < MAX_HANDOFF_HOPS) {
      const groupIds = new Set([group.leader.id, ...group.members.map((node) => node.id)]);
      for (const target of parseMentions(answer, flattenRoles(structure.root) as RoleNode[])) {
        if (target.id === role.id) continue;
        void enqueue(ctx, target, { guest: !groupIds.has(target.id), hops: options.hops + 1, handoffFrom: role.name });
      }
    }
    return answer;
  } catch (error) {
    append(key, {
      id: newId(),
      from: role.id,
      name: role.name,
      text: error instanceof Error ? error.message : String(error),
      at: Date.now(),
      guest: options.guest,
      error: true,
      workflow: workflowTag,
    });
    return null;
  } finally {
    if (conversationId) streams.delete(conversationId);
    live.busy.delete(role.id);
    live.drafts.delete(role.id);
    live.waiting.delete(role.id);
    emit(key);
  }
};

/** Score the group for `text` with Laya and return who reads it. Every member reads when routing fails. */
const route = async (
  ctx: GroupContext,
  text: string
): Promise<{ readers: RoleNode[]; guests: RoleNode[]; routing: NonNullable<GroupMessage['routing']> }> => {
  const { group, structure } = ctx;
  const audience = resolveAudience(group, structure, text);
  let scores = new Map<string, number>();
  let source: 'laya' | 'keywords' | 'all' = 'all';
  if (audience.primary.length > 1) {
    try {
      const res = await ipcBridge.company.routeGroupMessage.invoke({
        text,
        candidates: audience.primary.map((role) => ({
          id: role.id,
          name: role.name,
          responsibilities: role.responsibilities,
        })),
      });
      if (res.ok) {
        const data = (res as Extract<typeof res, { ok: true }>).data;
        scores = new Map(data.scores.map((item) => [item.id, item.score]));
        source = data.source;
      }
    } catch {
      // Routing is an optimisation; on failure every member reads.
    }
  }
  const picked =
    source === 'all' ? { called: audience.primary, skipped: [] } : selectReaders(audience, scores, group.leader.id);
  return {
    readers: picked.called,
    guests: audience.guests,
    routing: {
      called: [...picked.called, ...audience.guests].map((role) => role.name),
      skipped: picked.skipped.map(({ role, score }) => ({ name: role.name, score })),
      source,
    },
  };
};

/** Post a user message: Laya picks who reads it, tagged agents always do. */
export const sendGroupMessage = async (ctx: GroupContext, text: string): Promise<void> => {
  const body = text.trim();
  if (!body) return;
  const key = chatKey(ctx.companyId, ctx.group.id);
  // The line shows at once; the routing note is filled in when Laya has answered.
  const id = newId();
  append(key, { id, from: 'user', name: 'User', text: body, at: Date.now() });
  const { readers, guests, routing } = await route(ctx, body);
  patch(key, id, { routing });
  await Promise.all([
    ...readers.map((role) => enqueue(ctx, role, { guest: false, hops: 0 })),
    ...guests.map((role) => enqueue(ctx, role, { guest: true, hops: 0 })),
  ]);
};

/**
 * Run a workflow: its steps go one after another to their agents, each step
 * receiving the previous step's output. It stops at the first step that fails.
 */
export const runGroupWorkflow = async (ctx: GroupContext, workflow: GroupWorkflow): Promise<void> => {
  const key = chatKey(ctx.companyId, ctx.group.id);
  const live = liveFor(key);
  if (live.workflow || workflow.steps.length === 0) return;
  const total = workflow.steps.length;
  const roles = flattenRoles(ctx.structure.root) as RoleNode[];
  const groupIds = new Set([ctx.group.leader.id, ...ctx.group.members.map((node) => node.id)]);
  const line = (status: 'started' | 'done' | 'failed', step: number, text: string): void =>
    append(key, {
      id: newId(),
      from: 'workflow',
      name: workflow.name,
      text,
      at: Date.now(),
      workflow: { name: workflow.name, step, total, status },
    });

  live.workflow = true;
  line('started', 0, `Workflow "${workflow.name}" started (${total} steps).`);
  let previous: { name: string; output: string } | undefined;
  try {
    for (const [index, step] of workflow.steps.entries()) {
      const role = roles.find((node) => node.id === step.roleId);
      if (!role) {
        line('failed', index + 1, `Workflow "${workflow.name}" stopped: step ${index + 1} has no agent.`);
        return;
      }
      const output = await enqueue(ctx, role, {
        guest: !groupIds.has(role.id),
        hops: MAX_HANDOFF_HOPS,
        step: { workflow, index, instruction: step.instruction, previous },
      });
      if (output === null) {
        line('failed', index + 1, `Workflow "${workflow.name}" stopped at step ${index + 1}.`);
        return;
      }
      previous = { name: role.name, output };
    }
    line('done', total, `Workflow "${workflow.name}" finished.`);
  } finally {
    live.workflow = false;
    emit(key);
  }
};

/**
 * Fire a calendar event in its group: it runs its workflow when it has one,
 * otherwise it posts a line that its attendees (or Laya's pick) read and answer.
 */
export const fireGroupEvent = async (ctx: GroupContext, event: GroupEvent, late: boolean): Promise<void> => {
  const key = chatKey(ctx.companyId, ctx.group.id);
  const text = [event.title, event.note].filter(Boolean).join('\n');
  const id = newId();
  append(key, { id, from: 'calendar', name: event.title, text, at: Date.now(), late });
  const workflow = event.workflowId ? readMeta(key).workflows.find((item) => item.id === event.workflowId) : undefined;
  if (workflow) {
    await runGroupWorkflow(ctx, workflow);
    return;
  }
  const roles = flattenRoles(ctx.structure.root) as RoleNode[];
  const groupIds = new Set([ctx.group.leader.id, ...ctx.group.members.map((node) => node.id)]);
  if (event.attendees.length > 0) {
    const attendees = event.attendees
      .map((roleId) => roles.find((node) => node.id === roleId))
      .filter((role): role is RoleNode => Boolean(role));
    patch(key, id, { routing: { called: attendees.map((role) => role.name), skipped: [], source: 'attendees' } });
    await Promise.all(attendees.map((role) => enqueue(ctx, role, { guest: !groupIds.has(role.id), hops: 0 })));
    return;
  }
  const { readers, guests, routing } = await route(ctx, text);
  patch(key, id, { routing });
  await Promise.all([
    ...readers.map((role) => enqueue(ctx, role, { guest: false, hops: 0 })),
    ...guests.map((role) => enqueue(ctx, role, { guest: true, hops: 0 })),
  ]);
};
