import React, { useMemo, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '@arco-design/web-react';
import { ChatDockHost, useChatDockItem, type ChatDockItem } from '@/renderer/pages/conversation/components/ChatDock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.all': 'All',
        'common.pin': 'Pin',
        'common.unpin': 'Unpin',
      })[key] ?? key,
  }),
}));

const TeamRegistration: React.FC = () => {
  const item = useMemo<ChatDockItem>(
    () => ({
      id: 'team',
      label: 'Team',
      mode: 'panel',
      order: 20,
      panelTitle: 'Team activity',
      panel: <div>Lightweight team overview</div>,
    }),
    []
  );
  useChatDockItem(item);
  return null;
};

const BrowserRegistration: React.FC<{ onToggle: () => void }> = ({ onToggle }) => {
  const [active, setActive] = useState(false);
  const item = useMemo<ChatDockItem>(
    () => ({
      id: 'browser',
      label: 'Browser',
      mode: 'toggle',
      order: 30,
      active,
      onActivate: () => {
        setActive((value) => !value);
        onToggle();
      },
    }),
    [active, onToggle]
  );
  useChatDockItem(item);
  return null;
};

type DockRegistrationProps = {
  id: string;
  label: string;
  order: number;
  mode?: ChatDockItem['mode'];
  panel?: React.ReactNode;
  onActivate?: () => void;
};

const DockRegistration: React.FC<DockRegistrationProps> = ({
  id,
  label,
  order,
  mode = 'action',
  panel,
  onActivate,
}) => {
  const item = useMemo<ChatDockItem>(
    () => ({ id, label, order, mode, panel, panelTitle: label, onActivate }),
    [id, label, mode, onActivate, order, panel]
  );
  useChatDockItem(item);
  return null;
};

const ManyDockRegistrations: React.FC = () => (
  <>
    <DockRegistration id='one' label='One' order={10} />
    <DockRegistration id='two' label='Two' order={20} />
    <DockRegistration id='three' label='Three' order={30} />
    <DockRegistration id='four' label='Four' order={40} />
    <DockRegistration id='five' label='Five' order={50} mode='panel' panel={<div>Fifth dock panel</div>} />
    <DockRegistration id='six' label='Six' order={60} />
  </>
);

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe('ChatDock', () => {
  it('hosts panel and toggle apps without feature-specific clip code', async () => {
    const onToggle = vi.fn();
    render(
      <ConfigProvider>
        <ChatDockHost>
          <BrowserRegistration onToggle={onToggle} />
          <TeamRegistration />
        </ChatDockHost>
      </ConfigProvider>
    );

    const dock = await screen.findByTestId('chat-dock');
    expect(
      within(dock)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Team', 'Browser', 'All']);
    expect(within(dock).queryByText('Team')).not.toBeInTheDocument();
    expect(within(dock).queryByText('Browser')).not.toBeInTheDocument();
    expect(within(dock).queryByText('All')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-dock-item-team'));
    expect(await screen.findByText('Lightweight team overview')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-dock-item-browser'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-dock-item-browser')).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders at most four quick pins and keeps every dock reachable from All', async () => {
    render(
      <ConfigProvider>
        <ChatDockHost>
          <ManyDockRegistrations />
        </ChatDockHost>
      </ConfigProvider>
    );

    const dock = await screen.findByTestId('chat-dock');
    expect(within(dock).getAllByRole('button')).toHaveLength(5);
    expect(screen.getByTestId('chat-dock-item-one')).toBeInTheDocument();
    expect(screen.getByTestId('chat-dock-item-two')).toBeInTheDocument();
    expect(screen.getByTestId('chat-dock-item-three')).toBeInTheDocument();
    expect(screen.getByTestId('chat-dock-item-four')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-dock-item-five')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-dock-item-six')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-dock-all'));
    expect(await screen.findByTestId('chat-dock-all-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-dock-all-item-five'));

    expect(await screen.findByText('Fifth dock panel')).toBeInTheDocument();
  });

  it('replaces the fourth quick pin when a fifth dock is pinned from All', async () => {
    render(
      <ConfigProvider>
        <ChatDockHost>
          <ManyDockRegistrations />
        </ChatDockHost>
      </ConfigProvider>
    );

    fireEvent.click(await screen.findByTestId('chat-dock-all'));
    fireEvent.click(await screen.findByTestId('chat-dock-pin-five'));

    await waitFor(() => expect(screen.getByTestId('chat-dock-item-five')).toBeInTheDocument());
    expect(screen.queryByTestId('chat-dock-item-four')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('chat-dock')).getAllByRole('button')).toHaveLength(5);
    expect(JSON.parse(localStorage.getItem('tomny.chatDock.pinned.v1') ?? '[]')).toEqual([
      'one',
      'two',
      'three',
      'five',
    ]);
  });
});
