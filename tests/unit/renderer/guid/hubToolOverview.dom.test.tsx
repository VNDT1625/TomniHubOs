import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HubToolOverview } from '@/renderer/pages/guid/HubHome/inspector/HubToolOverview';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';

const ipc = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock('@/common/types/agent/hubActivity', () => ({
  hubActivityChannels: { overview: { invoke: ipc.overview } },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
const item: HubActivityItem = {
  id: 'agent:one',
  sourceId: 'one',
  kind: 'agent',
  title: 'Coder',
  status: 'running',
  startedAt: 1,
  updatedAt: 2,
  canStop: true,
  steps: [],
};
beforeEach(() => {
  ipc.overview.mockReset();
});
afterEach(cleanup);

describe('Overview tool action strip', () => {
  it('shows numbered tool actions, preserves ordering and updates status without duplicating calls', async () => {
    const first = [
      { id: 'find', number: 1, state: 'done', label: 'Đã tìm công cụ: tomny_read' },
      { id: 'read', number: 2, state: 'running', label: 'Đang đọc README.md' },
    ];
    ipc.overview
      .mockResolvedValueOnce(first)
      .mockResolvedValue(
        first.map((a) => (a.id === 'read' ? Object.assign({}, a, { state: 'done', label: 'Đã đọc README.md' }) : a))
      );
    const view = render(<HubToolOverview item={item} density='solo' />);
    await waitFor(() => expect(screen.getByTestId('hub-overview-tool-2')).toHaveTextContent('Đang đọc README.md'));
    expect(screen.getByTestId('hub-monitor-stage-start')).toHaveTextContent('(0)');
    expect(screen.getByTestId('hub-overview-tool-1')).toHaveTextContent('(1)');
    expect(screen.getByTestId('hub-overview-tool-1')).toHaveTextContent('Đã tìm công cụ');
    expect(screen.getByTestId('hub-overview-tool-2')).toHaveTextContent('(2)');
    expect(screen.getAllByTestId(/^hub-overview-tool-/)).toHaveLength(2);
    view.rerender(<HubToolOverview item={{ ...item, status: 'done' }} density='solo' />);
    await waitFor(() => expect(screen.getByTestId('hub-overview-tool-2')).toHaveTextContent('Đã đọc README.md'));
    expect(screen.getAllByTestId(/^hub-overview-tool-/)).toHaveLength(2);
    expect(screen.getByTestId('hub-monitor-stage-finish')).toHaveTextContent('(3)');
    expect(screen.getByTestId('hub-monitor-stage-finish')).toHaveTextContent('Đã kết thúc');
  });

    it('keeps the old (0) flow and branches only the Workflow step in solo / standard', async () => {
    const branch = {
      id: 'workflow-branch:wf-1', number: 2, state: 'running', label: 'Các tool chạy song song', workflowId: 'wf-1',
      children: [
        { id: 'a', number: 2, state: 'error', label: 'Tool A lỗi', workflowId: 'wf-1', workflowStepId: 'A' },
        { id: 'b', number: 3, state: 'done', label: 'Tool B xong', workflowId: 'wf-1', workflowStepId: 'B' },
        { id: 'c', number: 4, state: 'running', label: 'Tool C chạy', workflowId: 'wf-1', workflowStepId: 'C' },
      ],
    };
    ipc.overview.mockResolvedValue([
      { id: 'pre', number: 1, state: 'done', label: 'Đã nạp công cụ' },
      branch,
            { id: 'post', number: 5, state: 'running', label: 'Tool E tiếp theo', workflowId: 'wf-1', workflowStage: 1,
        children: [{ id: 'e', number: 5, state: 'running', label: 'Tool E tiếp theo', workflowStepId: 'E' }] },
    ]);
    const view = render(<HubToolOverview item={item} density='solo' />);
    await waitFor(() => expect(screen.getByTestId('hub-overview-branch-wf-1')).toBeInTheDocument());
    expect(screen.getByTestId('hub-monitor-stage-start')).toHaveTextContent('(0)');
    expect(screen.getByTestId('hub-overview-tool-1')).toHaveTextContent('(1)');
    expect(screen.getByTestId('hub-overview-tool-2')).toHaveTextContent('Tool A lỗi');
    expect(screen.getByTestId('hub-overview-tool-3')).toHaveTextContent('Tool B xong');
    expect(screen.getByTestId('hub-overview-tool-4')).toHaveTextContent('Tool C chạy');
        expect(screen.getByTestId('hub-overview-tool-5')).toHaveTextContent('Tool E tiếp theo');
    expect(screen.getByTestId('hub-overview-tool-5').closest('.hub-tool-flow-branch')).toBeNull();
    expect(screen.getByTestId('hub-overview-branch-wf-1').querySelectorAll('.hub-tool-flow-branch-arrow')).toHaveLength(3);
    view.rerender(<HubToolOverview item={item} density='standard' />);
    expect(screen.getByTestId('hub-overview-tool-4')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-overview-branch-toggle-wf-1')).not.toBeInTheDocument();
  });

  it('uses a compact summary button instead of drawing three crowded branch rows', async () => {
    ipc.overview.mockResolvedValue([{
      id: 'workflow-branch:wf-mini', number: 1, state: 'error', label: 'Workflow', workflowId: 'wf-mini',
      children: [
        { id: 'a', number: 1, state: 'error', label: 'Tool A', workflowStepId: 'A' },
        { id: 'b', number: 2, state: 'done', label: 'Tool B', workflowStepId: 'B' },
        { id: 'c', number: 3, state: 'done', label: 'Tool C', workflowStepId: 'C' },
      ],
    }]);
    render(<HubToolOverview item={item} density='compact' />);
    const button = await screen.findByTestId('hub-overview-branch-toggle-wf-mini');
    expect(button).toHaveTextContent('3 tool · 2 ✓ · 1 ✕');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('hub-overview-tool-1')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('hub-overview-tool-1')).toHaveTextContent('Tool A');
    expect(screen.getByTestId('hub-overview-tool-2')).toHaveTextContent('Tool B');
    expect(screen.getByTestId('hub-overview-tool-3')).toHaveTextContent('Tool C');
    fireEvent.click(button);
    expect(screen.queryByTestId('hub-overview-tool-2')).not.toBeInTheDocument();
  });

  it('uses one inline numbered flow even when there is no saved Tool Trace', async () => {
    ipc.overview.mockResolvedValue([]);
    render(<HubToolOverview item={{ ...item, preview: 'I have read README.md', status: 'done' }} density='solo' />);
    await waitFor(() => expect(ipc.overview).toHaveBeenCalled());
    const flow = screen.getByTestId('hub-tool-flow');
    expect(flow).toHaveClass('hub-tool-flow--fallback');
    expect(screen.getByTestId('hub-monitor-stage-start')).toHaveTextContent('(0)');
    expect(screen.getByTestId('hub-monitor-stage-answer')).toHaveTextContent('(1)');
    expect(screen.getByTestId('hub-monitor-stage-finish')).toHaveTextContent('(2)');
    expect(flow.querySelectorAll('.hub-tool-flow-arrow')).toHaveLength(2);
    expect(flow.querySelectorAll('.hub-tool-flow-number')).toHaveLength(3);
  });

  it('lays out a single unboxed sequence instead of a grid of bordered tool cards', () => {
    const css = readFileSync('packages/desktop/src/renderer/styles/tomni-ui.css', 'utf8');
    const flow = css.split('.hub-tool-flow {')[1]?.split('}')[0] ?? '';
    const step = css.split('.hub-tool-flow-step {')[1]?.split('}')[0] ?? '';
    expect(flow).toContain('display: block;');
    const frame = css.split('.hub-tool-flow-frame {')[1]?.split('}')[0] ?? '';
    expect(frame).toContain('border: 1px solid var(--g-line);');
    expect(frame).toContain('border-radius: 8px;');
    expect(flow).toContain('overflow-y: auto;');
    expect(flow).not.toMatch(/grid-template-columns/);
    expect(step).toContain('display: inline;');
    expect(step).toContain('border: none;');
    expect(step).toContain('background: transparent;');
  });

  it('autofollows the latest step, pauses for manual reading and resumes when the user returns to the bottom', async () => {
    ipc.overview.mockResolvedValue([]);
    const view = render(<HubToolOverview item={item} density='solo' />);
    await act(async () => {
      await Promise.resolve();
    });
    const frame = screen.getByTestId('hub-tool-flow-frame');
    const scroll = screen.getByTestId('hub-tool-flow') as HTMLDivElement;
    expect(frame).toContainElement(scroll);
    expect(frame).toHaveTextContent('Tiến trình thực hiện');
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 160 },
    });
    scroll.scrollTop = 0;
    view.rerender(<HubToolOverview item={{ ...item, preview: 'Agent is answering' }} density='solo' />);
    expect(scroll.scrollTop).toBe(900);
    scroll.scrollTop = 70;
    fireEvent.scroll(scroll);
    view.rerender(
      <HubToolOverview
        item={{
          ...item,
          preview: '```html\n<html><body>Landing page</body></html>',
        }}
        density='solo'
      />
    );
    expect(scroll.scrollTop).toBe(70);
    scroll.scrollTop = 740;
    fireEvent.scroll(scroll);
    await act(async () => {
      view.rerender(<HubToolOverview item={{ ...item, status: 'done', preview: 'Finished!' }} density='solo' />);
      await Promise.resolve();
    });
    expect(scroll.scrollTop).toBe(900);
    expect(screen.getByTestId('hub-monitor-stage-finish')).toHaveTextContent('Đã kết thúc');
  });

  it('limits compact layout while keeping the most recent tool numbers', async () => {
    ipc.overview.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        number: i + 1,
        state: 'done',
        label: `Đã đọc file${i}.ts`,
      }))
    );
    render(<HubToolOverview item={item} density='compact' />);
    await waitFor(() => expect(screen.getAllByTestId(/^hub-overview-tool-/)).toHaveLength(4));
    expect(screen.getByTestId('hub-overview-tool-8')).toHaveTextContent('file7.ts');
    expect(screen.getByTestId('hub-tool-hidden-count')).toHaveTextContent('+4');
  });
});
