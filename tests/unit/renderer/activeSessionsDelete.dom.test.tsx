import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));

import { ActiveSessions } from '@/renderer/pages/guid/HubHome/ActiveSessions';
import type { ActiveAppRow } from '@/renderer/pages/guid/HubHome/activeSessionsModel';

const rows: ActiveAppRow[] = [
  {
    appId: 'chat',
    title: 'Chat',
    icon: 'chat',
    display: 'idle',
    count: 3,
    groups: [
      {
        sessions: [
          { key: 'chat:c1', title: 'Plan Q3', display: 'idle', open: { kind: 'conversation', id: 'c1' } },
          { key: 'chat:c2', title: 'Blog draft', display: 'idle', open: { kind: 'conversation', id: 'c2' } },
          { key: 'chat:c3', title: 'Ideas', display: 'idle', open: { kind: 'conversation', id: 'c3' } },
        ],
      },
    ],
  },
  {
    appId: 'com.tomni.browser',
    title: 'Browser',
    icon: 'browser',
    display: 'idle',
    count: 1,
    groups: [
      {
        sessions: [
          {
            key: 'com.tomni.browser:t1',
            title: 'Google',
            display: 'idle',
            open: { kind: 'package', appId: 'com.tomni.browser', sessionId: 't1' },
          },
        ],
      },
    ],
  },
];

const renderRows = (
  onDeleteChat?: (id: string) => void,
  onDeleteChats?: (ids: string[], done: () => void) => void
) => {
  const onOpen = vi.fn();
  render(<ActiveSessions rows={rows} onOpen={onOpen} onDeleteChat={onDeleteChat} onDeleteChats={onDeleteChats} />);
  fireEvent.click(screen.getByTestId('hub-active-toggle-chat'));
  fireEvent.click(screen.getByTestId('hub-active-toggle-com.tomni.browser'));
  return onOpen;
};

afterEach(cleanup);

