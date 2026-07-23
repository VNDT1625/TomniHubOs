/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createTeamSessionHost, resolveWithinRepo } from '@/process/ide/teamEdit/teamSessionHost';
import { createTeamRequestQueue } from '@/process/ide/teamEdit/teamRequestQueue';
import type { TeamEditService } from '@/process/ide/teamEdit/teamEditService';

const ROOT = '/repo';

const makeTeam = (): TeamEditService =>
  ({
    join: vi.fn(),
    claim: vi.fn(() => ({
      ok: true,
      renewed: false,
      lease: { relPath: 'src/a.ts', agentId: 'peer', acquiredAt: 0, renewedAt: 0, expiresAt: 1 },
    })),
    heartbeat: vi.fn(),
    release: vi.fn(() => true),
    releaseAll: vi.fn(),
    write: vi.fn(async () => ({ ok: true, bytes: 1 })),
    editReplace: vi.fn(async () => ({ ok: true, matches: 1 })),
    saveTask: vi.fn(),
    removeTask: vi.fn(),
    saveGroup: vi.fn(),
    removeGroup: vi.fn(),
    postMessage: vi.fn(),
    publishPreview: vi.fn(),
    listPreviews: vi.fn(() => [{ packageId: 'preview-1' }]),
    getPreview: vi.fn(() => ({ packageId: 'preview-1' })),
    appendPreviewFeedback: vi.fn((_rootPath, _packageId, input) => ({
      ...input,
      snapshotId: 'snapshot-1',
      snapshotRevision: 1,
    })),
    listPreviewFeedback: vi.fn(() => [{ feedbackId: 'feedback-1' }]),
    snapshot: vi.fn(() => ({ rootPath: ROOT, participants: [], leases: [], activity: [] })),
    reset: vi.fn(),
  }) satisfies TeamEditService;

