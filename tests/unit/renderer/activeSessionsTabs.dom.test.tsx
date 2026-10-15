import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    count: 1,
    canCreate: false,
    groups: [
      {
        sessions: [
          {
            key: 'chat:c1',
            title: 'Plan',
            display: 'idle',
            canClose: false,
            open: { kind: 'conversation', id: 'c1' },
          },
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
    canCreate: true,
    groups: [
      {
        sessions: [
          {
            key: 'com.tomni.browser:t1',
            title: 'Google',
            display: 'idle',
            canClose: true,
            open: { kind: 'package', appId: 'com.tomni.browser', sessionId: 't1' },
          },
        ],
      },
    ],
  },
  {
    appId: 'plain',
    title: 'Plain',
    icon: 'app',
    display: 'idle',
    count: 1,
    canCreate: false,
    groups: [
      {
        sessions: [
          {
            key: 'plain:p1',
            title: 'P1',
            display: 'idle',
            canClose: false,
            open: { kind: 'package', appId: 'plain', sessionId: 'p1' },
          },
        ],
      },
    ],
  },
];

const setup = (withHandlers = true) => {
  const onOpen = vi.fn();
  const onCreateSession = vi.fn();
  const onCloseSession = vi.fn();
  render(
    <ActiveSessions
      rows={rows}
      onOpen={onOpen}
      onCreateSession={withHandlers ? onCreateSession : undefined}
      onCloseSession={withHandlers ? onCloseSession : undefined}
    />
  );
  for (const row of rows) fireEvent.click(screen.getByTestId(`hub-active-toggle-${row.appId}`));
  return { onOpen, onCreateSession, onCloseSession };
};

afterEach(cleanup);

describe('ActiveSessions add/close buttons', () => {
  it('draws "+" only on apps that can create, and "x" only on sessions that can close', () => {
    setup();
    expect(screen.getByTestId('hub-active-add-com.tomni.browser')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-active-add-chat')).toBeNull();
    expect(screen.queryByTestId('hub-active-add-plain')).toBeNull();
    expect(screen.getByTestId('hub-active-close-com.tomni.browser:t1')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-active-close-chat:c1')).toBeNull();
    expect(screen.queryByTestId('hub-active-close-plain:p1')).toBeNull();
  });

  it('draws nothing without handlers', () => {
    setup(false);
    expect(screen.queryByTestId('hub-active-add-com.tomni.browser')).toBeNull();
    expect(screen.queryByTestId('hub-active-close-com.tomni.browser:t1')).toBeNull();
  });

  it('creates a session without toggling the row', () => {
    const { onCreateSession } = setup();
    const toggle = screen.getByTestId('hub-active-toggle-com.tomni.browser');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByTestId('hub-active-add-com.tomni.browser'));
    expect(onCreateSession).toHaveBeenCalledWith('com.tomni.browser');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes a session by app and session id without opening it', () => {
    const { onCloseSession, onOpen } = setup();
    fireEvent.click(screen.getByTestId('hub-active-close-com.tomni.browser:t1'));
    expect(onCloseSession).toHaveBeenCalledWith('com.tomni.browser', 't1');
    expect(onOpen).not.toHaveBeenCalled();
  });
});
