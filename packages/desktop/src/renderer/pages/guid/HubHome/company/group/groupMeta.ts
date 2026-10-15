/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-group settings that outlive a single message: the shared goal, the group
 * calendar and the group workflows. Stored in the renderer next to the group
 * transcript and keyed the same way (`<companyId>::<groupId>`).
 */

export type EventRepeat = 'none' | 'daily' | 'weekdays' | 'weekly';

export type GroupEvent = {
  id: string;
  title: string;
  /** Extra instructions the attendees read when the event fires. */
  note?: string;
  /** First occurrence, epoch ms (local time as picked by the user). */
  startsAt: number;
  repeat: EventRepeat;
  /** Role ids that are called when it fires. Empty: Laya picks, as for a user message. */
  attendees: string[];
  /** Run this workflow when the event fires instead of posting a message. */
  workflowId?: string;
  enabled: boolean;
  /** Occurrence (epoch ms) that fired last, so an occurrence never fires twice. */
  lastFiredAt?: number;
};

export type WorkflowStep = { id: string; roleId: string; instruction: string };

/** Ordered steps; each step goes to one agent and receives the previous step's output. */
export type GroupWorkflow = { id: string; name: string; steps: WorkflowStep[] };

export type GroupMeta = { goal: string; events: GroupEvent[]; workflows: GroupWorkflow[] };

export const MAX_EVENTS = 50;
export const MAX_WORKFLOWS = 20;
export const MAX_STEPS = 12;
export const MAX_TEXT_CHARS = 2_000;

const STORAGE_KEY = 'tomni.hub.companyGroupMeta';
export const GROUP_META_CHANGED_EVENT = 'tomni-company-group-meta-changed';
const DAY_MS = 86_400_000;

export const chatKey = (companyId: string, groupId: string): string => `${companyId}::${groupId}`;

export const splitChatKey = (key: string): { companyId: string; groupId: string } | null => {
  const at = key.indexOf('::');
  return at > 0 ? { companyId: key.slice(0, at), groupId: key.slice(at + 2) } : null;
};

export const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const clip = (value: unknown, max = MAX_TEXT_CHARS): string => (typeof value === 'string' ? value.slice(0, max) : '');
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const REPEATS: readonly EventRepeat[] = ['none', 'daily', 'weekdays', 'weekly'];

/** Bound and repair whatever is in storage; anything malformed is dropped. */
export const sanitizeMeta = (raw: unknown): GroupMeta => {
  const source = isObject(raw) ? raw : {};
  const events = (Array.isArray(source.events) ? source.events : [])
    .filter(isObject)
    .filter((event) => typeof event.id === 'string' && typeof event.startsAt === 'number')
    .slice(0, MAX_EVENTS)
    .map(
      (event): GroupEvent => ({
        id: event.id as string,
        title: clip(event.title, 200),
        note: clip(event.note) || undefined,
        startsAt: event.startsAt as number,
        repeat: REPEATS.includes(event.repeat as EventRepeat) ? (event.repeat as EventRepeat) : 'none',
        attendees: Array.isArray(event.attendees) ? event.attendees.filter((id) => typeof id === 'string') : [],
        workflowId: typeof event.workflowId === 'string' ? event.workflowId : undefined,
        enabled: event.enabled !== false,
        lastFiredAt: typeof event.lastFiredAt === 'number' ? event.lastFiredAt : undefined,
      })
    );
  const workflows = (Array.isArray(source.workflows) ? source.workflows : [])
    .filter(isObject)
    .filter((workflow) => typeof workflow.id === 'string')
    .slice(0, MAX_WORKFLOWS)
    .map(
      (workflow): GroupWorkflow => ({
        id: workflow.id as string,
        name: clip(workflow.name, 120),
        steps: (Array.isArray(workflow.steps) ? workflow.steps : [])
          .filter(isObject)
          .filter((step) => typeof step.id === 'string' && typeof step.roleId === 'string')
          .slice(0, MAX_STEPS)
          .map((step) => ({
            id: step.id as string,
            roleId: step.roleId as string,
            instruction: clip(step.instruction),
          })),
      })
    );
  return { goal: clip(source.goal, 600), events, workflows };
};

const readAll = (): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const readMeta = (key: string): GroupMeta => sanitizeMeta(readAll()[key]);

/** Every group that has settings, for the calendar scheduler. */
export const readAllMeta = (): [string, GroupMeta][] =>
  Object.entries(readAll()).map(([key, value]) => [key, sanitizeMeta(value)]);

export const writeMeta = (key: string, meta: GroupMeta): void => {
  try {
    const all = readAll();
    all[key] = sanitizeMeta(meta);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(GROUP_META_CHANGED_EVENT, { detail: key }));
  } catch {
    // Settings are a convenience; a storage failure only loses them on reload.
  }
};

const isWeekend = (at: number): boolean => {
  const day = new Date(at).getDay();
  return day === 0 || day === 6;
};

const stepOf = (repeat: EventRepeat): number => (repeat === 'weekly' ? 7 * DAY_MS : DAY_MS);

/**
 * The latest occurrence at or before `now`, or null when the event has not
 * started yet. Repeats advance in fixed 24h steps (no DST adjustment).
 */
export const latestOccurrence = (event: Pick<GroupEvent, 'startsAt' | 'repeat'>, now: number): number | null => {
  if (now < event.startsAt) return null;
  if (event.repeat === 'none') return event.startsAt;
  const step = stepOf(event.repeat);
  let at = event.startsAt + Math.floor((now - event.startsAt) / step) * step;
  if (event.repeat === 'weekdays') {
    while (at >= event.startsAt && isWeekend(at)) at -= DAY_MS;
    if (at < event.startsAt) return null;
  }
  return at;
};

/**
 * The occurrence that should fire now, if any. Only the latest occurrence of a
 * repeating event fires (no backlog after the app was closed); a one-time event
 * that was missed fires late.
 */
export const dueOccurrence = (event: GroupEvent, now: number): number | null => {
  if (!event.enabled) return null;
  const at = latestOccurrence(event, now);
  if (at === null) return null;
  return event.lastFiredAt !== undefined && at <= event.lastFiredAt ? null : at;
};

/** Occurrences in `[from, to)`, for the week view. */
export const occurrencesBetween = (
  event: Pick<GroupEvent, 'startsAt' | 'repeat'>,
  from: number,
  to: number
): number[] => {
  if (event.repeat === 'none') return event.startsAt >= from && event.startsAt < to ? [event.startsAt] : [];
  const step = stepOf(event.repeat);
  const result: number[] = [];
  let at = event.startsAt + Math.max(0, Math.ceil((from - event.startsAt) / step)) * step;
  for (; at < to && result.length < 64; at += step) {
    if (event.repeat !== 'weekdays' || !isWeekend(at)) result.push(at);
  }
  return result;
};

/** A new event never fires for an occurrence that is already in the past. */
export const createEvent = (input: Omit<GroupEvent, 'id' | 'enabled' | 'lastFiredAt'>, now: number): GroupEvent => {
  const event: GroupEvent = { ...input, id: newId(), enabled: true };
  const past = latestOccurrence(event, now - 1);
  return past === null ? event : { ...event, lastFiredAt: past };
};