describe('ActiveSessions delete button', () => {
  it('offers a delete button on chats only', () => {
    renderRows(vi.fn());
    expect(screen.getByTestId('hub-active-delete-chat:c1')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-active-delete-com.tomni.browser:t1')).toBeNull();
  });

  it('asks to delete the chat without opening it', () => {
    const onDeleteChat = vi.fn();
    const onOpen = renderRows(onDeleteChat);
    fireEvent.click(screen.getByTestId('hub-active-delete-chat:c1'));
    expect(onDeleteChat).toHaveBeenCalledWith('c1');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('labels the button with the existing delete text for screen readers', () => {
    renderRows(vi.fn());
    expect(screen.getByTestId('hub-active-delete-chat:c1')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('conversation.history.deleteTitle')
    );
  });

  it('shows no delete button when the host gives no delete handler', () => {
    renderRows(undefined);
    expect(screen.queryByTestId('hub-active-delete-chat:c1')).toBeNull();
  });
});

describe('ActiveSessions chat context menu', () => {
  it('exposes real actions from the left-click menu without opening the conversation', () => {
    const onOpen = vi.fn();
    const onDeleteChat = vi.fn();
    const onShowChat = vi.fn();
    const onRenameChat = vi.fn();
    const onForkChat = vi.fn();
    const onExportChat = vi.fn();
    render(<ActiveSessions rows={rows} onOpen={onOpen} onDeleteChat={onDeleteChat}
      onShowChat={onShowChat} onRenameChat={onRenameChat} onForkChat={onForkChat} onExportChat={onExportChat} />);
    fireEvent.click(screen.getByTestId('hub-active-toggle-chat'));
    const menu = () => fireEvent.click(screen.getByTestId('hub-active-menu-chat:c1'));
    menu();
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    fireEvent.click(screen.getByTestId('hub-active-menu-action-show'));
    expect(onShowChat).toHaveBeenCalledWith('c1');
    menu();
    fireEvent.click(screen.getByTestId('hub-active-menu-action-rename'));
    expect(onRenameChat).toHaveBeenCalledWith('c1', 'Plan Q3');
    menu();
    fireEvent.click(screen.getByTestId('hub-active-menu-action-fork'));
    expect(onForkChat).toHaveBeenCalledWith('c1');
    menu();
    fireEvent.click(screen.getByTestId('hub-active-menu-action-export'));
    expect(onExportChat).toHaveBeenCalledWith('c1');
    menu();
    fireEvent.click(screen.getByTestId('hub-active-menu-action-delete'));
    expect(onDeleteChat).toHaveBeenCalledWith('c1');
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('ActiveSessions select mode', () => {
  const enterSelectMode = (): void => {
    fireEvent.click(screen.getByTestId('hub-active-select-chat'));
  };

  it('offers the select toggle on the Chat row only', () => {
    renderRows(vi.fn(), vi.fn());
    expect(screen.getByTestId('hub-active-select-chat')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-active-select-com.tomni.browser')).toBeNull();
  });

  it('offers no select toggle without a batch handler', () => {
    renderRows(vi.fn(), undefined);
    expect(screen.queryByTestId('hub-active-select-chat')).toBeNull();
  });

  it('swaps the trash buttons for tick boxes while selecting', () => {
    renderRows(vi.fn(), vi.fn());
    expect(screen.getByTestId('hub-active-delete-chat:c1')).toBeInTheDocument();
    enterSelectMode();
    expect(screen.queryByTestId('hub-active-delete-chat:c1')).toBeNull();
    for (const id of ['c1', 'c2', 'c3']) expect(screen.getByTestId(`hub-active-check-chat:${id}`)).not.toBeChecked();
  });

  it('ticks a chat when its row is clicked instead of opening it', () => {
    const onOpen = renderRows(vi.fn(), vi.fn());
    enterSelectMode();
    fireEvent.click(screen.getByTestId('hub-active-session-chat:c2'));
    expect(screen.getByTestId('hub-active-check-chat:c2')).toBeChecked();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-active-session-chat:c2'));
    expect(screen.getByTestId('hub-active-check-chat:c2')).not.toBeChecked();
  });

  it('does not touch rows of other apps while selecting', () => {
    const onOpen = renderRows(vi.fn(), vi.fn());
    enterSelectMode();
    fireEvent.click(screen.getByTestId('hub-active-session-com.tomni.browser:t1'));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'package', appId: 'com.tomni.browser', sessionId: 't1' });
  });

  it('shows how many are ticked and deletes them in one go, in list order', () => {
    const onDeleteChats = vi.fn();
    renderRows(vi.fn(), onDeleteChats);
    enterSelectMode();
    expect(screen.getByTestId('hub-active-batch-delete')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hub-active-session-chat:c3'));
    fireEvent.click(screen.getByTestId('hub-active-session-chat:c1'));
    expect(screen.getByTestId('hub-active-batch-count')).toHaveTextContent('conversation.history.selectedCount:2');
    fireEvent.click(screen.getByTestId('hub-active-batch-delete'));
    expect(onDeleteChats).toHaveBeenCalledTimes(1);
    expect(onDeleteChats.mock.calls[0][0]).toEqual(['c1', 'c3']);
  });

  it('leaves select mode once the host reports the deletion is done', () => {
    const onDeleteChats = vi.fn();
    renderRows(vi.fn(), onDeleteChats);
    enterSelectMode();
    fireEvent.click(screen.getByTestId('hub-active-session-chat:c1'));
    fireEvent.click(screen.getByTestId('hub-active-batch-delete'));
    act(() => onDeleteChats.mock.calls[0][1]());
    expect(screen.queryByTestId('hub-active-check-chat:c1')).toBeNull();
    expect(screen.getByTestId('hub-active-delete-chat:c1')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-active-batch-delete')).toBeNull();
  });

  it('cancels without deleting and forgets the ticks', () => {
    const onDeleteChats = vi.fn();
    renderRows(vi.fn(), onDeleteChats);
    enterSelectMode();
    fireEvent.click(screen.getByTestId('hub-active-session-chat:c1'));
    fireEvent.click(screen.getByTestId('hub-active-select-chat'));
    expect(onDeleteChats).not.toHaveBeenCalled();
    enterSelectMode();
    expect(screen.getByTestId('hub-active-check-chat:c1')).not.toBeChecked();
  });
});

describe('ActiveSessions select mode keyboard', () => {
  const start = (onDeleteChats = vi.fn()) => {
    renderRows(vi.fn(), onDeleteChats);
    fireEvent.click(screen.getByTestId('hub-active-select-chat'));
    return { onDeleteChats, focused: screen.getByTestId('hub-active-select-chat') };
  };

  it('Ctrl+A ticks every chat in the list', () => {
    const { focused } = start();
    fireEvent.keyDown(focused, { key: 'a', ctrlKey: true });
    for (const id of ['c1', 'c2', 'c3']) expect(screen.getByTestId(`hub-active-check-chat:${id}`)).toBeChecked();
    expect(screen.getByTestId('hub-active-batch-count')).toHaveTextContent('conversation.history.selectedCount:3');
  });

  it('Cmd+A does the same on a Mac, and keeps the browser from selecting the whole page', () => {
    const { focused } = start();
    const notPrevented = fireEvent.keyDown(focused, { key: 'A', metaKey: true });
    expect(notPrevented).toBe(false);
    expect(screen.getByTestId('hub-active-check-chat:c2')).toBeChecked();
  });

  it('Ctrl+A also works from a chat row that was just clicked', () => {
    start();
    fireEvent.click(screen.getByTestId('hub-active-session-chat:c2'));
    fireEvent.keyDown(screen.getByTestId('hub-active-session-chat:c2'), { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('hub-active-check-chat:c1')).toBeChecked();
    expect(screen.getByTestId('hub-active-check-chat:c3')).toBeChecked();
  });

  it('Delete asks to delete everything that is ticked, in list order', () => {
    const { onDeleteChats, focused } = start();
    fireEvent.keyDown(focused, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(focused, { key: 'Delete' });
    expect(onDeleteChats).toHaveBeenCalledTimes(1);
    expect(onDeleteChats.mock.calls[0][0]).toEqual(['c1', 'c2', 'c3']);
  });

  it('Backspace works as Delete, and does nothing when no chat is ticked', () => {
    const { onDeleteChats, focused } = start();
    fireEvent.keyDown(focused, { key: 'Backspace' });
    expect(onDeleteChats).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-active-session-chat:c1'));
    fireEvent.keyDown(focused, { key: 'Backspace' });
    expect(onDeleteChats.mock.calls[0][0]).toEqual(['c1']);
  });

  it('ignores a held-down Delete so the confirmation does not open twice', () => {
    const { onDeleteChats, focused } = start();
    fireEvent.keyDown(focused, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(focused, { key: 'Delete', repeat: true });
    expect(onDeleteChats).not.toHaveBeenCalled();
  });

  it('Escape leaves select mode and forgets the ticks', () => {
    const { focused } = start();
    fireEvent.keyDown(focused, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(focused, { key: 'Escape' });
    expect(screen.queryByTestId('hub-active-check-chat:c1')).toBeNull();
    expect(screen.getByTestId('hub-active-delete-chat:c1')).toBeInTheDocument();
  });

  it('does nothing outside select mode', () => {
    const onDeleteChats = vi.fn();
    renderRows(vi.fn(), onDeleteChats);
    const notPrevented = fireEvent.keyDown(screen.getByTestId('hub-active-select-chat'), { key: 'a', ctrlKey: true });
    expect(notPrevented).toBe(true);
    fireEvent.keyDown(screen.getByTestId('hub-active-select-chat'), { key: 'Delete' });
    expect(onDeleteChats).not.toHaveBeenCalled();
    expect(screen.queryByTestId('hub-active-check-chat:c1')).toBeNull();
  });

  it('tells the user about the shortcuts in the bar', () => {
    start();
    expect(screen.getByTestId('hub-active-batch-hint')).toHaveTextContent('guid.hubHome.shell.selectHint');
  });
});

