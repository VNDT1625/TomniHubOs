/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live sessions: the tabs, chats and terminals an app currently keeps alive.
 * The sidebar "Active" section lists apps that hold at least one. Input comes
 * from apps and third-party packages, so everything here is bounded and
 * dropped silently when malformed.
 */

export type LiveSessionStatus = 'working' | 'idle' | 'attention' | 'error' | 'suspended';

export type LiveSession = {
  id: string;
  title: string;
  status: LiveSessionStatus;
  /** Epoch ms of the session's latest activity, when the app knows it. */
  lastActiveAt?: number;
  /** Icon name from a small allowed shape; never a URL. */
  icon?: string;
  /** Sub-group inside the app (Chat uses it for the workspace). */
  group?: string;
  detail?: string;
};

/** What the sidebar may ask the app to do with its sessions: add one ("+") or close one ("x"). */
export type LiveSessionActions = { create?: true; close?: true };

export type LiveSessionApp = {
  appId: string;
  sessions: LiveSession[];
  updatedAt: number;
  /** Present only when the app says it can add and/or close sessions on request. */
  actions?: LiveSessionActions;
};

export type LiveSessionsSnapshot = { generatedAt: number; apps: LiveSessionApp[] };

export const LIVE_SESSION_LIMITS = { maxSessions: 50, title: 120, group: 80, detail: 80, id: 200 } as const;

/** Only this many leading entries of a report are looked at, so a huge list cannot stall Main. */
const MAX_INPUT_ENTRIES = 500;

/** An idle session untouched for longer than this is shown grey. */
export const IDLE_TO_GREY_MS = 300_000;

const STATUSES = new Set<string>(['working', 'idle', 'attention', 'error', 'suspended']);
const ICON = /^[a-z0-9-]{1,40}$/;

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
};

const readSession = (raw: unknown): LiveSession | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  // The id is the app's own handle for the session (a file path, a tab id) and comes back in a focus request,
  // so it is kept exactly as sent: a blank or over-long id drops the session instead of being altered.
  const id =
    typeof input.id === 'string' && input.id.trim().length > 0 && input.id.length <= LIVE_SESSION_LIMITS.id
      ? input.id
      : undefined;
  const title = clip(input.title, LIVE_SESSION_LIMITS.title);
  const status = input.status;
  if (!id || !title || typeof status !== 'string' || !STATUSES.has(status)) return undefined;
  const group = clip(input.group, LIVE_SESSION_LIMITS.group);
  const detail = clip(input.detail, LIVE_SESSION_LIMITS.detail);
  const icon = typeof input.icon === 'string' && ICON.test(input.icon) ? input.icon : undefined;
  const lastActiveAt =
    typeof input.lastActiveAt === 'number' && Number.isFinite(input.lastActiveAt) ? input.lastActiveAt : undefined;
  return {
    id,
    title,
    status: status as LiveSessionStatus,
    ...(lastActiveAt === undefined ? {} : { lastActiveAt }),
    ...(icon ? { icon } : {}),
    ...(group ? { group } : {}),
    ...(detail ? { detail } : {}),
  };
};

/**
 * Returns undefined when `input` is not an array, or is a non-empty array with nothing readable in it, so the
 * caller keeps the previous list. An explicitly empty array is a real empty list. Bad entries are dropped
 * without a trace.
 */
export const normalizeSessions = (input: unknown): LiveSession[] | undefined => {
  if (!Array.isArray(input)) return undefined;
  const byId = new Map<string, LiveSession>();
  for (const raw of input.slice(0, MAX_INPUT_ENTRIES)) {
    const session = readSession(raw);
    if (!session) continue;
    byId.delete(session.id);
    byId.set(session.id, session);
  }
  if (input.length > 0 && byId.size === 0) return undefined;
  return [...byId.values()].slice(0, LIVE_SESSION_LIMITS.maxSessions);
};

/** Only a literal `true` counts; anything else is "not supported". Returns undefined when nothing is claimed. */
export const normalizeActions = (input: unknown): LiveSessionActions | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const actions: LiveSessionActions = {};
  if (record.create === true) actions.create = true;
  if (record.close === true) actions.close = true;
  return actions.create || actions.close ? actions : undefined;
};

/** `dormant` is an idle session shown grey after five quiet minutes; it is display only. */
export type LiveSessionDisplay = LiveSessionStatus | 'dormant';

export const displayStatus = (session: LiveSession, now: number): LiveSessionDisplay =>
  session.status === 'idle' && session.lastActiveAt !== undefined && now - session.lastActiveAt > IDLE_TO_GREY_MS
    ? 'dormant'
    : session.status;

/** Most attention-worthy first; dormant ranks with suspended. */
const RANK: Record<LiveSessionDisplay, number> = {
  error: 0,
  attention: 1,
  working: 2,
  idle: 3,
  dormant: 4,
  suspended: 4,
};

export const aggregateDisplay = (sessions: readonly LiveSession[], now: number): LiveSessionDisplay | undefined => {
  let best: LiveSessionDisplay | undefined;
  for (const session of sessions) {
    const display = displayStatus(session, now);
    if (best === undefined || RANK[display] < RANK[best]) best = display;
  }
  return best;
};
