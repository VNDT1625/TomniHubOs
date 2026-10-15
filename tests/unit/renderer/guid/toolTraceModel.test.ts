import { describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import {
  displayToolValue,
  extractToolTraceRows,
  redactToolValue,
} from '@/renderer/pages/guid/HubHome/inspector/toolTraceModel';

const toolGroup = (content: unknown[], created_at = 10): TMessage =>
  ({
    id: 'group-' + created_at,
    conversation_id: 'c1',
    type: 'tool_group',
    created_at,
    content,
  }) as TMessage;

describe('Inspector execution trace projection', () => {
  it('preserves arguments across updates and only reports real durations', () => {
    const messages = [
      toolGroup(
        [
          {
            call_id: 'a1',
            name: 'browser.navigate',
            description: 'Open page',
            input: { url: 'https://example.com' },
            status: 'Executing',
          },
        ],
        1
      ),
      toolGroup(
        [
          {
            call_id: 'a1',
            name: 'browser.navigate',
            description: 'Done',
            result_display: 'Loaded',
            duration_ms: 183,
            started_at_ms: 1791980000100,
            finished_at_ms: 1791980000283,
            status: 'Success',
          },
        ],
        2
      ),
      toolGroup(
        [
          {
            call_id: 'b1',
            name: 'edit_file',
            description: 'Update file',
            status: 'Error',
            result_display: 'Patch failed',
          },
        ],
        3
      ),
    ];
    const rows = extractToolTraceRows(messages);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'a1',
      status: 'done',
      durationMs: 183,
      startedAtMs: 1791980000100,
      finishedAtMs: 1791980000283,
      input: { url: 'https://example.com' },
      output: 'Loaded',
    });
    expect(rows[1]).toMatchObject({ id: 'b1', status: 'error', output: 'Patch failed' });
    expect(rows[1]?.durationMs).toBeUndefined();
  });

  it('merges ACP updates into the same tool trace and respects failure status', () => {
    const acp = (
      time: number,
      status: 'in_progress' | 'completed' | 'failed',
      input?: Record<string, unknown>,
      content?: Array<{ type: 'content'; content: { type: 'text'; text: string } }>
    ): TMessage =>
      ({
        id: `acp-${time}`,
        type: 'acp_tool_call',
        conversation_id: 'c1',
        created_at: time,
        content: {
          update: {
            sessionUpdate: 'tool_call',
            tool_call_id: 'acp-1',
            kind: 'execute',
            title: 'Run UI tests',
            status,
            rawInput: input,
            content,
          },
        },
      }) as TMessage;
    const events = [
      acp(1, 'in_progress', { command: 'vitest run' }),
      acp(2, 'completed', undefined, [{ type: 'content', content: { type: 'text', text: '3 tests passed' } }]),
    ];
    expect(extractToolTraceRows(events)).toEqual([
      expect.objectContaining({
        id: 'acp-1',
        name: 'execute',
        status: 'done',
        input: { command: 'vitest run' },
        output: ['3 tests passed'],
      }),
    ]);
    expect(extractToolTraceRows([acp(3, 'failed')])[0]?.status).toBe('error');
    expect(extractToolTraceRows(events)[0]?.durationMs).toBeUndefined();
  });

  it('filters hidden tool calls and redacts nested secrets before UI display', () => {
    const hidden = { ...toolGroup([{ call_id: 'hidden', name: 'secret_tool', status: 'Success' }]), hidden: true };
    expect(extractToolTraceRows([hidden])).toHaveLength(0);
    expect(
      redactToolValue({
        headers: { Authorization: 'Bearer abc' },
        args: { path: 'src/index.ts', api_key: 'abc', password: 'hunter2' },
      })
    ).toEqual({
      headers: { Authorization: '[REDACTED]' },
      args: { path: 'src/index.ts', api_key: '[REDACTED]', password: '[REDACTED]' },
    });
    expect(displayToolValue('Bearer [REDACTED]')).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});
