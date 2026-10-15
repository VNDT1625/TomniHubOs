import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HubToolTrace } from '@/renderer/pages/guid/HubHome/inspector/HubToolTrace';

const ports = vi.hoisted(() => ({ history: vi.fn(), trace: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: { database: { getConversationMessages: { invoke: ports.history } } },
}));
vi.mock('@/common/types/agent/hubActivity', () => ({
  hubActivityChannels: { trace: { invoke: ports.trace } },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const item = {
  id: 'agent:c1',
  sourceId: 'c1',
  kind: 'agent' as const,
  title: 'Agent',
  status: 'running' as const,
  startedAt: 1,
  updatedAt: 2,
  canStop: true,
  steps: [{ id: 'tool-1', label: 'tomny_read', state: 'done' as const }],
};

beforeEach(() => {
  ports.history.mockReset();
  ports.trace.mockReset();
  ports.history.mockResolvedValue({ items: [], has_more: false });
  ports.trace.mockResolvedValue([
    {
      id: 'tool-1',
      name: 'tomny_read',
      description: 'Read README',
      status: 'done',
      input: 'filePath: README.md',
      output: 'File read successfully',
      durationMs: 247,
      startedAtMs: 1791980000000,
      finishedAtMs: 1791980000247,
    },
  ]);
});
afterEach(cleanup);

describe('Mission Control live Activity trace', () => {
  it('shows arguments, tool results and measured time without Tool Calls in Chat history', async () => {
    render(<HubToolTrace item={item} />);
    await waitFor(() => expect(screen.getByTestId('hub-tool-trace')).toHaveTextContent('247 ms'));
    expect(ports.trace).toHaveBeenCalledWith({ id: 'agent:c1' });
    expect(screen.getByText('filePath: README.md')).toBeInTheDocument();
    expect(screen.getByText('File read successfully')).toBeInTheDocument();
    expect(screen.getByTestId('hub-tool-trace')).toHaveTextContent('Bắt đầu');
    expect(screen.getByTestId('hub-tool-trace')).toHaveTextContent('Hoàn tất');
    expect(screen.getAllByText('tomny_read')).toHaveLength(1);
  });

    it('expands a Workflow group and separately opens each child input, output and timing', async () => {
    ports.trace.mockResolvedValue([
      {
        id: 'a', name: 'tomny_read', description: 'Read A', status: 'error',
        workflowId: 'wf-1', workflowStepId: 'A',
        input: '{"filePath":"a.txt"}', output: 'A error', durationMs: 140,
        startedAtMs: 1791980000000, finishedAtMs: 1791980000140,
      },
      {
        id: 'b', name: 'tomny_search', description: 'Search B', status: 'done',
        workflowId: 'wf-1', workflowStepId: 'B',
        input: '{"query":"foo"}', output: 'B complete', durationMs: 80,
        startedAtMs: 1791980000000, finishedAtMs: 1791980000080,
      },
      {
        id: 'c', name: 'tomny_glob', description: 'Find C', status: 'running',
        workflowId: 'wf-1', workflowStepId: 'C',
        input: '{"pattern":"*.ts"}', startedAtMs: Date.now() - 100,
      },
    ]);
    render(<HubToolTrace item={{ ...item, steps: [] }} />);
    const group = await screen.findByTestId('hub-workflow-group-wf-1');
        expect(group.querySelectorAll('.hub-inspector-workflow-tool')).toHaveLength(3);
    expect(group).toHaveTextContent('1 xong · 1 đang chạy · 1 lỗi');
    expect(group).not.toHaveAttribute('open');
    const summary = group.querySelector('summary');
    expect(summary).not.toBeNull();
    fireEvent.click(summary!);
    expect(group).toHaveAttribute('open');
    fireEvent.click(screen.getByTestId('hub-workflow-input-A'));
    expect(screen.getByTestId('hub-workflow-tool-A')).toHaveTextContent('filePath');
    fireEvent.click(screen.getByTestId('hub-workflow-output-A'));
    expect(screen.getByTestId('hub-workflow-tool-A')).toHaveTextContent('A error');
    expect(screen.getByTestId('hub-workflow-tool-A')).not.toHaveTextContent('filePath');
    fireEvent.click(screen.getByTestId('hub-workflow-time-A'));
    expect(screen.getByTestId('hub-workflow-tool-A')).toHaveTextContent('140 ms');
    expect(screen.getByTestId('hub-workflow-tool-A')).toHaveTextContent('Bắt đầu');
    expect(screen.getByTestId('hub-workflow-tool-A')).toHaveTextContent('Hoàn tất');
    expect(screen.getByTestId('hub-workflow-tool-B')).not.toHaveTextContent('B complete');
    fireEvent.click(screen.getByTestId('hub-workflow-output-B'));
    expect(screen.getByTestId('hub-workflow-tool-B')).toHaveTextContent('B complete');
  });

  it('keeps all recorded steps in the scrollable Activity pane without shrinking call cards', async () => {
    const calls = Array.from({ length: 65 }, (_, index) => ({
      id: `call-${index}`,
      name: 'tomny_read',
      description: `Read file ${index}`,
      status: 'done',
      durationMs: index + 1,
    }));
    ports.trace.mockResolvedValue(calls);
    render(<HubToolTrace item={{ ...item, steps: [] }} />);
    await waitFor(() => expect(screen.getAllByText('tomny_read')).toHaveLength(65));
    const pane = screen.getByTestId('hub-tool-trace');
    expect(pane.querySelectorAll('details.hub-inspector-tool-call')).toHaveLength(65);
    expect(pane).toHaveTextContent('Read file 64');
    const css = readFileSync('packages/desktop/src/renderer/styles/tomni-ui.css', 'utf8');
    expect(css).toMatch(/\.hub-inspector-trace\s*\{[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/\.hub-inspector-trace > \.hub-inspector-tool-call,[\s\S]*?flex:\s*0 0 auto;/);
  });

  it('shows no invented duration for older records without a clock', async () => {
    ports.trace.mockResolvedValue([{ id: 'tool-1', name: 'tomny_read', description: 'Read file', status: 'done' }]);
    render(<HubToolTrace item={item} />);
    await waitFor(() => expect(ports.trace).toHaveBeenCalledOnce());
    expect(screen.getByTestId('hub-tool-trace')).toHaveTextContent('—');
  });
});