const wait = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('teamSessionHost ? queued remote work', () => {
  it('serialises host reads and writes for the same shared repo', async () => {
    const events: string[] = [];
    const host = createTeamSessionHost({
      team: makeTeam(),
      queue: createTeamRequestQueue({ maxConcurrent: 1 }),
      refreshGraph: async () => undefined,
      loadGraph: async () => null,
      loadWiki: async () => null,
      listDbConnections: async () => [],
      runDbQuery: async () => ({ columns: [], rows: [], rowCount: 0 }),
      readDir: async () => {
        events.push('tree:start');
        await wait(10);
        events.push('tree:end');
        return [{ name: 'src', isDir: true }];
      },
      readFileText: async () => {
        events.push('file:start');
        events.push('file:end');
        return 'content';
      },
    });

    const tree = host.listDir(ROOT, '');
    const file = host.readFile(ROOT, 'src/a.ts');

    await expect(Promise.all([tree, file])).resolves.toEqual([[{ name: 'src', isDir: true }], { content: 'content' }]);
    expect(events).toEqual(['tree:start', 'tree:end', 'file:start', 'file:end']);
  });

  it('queues writes behind earlier reads to keep peer changes ordered', async () => {
    const events: string[] = [];
    const team = makeTeam();
    team.write = vi.fn(async () => {
      events.push('write');
      return { ok: true, bytes: 4 };
    });
    const host = createTeamSessionHost({
      team,
      queue: createTeamRequestQueue({ maxConcurrent: 1 }),
      refreshGraph: async () => undefined,
      loadGraph: async () => null,
      loadWiki: async () => null,
      listDbConnections: async () => [],
      runDbQuery: async () => ({ columns: [], rows: [], rowCount: 0 }),
      readDir: async () => {
        events.push('read:start');
        await wait(10);
        events.push('read:end');
        return [];
      },
      readFileText: async () => '',
    });

    const read = host.listDir(ROOT, 'src');
    const write = host.write(ROOT, 'peer', 'src/a.ts', 'data');

    await expect(Promise.all([read, write])).resolves.toEqual([[], { ok: true, bytes: 4 }]);
    expect(events).toEqual(['read:start', 'read:end', 'write']);
  });

  it('forwards presence, preview, feedback and lease operations to the authoritative team service', async () => {
    const team = makeTeam();
    const host = createTeamSessionHost({
      team,
      refreshGraph: async () => undefined,
      loadGraph: async () => null,
      loadWiki: async () => null,
      listDbConnections: async () => [],
      runDbQuery: async () => ({ columns: [], rows: [], rowCount: 0 }),
      readDir: async () => [],
      readFileText: async () => '',
    });
    const feedback = {
      feedbackId: 'feedback-1',
      authorId: 'reviewer',
      authorKind: 'user' as const,
      createdAt: 10,
      kind: 'comment' as const,
      body: 'Ship it',
    };

    host.joinPeer(ROOT, 'peer-token', 'Reviewer');
    host.leavePeer(ROOT, 'peer-token');

    expect(host.snapshot(ROOT)).toEqual({ rootPath: ROOT, participants: [], leases: [], activity: [] });
    expect(host.listPreviews(ROOT)).toEqual([{ packageId: 'preview-1' }]);
    expect(host.getPreview(ROOT, 'preview-1')).toEqual({ packageId: 'preview-1' });
    expect(host.appendPreviewFeedback(ROOT, 'preview-1', feedback)).toMatchObject({
      ...feedback,
      snapshotId: 'snapshot-1',
    });
    expect(host.listPreviewFeedback(ROOT, 'preview-1')).toEqual([{ feedbackId: 'feedback-1' }]);
    expect(host.claim(ROOT, 'peer-token', 'src/a.ts', 'review')).toMatchObject({ ok: true });
    expect(host.release(ROOT, 'peer-token', 'src/a.ts')).toBe(true);
    expect(team.join).toHaveBeenCalledWith(ROOT, 'peer-token', 'Reviewer', true);
    expect(team.releaseAll).toHaveBeenCalledWith(ROOT, 'peer-token');
    expect(team.getPreview).toHaveBeenCalledWith(ROOT, 'preview-1', 'user-preview');
  });

  it('queues knowledge and database reads while keeping graph refresh best-effort', async () => {
    const team = makeTeam();
    const refreshGraph = vi.fn(async () => {
      throw new Error('index temporarily unavailable');
    });
    const host = createTeamSessionHost({
      team,
      refreshGraph,
      loadGraph: async () => ({ nodes: 3 }),
      loadWiki: async () => ({ pages: 2 }),
      listDbConnections: async () => [{ id: 'db-1', name: 'Primary', kind: 'sqlite' }],
      runDbQuery: async (_id, _sql) => ({ columns: ['count'], rows: [[3]], rowCount: 1 }),
      readDir: async () => [],
      readFileText: async () => '',
    });

    await expect(host.edit(ROOT, 'peer-token', 'src/a.ts', 'before', 'after')).resolves.toEqual({
      ok: true,
      matches: 1,
    });
    await expect(host.understand(ROOT)).resolves.toEqual({ nodes: 3 });
    await expect(host.wiki(ROOT)).resolves.toEqual({ pages: 2 });
    await expect(host.dbConnections(ROOT)).resolves.toEqual([{ id: 'db-1', name: 'Primary', kind: 'sqlite' }]);
    await expect(host.dbQuery(ROOT, 'db-1', 'select count(*)')).resolves.toEqual({
      columns: ['count'],
      rows: [[3]],
      rowCount: 1,
    });
    expect(refreshGraph).toHaveBeenCalledWith(ROOT, 'src/a.ts', expect.stringContaining('src'));
    expect(() => resolveWithinRepo(ROOT, '../outside.txt')).toThrow('Path escapes the shared repository.');
  });

  it('surfaces queue pressure for the active repo', async () => {
    const host = createTeamSessionHost({
      team: makeTeam(),
      queue: createTeamRequestQueue({ maxConcurrent: 1 }),
      refreshGraph: async () => undefined,
      loadGraph: async () => null,
      loadWiki: async () => null,
      listDbConnections: async () => [],
      runDbQuery: async () => ({ columns: [], rows: [], rowCount: 0 }),
      readDir: () => new Promise(() => undefined),
      readFileText: async () => '',
    });

    void host.listDir(ROOT, '').catch(() => undefined);
    void host.readFile(ROOT, 'src/a.ts').catch(() => undefined);

    expect(host.queueStatus(ROOT)).toMatchObject({ running: 1, pending: 1, maxConcurrent: 1 });
  });
});
