import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HubRail } from '@/renderer/pages/guid/HubHome/HubRail';

const history = vi.hoisted(() => ({ invoke: vi.fn() }));
const terminalMocks = vi.hoisted(() => ({
  sessions: [] as Array<{ id: string; title: string; status: 'running' | 'exited'; cwd: string }>,
  activeId: null as string | null,
  create: vi.fn().mockResolvedValue(null),
  write: vi.fn(),
  select: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: { database: { getConversationMessages: history } },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Menu: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }),
}));
vi.mock('@/renderer/pages/guid/HubHome/terminal/HumanTerminalContext', () => ({
  useHumanTerminals: () => ({
    status: 'ready', sessions: terminalMocks.sessions, activeId: terminalMocks.activeId,
    error: null, create: terminalMocks.create, write: terminalMocks.write, select: terminalMocks.select,
  }),
}));
vi.mock('@/renderer/pages/guid/HubHome/terminal/HumanTerminalViewport', () => ({
    HumanTerminalViewport: ({ sessionId, readOnly, noResize, inRail }: {
    sessionId: string; readOnly?: boolean; noResize?: boolean; inRail?: boolean;
  }) => <div data-testid='hub-console-output' data-session={sessionId}
    data-read-only={String(Boolean(readOnly))} data-no-resize={String(Boolean(noResize))} data-in-rail={String(Boolean(inRail))}/>,
}));
vi.mock('@/renderer/pages/guid/HubHome/monitor/HubSystemMonitor', () => ({
  HubSystemMonitor: ({ activities }: { activities: unknown[] }) => (
    <div data-testid='system-monitor-fixture'>Jobs: {activities.length}</div>
  ),
}));
vi.mock('@/renderer/pages/guid/HubHome/explorer/HubExplorer', () => ({
  HubExplorer: () => <div>Explorer stub</div>,
}));
vi.mock('@/renderer/pages/guid/HubHome/memory/HubSessionMemory', () => ({
  HubSessionMemory: () => <div>Memory stub</div>,
}));
vi.mock('@/renderer/pages/guid/HubHome/memory/HubSessionContext', () => ({
  HubSessionContext: () => <div>Context stub</div>,
}));
vi.mock('@/renderer/pages/guid/HubHome/memory/HubSessionSecrets', () => ({
  HubSessionSecrets: () => <div>Secrets stub</div>,
}));
vi.mock('@/renderer/pages/conversation/Preview/components/viewers/HTMLViewer', () => ({
  default: ({ content }: { content: string }) => <div data-testid='hub-html-viewer'>{content}</div>,
}));
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

beforeEach(() => {
  window.localStorage.clear();
    terminalMocks.sessions = [];
  terminalMocks.activeId = null;
  terminalMocks.create.mockClear();
  terminalMocks.select.mockClear();
  terminalMocks.write.mockClear();
  history.invoke.mockReset();
  history.invoke.mockResolvedValue({ items: [], total: 0, has_more: false });
});
afterEach(cleanup);
const event = (content: string, file_name: string) =>
  window.dispatchEvent(
    new CustomEvent('preview.open', {
      detail: { content, contentType: 'html', metadata: { file_name } },
    })
  );

