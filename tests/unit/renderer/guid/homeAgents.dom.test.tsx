import type { HubActivityItem, HubActivityStatus } from '@/common/types/agent/hubActivity';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubAgents } from '@/renderer/pages/guid/HubHome/HubAgents';
import type { HubActivityControls } from '@/renderer/pages/guid/HubHome/useHubActivity';

const messages = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('@arco-design/web-react', () => ({ Message: messages }));
const translations = vi.hoisted(() => ({
  t: vi.fn((key: string, options?: { count?: number }) =>
    options?.count !== undefined ? `${key}:${options.count}` : key
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => translations }));

const item = (id: string, status: HubActivityStatus = 'running'): HubActivityItem => ({
  id,
  sourceId: id,
  kind: 'agent',
  title: id,
  status,
  startedAt: 1,
  updatedAt: 1,
  steps: [],
  canStop: true,
});
const activity = (items: HubActivityItem[]): HubActivityControls => ({
  items,
  ready: true,
  stop: vi.fn().mockResolvedValue(true),
  respond: vi.fn().mockResolvedValue(true),
  dismiss: vi.fn().mockResolvedValue(true),
});
const setup = (controls: HubActivityControls) => {
  const props = {
    apps: [],
    pingAdvice: { limit: 6, value: null },
    onSelect: vi.fn(),
    onOpenItem: vi.fn(),
    onOpenApp: vi.fn(),
    onNavigate: vi.fn(),
    onFocusComposer: vi.fn(),
  };
  const view = render(<HubAgents {...props} activity={controls} />);
  return {
    ...view,
    props,
    update: (next: HubActivityControls) => view.rerender(<HubAgents {...props} activity={next} />),
  };
};
const menu = (id: string, action: string) => {
  fireEvent.contextMenu(screen.getByTestId(`hub-agent-tile-${id}`), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`guid.hubHome.live.${action}`) }));
};
const saved = () =>
  JSON.parse(localStorage.getItem('tomni.hub.liveGrid') ?? '{}') as {
    order: string[];
    unfollowed: string[];
    unpinged: string[];
    slots: number | 'auto';
  };
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('Home welcome and agent action loops', () => {
  it('transitions welcome -> live -> terminal receipt -> welcome after removal', async () => {
    const controls = activity([]);
    const view = setup(controls);
    expect(screen.getByTestId('hub-promo-panel')).toBeInTheDocument();
    view.update({ ...controls, items: [item('a')] });
    expect(screen.queryByTestId('hub-promo-panel')).not.toBeInTheDocument();
    // Manual count changes the attention window, never inserts fake agents.
    expect(screen.queryAllByText('guid.hubHome.layout.startAgent')).toHaveLength(0);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    expect(saved().slots).toBe(5);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    view.update({ ...controls, items: [item('a', 'done')] });
    expect(screen.getByTestId('hub-agent-tile-a')).toHaveAttribute('data-status', 'done');
    menu('a', 'dismiss');
    await waitFor(() => expect(controls.dismiss).toHaveBeenCalledWith('a'));
    view.update({ ...controls, items: [] });
    expect(screen.getByTestId('hub-promo-panel')).toBeInTheDocument();
  });

  it('switches among solo, balanced, compact and original Auto card presentations', () => {
    setup(
      activity([
        {
          ...item('a'),
          preview: 'I am finishing the landing page for you.',
          steps: [{ id: '1', label: 'Editing app.tsx', state: 'running' }],
        },
        ...Array.from({ length: 7 }, (_, n) => item(`agent-${n}`)),
      ])
    );
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } });
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-density-solo');
    expect(screen.getByTestId('hub-agent-tile-a')).toHaveAttribute('data-density', 'solo');
    expect(screen.getByTestId('hub-monitor-recent')).toBeInTheDocument();
    expect(screen.getByTestId('hub-monitor-response')).toHaveTextContent('I am finishing the landing page');

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-density-solo');
    expect(screen.getByTestId('hub-monitor-recent')).toBeInTheDocument();
    expect(screen.getByTestId('hub-monitor-response')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-density-standard');
    expect(screen.queryByTestId('hub-monitor-recent')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-density-standard');
    expect(screen.queryByTestId('hub-monitor-recent')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } });
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-density-compact');
    expect(screen.getByTestId('hub-agent-tile-a')).toHaveAttribute('data-density', 'compact');

    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.live.auto' }));
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-agent-grid--auto');
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-density-compact');
    expect(screen.getByTestId('hub-agent-tile-a')).toHaveAttribute('data-density', 'compact');
  });

  it('Auto switches details at 2→3 and 6→7 agents, regardless of manual setting', () => {
    const first = { ...item('a'), preview: 'Currently composing the answer' };
    const view = setup(activity([first]));
    const grid = document.querySelector('.hub-agent-grid');
    expect(grid).toHaveClass('hub-density-solo');
    expect(screen.getByTestId('hub-monitor-response')).toBeInTheDocument();

    view.update(activity([first, item('b')]));
    expect(grid).toHaveClass('hub-density-solo');
    expect(screen.getByTestId('hub-monitor-response')).toBeInTheDocument();

    view.update(activity([first, item('b'), item('c')]));
    expect(grid).toHaveClass('hub-density-standard');
    expect(screen.queryByTestId('hub-monitor-response')).not.toBeInTheDocument();

    view.update(activity([first, ...Array.from({ length: 5 }, (_, n) => item(`agent-${n}`))]));
    expect(grid).toHaveClass('hub-density-standard');
    view.update(activity([first, ...Array.from({ length: 6 }, (_, n) => item(`agent-${n}`))]));
    expect(grid).toHaveClass('hub-density-compact');
    expect(screen.getByTestId('hub-agent-tile-a')).toHaveAttribute('data-density', 'compact');
  });

  it('keeps the full solo presentation for two actual sessions even if Custom requests 12 slots', () => {
    localStorage.setItem(
      'tomni.hub.liveGrid',
      JSON.stringify({
        order: [],
        unpinged: [],
        unfollowed: [],
        slots: 12,
      })
    );
    setup(activity([{ ...item('a'), preview: 'A completed draft answer' }, item('b')]));
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-density-solo');
    expect(screen.getByTestId('hub-monitor-response')).toBeInTheDocument();
    expect(screen.getByTestId('hub-agent-tile-b')).toHaveAttribute('data-density', 'solo');
  });

  it('places card N+1 below the visible viewport even when the last row has a free column', () => {
    let onResize: ((entries: Array<{ contentRect: { width: number; height: number } }>) => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: typeof onResize) {
          onResize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    try {
      localStorage.setItem('tomni.hub.liveGrid', JSON.stringify({ order: [], unpinged: [], unfollowed: [], slots: 5 }));
      setup(activity(Array.from({ length: 8 }, (_, i) => item(`agent-${i}`))));
      act(() => onResize?.([{ contentRect: { width: 992, height: 720 } }]));
      const grid = document.querySelector('.hub-agent-grid') as HTMLElement;
      expect(grid.style.gridTemplateColumns).toContain('repeat(3,');
      expect(grid.style.gridAutoRows).toContain('minmax(');
      expect(screen.getByTestId('hub-agent-tile-agent-4')).not.toHaveStyle({ gridRowStart: '3' });
      expect(screen.getByTestId('hub-agent-tile-agent-5')).toHaveStyle({ gridRowStart: '3' });
      expect(grid).toHaveClass('hub-density-standard');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('auto mode is the default and tags the grid with the resolved tile size', () => {
    setup(activity([item('a')]));
    const grid = document.querySelector('.hub-agent-grid');
    expect(grid).toHaveClass('hub-agent-grid--auto');
    expect(grid).toHaveClass('hub-size-xl');
    expect(grid).not.toHaveClass('hub-agent-grid--fixed');
    expect(saved().slots).toBe('auto');
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.live.auto' }));
    expect(saved().slots).toBe('auto');
  });

  it('selects a tile, opens it by double-click and offers keyboard actions', () => {
    const a = { ...item('a'), workspace: 'C:/Work/Test', route: '/conversation/a' };
    const view = setup(activity([a]));
    const tile = screen.getByTestId('hub-agent-tile-a');
    fireEvent.click(tile);
    expect(view.props.onSelect).toHaveBeenCalledWith(a);
    fireEvent.doubleClick(tile);
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(view.props.onOpenItem).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(tile, { key: ' ' });
    expect(view.props.onSelect).toHaveBeenCalledTimes(2);
  });

  it('lets long title and task text wrap instead of using an ellipsis', () => {
    setup(
      activity([
        { ...item('a', 'done'), title: 'Mot tieu de rat dai de xuong dong', task: 'Mot tac vu rat dai de xuong dong' },
      ])
    );

    const tile = screen.getByTestId('hub-agent-tile-a');
    expect(tile.querySelector('.hub-t-summary')).toBeInTheDocument();
    expect(tile.querySelector('.hub-t-task')).not.toHaveStyle({ whiteSpace: 'nowrap' });
  });

  it('summarizes the current step instead of mounting long HTML or chat text in the monitor tile', () => {
    setup(
      activity([
        {
          ...item('a'),
          task: 'Fix OAuth',
          steps: [{ id: 's1', label: 'Editing auth.ts', state: 'running' }],
          preview: '# Release notes\n'.repeat(200),
        },
      ])
    );

    const tile = screen.getByTestId('hub-agent-tile-a');
    expect(tile.querySelector('.hub-preview')).not.toBeInTheDocument();
    expect(tile.querySelector('.markdown-shadow')).not.toBeInTheDocument();
    expect(tile.querySelector('.hub-tile-overview')).toHaveTextContent('Editing auth.ts');
  });

  it('displays observed chat-only and HTML milestones rather than tool names as the primary work', () => {
    const first = item('a');
    const view = setup(activity([{ ...first, preview: '' }]));
    expect(screen.getByTestId('hub-monitor-stage-start')).toHaveTextContent('guid.hubHome.monitor.start');
    view.update({ ...activity([{ ...first, preview: 'Mình đang chuẩn bị nội dung cho bạn' }]) });
    expect(screen.getByTestId('hub-monitor-stage-answer')).toHaveTextContent('guid.hubHome.monitor.answer');
    view.update({ ...activity([{ ...first, preview: 'Mình đang làm trang web. ```html\n<html><body>' }]) });
    expect(screen.getByTestId('hub-monitor-stage-html')).toHaveTextContent('guid.hubHome.monitor.html');
    view.update({
      ...activity([{ ...first, status: 'done', preview: 'Mình đã tạo HTML. ```html\n<html></html>\n```' }]),
    });
    expect(screen.getByTestId('hub-monitor-stage-finish')).toHaveTextContent('guid.hubHome.monitor.finish');
  });

  it('offers a small button to open the existing full session and keeps double-click', () => {
    const view = setup(activity([{ ...item('a'), route: '/conversation/a' }]));
    fireEvent.click(screen.getByTestId('hub-tile-open-session'));
    expect(view.props.onOpenItem).toHaveBeenCalledOnce();
    expect(view.props.onSelect).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByTestId('hub-agent-tile-a'));
    expect(view.props.onOpenItem).toHaveBeenCalledTimes(2);
  });

  it('switches the visible teammate summary without opening a second session', () => {
    const view = setup(
      activity([
        {
          ...item('team:auth'),
          kind: 'team',
          steps: [
            { id: 'coder', label: 'Coder · editing auth.ts', state: 'running' },
            { id: 'tester', label: 'Tester · testing login', state: 'done' },
          ],
        },
      ])
    );
    expect(screen.getByTestId('hub-tile-overview')).toHaveTextContent('Coder · editing auth.ts');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tester' } });
    expect(screen.getByTestId('hub-tile-overview')).toHaveTextContent('Tester · testing login');
    expect(view.props.onOpenItem).not.toHaveBeenCalled();
  });

  it('deduplicates permission submissions and unlocks after failure', async () => {
    const a = {
      ...item('a', 'needs_input'),
      prompt: { id: 'p', title: 'Permission?', description: '', options: [{ label: 'Allow', value: 'allow' }] },
    };
    const controls = activity([a]);
    let finish!: (value: boolean) => void;
    vi.mocked(controls.respond).mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
    );
    const view = setup(controls);
    const answer = screen.getByTestId('hub-tile-answer-allow');
    fireEvent.click(answer);
    fireEvent.click(answer);
    expect(controls.respond).toHaveBeenCalledOnce();
    expect(controls.respond).toHaveBeenCalledWith('a', 'p', 'allow');
    expect(answer).toBeDisabled();
    expect(view.props.onSelect).not.toHaveBeenCalled();
    await act(async () => finish(false));
    expect(answer).not.toBeDisabled();
    expect(messages.warning).toHaveBeenCalledWith('guid.hubHome.live.actionFailed');
  });

  it('handles rejected stop and dismiss operations without unhandled rejection', async () => {
    const controls = activity([item('a')]);
    vi.mocked(controls.stop).mockRejectedValue(new Error('IPC unavailable'));
    vi.mocked(controls.dismiss).mockRejectedValue(new Error('IPC unavailable'));
    const view = setup(controls);
    menu('a', 'stop');
    await waitFor(() => expect(messages.error).toHaveBeenCalledTimes(1));
    view.update({ ...controls, items: [item('a', 'done')] });
    menu('a', 'dismiss');
    await waitFor(() => expect(messages.error).toHaveBeenCalledTimes(2));
  });

  it('persists follow/ping and keeps finished cards until the user explicitly dismisses them', async () => {
    const controls = activity([item('a')]);
    const view = setup(controls);
    menu('a', 'follow');
    menu('a', 'ping');
    expect(saved().unfollowed).toEqual(['a']);
    expect(saved().unpinged).toEqual(['a']);
    expect(screen.getByTestId('hub-agent-tile-a')).toHaveTextContent('guid.hubHome.live.pingOff');
    view.update({ ...controls, items: [item('a', 'done')] });
    expect(screen.getByTestId('hub-agent-tile-a')).toHaveAttribute('data-status', 'done');
    expect(controls.dismiss).not.toHaveBeenCalled();
    menu('a', 'dismiss');
    await waitFor(() => expect(controls.dismiss).toHaveBeenCalledOnce());
    view.update({ ...controls, items: [] });
    expect(saved().unfollowed).toEqual([]);
    expect(screen.getByTestId('hub-promo-panel')).toBeInTheDocument();
  });

  it('does not auto-remove a failed unfollowed run before the user sees it', async () => {
    const controls = activity([item('a')]);
    const view = setup(controls);
    menu('a', 'follow');
    view.update({ ...controls, items: [item('a', 'error')] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(controls.dismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('hub-agent-tile-a')).toBeInTheDocument();
  });

  it('does not save temporary escalation positions while dragging another tile', () => {
    localStorage.setItem(
      'tomni.hub.liveGrid',
      JSON.stringify({ order: ['a', 'b', 'c'], unpinged: ['b', 'c'], unfollowed: [], slots: 4 })
    );
    setup(activity([item('a'), item('b'), item('c', 'needs_input')]));
    expect(screen.getAllByRole('listitem').map((node) => node.getAttribute('aria-label'))[0]).toBe('c');
    expect(screen.getByTestId('hub-agent-tile-b')).not.toHaveAttribute('draggable');
    fireEvent.dragStart(screen.getByTestId('hub-agent-tile-b').querySelector('.hub-tile-head')!, {
      dataTransfer: { effectAllowed: '' },
    });
    fireEvent.drop(screen.getByTestId('hub-agent-tile-a'));
    expect(saved().order).toEqual(['b', 'a', 'c']);
  });

  it('keeps the chosen slot count across reloads and warns on resource-constrained ping', () => {
    localStorage.setItem(
      'tomni.hub.liveGrid',
      JSON.stringify({ order: [], unpinged: ['a'], unfollowed: [], slots: 6 })
    );
    const controls = activity([item('a'), item('b'), item('c')]);
    const props = {
      apps: [],
      pingAdvice: { limit: 2, value: 90, reason: 'ram' as const },
      onSelect: vi.fn(),
      onOpenItem: vi.fn(),
      onOpenApp: vi.fn(),
      onNavigate: vi.fn(),
      onFocusComposer: vi.fn(),
    };
    render(<HubAgents {...props} activity={controls} />);
    expect(document.querySelector('.hub-agent-grid')).toHaveClass('hub-agent-grid--fixed');
    expect(screen.getByRole('spinbutton')).toHaveValue(6);
    menu('a', 'ping');
    expect(messages.warning).toHaveBeenCalled();
    expect(saved().unpinged).toEqual([]);
  });
});
