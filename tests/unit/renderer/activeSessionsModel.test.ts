import { describe, expect, it } from 'vitest';

import { IDLE_TO_GREY_MS, type LiveSessionApp } from '@/common/liveSessions/model';
import { buildActiveApps, MAX_ACTIVE_CHATS } from '@/renderer/pages/guid/HubHome/activeSessionsModel';

const NOW = 10 * IDLE_TO_GREY_MS;
const labelFor = (appId: string) => ({ title: appId === 'chat' ? 'Chat' : appId, icon: appId });
const workspaceLabel = (workspace: string) => workspace.split('/').pop() ?? workspace;

const build = (patch: Partial<Parameters<typeof buildActiveApps>[0]> = {}) =>
  buildActiveApps({ apps: [], chats: [], labelFor, workspaceLabel, now: NOW, ...patch });

const chat = (id: string, activityAt: number, workspace?: string) => ({ id, name: `Chat ${id}`, workspace, activityAt });

const pkg = (appId: string, updatedAt: number, sessions: LiveSessionApp['sessions']): LiveSessionApp => ({
  appId,
  updatedAt,
  sessions,
});

describe('buildActiveApps', () => {
  it('returns nothing when no app holds a session', () => {
    expect(build()).toEqual([]);
    expect(build({ apps: [pkg('terminal', 1, [])] })).toEqual([]);
  });

  it('groups chats by workspace and keeps loose chats in an unnamed last group', () => {
    const [row] = build({
      chats: [chat('1', NOW - 1, '/work/blog'), chat('2', NOW - 2), chat('3', NOW - 3, '/work/blog'), chat('4', NOW - 4, '/work/app')],
    });
    expect(row.appId).toBe('chat');
    expect(row.count).toBe(4);
    expect(row.groups.map((group) => group.name)).toEqual(['blog', 'app', undefined]);
    expect(row.groups[0].sessions.map((session) => session.key)).toEqual(['chat:1', 'chat:3']);
    expect(row.groups[0].sessions[0].open).toEqual({ kind: 'conversation', id: '1' });
  });

  it('treats equivalent workspace path spellings as one group', () => {
    const [row] = build({ chats: [chat('1', NOW - 1, 'C:\\Work\\Blog\\'), chat('2', NOW - 2, 'c:/work/blog')] });
    expect(row.groups).toHaveLength(1);
    expect(row.groups[0].sessions).toHaveLength(2);
  });

  it('maps chat activity to a colour status', () => {
    const live = new Map([
      ['1', 'running'],
      ['2', 'needs_input'],
      ['3', 'error'],
      ['4', 'done'],
    ] as const);
    const [row] = build({
      chats: [chat('1', NOW), chat('2', NOW), chat('3', NOW), chat('4', NOW), chat('5', NOW)],
      liveStatus: live,
    });
    const byId = Object.fromEntries(row.groups.flatMap((group) => group.sessions).map((session) => [session.key, session.display]));
    expect(byId).toEqual({
      'chat:1': 'working',
      'chat:2': 'attention',
      'chat:3': 'error',
      'chat:4': 'idle',
      'chat:5': 'idle',
    });
  });

  it('caps the chat list to the most recent conversations', () => {
    const chats = Array.from({ length: MAX_ACTIVE_CHATS + 10 }, (_, index) => chat(String(index), NOW - index));
    const [row] = build({ chats });
    expect(row.count).toBe(MAX_ACTIVE_CHATS);
    expect(row.groups[0].sessions[0].key).toBe('chat:0');
  });

  it('shows the most urgent session colour on a collapsed app row', () => {
    const [row] = build({
      apps: [
        pkg('terminal', NOW, [
          { id: 'a', title: 'bash', status: 'idle', lastActiveAt: NOW },
          { id: 'b', title: 'build', status: 'error', lastActiveAt: NOW },
        ]),
      ],
    });
    expect(row.display).toBe('error');
    expect(row.count).toBe(2);
  });

  it('dims an idle session after five quiet minutes', () => {
    const [row] = build({
      apps: [pkg('com.tomni.browser', NOW, [{ id: 'a', title: 'Google', status: 'idle', lastActiveAt: 0 }])],
    });
    expect(row.groups[0].sessions[0].display).toBe('dormant');
  });

  it('groups package sessions by their group and opens them by app and session id', () => {
    const [row] = build({
      apps: [
        pkg('com.acme.board', NOW, [
          { id: 'x', title: 'X', status: 'working', group: 'Boards' },
          { id: 'y', title: 'Y', status: 'idle' },
        ]),
      ],
    });
    expect(row.groups.map((group) => group.name)).toEqual(['Boards', undefined]);
    expect(row.groups[0].sessions[0].open).toEqual({ kind: 'package', appId: 'com.acme.board', sessionId: 'x' });
    expect(row.title).toBe('com.acme.board');
  });

  it('flags create/close support from the app actions and never on Chat', () => {
    const rows = build({
      apps: [
        { ...pkg('com.tomni.browser', NOW, [{ id: 't1', title: 'G', status: 'idle' }]), actions: { create: true, close: true } },
        { ...pkg('terminal', NOW - 1, [{ id: 'a', title: 'bash', status: 'idle' }]), actions: { create: true } },
        pkg('plain', NOW - 2, [{ id: 'p', title: 'P', status: 'idle' }]),
      ],
      chats: [chat('1', NOW - 5)],
    });
    const byId = Object.fromEntries(rows.map((row) => [row.appId, row]));
    expect(byId['com.tomni.browser'].canCreate).toBe(true);
    expect(byId['com.tomni.browser'].groups[0].sessions[0].canClose).toBe(true);
    expect(byId.terminal.canCreate).toBe(true);
    expect(byId.terminal.groups[0].sessions[0].canClose).toBe(false);
    expect(byId.plain.canCreate).toBe(false);
    expect(byId.plain.groups[0].sessions[0].canClose).toBe(false);
    expect(byId.chat.canCreate).toBe(false);
    expect(byId.chat.groups[0].sessions[0].canClose).toBe(false);
  });

  it('orders apps by their most recent activity', () => {
    const rows = build({
      apps: [pkg('terminal', NOW - 100, [{ id: 'a', title: 'bash', status: 'idle' }])],
      chats: [chat('1', NOW - 5)],
    });
    expect(rows.map((row) => row.appId)).toEqual(['chat', 'terminal']);
  });
});
