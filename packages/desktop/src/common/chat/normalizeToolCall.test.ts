import { describe, expect, it } from 'vitest';
import { normalizeToolCall, normalizeToolGroup } from './normalizeToolCall';

describe('normalizeToolCall', () => {
  it('ignores tool_call messages without call_id', () => {
    const result = normalizeToolCall({
      type: 'tool_call',
      content: {
        call_id: '',
        name: 'Glob',
        status: 'running',
        args: { pattern: '*.rs' },
      },
    } as any);

    expect(result).toBeUndefined();
  });

  it('prefers structured tool input over the human-readable description', () => {
    const [result] = normalizeToolGroup({
      type: 'tool_group',
      content: [
        {
          call_id: 'ide-1',
          name: 'ide_scan_repo',
          description: 'Scanning repository',
          input: { rootPath: 'C:/repo', maxFiles: 2000 },
          agent_id: 'repo-reader',
          render_output_as_markdown: false,
          status: 'Success',
          result_display: 'Files: 2000',
        },
      ],
    } as any);

    expect(result?.input).toBe(JSON.stringify({ rootPath: 'C:/repo', maxFiles: 2000 }, null, 2));
    expect(result?.agentId).toBe('repo-reader');
    expect(result?.output).toBe('Files: 2000');
  });
});
