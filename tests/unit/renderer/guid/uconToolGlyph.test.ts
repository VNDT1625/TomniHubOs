import { describe, expect, it } from 'vitest';
import { eyeGlyphForRunningTrace, eyeGlyphForToolName } from '@/renderer/components/agents/useUconToolGlyph';
import type { HubActivityToolTrace } from '@/common/types/agent/hubActivity';

const trace = (name: string, status: HubActivityToolTrace['status']): HubActivityToolTrace => ({
  id: name,
  name,
  description: '',
  status,
});

describe('UCON running work eye signals', () => {
  it('recognizes structured tool IDs and never infers task text', () => {
    expect(eyeGlyphForToolName('tomny_team_edit')).toBe('code');
    expect(eyeGlyphForToolName('tomny_read')).toBe('scan');
    expect(eyeGlyphForToolName('browser_search')).toBe('scan');
    expect(eyeGlyphForToolName('terminal_command')).toBe('terminal');
    expect(eyeGlyphForToolName('database_query')).toBe('chart');
    expect(eyeGlyphForToolName('workflow_delegate')).toBe('nodes');
    expect(eyeGlyphForToolName('security_audit')).toBe('shield');
    expect(eyeGlyphForToolName('user prompt says write code')).toBeUndefined();
    expect(eyeGlyphForToolName('unknown_tool')).toBeUndefined();
    expect(eyeGlyphForToolName('code'.repeat(100))).toBeUndefined();
  });
  it('considers running tools only, never a finished historical action', () => {
    expect(eyeGlyphForRunningTrace([trace('tomny_edit', 'done')])).toBeUndefined();
    expect(eyeGlyphForRunningTrace([trace('tomny_write', 'running')])).toBe('code');
    expect(eyeGlyphForRunningTrace([trace('terminal_command', 'done'), trace('browser_search', 'running')])).toBe(
      'scan'
    );
    expect(eyeGlyphForRunningTrace([])).toBeUndefined();
  });
});