describe('Hub Home Preview tabs', () => {
  it('opens System Monitor in the existing rail, without replacing the agent workspace', () => {
    window.localStorage.setItem(
      'tomni.hub.railTabs.v1',
      JSON.stringify({ openTabs: ['files', 'system-monitor'], active: 'system-monitor' })
    );
    render(<HubRail agentName='Agent' onFocusDirectory={() => {}} enableHomePreview activityItems={[]} />);
    expect(screen.getByTestId('hub-rail-tab-system-monitor')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hub-rail-system-monitor')).toContainElement(screen.getByTestId('system-monitor-fixture'));
    expect(screen.getByTestId('hub-workspace-panel')).toBeInTheDocument();
  });


  it('keeps Console as a separate secondary rail tab even without terminal sessions', () => {
    window.localStorage.setItem(
      'tomni.hub.railTabs.v1',
      JSON.stringify({ openTabs: ['files', 'console'], active: 'console' })
    );
    render(<HubRail agentName='Agent' onFocusDirectory={() => {}} enableHomePreview />);
    expect(screen.getByTestId('hub-rail-tab-console')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hub-rail-console')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-active-terminal')).toBeNull();
    expect(screen.getByText('guid.hubHome.terminal.empty')).toBeInTheDocument();
  });


    it('controls a chosen terminal in the Console rail during Chat', () => {
    terminalMocks.sessions = [
      { id: 'shell-1', title: 'Terminal 1', status: 'running', cwd: 'C:/' },
      { id: 'shell-2', title: 'Terminal 2', status: 'running', cwd: 'C:/' },
    ];
    terminalMocks.activeId = 'shell-1';
    window.localStorage.setItem('tomni.hub.railTabs.v1', JSON.stringify({ openTabs: ['files', 'console'], active: 'console' }));
    render(<HubRail agentName='Agent' onFocusDirectory={() => {}} enableHomePreview />);
    expect(screen.getByTestId('hub-console-output')).toHaveAttribute('data-session', 'shell-1');
    expect(screen.getByTestId('hub-console-output')).toHaveAttribute('data-read-only', 'false');
    expect(screen.getByTestId('hub-console-output')).toHaveAttribute('data-no-resize', 'false');

    fireEvent.change(screen.getByRole('combobox', { name: 'guid.hubHome.terminal.choose' }), {
      target: { value: 'shell-2' },
    });
    expect(screen.getByTestId('hub-console-output')).toHaveAttribute('data-session', 'shell-2');
    fireEvent.click(screen.getByTestId('hub-console-interrupt'));
    expect(terminalMocks.write).toHaveBeenCalledWith('shell-2', '\x03');
    fireEvent.click(screen.getByTestId('hub-console-new-terminal'));
    expect(terminalMocks.create).toHaveBeenCalledTimes(1);
  });

  it('leaves the rail read-only when Terminal Mode owns the main PTY', () => {
    terminalMocks.sessions = [{ id: 'shell-1', title: 'Terminal 1', status: 'running', cwd: 'C:/' }];
    terminalMocks.activeId = 'shell-1';
    window.localStorage.setItem('tomni.hub.railTabs.v1', JSON.stringify({ openTabs: ['files', 'console'], active: 'console' }));
    render(<HubRail agentName='Agent' onFocusDirectory={() => {}} enableHomePreview terminalMode />);
    expect(screen.getByTestId('hub-console-output')).toHaveAttribute('data-read-only', 'true');
    expect(screen.getByTestId('hub-console-output')).toHaveAttribute('data-no-resize', 'true');
    expect(screen.queryByTestId('hub-console-interrupt')).toBeNull();
  });

  it('accepts Home code preview events, creates multiple tabs and allows closing them', async () => {
    const onPreviewOpened = vi.fn();
    render(
      <HubRail
        workspaceName='Demo'
        agentName='Agent'
        onFocusDirectory={() => {}}
        enableHomePreview
        onPreviewOpened={onPreviewOpened}
      />
    );
    act(() => {
      event('<h1>First</h1>', 'first.html');
      event('<h1>Second</h1>', 'second.html');
    });
    expect(onPreviewOpened).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('hub-rail-tab-preview')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'first.html' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'second.html' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('hub-html-viewer')).toHaveTextContent('Second'));
    fireEvent.click(screen.getByRole('tab', { name: 'first.html' }));
    expect(screen.getByTestId('hub-html-viewer')).toHaveTextContent('First');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng preview first.html' }));
    expect(screen.queryByRole('tab', { name: 'first.html' })).toBeNull();
  });

  it('updates the same preview after streaming completes, names it, and opens fullscreen', async () => {
    const launchBrowser = vi.fn().mockResolvedValue(undefined);
    render(
      <HubRail agentName='Agent' onFocusDirectory={() => {}} enableHomePreview onOpenPreviewInBrowser={launchBrowser} />
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('preview.open', {
          detail: {
            content: '<html><head><title>Coffee Studio</title></head><body><h1>Old</h1></body>',
            contentType: 'html',
            metadata: { previewId: 'stream-001', title: 'html', pending: true },
          },
        })
      );
    });
    expect(screen.getByRole('tab', { name: 'Coffee Studio' })).toBeInTheDocument();
    expect(screen.getByText(/Đang viết code/)).toBeInTheDocument();
    expect(screen.getByTestId('hub-html-viewer')).toHaveTextContent('Old');
    act(() => {
      window.dispatchEvent(
        new CustomEvent('preview.update', {
          detail: {
            previewId: 'stream-001',
            content: '<html><title>Coffee Studio</title><h1>Final</h1></html>',
            pending: false,
          },
        })
      );
    });
    await waitFor(() => expect(screen.getByTestId('hub-html-viewer')).toHaveTextContent('Final'));
    expect(screen.getAllByRole('tab', { name: 'Coffee Studio' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mở toàn màn hình' }));
    expect(screen.getByRole('dialog', { name: 'Xem toàn màn hình: Coffee Studio' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng toàn màn hình' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở bằng Browser của Tomni' }));
    await waitFor(() => expect(launchBrowser).toHaveBeenCalledWith(expect.stringContaining('Final')));
  });

  it('streams full HTML from the activity source into the same open Preview while still running', async () => {
    render(<HubRail agentName='Agent' onFocusDirectory={() => {}} enableHomePreview />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('preview.open', {
          detail: {
            content: '<h1>Partial</h1>',
            contentType: 'html',
            metadata: { sourceId: 'agent:demo', blockIndex: 0, title: 'html', pending: true },
          },
        })
      );
    });
    expect(screen.getByTestId('hub-html-viewer')).toHaveTextContent('Partial');
    const completeHtml = `<h1>Complete</h1>${'a'.repeat(11000)}`;
    act(() => {
      window.dispatchEvent(
        new CustomEvent('preview.source-update', {
          detail: { sourceId: 'agent:demo', blocks: [completeHtml], pending: true },
        })
      );
    });
    expect(screen.getByTestId('hub-html-viewer')).toHaveTextContent('Complete');
    expect(screen.getByText(/Đang viết code/)).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('preview.source-update', {
          detail: { sourceId: 'agent:demo', blocks: [`${completeHtml}<p>Finish</p>`], pending: false },
        })
      );
    });
    await waitFor(() => expect(screen.getByTestId('hub-html-viewer')).toHaveTextContent('Finish'));
    expect(screen.queryByText(/Đang viết code/)).toBeNull();
  });

  it('opens the selected agent mini chat and keeps Activity separate from Live', () => {
    window.localStorage.setItem(
      'tomni.hub.railTabs.v1',
      JSON.stringify({ openTabs: ['files', 'chat', 'activity', 'live'], active: 'activity' })
    );
    const item = {
      id: 'agent:run1',
      sourceId: 'run1',
      kind: 'agent' as const,
      title: 'Coder',
      task: 'Fix OAuth',
      status: 'running' as const,
      startedAt: 1,
      updatedAt: 2,
      route: '/conversation/run1',
      preview: 'This is the latest reply',
      steps: [{ id: 'call1', label: 'read_file', state: 'done' as const }],
      canStop: true,
    };
    const onOpenActivity = vi.fn();
    history.invoke.mockResolvedValue({
      items: [
        {
          id: 'u1',
          conversation_id: 'run1',
          type: 'text',
          position: 'right',
          content: { content: 'Fix OAuth' },
          created_at: 1,
        },
        {
          id: 'a1',
          conversation_id: 'run1',
          type: 'text',
          position: 'left',
          content: { content: 'This is the latest reply' },
          created_at: 2,
        },
      ],
      has_more: false,
      total: 2,
    });
    render(
      <HubRail
        agentName='Coder'
        onFocusDirectory={() => {}}
        activityItem={item}
        enableHomePreview
        onOpenActivity={onOpenActivity}
      />
    );
    expect(screen.getByTestId('hub-rail-activity')).toHaveTextContent('read_file');
    fireEvent.click(screen.getByTestId('hub-rail-tab-chat'));
    expect(screen.getByTestId('hub-rail-chat')).toHaveTextContent('This is the latest reply');
    expect(screen.queryByTestId('hub-rail-tab-live')).toBeNull();
    expect(screen.queryByTestId('hub-rail-tab-artifacts')).toBeNull();
    expect(screen.queryByTestId('hub-rail-tab-diff')).toBeNull();
    expect(screen.queryByTestId('hub-rail-tab-subagents')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.live.open' }));
    expect(onOpenActivity).toHaveBeenCalledWith(item);
  });

  it('deduplicates a persisted partial response against the live stream and provides scroll-to-bottom', async () => {
    window.localStorage.setItem(
      'tomni.hub.railTabs.v1',
      JSON.stringify({ openTabs: ['files', 'chat'], active: 'chat' })
    );
    const content = 'A detailed HTML page answer with many streamed tokens';
    history.invoke.mockResolvedValue({
      items: [
        {
          id: 'u',
          conversation_id: 'run1',
          type: 'text',
          position: 'right',
          content: { content: 'Build HTML' },
          created_at: 1,
        },
        {
          id: 'a',
          conversation_id: 'run1',
          type: 'text',
          position: 'left',
          content: { content: content.slice(0, 27) },
          created_at: 2,
        },
      ],
      has_more: false,
    });
    render(
      <HubRail
        agentName='Coder'
        onFocusDirectory={() => {}}
        enableHomePreview
        activityItem={{
          id: 'agent:run1',
          sourceId: 'run1',
          title: 'Coder',
          kind: 'agent',
          task: 'Build HTML',
          status: 'running',
          startedAt: 1,
          updatedAt: 2,
          steps: [],
          preview: content,
          canStop: true,
        }}
      />
    );
    await waitFor(() => expect(screen.getByTestId('hub-inspector-mini-chat')).toHaveTextContent(content));
    expect(screen.queryByText(content.slice(0, 27), { exact: true })).toBeNull();
    const scroller = screen.getByTestId('hub-inspector-mini-chat').closest('.hub-inspector-detail-body') as HTMLElement;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 200 },
    });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    const button = screen.getByTestId('hub-mini-chat-scroll-bottom');
    fireEvent.click(button);
    expect(scroller.scrollTop).toBe(900);
    expect(screen.queryByTestId('hub-mini-chat-scroll-bottom')).toBeNull();
  });

  it('shows Subagents only for team activity that has reported members', () => {
    window.localStorage.setItem(
      'tomni.hub.railTabs.v1',
      JSON.stringify({ openTabs: ['files', 'subagents'], active: 'subagents' })
    );
    render(
      <HubRail
        agentName='Team'
        onFocusDirectory={() => {}}
        enableHomePreview
        activityItem={{
          id: 'team:one',
          sourceId: 'one',
          kind: 'team',
          title: 'OAuth Team',
          status: 'running',
          startedAt: 1,
          updatedAt: 1,
          steps: [
            { id: 'coder', label: 'Coder · editing token.ts', state: 'running' },
            { id: 'tester', label: 'Tester · checking login', state: 'done' },
          ],
          canStop: false,
        }}
      />
    );
    expect(screen.getByTestId('hub-rail-tab-subagents')).toBeInTheDocument();
    expect(screen.getByTestId('hub-rail-subagents')).toHaveTextContent('Coder · editing token.ts');
    fireEvent.change(screen.getByLabelText('guid.hubHome.inspector.selectMember'), { target: { value: 'tester' } });
    expect(screen.getByTestId('hub-rail-subagents')).toHaveTextContent('Tester · checking login');
  });

  it('does not expose Home-only monitor tabs on the full Session route', () => {
    window.localStorage.setItem(
      'tomni.hub.railTabs.v1',
      JSON.stringify({ openTabs: ['files', 'chat', 'activity', 'live'], active: 'chat' })
    );
    render(<HubRail agentName='Coder' conversationId='run1' onFocusDirectory={() => {}} />);
    expect(screen.queryByTestId('hub-rail-tab-chat')).toBeNull();
    expect(screen.queryByTestId('hub-rail-tab-activity')).toBeNull();
    expect(screen.getByTestId('hub-rail-tab-files')).toBeInTheDocument();
  });

  it('does not intercept previews on non-Home routes', () => {
    const onPreviewOpened = vi.fn();
    render(<HubRail agentName='Agent' onFocusDirectory={() => {}} onPreviewOpened={onPreviewOpened} />);
    act(() => {
      event('<button>Hello</button>', 'demo.html');
    });
    expect(onPreviewOpened).not.toHaveBeenCalled();
    expect(screen.queryByTestId('hub-rail-tab-preview')).toBeNull();
  });
});
