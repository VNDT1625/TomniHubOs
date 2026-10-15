import { describe, expect, it } from 'vitest';
import { decideCliSlashCommand, parseSlashCommandName } from '@/common/chat/slash/compatibility';
import type { CliCommandDiscovery } from '@/common/chat/slash/types';

const available: CliCommandDiscovery = {
  status: 'available',
  commands: [
    { name: 'compact', description: 'Compact history' },
    { name: 'guide', description: 'Native provider guide' },
  ],
};

describe('ACP command compatibility / safe fallback', () => {
  it('parses slash invocations without confusing paths and ordinary text', () => {
    expect(parseSlashCommandName('/compact more')).toBe('compact');
    expect(parseSlashCommandName(' /project:review --all')).toBe('project:review');
    expect(parseSlashCommandName('/home/user')).toBeNull();
    expect(parseSlashCommandName('Please run /compact')).toBeNull();
    expect(parseSlashCommandName('https://example.com')).toBeNull();
    expect(parseSlashCommandName('//compact')).toBeNull();
  });

  it('prefers an advertised ACP command over a Tomni builtin of the same name', () => {
    expect(decideCliSlashCommand('/guide docs', available)).toEqual({ kind: 'native', name: 'guide' });
        expect(decideCliSlashCommand('/compact', available)).toEqual({ kind: 'native', name: 'compact' });
  });

  it('rejects an advertised native command when its interactive UI is not implemented', () => {
    expect(
      decideCliSlashCommand('/btw question', {
        status: 'available',
        commands: [{ name: 'btw', description: 'Ask alongside the current session' }],
      })
    ).toEqual({ kind: 'unsupported', name: 'btw', reason: 'requires-ui' });
  });

  it('keeps Tomni builtin slash modes accessible without ACP advertisement', () => {
    expect(decideCliSlashCommand('/goal finish work', available)).toEqual({ kind: 'tomni', name: 'goal' });
    expect(decideCliSlashCommand('/remember a preference', available)).toEqual({ kind: 'tomni', name: 'remember' });
  });

  it('refuses unadvertised provider commands rather than downgrading them to prompts', () => {
    expect(decideCliSlashCommand('/future_command arg', available)).toEqual({
      kind: 'unsupported',
      name: 'future_command',
      reason: 'unknown-command',
    });
    expect(decideCliSlashCommand('/compact', { status: 'unsupported', commands: [] })).toEqual({
      kind: 'unsupported',
      name: 'compact',
      reason: 'unknown-command',
    });
        expect(decideCliSlashCommand('/compact', { status: 'unavailable', commands: [] })).toEqual({
      kind: 'unsupported',
      name: 'compact',
      reason: 'provider-unavailable',
    });
    expect(decideCliSlashCommand('/compact', { status: 'authentication-required', commands: [] })).toEqual({
      kind: 'unsupported', name: 'compact', reason: 'provider-authentication-required',
    });
  });

  it('does not treat other messages or absolute paths as commands', () => {
    expect(decideCliSlashCommand('/home/user', available)).toEqual({ kind: 'ordinary' });
    expect(decideCliSlashCommand('hello /compact', available)).toEqual({ kind: 'ordinary' });
  });
});
