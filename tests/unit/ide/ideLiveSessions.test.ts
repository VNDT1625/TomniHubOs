import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildIdeLiveSessions,
  getIdeChatTabsFor,
  publishIdeChatTabs,
} from '@package-apps/ide/renderer/liveSessions/ideLiveSessions';

const A = String.raw`C:\work\my-repo\src\a.ts`;
const B = String.raw`C:\work\my-repo\b.md`;

describe('buildIdeLiveSessions', () => {
  it('reports open files and chats grouped by workspace folder name', () => {
    const sessions = buildIdeLiveSessions({
      rootPath: String.raw`C:\work\my-repo`,
      openFiles: [A, B],
      dirtyFiles: new Set([B]),
      chatTabs: [{ id: 'c1', title: 'Fix bug', memId: 'm1' }],
      unsavedLabel: 'Unsaved',
    });
    expect(sessions).toEqual([
      { id: 'chat:c1', title: 'Fix bug', status: 'idle', group: 'my-repo' },
      { id: `file:${A}`, title: 'a.ts', status: 'idle', group: 'my-repo' },
      { id: `file:${B}`, title: 'b.md', status: 'idle', group: 'my-repo', detail: 'Unsaved' },
    ]);
  });

  it('reports nothing without a workspace', () => {
    expect(
      buildIdeLiveSessions({
        rootPath: null,
        openFiles: ['x'],
        dirtyFiles: new Set(),
        chatTabs: [],
        unsavedLabel: 'Unsaved',
      })
    ).toEqual([]);
  });

  it('falls back to the workspace name for an untitled chat', () => {
    const sessions = buildIdeLiveSessions({
      rootPath: '/r/proj',
      openFiles: [],
      dirtyFiles: new Set(),
      chatTabs: [{ id: 'c2', title: '', memId: 'm' }],
      unsavedLabel: 'Unsaved',
    });
    expect(sessions).toEqual([{ id: 'chat:c2', title: 'proj', status: 'idle', group: 'proj' }]);
  });
});

describe('ide chat tab store', () => {
  beforeEach(() => publishIdeChatTabs(null, []));

  it('keeps tabs for their workspace only', () => {
    publishIdeChatTabs('/r/a', [{ id: 'c1', title: 'T', memId: 'm' }]);
    expect(getIdeChatTabsFor('/r/a')).toHaveLength(1);
    expect(getIdeChatTabsFor('/r/b')).toEqual([]);
  });
});
