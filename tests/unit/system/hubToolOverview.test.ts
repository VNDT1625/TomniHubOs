import { describe, expect, it } from 'vitest';
import type { HubActivityToolTrace } from '@/common/types/agent/hubActivity';
import { projectHubOverviewActions, toolActionDescription } from '@process/system/hubActivity/hubToolOverview';
import { HubActivityRegistry } from '@process/system/hubActivity/hubActivityRegistry';
import { projectHubToolTrace } from '@process/system/hubActivity/hubToolTrace';

const tool = (name: string, status: HubActivityToolTrace['status'], input?: unknown): HubActivityToolTrace => ({
  id: name,
  name,
  status,
  description: name,
  input: input === undefined ? undefined : JSON.stringify(input),
});

describe('Hub Overview actions from redacted Main Tool Trace', () => {
  it('describes actual read/write/schema-search actions and changes the verb on completion', () => {
    const read = tool('tomny_read', 'running', { filePath: 'C:/work/app/src/Home.tsx' });
    expect(toolActionDescription(read)).toBe('Đang đọc Home.tsx');
    expect(toolActionDescription({ ...read, status: 'done' })).toBe('Đã đọc Home.tsx');
    expect(toolActionDescription({ ...read, status: 'error' })).toBe('Không thành công: đọc home.tsx');
    expect(toolActionDescription(tool('tomny_team_edit', 'running', { relPath: 'src/auth.ts' }))).toBe(
      'Đang chỉnh sửa auth.ts'
    );
    expect(toolActionDescription(tool('ToolSearch', 'running', { query: 'tomny_read' }))).toBe(
      'Đang tìm công cụ: tomny_read'
    );
    expect(toolActionDescription(tool('ToolSearch', 'done', { query: 'tomny_read' }))).toBe(
      'Đã tìm công cụ: tomny_read'
    );
  });

    it('groups child tools into one numbered Workflow fan-out without changing ordinary steps', () => {
    const actions = projectHubOverviewActions([
      { ...tool('ToolSearch', 'done'), ordinal: 1 },
      { ...tool('tomny_read', 'error'), id: 'a', ordinal: 2, workflowId: 'wf-1', workflowStepId: 'A' },
      { ...tool('tomny_search', 'done'), id: 'b', ordinal: 3, workflowId: 'wf-1', workflowStepId: 'B' },
      { ...tool('tomny_glob', 'running'), id: 'c', ordinal: 4, workflowId: 'wf-1', workflowStepId: 'C' },
      { ...tool('tomny_write', 'done'), id: 'e', ordinal: 5, workflowId: 'wf-1', workflowStepId: 'E', workflowStage: 1 },
    ]);
    expect(actions).toHaveLength(3);
    expect(actions.map((action) => action.number)).toEqual([1, 2, 5]);
    expect(actions[1]).toMatchObject({
      workflowId: 'wf-1',
      state: 'running',
      children: [
        { workflowStepId: 'A', number: 2, state: 'error' },
        { workflowStepId: 'B', number: 3, state: 'done' },
        { workflowStepId: 'C', number: 4, state: 'running' },
      ],
    });
        expect(actions[2]).toMatchObject({ workflowId: 'wf-1', workflowStage: 1, children: [{ workflowStepId: 'E', number: 5 }] });
    const source = projectHubToolTrace({
      call_id: 'child-a', name: 'tomny_read', status: 'Executing',
            workflow_id: 'wf-1', workflow_step_id: 'A', workflow_stage: 0,
      input: { filePath: 'readme.md', authorization: 'Bearer secret123' },
    });
        expect(source).toMatchObject({ workflowId: 'wf-1', workflowStepId: 'A', workflowStage: 0 });
    expect(source?.input).not.toContain('secret123');
  });

  it('numbers calls in chronological order, never duplicates status updates, does not expose full arguments', () => {
    const actions = projectHubOverviewActions([
      tool('ToolSearch', 'done', { query: 'tomny_read' }),
      tool('tomny_read', 'running', { filePath: '/work/README.md', api_key: '[REDACTED]' }),
      tool('tomny_write', 'done', { filePath: 'out.html' }),
    ]);
    expect(actions.map((entry) => entry.number)).toEqual([1, 2, 3]);
    expect(actions[1]).toMatchObject({ state: 'running', label: 'Đang đọc README.md' });
    expect(JSON.stringify(actions)).not.toContain('api_key');
    expect(JSON.stringify(actions)).not.toContain('/work/');
  });

  it('keeps the original ordinal when the trace has dropped older calls', () => {
    const actions = projectHubOverviewActions([
      { ...tool('tomny_read', 'done'), ordinal: 120 },
      { ...tool('tomny_write', 'running'), ordinal: 121 },
    ]);
    expect(actions.map((a) => a.number)).toEqual([120, 121]);
  });

  it('keeps ordinals across the 120-entry cap and resets numbering for a new turn', () => {
    const registry = new HubActivityRegistry();
    registry.upsert('agent', 's1', { status: 'running' });
    for (let index = 1; index <= 123; index += 1) {
      registry.traceTool('agent', 's1', {
        id: `call-${index}`,
        name: 'tomny_read',
        description: 'Read',
        status: 'done',
      });
    }
    const calls = registry.toolTrace('agent', 's1');
    expect(calls).toHaveLength(120);
    expect(projectHubOverviewActions(calls)[0]?.number).toBe(4);
    expect(projectHubOverviewActions(calls).at(-1)?.number).toBe(123);
    registry.traceTool('agent', 's1', {
      id: 'call-123',
      name: 'tomny_read',
      description: 'Read',
      status: 'error',
    });
    expect(projectHubOverviewActions(registry.toolTrace('agent', 's1')).at(-1)).toMatchObject({
      number: 123,
      state: 'error',
    });
    registry.clearToolTrace('agent', 's1');
    registry.traceTool('agent', 's1', {
      id: 'new-turn',
      name: 'ToolSearch',
      description: 'Search',
      status: 'running',
    });
    expect(projectHubOverviewActions(registry.toolTrace('agent', 's1'))[0]?.number).toBe(1);
  });

  it('does not show raw commands, redacted secrets or arbitrary tool input', () => {
    expect(toolActionDescription(tool('tomny_command', 'running', { command: 'echo password-secret' }))).toBe(
      'Đang chạy lệnh'
    );
    expect(toolActionDescription(tool('tomny_read', 'running', { filePath: '[REDACTED]' }))).toBe('Đang đọc tệp');
    expect(toolActionDescription(tool('tool_unknown', 'running', { api_key: 'SECRET' }))).toBe(
      'Đang dùng tool_unknown'
    );
  });
});
