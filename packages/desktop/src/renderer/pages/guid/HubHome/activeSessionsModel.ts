import {
  aggregateDisplay,
  displayStatus,
  type LiveSessionApp,
  type LiveSessionDisplay,
  type LiveSessionStatus,
} from '@/common/liveSessions/model';
import type { HubActivityStatus } from '@/common/types/agent/hubActivity';

/** Chat shows its most recent conversations; the rest stay reachable from the chat history itself. */
export const MAX_ACTIVE_CHATS = 30;
export const CHAT_APP_ID = 'chat';

export type ActiveOpenTarget =
  | { kind: 'conversation'; id: string }
  | { kind: 'package'; appId: string; sessionId: string };

export type ActiveSessionRow = {
  key: string;
  title: string;
  display: LiveSessionDisplay;
  detail?: string;
  open: ActiveOpenTarget;
  /** The app can close this session on request (shows the "x"). */
  canClose: boolean;
};

export type ActiveGroup = { name?: string; sessions: ActiveSessionRow[] };

export type ActiveAppRow = {
  appId: string;
  title: string;
  icon: string;
  display: LiveSessionDisplay;
  count: number;
  groups: ActiveGroup[];
  /** The app can add a session on request (shows the "+"). */
  canCreate: boolean;
};

export type ActiveChat = { id: string; name: string; workspace?: string; activityAt: number };

type BuildInput = {
  apps: readonly LiveSessionApp[];
  chats: readonly ActiveChat[];
  liveStatus?: ReadonlyMap<string, HubActivityStatus>;
  labelFor: (appId: string) => { title: string; icon: string };
  workspaceLabel: (workspace: string) => string;
  now: number;
};

/** Treat equivalent path spellings as one workspace. */
const workspaceKey = (workspace: string): string =>
  workspace.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

const CHAT_STATUS: Record<HubActivityStatus, LiveSessionStatus> = {
  running: 'working',
  needs_input: 'attention',
  error: 'error',
  done: 'idle',
  stopped: 'idle',
};

type Grouped<T> = { name?: string; items: T[] };

/** Named groups keep first-seen order (input is newest first); the unnamed group goes last. */
const group = <T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
  labelOf: (item: T) => string
): Grouped<T>[] => {
  const named = new Map<string, Grouped<T>>();
  const loose: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key) {
      loose.push(item);
      continue;
    }
    const existing = named.get(key);
    if (existing) existing.items.push(item);
    else named.set(key, { name: labelOf(item), items: [item] });
  }
  return [...named.values(), ...(loose.length > 0 ? [{ items: loose }] : [])];
};

const buildChatRow = (input: BuildInput): { row: ActiveAppRow; recency: number } | undefined => {
  const chats = [...input.chats].toSorted((left, right) => right.activityAt - left.activityAt).slice(0, MAX_ACTIVE_CHATS);
  if (chats.length === 0) return undefined;
  const sessionOf = (chat: ActiveChat): ActiveSessionRow & { status: LiveSessionStatus; activityAt: number } => {
    const live = input.liveStatus?.get(chat.id);
    const status = live ? CHAT_STATUS[live] : 'idle';
    const display = displayStatus({ id: chat.id, title: chat.name, status, lastActiveAt: chat.activityAt }, input.now);
    return {
      key: `chat:${chat.id}`,
      title: chat.name,
      display,
      open: { kind: 'conversation', id: chat.id },
      canClose: false,
      status,
      activityAt: chat.activityAt,
    };
  };
  const sessions = chats.map((chat) => ({ chat, session: sessionOf(chat) }));
  const groups = group(
    sessions,
    ({ chat }) => (chat.workspace ? workspaceKey(chat.workspace) : undefined),
    ({ chat }) => input.workspaceLabel(chat.workspace ?? '')
  );
  const label = input.labelFor(CHAT_APP_ID);
  return {
    recency: chats[0].activityAt,
    row: {
      appId: CHAT_APP_ID,
      ...label,
      display:
        aggregateDisplay(
          sessions.map(({ session }) => ({
            id: session.key,
            title: session.title,
            status: session.status,
            lastActiveAt: session.activityAt,
          })),
          input.now
        ) ?? 'idle',
      count: sessions.length,
      groups: groups.map((entry) => ({
        name: entry.name,
        sessions: entry.items.map(({ session }) => ({
          key: session.key,
          title: session.title,
          display: session.display,
          open: session.open,
          canClose: false,
        })),
      })),
      canCreate: false,
    },
  };
};

const buildPackageRow = (app: LiveSessionApp, input: BuildInput): { row: ActiveAppRow; recency: number } | undefined => {
  if (app.sessions.length === 0) return undefined;
  const groups = group(
    app.sessions,
    (session) => session.group,
    (session) => session.group ?? ''
  );
  const label = input.labelFor(app.appId);
  return {
    recency: app.updatedAt,
    row: {
      appId: app.appId,
      ...label,
      display: aggregateDisplay(app.sessions, input.now) ?? 'idle',
      count: app.sessions.length,
      groups: groups.map((entry) => ({
        name: entry.name,
        sessions: entry.items.map((session) => ({
          key: `${app.appId}:${session.id}`,
          title: session.title,
          display: displayStatus(session, input.now),
          ...(session.detail ? { detail: session.detail } : {}),
          open: { kind: 'package', appId: app.appId, sessionId: session.id },
          canClose: app.actions?.close === true,
        })),
      })),
      canCreate: app.actions?.create === true,
    },
  };
};

/** The sidebar "Active" rows: apps that hold at least one session, newest activity first. */
export const buildActiveApps = (input: BuildInput): ActiveAppRow[] => {
  const rows = [
    buildChatRow(input),
    ...input.apps.filter((app) => app.appId !== CHAT_APP_ID).map((app) => buildPackageRow(app, input)),
  ].filter((entry): entry is { row: ActiveAppRow; recency: number } => entry !== undefined);
  return rows.toSorted((left, right) => right.recency - left.recency).map((entry) => entry.row);
};
