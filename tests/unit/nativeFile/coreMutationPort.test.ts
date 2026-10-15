import { describe, expect, it, vi } from 'vitest';

import {
  createTeamMutationPort,
  type TeamMutationService,
} from '../../../packages/desktop/src/process/resources/nativeFile/coreMutationPort';

const lease = { relPath: 'src/a.ts', agentId: 'ide-agent', intent: 'refactor' };

const team = (overrides: Partial<TeamMutationService> = {}): TeamMutationService => ({
  write: vi.fn(async () => ({ ok: true as const, bytes: 12 })),
  editReplace: vi.fn(async () => ({ ok: true as const, matches: 1 })),
  ...overrides,
});

describe('team-backed core mutation port', () => {
  it('reports successful writes and edits through the shared team service', async () => {
    const service = team();
    const port = createTeamMutationPort(() => service);
    const input = { workspace: 'C:/repo', agentId: 'core-1', relPath: 'src/a.ts' };

    await expect(port.write({ ...input, content: 'hello' })).resolves.toEqual({
      ok: true,
      message: 'Wrote src/a.ts (12 bytes) via MTUI.',
    });
    await expect(port.editReplace({ ...input, oldText: 'a', newText: 'b' })).resolves.toEqual({
      ok: true,
      message: 'Edited src/a.ts (1 match replaced) via MTUI.',
    });
    expect(service.write).toHaveBeenCalledWith('C:/repo', 'core-1', 'src/a.ts', 'hello');
    expect(service.editReplace).toHaveBeenCalledWith('C:/repo', 'core-1', 'src/a.ts', 'a', 'b');
  });

  it('names the lease holder instead of overwriting', async () => {
    const port = createTeamMutationPort(() =>
      team({
        write: vi.fn(async () => ({ ok: false as const, reason: 'held' as const, lease })),
        editReplace: vi.fn(async () => ({ ok: false as const, reason: 'held' as const, lease })),
      })
    );
    const base = { workspace: 'C:/repo', agentId: 'core-1', relPath: 'src/a.ts' };
    const written = await port.write({ ...base, content: 'x' });
    expect(written.ok).toBe(false);
    expect(written.message).toContain('held by ide-agent (refactor)');
    expect(written.message).toContain('write was refused');
    const edited = await port.editReplace({ ...base, oldText: 'a', newText: 'b' });
    expect(edited.message).toContain('edit was refused');
  });

  it('turns stale, ambiguous, and failed edits into instructions for the model', async () => {
    const outcomes = [
      { ok: false as const, reason: 'stale' as const, detail: 'anchor moved' },
      { ok: false as const, reason: 'ambiguous' as const, detail: '3 matches' },
      { ok: false as const, reason: 'error' as const, error: 'disk full' },
    ];
    const messages: string[] = [];
    for (const outcome of outcomes) {
      const port = createTeamMutationPort(() => team({ editReplace: vi.fn(async () => outcome) }));
      const result = await port.editReplace({
        workspace: 'C:/repo',
        agentId: 'core-1',
        relPath: 'src/a.ts',
        oldText: 'a',
        newText: 'b',
      });
      expect(result.ok).toBe(false);
      messages.push(result.message);
    }
    expect(messages[0]).toContain('STALE: anchor moved');
    expect(messages[0]).toContain('Do not force it');
    expect(messages[1]).toContain('AMBIGUOUS: 3 matches');
    expect(messages[2]).toBe('Edit failed: disk full');
  });

  it('resolves the team service lazily on every call', async () => {
    const getTeam = vi.fn(() => team());
    const port = createTeamMutationPort(getTeam);
    expect(getTeam).not.toHaveBeenCalled();
    await port.write({ workspace: 'C:/repo', agentId: 'core-1', relPath: 'a.txt', content: 'x' });
    expect(getTeam).toHaveBeenCalledTimes(1);
  });
});
