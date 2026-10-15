import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createTeamBatchEditor } from '@package-apps/ide/process/collaboration/teamEdit/teamBatchEdit';

const ROOT = path.resolve('C:/work/project');

const setup = (options: { held?: string; run?: (args: string[]) => Record<string, unknown> | Promise<Record<string, unknown>> } = {}) => {
  const claimed: string[] = [];
  const released: string[] = [];
  const team = {
    claim: vi.fn((_root: string, agentId: string, relPath: string) => {
      if (options.held === relPath) {
        return { ok: false as const, reason: 'held' as const, lease: { relPath, agentId: 'other-agent', intent: 'refactor' } };
      }
      claimed.push(relPath);
      return { ok: true as const, lease: { relPath, agentId }, renewed: false };
    }),
    release: vi.fn((_root: string, _agent: string, relPath: string) => {
      released.push(relPath);
      return true;
    }),
  };
  const calls: string[][] = [];
  const runMtui = vi.fn(async (args: string[]) => {
    calls.push(args);
    return options.run ? options.run(args) : { ok: true };
  });
  return { editor: createTeamBatchEditor({ team, runMtui }), team, runMtui, calls, claimed, released };
};

describe('editMany', () => {
  it('sends every file and edit to one MTUI batch and tells the model how to undo it', async () => {
    let spec: unknown;
    const { editor, calls, released } = setup({
      run: async (args) => {
        spec = JSON.parse(await readFile(args[args.indexOf('--spec') + 1]!, 'utf8'));
        return { ok: true, group_id: 'op_1', files: [{ matches: 2 }, { matches: 1 }] };
      },
    });

    const outcome = await editor.editMany(ROOT, 'agent-1', [
      { relPath: 'src\\a.ts', edits: [{ oldText: 'x', newText: 'y' }, { oldText: 'p', newText: 'q', all: true }] },
      { relPath: 'src/b.ts', edits: [{ oldText: 'm', newText: 'n' }] },
    ]);

    expect(outcome).toEqual({
      ok: true,
      message: expect.stringContaining('Edited 2 files (3 replacements) via MTUI. Undo all of it with tomny_team_undo groupId=op_1'),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 3)).toEqual(['--json', 'edit-many', '--spec']);
    expect(spec).toEqual([
      { file: 'src/a.ts', edits: [{ old: 'x', new: 'y', all: false }, { old: 'p', new: 'q', all: true }] },
      { file: 'src/b.ts', edits: [{ old: 'm', new: 'n', all: false }] },
    ]);
    expect(released.toSorted()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('changes nothing when another agent holds any of the files, and releases what it took', async () => {
    const { editor, runMtui, released } = setup({ held: 'src/b.ts' });

    const outcome = await editor.editMany(ROOT, 'agent-1', [
      { relPath: 'src/a.ts', edits: [{ oldText: 'x', newText: 'y' }] },
      { relPath: 'src/b.ts', edits: [{ oldText: 'm', newText: 'n' }] },
    ]);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('CONFLICT: src/b.ts is held by other-agent (refactor)');
    expect(outcome.message).toContain('nothing was changed');
    expect(runMtui).not.toHaveBeenCalled();
    expect(released).toEqual(['src/a.ts']);
  });

  it('refuses paths that leave the workspace and empty or oversized batches before any lease', async () => {
    const { editor, team } = setup();
    for (const relPath of ['../outside.ts', '/etc/passwd', 'C:/Windows/x.ts', 'a/../../b.ts', '']) {
      const outcome = await editor.editMany(ROOT, 'agent-1', [{ relPath, edits: [{ oldText: 'x', newText: 'y' }] }]);
      expect(outcome.ok).toBe(false);
    }
    expect((await editor.editMany(ROOT, 'agent-1', [])).ok).toBe(false);
    expect((await editor.editMany(ROOT, 'agent-1', [{ relPath: 'a.ts', edits: [] }])).ok).toBe(false);
    expect(team.claim).not.toHaveBeenCalled();
  });

  it('explains a stale, ambiguous or conflicting batch so it can be rebased', async () => {
    const stale = setup({ run: () => ({ ok: false, error_type: 'NO_MATCH', message: 'Edit 2 of 2: text not found in a.ts' }) });
    const staleOutcome = await stale.editor.editMany(ROOT, 'a', [{ relPath: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }] }]);
    expect(staleOutcome.message).toMatch(/^STALE: Edit 2 of 2.*Nothing was written\. Re-read/su);

    const ambiguous = setup({ run: () => ({ ok: false, error_type: 'MULTIPLE_MATCHES', message: 'found 3 matches' }) });
    const ambiguousOutcome = await ambiguous.editor.editMany(ROOT, 'a', [{ relPath: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }] }]);
    expect(ambiguousOutcome.message).toMatch(/^AMBIGUOUS:.*all=true/su);
  });
});

