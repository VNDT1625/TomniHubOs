import { describe, expect, it } from 'vitest';
import type { IMessageAcpToolCall, IMessageToolGroup } from '@/common/chat/chatLib';
import { normalizeAcpToolCall, normalizeToolCall, normalizeToolGroup } from '@/common/chat/normalizeToolCall';

describe('normalizeToolCall', () => {
  it('normalizes compact snake_case acp tool calls from history responses', () => {
    const result = normalizeAcpToolCall({
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
    } as unknown as IMessageAcpToolCall);

    expect(result).toMatchObject({
      key: 'tool-1',
      name: 'rg',
      status: 'completed',
      description: '"needle" in .',
      output: 'preview',
      truncated: true,
      messageId: 'message-1',
      conversationId: 'conversation-1',
    });
  });

  it('does not render an MCP validation payload as a completed tool_group step', () => {
    const result = normalizeToolGroup({
      id: 'message-2',
      type: 'tool_group',
      conversation_id: 'conversation-1',
      content: [
        {
          call_id: 'call-2',
          name: 'ide_map',
          description: '',
          render_output_as_markdown: false,
          status: 'Success',
          result_display:
            'MCP error -32602: Input validation error: Invalid arguments for tool ide_map: rootPath is required',
        },
      ],
    } satisfies IMessageToolGroup);

    expect(result).toEqual([expect.objectContaining({ key: 'call-2', name: 'ide_map', status: 'error' })]);
  });

  it('keeps a successful command completed when stdout merely quotes an MCP error', () => {
    const result = normalizeToolGroup({
      id: 'message-command',
      type: 'tool_group',
      conversation_id: 'conversation-1',
      content: [
        {
          call_id: 'command-1',
          name: 'tomny_command',
          description: '',
          render_output_as_markdown: false,
          status: 'Success',
          result_display:
            '[exit 0 in 508ms]\n--- stdout ---\nThe report documents: MCP error -32602: Input validation error.',
        },
      ],
    } satisfies IMessageToolGroup);

    expect(result).toEqual([expect.objectContaining({ key: 'command-1', name: 'tomny_command', status: 'completed' })]);
  });

  it('marks a generic tool_call error payload as failed even when status says completed', () => {
    const result = normalizeToolCall({
      id: 'message-3',
      type: 'tool_call',
      conversation_id: 'conversation-1',
      content: {
        call_id: 'call-3',
        name: 'ide_search',
        status: 'completed',
        args: {},
        error: 'MCP error -32602: Invalid arguments for tool ide_search',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        key: 'call-3',
        name: 'ide_search',
        status: 'error',
        output: expect.stringContaining('-32602'),
      })
    );
  });
});
