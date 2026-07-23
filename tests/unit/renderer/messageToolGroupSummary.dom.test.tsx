import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessage: {
        invoke: vi.fn(),
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      if (key === 'messages.steps.title') return (options?.count ?? 0) + ' action steps';
      if (key === 'messages.steps.viewFull') return 'View full';
      return options?.defaultValue ?? key;
    },
  }),
}));

describe('MessageToolGroupSummary', () => {
  it('loads full tool content when expanding a compact history item', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessage.invoke);
    invoke.mockResolvedValue({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_input: { pattern: 'needle', path: '.' },
          content: [{ type: 'content', content: { type: 'text', text: 'full output' } }],
        },
      },
    } as unknown as TMessage);

    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'message-1',
            conversation_id: 'conversation-1',
            type: 'acp_tool_call',
            content: {
              _compact: {
                truncated: true,
                original_size: 90000,
                preview_chars: 4096,
              },
              update: {
                session_update: 'tool_call',
                tool_call_id: 'tool-1',
                status: 'completed',
                title: 'rg',
                kind: 'search',
                raw_input: { pattern: 'needle', path: '.' },
                content: [{ type: 'content', content: { type: 'text', text: 'preview' } }],
              },
            },
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('1 action steps'));
    fireEvent.click(screen.getByText('rg'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith({
        conversation_id: 'conversation-1',
        message_id: 'message-1',
      });
    });
    expect(await screen.findByText('full output')).toBeInTheDocument();
  });

  it('renders StartAction and ToolSearch with exact input, output, status, and owner', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'gate-message',
            conversation_id: 'conversation-1',
            type: 'tool_group',
            content: [
              {
                call_id: 'gate-1',
                name: 'StartAction',
                description: '',
                status: 'Success',
                agent_id: 'repo-auditor',
                input: { goal: 'Inspect the repo' },
                result_display: 'Action gate opened.\nToolMap: [{"name":"ide_map"}]',
              },
              {
                call_id: 'schema-1',
                name: 'ToolSearch',
                description: '',
                status: 'Success',
                agent_id: 'repo-auditor',
                input: { query: 'ide map' },
                result_display: 'Loaded exact schemas for ide_map.',
              },
            ],
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('2 action steps'));
    expect(screen.getByText('StartAction')).toBeInTheDocument();
    expect(screen.getByText('ToolSearch')).toBeInTheDocument();
    expect(screen.getAllByText('repo-auditor')).toHaveLength(2);
    expect(screen.getAllByText('messages.steps.status.completed')).toHaveLength(2);

    fireEvent.click(screen.getByText('StartAction'));
    expect(screen.getByText(/Inspect the repo/u)).toBeInTheDocument();
    expect(screen.getByText(/ToolMap/u)).toBeInTheDocument();

    fireEvent.click(screen.getByText('ToolSearch'));
    expect(screen.getByText(/ide map/u)).toBeInTheDocument();
    expect(screen.getByText(/Loaded exact schemas/u)).toBeInTheDocument();
  });

  it('keeps StartAction visible and exposes its compact ToolMap as a separate step', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'tool-map-message',
            conversation_id: 'conversation-1',
            type: 'tool_group',
            content: [
              {
                call_id: 'gate-1',
                name: 'StartAction',
                description: '',
                status: 'Success',
                result_display: 'Action gate opened.',
              },
              {
                call_id: 'gate-1:tool-map',
                name: 'ToolMap',
                description: '2',
                status: 'Success',
                result_display: JSON.stringify(
                  {
                    count: 2,
                    recommended: ['ide_research'],
                    deferred: ['ide_read_file'],
                    tools: ['ide_research', 'ide_read_file'],
                  },
                  null,
                  2
                ),
              },
            ],
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('2 action steps'));
    expect(screen.getByText('StartAction')).toBeInTheDocument();
    expect(screen.getByText('ToolMap')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('ToolMap'));
    expect(screen.getByText(/ide_research/u)).toBeInTheDocument();
    expect(screen.getByText(/ide_read_file/u)).toBeInTheDocument();
  });

  it('shows an MCP validation payload as an error instead of completed', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'tool-message',
            conversation_id: 'conversation-1',
            type: 'tool_group',
            content: [
              {
                call_id: 'tool-1',
                name: 'ide_map',
                description: '',
                status: 'Success',
                result_display: 'MCP error -32602: Input validation error: rootPath is required',
              },
            ],
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('1 action steps'));
    expect(screen.getByText('messages.steps.status.error')).toBeInTheDocument();
    expect(screen.queryByText('messages.steps.status.completed')).not.toBeInTheDocument();
  });

  it('shows exit-zero command stdout as completed when it only quotes an MCP error', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'command-message',
            conversation_id: 'conversation-1',
            type: 'tool_group',
            content: [
              {
                call_id: 'command-1',
                name: 'tomny_command',
                description: '',
                status: 'Success',
                result_display:
                  '[exit 0 in 508ms]\n--- stdout ---\nThe report documents: MCP error -32602: Input validation error.',
              },
            ],
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('1 action steps'));
    expect(screen.getByText('messages.steps.status.completed')).toBeInTheDocument();
    expect(screen.queryByText('messages.steps.status.error')).not.toBeInTheDocument();
  });

  it('bounds long input/output and opens the complete payload in a dialog', () => {
    const longInput = JSON.stringify({ query: 'x'.repeat(3_000) });
    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'long-tool-message',
            conversation_id: 'conversation-1',
            type: 'tool_call',
            content: {
              call_id: 'long-tool-1',
              name: 'ide_search',
              status: 'completed',
              input: { query: 'x'.repeat(3_000) },
              output: 'short result',
            },
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('1 action steps'));
    fireEvent.click(screen.getByText('ide_search'));

    const viewFull = screen.getByRole('button', { name: 'View full' });
    expect(viewFull).toBeInTheDocument();
    expect(screen.getByText('short result')).toBeInTheDocument();

    fireEvent.click(viewFull);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const dialogText = screen.getByRole('dialog').textContent ?? '';
    expect(dialogText).toContain('query');
    expect(dialogText.length).toBeGreaterThan(longInput.length - 500);
  });

  it('shows the subagent owner beside its tool step', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'owned-tool-message',
            conversation_id: 'conversation-1',
            type: 'tool_group',
            content: [
              {
                call_id: 'owned-tool-1',
                name: 'ide_map',
                description: 'Mapping repository',
                status: 'Success',
                agent_id: 'mcp-researcher',
              },
            ],
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('1 action steps'));
    expect(screen.getByText('mcp-researcher')).toBeInTheDocument();
  });
});