describe('applyPatch', () => {
  const patch = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-x', '+y', '--- /dev/null', '+++ b/src/new.ts', '@@ -0,0 +1 @@', '+hi', ''].join('\n');

  it('takes the lease of every file the diff names and applies it through MTUI', async () => {
    const { editor, calls, claimed, released } = setup({
      run: () => ({ ok: true, files: [{ operation_id: 'op_a' }, { operation_id: 'op_b' }] }),
    });

    const outcome = await editor.applyPatch(ROOT, 'agent-1', patch);

    expect(outcome).toEqual({ ok: true, message: expect.stringContaining('Patched 2 files via MTUI') });
    expect(calls[0]!.slice(0, 3)).toEqual(['--json', 'apply-patch', '--file']);
    expect(claimed.toSorted()).toEqual(['src/a.ts', 'src/new.ts']);
    expect(released.toSorted()).toEqual(['src/a.ts', 'src/new.ts']);
  });

  it('refuses a diff that names no file or escapes the workspace', async () => {
    const { editor, runMtui } = setup();
    expect((await editor.applyPatch(ROOT, 'a', 'not a diff')).ok).toBe(false);
    expect((await editor.applyPatch(ROOT, 'a', '--- a/../x.ts\n+++ b/../x.ts\n')).ok).toBe(false);
    expect(runMtui).not.toHaveBeenCalled();
  });
});

describe('undo', () => {
  it('finds every operation of a group, leases the files they restore and undoes the group once', async () => {
    const { editor, calls, released } = setup({
      run: (args) => {
        if (args[1] === 'diff') {
          const id = args[args.indexOf('--operation') + 1]!;
          if (id === 'grp.0') return { ok: true, files: [{ file: `\\\\?\\${path.join(ROOT, 'src', 'a.ts')}` }] };
          if (id === 'grp.1') return { ok: true, files: [{ file: path.join(ROOT, 'src', 'b.ts') }] };
          return { ok: false, error_type: 'NO_MATCH', message: 'unknown operation' };
        }
        return { ok: true };
      },
    });

    const outcome = await editor.undo(ROOT, 'agent-1', { groupId: 'grp' });

    expect(outcome).toEqual({ ok: true, message: 'Restored 2 files via MTUI: src/a.ts, src/b.ts.' });
    expect(calls.at(-1)).toEqual(['--json', 'undo', '--group', 'grp']);
    expect(released.toSorted()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('needs exactly one target, reports an unknown group, and will not touch files outside the workspace', async () => {
    const { editor } = setup({ run: () => ({ ok: false, error_type: 'NO_MATCH', message: 'unknown' }) });
    expect((await editor.undo(ROOT, 'a', {})).ok).toBe(false);
    expect((await editor.undo(ROOT, 'a', { operationId: 'x', groupId: 'y' })).ok).toBe(false);
    expect((await editor.undo(ROOT, 'a', { groupId: 'nope' })).message).toContain('No operations were found for group nope');

    const outside = setup({ run: () => ({ ok: true, files: [{ file: path.resolve('C:/elsewhere/x.ts') }] }) });
    const result = await outside.editor.undo(ROOT, 'a', { operationId: 'op_x' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('outside this workspace');
  });
});
