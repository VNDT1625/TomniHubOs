/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Render-load guard for the Home live agent card. Each step is wrapped in its own act() so commits are
 * counted per poll, per package event, per snapshot push and per permission click, not batched together.
 */
import type { HubActivityItem, HubOverviewToolAction } from '@/common/types/agent/hubActivity';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubAgents } from '@/renderer/pages/guid/HubHome/HubAgents';
import { HubToolTrace } from '@/renderer/pages/guid/HubHome/inspector/HubToolTrace';

const channels = vi.hoisted(() => ({
  overview: vi.fn(),
  trace: vi.fn(),
  getConversationMessages: vi.fn(),
}));

vi.mock('@/common/types/agent/hubActivity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/types/agent/hubActivity')>();
  return {
    ...actual,
    hubActivityChannels: {
      ...actual.hubActivityChannels,
      overview: { invoke: channels.overview },
      trace: { invoke: channels.trace },
    },
  };
});
vi.mock('@/common', () => ({
  ipcBridge: { database: { getConversationMessages: { invoke: channels.getConversationMessages } } },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const STEP_SEQUENCE = [
  'Đang tìm công cụ: context-mode',
  'Đã tìm công cụ: context-mode',
  'Đã dùng ToolSearch',
  'Đã dùng tools_search',
  'Đã dùng plugin',
];

const overviewActions = (): HubOverviewToolAction[] =>
  STEP_SEQUENCE.map((label, index) => ({
    id: `call-${index}`,
    number: index + 1,
    state: index === STEP_SEQUENCE.length - 1 ? 'running' : 'done',
    label,
  }));

const PERMISSION_OPTIONS = [
  { label: 'Có, cho phép một lần', value: 'allow_once' },
  { label: 'Có, luôn cho phép', value: 'allow_always' },
  { label: 'Không', value: 'deny' },
];

const agentItem = (overrides: Partial<HubActivityItem> = {}): HubActivityItem => ({
  id: 'agent:conv-1',
  kind: 'agent',
  sourceId: 'conv-1',
  title: 'Tomny',
  status: 'running',
  startedAt: 1,
  updatedAt: 2,
  steps: [
    { id: 'step-1', label: 'ToolSearch · context-mode', state: 'done' },
    { id: 'step-2', label: 'tools_search · plugin', state: 'done' },
    { id: 'step-3', label: 'plugin · connect', state: 'running' },
  ],
  // Main caps the streamed preview at 8 KB; use the full cap so the parsers run on realistic text.
  preview: `Đang kiểm tra plugin. ${'Nội dung trả lời với `code` và **đậm**. '.repeat(170)}`.slice(0, 8_000),
  canStop: true,
  ...overrides,
});

const permissionItem = (index: number): HubActivityItem =>
  agentItem({
    id: `agent:perm-${index}`,
    sourceId: `perm-${index}`,
    title: `Agent ${index}`,
    prompt: {
      id: `prompt-${index}`,
      title: 'tomny_read cần quyền đọc tệp',
      description: 'Bước đọc tệp của quy trình nhiều công cụ',
      options: PERMISSION_OPTIONS,
    },
    status: 'needs_input',
  });

const doneItem = (index: number): HubActivityItem =>
  agentItem({
    id: `agent:done-${index}`,
    sourceId: `done-${index}`,
    title: `Done ${index}`,
    status: 'done',
    steps: [],
    preview: undefined,
  });

const activityControls = (items: HubActivityItem[]) => ({
  items,
  ready: true,
  stop: vi.fn(async () => true),
  respond: vi.fn(async () => true),
  dismiss: vi.fn(async () => true),
});

type CardProps = React.ComponentProps<typeof HubAgents>;
const cardProps = (items: HubActivityItem[], respond?: CardProps['activity']['respond']): CardProps => {
  const activity = activityControls(items);
  if (respond) activity.respond = respond;
  return {
    activity,
    apps: [],
    pingAdvice: { limit: 6, value: null },
    onSelect: vi.fn(),
    onOpenItem: vi.fn(),
    onOpenApp: vi.fn(),
    onNavigate: vi.fn(),
    onFocusComposer: vi.fn(),
    assistants: [],
    onSelectAssistant: vi.fn(),
  };
};

describe('Home live agent card render load', () => {
  let commits: number[];
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    commits.push(actualDuration);
  };
  const mountCard = (props: CardProps) =>
    render(
      <Profiler id='hub-agent-card' onRender={onRender}>
        <HubAgents {...props} />
      </Profiler>
    );

  beforeEach(() => {
    commits = [];
    vi.useFakeTimers({ shouldAdvanceTime: false });
    window.localStorage.clear();
    channels.overview.mockReset().mockImplementation(async () => overviewActions());
    channels.trace.mockReset().mockImplementation(async () => []);
    channels.getConversationMessages
      .mockReset()
      .mockImplementation(async () => ({ items: [], total: 0, has_more: false }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('commits a bounded number of times while the plugin step sequence is polled', async () => {
    mountCard(cardProps([agentItem()]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const settled = commits.length;
    for (let poll = 0; poll < 10; poll += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_400);
      });
    }
    const polls = channels.overview.mock.calls.length;
    const commitsDuringPolling = commits.length - settled;
    console.info(`[card] polls=${polls} commitsDuringPolling=${commitsDuringPolling}`);
    expect(polls).toBeGreaterThanOrEqual(9);
    // The overview payload is identical on every poll, so polling must not commit the card again.
    expect(commitsDuringPolling).toBeLessThanOrEqual(2);
  });

  it('does not re-render the live card for 200 tomni-packages-changed events', async () => {
    mountCard(cardProps([agentItem()]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const settled = commits.length;
    for (let index = 0; index < 200; index += 1) {
      await act(async () => {
        window.dispatchEvent(new CustomEvent('tomni-packages-changed'));
      });
    }
    console.info(`[events] commitsFor200PackageEvents=${commits.length - settled}`);
    expect(commits.length - settled).toBe(0);
  });

  it('commits once per snapshot push, with no cascade from the items identity', async () => {
    const pushes = 200;
    const first = cardProps([agentItem()]);
    const { rerender } = mountCard(first);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const settled = commits.length;
    for (let index = 0; index < pushes; index += 1) {
      // Main pushes a fresh array with identical content every 200 ms while the agent is running.
      const next = cardProps([agentItem({ updatedAt: 2 + index })]);
      await act(async () => {
        rerender(
          <Profiler id='hub-agent-card' onRender={onRender}>
            <HubAgents {...next} />
          </Profiler>
        );
      });
    }
    const perPush = (commits.length - settled) / pushes;
    console.info(`[pushes] commitsPerPush=${perPush.toFixed(2)}`);
    expect(perPush).toBeLessThanOrEqual(1.5);
  });

  it('approves a permission with 8 active prompts in a 200-row list with one respond call and bounded commits', async () => {
    const prompts = Array.from({ length: 8 }, (_, index) => permissionItem(index));
    const rows = Array.from({ length: 192 }, (_, index) => doneItem(index));
    const respond = vi.fn(async () => true);
    const props = cardProps([...prompts, ...rows], respond);
    mountCard(props);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const approve = screen.getAllByTestId('hub-tile-answer-allow_once');
    expect(approve).toHaveLength(8);
    const settled = commits.length;
    await act(async () => {
      fireEvent.click(approve[0]!);
      fireEvent.click(approve[0]!);
      fireEvent.click(approve[0]!);
      await vi.advanceTimersByTimeAsync(0);
    });
    const clickCommits = commits.length - settled;
    console.info(`[approve] respondCalls=${respond.mock.calls.length} clickCommits=${clickCommits}`);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith('agent:perm-0', 'prompt-0', 'allow_once');
    expect(clickCommits).toBeLessThanOrEqual(4);
  });

  it('keeps the Execution Trace render cost bounded with 120 large tool rows polled every 850 ms', async () => {
    const big = 'x'.repeat(2_900);
    const calls = Array.from({ length: 120 }, (_, index) => ({
      id: `call-${index}`,
      name: index % 3 === 0 ? 'ToolSearch' : index % 3 === 1 ? 'plugin' : 'read_file',
      description: `Tool ${index}`,
      status: 'done' as const,
      input: JSON.stringify({ query: `context-mode ${index}`, pad: big.slice(0, 1_900) }),
      output: big,
      startedAtMs: 1_700_000_000_000 + index,
      finishedAtMs: 1_700_000_000_500 + index,
      durationMs: 500,
    }));
    channels.trace.mockImplementation(async () => calls);
    const durations: number[] = [];
    const onTraceRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => durations.push(actualDuration);
    render(
      <Profiler id='hub-tool-trace' onRender={onTraceRender}>
        <HubToolTrace item={agentItem()} />
      </Profiler>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (let poll = 0; poll < 10; poll += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(850);
      });
    }
    const worst = Math.max(...durations);
    const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    console.info(`[trace] renders=${durations.length} meanMs=${mean.toFixed(1)} worstMs=${worst.toFixed(1)}`);
    // Identical 850 ms trace polls must not re-render the rows: only the mount and first loads commit (mount, stored history, live snapshot).
    expect(durations.length).toBeLessThanOrEqual(4);
    expect(worst).toBeLessThan(1_000);
  });
});
