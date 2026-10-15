import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  ExplorerService,
  type ExplorerAuditReceipt,
  type ExplorerServiceDeps,
} from '@process/resources/explorer/explorerService';
import type { ExplorerActionRequest, ExplorerSession } from '@/common/types/platform/explorer';

describe('human Explorer filesystem integration', () => {
  let fixture: string;
  let root: string;
  let session: ExplorerSession;
  let service: ExplorerService;
  let deps: ExplorerServiceDeps;
  let receipts: ExplorerAuditReceipt[];
  let trashCount: number;

  beforeEach(async () => {
    fixture = await mkdtemp(path.join(os.tmpdir(), 'tomni-explorer-test-'));
    root = path.join(fixture, 'root');
    await mkdir(root);
    await mkdir(path.join(fixture, 'trash'));
    receipts = [];
    trashCount = 0;
    deps = {
      appendAudit: vi.fn(async (receipt) => {
        receipts.push(receipt);
      }),
      approveMutation: vi.fn(async () => true),
      trashItem: vi.fn(async (target) => {
        await rename(target, path.join(fixture, 'trash', String(++trashCount)));
      }),
      moveItem: vi.fn(async (source, target) => {
        await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
        await rename(source, target);
      }),
      openItem: vi.fn(async () => {}),
      revealItem: vi.fn(async () => {}),
    };
    service = new ExplorerService(deps);
    session = await service.openSession(7, root);
  });

  afterEach(async () => {
    service.closeOwner(7);
    // Fixtures are always beneath the uniquely issued test temp directory.
    if (!path.basename(fixture).startsWith('tomni-explorer-test-') || path.dirname(fixture) !== os.tmpdir())
      throw new Error('Unsafe fixture cleanup');
    await rm(fixture, { recursive: true, force: true });
  });

  const action = (request: Omit<ExplorerActionRequest, 'sessionId'>): ExplorerActionRequest => ({
    ...request,
    sessionId: session.id,
  });

  it('returns a bounded preview only for a file in the caller-owned Explorer session', async () => {
    await writeFile(path.join(root, 'notes.txt'), 'safe notes');

    await expect(service.quickView(7, session.id, 'notes.txt')).resolves.toEqual({
      kind: 'text',
      content: 'safe notes',
      truncated: false,
    });
    await expect(service.quickView(8, session.id, 'notes.txt')).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('returns metadata for Explorer folders instead of reading them', async () => {
    await mkdir(path.join(root, 'docs'));

    await expect(service.quickView(7, session.id, 'docs')).resolves.toMatchObject({
      kind: 'metadata',
      reason: 'directory',
      name: 'docs',
    });
  });


  it('lists only immediate children with metadata and directory ordering', async () => {
    await mkdir(path.join(root, 'folder'));
    await writeFile(path.join(root, 'folder', 'hidden-depth.txt'), 'nested');
    await writeFile(path.join(root, 'file.txt'), 'abc');
    const result = await service.list(7, session.id, '');
    expect(result.entries.map((entry) => entry.name)).toEqual(['folder', 'file.txt']);
    expect(result.entries[1]).toMatchObject({ relativePath: 'file.txt', size: 3, isDirectory: false });
    expect(result.truncated).toBe(false);
  });

  it('truncates bounded listings without recursive reads', async () => {
    service = new ExplorerService({ ...deps, limits: { maxEntries: 1 } });
    session = await service.openSession(7, root);
    await writeFile(path.join(root, 'a'), '');
    await writeFile(path.join(root, 'b'), '');
    const result = await service.list(7, session.id, '');
    expect(result.entries).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('creates files and folders exclusively with durable proposal before effect', async () => {
    const originalAudit = deps.appendAudit;
    deps = {
      ...deps,
      appendAudit: async (receipt) => {
        if (receipt.status === 'proposed')
          await expect(readFile(path.join(root, 'created.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
        await originalAudit(receipt);
      },
    };
    service = new ExplorerService(deps);
    session = await service.openSession(7, root);
    const created = await service.action(7, action({ operation: 'create-file', paths: [''], name: 'created.txt' }));
    expect(created.affectedPaths).toEqual(['created.txt']);
    await expect(
      service.action(7, action({ operation: 'create-file', paths: [''], name: 'created.txt' }))
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(path.join(root, 'created.txt'), 'utf8')).toBe('');
    service = new ExplorerService({ ...deps, appendAudit: originalAudit });
    session = await service.openSession(7, root);
    await service.action(7, action({ operation: 'create-directory', paths: [''], name: 'new-folder' }));
    expect(
      (await service.list(7, session.id, '')).entries.find((entry) => entry.name === 'new-folder')?.isDirectory
    ).toBe(true);
    expect(receipts.map((receipt) => receipt.status)).toEqual(['proposed', 'completed', 'proposed', 'completed']);
  });

  it('copies nested trees and moves or renames through metadata-preserving driver', async () => {
    await mkdir(path.join(root, 'source'));
    await writeFile(path.join(root, 'source', 'file.txt'), 'payload');
    await mkdir(path.join(root, 'destination'));
    await service.action(7, action({ operation: 'copy', paths: ['source'], destination: 'destination' }));
    expect(await readFile(path.join(root, 'destination', 'source', 'file.txt'), 'utf8')).toBe('payload');
    expect(await readFile(path.join(root, 'source', 'file.txt'), 'utf8')).toBe('payload');
    await service.action(7, action({ operation: 'rename', paths: ['source'], name: 'renamed' }));
    expect(await readFile(path.join(root, 'renamed', 'file.txt'), 'utf8')).toBe('payload');
    await expect(lstat(path.join(root, 'source'))).rejects.toMatchObject({ code: 'ENOENT' });
    await service.action(7, action({ operation: 'move', paths: ['renamed'], destination: 'destination' }));
    expect(await readFile(path.join(root, 'destination', 'renamed', 'file.txt'), 'utf8')).toBe('payload');
    expect(deps.moveItem).toHaveBeenCalledTimes(2);
    expect(deps.trashItem).not.toHaveBeenCalled();
  });

  it('deletes only through native trash, retaining receipt and recoverable source', async () => {
    await writeFile(path.join(root, 'file'), 'preserved');
    const result = await service.action(7, action({ operation: 'delete', paths: ['file'] }));
    expect(result.affectedPaths).toEqual(['file']);
    expect(await readFile(path.join(fixture, 'trash', '1'), 'utf8')).toBe('preserved');
    expect(receipts[1]).toMatchObject({ receiptId: result.receiptId, status: 'completed', affectedPaths: ['file'] });
  });

  it('does not overwrite a destination or remove source on a conflict', async () => {
    await writeFile(path.join(root, 'source'), 'source');
    await mkdir(path.join(root, 'destination'));
    await writeFile(path.join(root, 'destination', 'source'), 'keep');
    await expect(
      service.action(7, action({ operation: 'move', paths: ['source'], destination: 'destination' }))
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(path.join(root, 'source'), 'utf8')).toBe('source');
    expect(await readFile(path.join(root, 'destination', 'source'), 'utf8')).toBe('keep');
    expect(deps.trashItem).not.toHaveBeenCalled();
  });

  it('handles a destination created during confirmation without overwriting', async () => {
    await writeFile(path.join(root, 'source'), 'source');
    await mkdir(path.join(root, 'destination'));
    service = new ExplorerService({
      ...deps,
      approveMutation: async () => {
        await writeFile(path.join(root, 'destination', 'source'), 'race');
        return true;
      },
    });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'copy', paths: ['source'], destination: 'destination' }))
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(path.join(root, 'destination', 'source'), 'utf8')).toBe('race');
    expect(receipts.at(-1)).toMatchObject({ status: 'failed', errorCode: 'CONFLICT' });
  });

  it('rejects traversal, device names, alternate streams and root mutations', async () => {
    await Promise.all(
      ['../outside', 'folder/../../outside', 'C:\\Windows', 'file:secret', 'CON.txt', 'name.'].map((relativePath) =>
        expect(service.list(7, session.id, relativePath)).rejects.toMatchObject({ code: 'DENIED' })
      )
    );
    await expect(service.action(7, action({ operation: 'delete', paths: [''] }))).rejects.toMatchObject({
      code: 'DENIED',
    });
    await expect(
      service.action(7, action({ operation: 'create-file', paths: [''], name: '../escape' }))
    ).rejects.toMatchObject({ code: 'DENIED' });
    expect(deps.trashItem).not.toHaveBeenCalled();
  });

  it('rejects links and junctions including descendants before any mutation', async () => {
    await mkdir(path.join(fixture, 'outside'));
    await writeFile(path.join(fixture, 'outside', 'secret.txt'), 'secret');
    await symlink(
      path.join(fixture, 'outside'),
      path.join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect((await service.list(7, session.id, '')).entries).toEqual([]);
    await expect(service.list(7, session.id, 'linked')).rejects.toMatchObject({ code: 'DENIED' });
    await mkdir(path.join(root, 'tree'));
    await symlink(
      path.join(fixture, 'outside'),
      path.join(root, 'tree', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await mkdir(path.join(root, 'destination'));
    await expect(
      service.action(7, action({ operation: 'copy', paths: ['tree'], destination: 'destination' }))
    ).rejects.toMatchObject({ code: 'DENIED' });
    expect(deps.approveMutation).not.toHaveBeenCalled();
  });

  it('binds sessions to sender and expires them', async () => {
    await expect(service.list(8, session.id, '')).rejects.toMatchObject({ code: 'DENIED' });
    let now = 100;
    service = new ExplorerService({ ...deps, now: () => now });
    session = await service.openSession(7, root);
    now = session.expiresAt;
    await expect(service.list(7, session.id, '')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('cancels after native dialog when owner navigates or is destroyed', async () => {
    service = new ExplorerService({
      ...deps,
      approveMutation: async () => {
        service.closeOwner(7);
        return true;
      },
    });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'create-file', paths: [''], name: 'cancelled' }))
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(readFile(path.join(root, 'cancelled'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed if proposal audit fails or native confirmation declines', async () => {
    service = new ExplorerService({
      ...deps,
      appendAudit: async () => {
        throw new Error('disk unavailable');
      },
    });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'create-file', paths: [''], name: 'denied' }))
    ).rejects.toMatchObject({ code: 'AUDIT_FAILED' });
    expect(deps.approveMutation).not.toHaveBeenCalled();
    service = new ExplorerService({ ...deps, approveMutation: async () => false });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'create-file', paths: [''], name: 'denied' }))
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(readFile(path.join(root, 'denied'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(receipts.at(-1)?.status).toBe('cancelled');
  });

  it('preflights byte budgets and depth before creating destinations', async () => {
    await writeFile(path.join(root, 'big'), '12345');
    await mkdir(path.join(root, 'destination'));
    service = new ExplorerService({ ...deps, limits: { maxBytes: 4 } });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'copy', paths: ['big'], destination: 'destination' }))
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect((await service.list(7, session.id, 'destination')).entries).toEqual([]);
    await mkdir(path.join(root, 'tree', 'child', 'deeper'), { recursive: true });
    service = new ExplorerService({ ...deps, limits: { maxDepth: 1 } });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'copy', paths: ['tree'], destination: 'destination' }))
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('records completed first move and preserves pending source when next move fails', async () => {
    await writeFile(path.join(root, 'first'), 'first');
    await writeFile(path.join(root, 'second'), 'second');
    await mkdir(path.join(root, 'destination'));
    service = new ExplorerService({
      ...deps,
      moveItem: async (source, target) => {
        if (path.basename(source) === 'second') throw new Error('OS move failed');
        await deps.moveItem!(source, target);
      },
    });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'move', paths: ['first', 'second'], destination: 'destination' }))
    ).rejects.toMatchObject({
      code: 'IO_ERROR',
      mayHaveCommitted: true,
      affectedPaths: ['first', 'destination/first'],
    });
    expect(await readFile(path.join(root, 'second'), 'utf8')).toBe('second');
    expect(await readFile(path.join(root, 'destination', 'first'), 'utf8')).toBe('first');
    expect(receipts.at(-1)).toMatchObject({
      status: 'failed',
      affectedPaths: ['first', 'destination/first'],
      targets: ['destination/first', 'destination/second'],
    });
  });

  it('revalidates source after confirmation before copying or trashing', async () => {
    await writeFile(path.join(root, 'source'), 'original');
    service = new ExplorerService({
      ...deps,
      approveMutation: async () => {
        await writeFile(path.join(root, 'source'), 'changed source');
        return true;
      },
    });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'rename', paths: ['source'], name: 'destination' }))
    ).rejects.toMatchObject({ code: 'IO_ERROR' });
    await expect(readFile(path.join(root, 'destination'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(deps.trashItem).not.toHaveBeenCalled();
  });

  it('rejects copies into the source and overlapping selections', async () => {
    await mkdir(path.join(root, 'tree', 'child'), { recursive: true });
    await expect(
      service.action(7, action({ operation: 'copy', paths: ['tree'], destination: 'tree/child' }))
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      service.action(7, action({ operation: 'delete', paths: ['tree', 'tree/child'] }))
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('records confirmed OS handoffs without exposing file contents to audit', async () => {
    await writeFile(path.join(root, 'document.txt'), 'private document');
    await service.action(7, action({ operation: 'open', paths: ['document.txt'] }));
    await service.action(7, action({ operation: 'reveal', paths: ['document.txt'] }));
    expect(deps.openItem).toHaveBeenCalledWith(path.join(root, 'document.txt'));
    expect(deps.revealItem).toHaveBeenCalledWith(path.join(root, 'document.txt'));
    expect(JSON.stringify(receipts)).not.toContain('private document');
    expect(JSON.stringify(receipts)).not.toContain(root.replace(/\\/g, '\\\\'));
  });

  it('renames directories without applying recursive copy size and depth limits', async () => {
    await mkdir(path.join(root, 'tree', 'child', 'deep'), { recursive: true });
    await writeFile(path.join(root, 'tree', 'child', 'deep', 'large'), 'large file');
    const before = await lstat(path.join(root, 'tree'));
    service = new ExplorerService({ ...deps, limits: { maxBytes: 1, maxDepth: 1 } });
    session = await service.openSession(7, root);
    await service.action(7, action({ operation: 'rename', paths: ['tree'], name: 'renamed' }));
    const after = await lstat(path.join(root, 'renamed'));
    expect(after.ino).toBe(before.ino);
    expect(await readFile(path.join(root, 'renamed', 'child', 'deep', 'large'), 'utf8')).toBe('large file');
  });

  it('rechecks each deletion identity after prior native trash awaited', async () => {
    await writeFile(path.join(root, 'first'), 'first');
    await writeFile(path.join(root, 'second'), 'second');
    service = new ExplorerService({
      ...deps,
      trashItem: async (source) => {
        await deps.trashItem(source);
        if (path.basename(source) === 'first') await writeFile(path.join(root, 'second'), 'unapproved replacement');
      },
    });
    session = await service.openSession(7, root);
    await expect(service.action(7, action({ operation: 'delete', paths: ['first', 'second'] }))).rejects.toMatchObject({
      code: 'IO_ERROR',
      affectedPaths: ['first'],
      mayHaveCommitted: true,
    });
    expect(await readFile(path.join(root, 'second'), 'utf8')).toBe('unapproved replacement');
    expect(deps.trashItem).toHaveBeenCalledTimes(1);
  });

  it('does not open a replaced handoff target after confirmation', async () => {
    await writeFile(path.join(root, 'document'), 'approved');
    service = new ExplorerService({
      ...deps,
      approveMutation: async () => {
        await writeFile(path.join(root, 'document'), 'unapproved changed');
        return true;
      },
    });
    session = await service.openSession(7, root);
    await expect(service.action(7, action({ operation: 'open', paths: ['document'] }))).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
    expect(deps.openItem).not.toHaveBeenCalled();
  });

  it('records intended destination before copy and revokes after terminal audit loss', async () => {
    await writeFile(path.join(root, 'source'), 'source');
    await mkdir(path.join(root, 'destination'));
    service = new ExplorerService({
      ...deps,
      appendAudit: async (receipt) => {
        if (receipt.status === 'completed') throw new Error('disk full');
        await deps.appendAudit(receipt);
      },
    });
    session = await service.openSession(7, root);
    await expect(
      service.action(7, action({ operation: 'copy', paths: ['source'], destination: 'destination' }))
    ).rejects.toMatchObject({ code: 'AUDIT_FAILED', affectedPaths: ['destination/source'], mayHaveCommitted: true });
    expect(receipts[0]).toMatchObject({ status: 'proposed', paths: ['source'], targets: ['destination/source'] });
    expect(await readFile(path.join(root, 'destination', 'source'), 'utf8')).toBe('source');
    await expect(service.list(7, session.id, '')).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('denies UNC and extended network paths before any filesystem access', async () => {
    await Promise.all(
      ['\\\\server\\share', '\\\\?\\UNC\\server\\share', '//server/share'].map((networkPath) =>
        expect(service.openSession(7, networkPath)).rejects.toMatchObject({ code: 'DENIED' })
      )
    );
  });

  it('serializes session actions while native confirmation is open', async () => {
    let approve!: (value: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => {
      approve = resolve;
    });
    let reached!: () => void;
    const reachedDialog = new Promise<void>((resolve) => {
      reached = resolve;
    });
    service = new ExplorerService({
      ...deps,
      approveMutation: () => {
        reached();
        return waiting;
      },
    });
    session = await service.openSession(7, root);
    const first = service.action(7, action({ operation: 'create-file', paths: [''], name: 'first' }));
    await reachedDialog;
    await expect(
      service.action(7, action({ operation: 'create-file', paths: [''], name: 'second' }))
    ).rejects.toMatchObject({ code: 'BUSY' });
    approve(true);
    await first;
    expect(await readFile(path.join(root, 'first'), 'utf8')).toBe('');
    await expect(lstat(path.join(root, 'second'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  describe('duplicate target detection', () => {
    it('offers a rename when a folder would land on an existing file', async () => {
      await mkdir(path.join(root, 'hello'));
      await mkdir(path.join(root, 'hea'));
      await writeFile(path.join(root, 'hea', 'hello'), 'a file occupies the name');
      await expect(
        service.action(7, action({ operation: 'move', paths: ['hello'], destination: 'hea' }))
      ).rejects.toMatchObject({ code: 'CONFLICT', suggestedName: 'hello (1)' });
      expect(deps.moveItem).not.toHaveBeenCalled();
      expect((await lstat(path.join(root, 'hello'))).isDirectory()).toBe(true);
      expect((await lstat(path.join(root, 'hea', 'hello'))).isFile()).toBe(true);
      const result = await service.action(
        7,
        action({ operation: 'move', paths: ['hello'], destination: 'hea', autoRename: true })
      );
      expect(result.affectedPaths).toEqual(['hello', 'hea/hello (1)']);
      expect((await lstat(path.join(root, 'hea', 'hello'))).isFile()).toBe(true);
      expect((await lstat(path.join(root, 'hea', 'hello (1)'))).isDirectory()).toBe(true);
      expect(await readFile(path.join(root, 'hea', 'hello'), 'utf8')).toBe('a file occupies the name');
      expect(receipts.at(-1)).toMatchObject({ status: 'completed', targets: ['hea/hello (1)'] });
    });

    it('keeps a same-type name collision a hard conflict with a rename offer', async () => {
      await mkdir(path.join(root, 'source'));
      await mkdir(path.join(root, 'destination'));
      await mkdir(path.join(root, 'destination', 'source'));
      await expect(
        service.action(7, action({ operation: 'move', paths: ['source'], destination: 'destination' }))
      ).rejects.toMatchObject({ code: 'CONFLICT', suggestedName: 'source (1)' });
      expect(await lstat(path.join(root, 'source'))).toBeTruthy();
      expect(await lstat(path.join(root, 'destination', 'source'))).toBeTruthy();
      expect(deps.moveItem).not.toHaveBeenCalled();
    });

    it('offers a rename when a file would land on an existing directory', async () => {
      await writeFile(path.join(root, 'notes'), 'content');
      await mkdir(path.join(root, 'docs'));
      await mkdir(path.join(root, 'docs', 'notes'));
      await expect(
        service.action(7, action({ operation: 'move', paths: ['notes'], destination: 'docs' }))
      ).rejects.toMatchObject({ code: 'CONFLICT', suggestedName: 'notes (1)' });
      expect((await lstat(path.join(root, 'docs', 'notes'))).isDirectory()).toBe(true);
      expect(await lstat(path.join(root, 'notes'))).toBeTruthy();
      const result = await service.action(
        7,
        action({ operation: 'move', paths: ['notes'], destination: 'docs', autoRename: true })
      );
      expect(result.affectedPaths).toEqual(['notes', 'docs/notes (1)']);
      expect((await lstat(path.join(root, 'docs', 'notes'))).isDirectory()).toBe(true);
      expect((await lstat(path.join(root, 'docs', 'notes (1)'))).isFile()).toBe(true);
      expect(await readFile(path.join(root, 'docs', 'notes (1)'), 'utf8')).toBe('content');
    });

    it('treats a move onto the item itself as a completed no-op', async () => {
      await writeFile(path.join(root, 'a.txt'), 'keep');
      const result = await service.action(7, action({ operation: 'move', paths: ['a.txt'], destination: '' }));
      expect(result.affectedPaths).toEqual([]);
      expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('keep');
      expect(deps.moveItem).not.toHaveBeenCalled();
      expect(deps.approveMutation).not.toHaveBeenCalled();
      expect(receipts).toHaveLength(1);
      expect(receipts.at(-1)).toMatchObject({ status: 'completed', operation: 'move', targets: [] });
    });

    it('skips only the self-targeted entries in a mixed multi-select move', async () => {
      await writeFile(path.join(root, 'a.txt'), 'stay');
      await mkdir(path.join(root, 'sub'));
      await writeFile(path.join(root, 'sub', 'b.txt'), 'move');
      const result = await service.action(
        7,
        action({ operation: 'move', paths: ['a.txt', 'sub/b.txt'], destination: '' })
      );
      expect(result.affectedPaths).toEqual(['sub/b.txt', 'b.txt']);
      expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('stay');
      expect(await readFile(path.join(root, 'b.txt'), 'utf8')).toBe('move');
      expect(deps.moveItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('block list enforcement', () => {
    let blockedRoots: string[];
    let blockedStore: { block: ReturnType<typeof vi.fn>; unblock: ReturnType<typeof vi.fn> };
    beforeEach(async () => {
      blockedRoots = [];
      blockedStore = { block: vi.fn(async () => {}), unblock: vi.fn(async () => {}) };
      deps = {
        ...deps,
        isBlocked: vi.fn(async (canonicalPaths: readonly string[]) =>
          canonicalPaths.some((candidate) => blockedRoots.some((blocked) => candidate.startsWith(blocked)))
        ),
        blockMutation: vi.fn(async (operation: 'block' | 'unblock', canonicalPaths: readonly string[]) => {
          if (operation === 'block') {
            for (const entry of canonicalPaths) blockedRoots.push(entry);
            await blockedStore.block();
          } else {
            for (const entry of canonicalPaths) blockedRoots = blockedRoots.filter((blocked) => blocked !== entry);
            await blockedStore.unblock();
          }
        }),
      };
      service = new ExplorerService(deps);
      session = await service.openSession(7, root);
    });

    it('refuses a mutation touching a blocked tree before audit or approval', async () => {
      await writeFile(path.join(root, 'confidential.txt'), 'secret');
      blockedRoots = [path.join(root, 'confidential.txt')];
      await expect(
        service.action(7, action({ operation: 'delete', paths: ['confidential.txt'] }))
      ).rejects.toMatchObject({ code: 'DENIED' });
      expect(receipts).toEqual([]);
      await expect(service.action(7, action({ operation: 'open', paths: ['confidential.txt'] }))).rejects.toMatchObject(
        {
          code: 'DENIED',
        }
      );
      await expect(
        service.action(7, action({ operation: 'rename', paths: ['confidential.txt'], name: 'x' }))
      ).rejects.toMatchObject({
        code: 'DENIED',
      });
      expect(deps.trashItem).not.toHaveBeenCalled();
    });

    it('persists block and unblock entries and reports the blocked listing flag', async () => {
      blockedRoots = [];
      await mkdir(path.join(root, 'vault'));
      await service.action(7, action({ operation: 'block', paths: ['vault'] }));
      expect(deps.blockMutation).toHaveBeenCalledWith(
        'block',
        [path.join(root, 'vault')],
        expect.objectContaining({ operation: 'block' })
      );
      const listing = await service.list(7, session.id, '');
      expect(listing.entries.find((entry) => entry.name === 'vault')?.blocked).toBe(true);
      await service.action(7, action({ operation: 'unblock', paths: ['vault'] }));
      expect(deps.blockMutation).toHaveBeenLastCalledWith(
        'unblock',
        [path.join(root, 'vault')],
        expect.objectContaining({ operation: 'unblock' })
      );
      const reopened = await service.list(7, session.id, '');
      expect(reopened.entries.find((entry) => entry.name === 'vault')?.blocked).toBe(false);
    });

    it('marks descendants of a blocked folder in its own listing', async () => {
      await mkdir(path.join(root, 'vault'));
      await writeFile(path.join(root, 'vault', 'secret.txt'), 'data');
      blockedRoots = [path.join(root, 'vault')];
      // Exact-match checker: the child is not itself on the list, so only the ancestor walk reports it.
      deps.isBlocked = vi.fn(async (canonicalPaths: readonly string[]) =>
        canonicalPaths.some((candidate) => blockedRoots.includes(candidate))
      );
      const tree = await service.list(7, session.id, 'vault');
      expect(tree.entries.find((entry) => entry.name === 'secret.txt')?.blocked).toBe(true);
      const parent = await service.list(7, session.id, '');
      expect(parent.entries.find((entry) => entry.name === 'vault')?.blocked).toBe(true);
    });

    it('refuses block-target management when the block store is unavailable', async () => {
      service = new ExplorerService({ ...deps, isBlocked: undefined, blockMutation: undefined });
      session = await service.openSession(7, root);
      await mkdir(path.join(root, 'vault'));
      await expect(service.action(7, action({ operation: 'block', paths: ['vault'] }))).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
    });
  });

  describe('grant-assisted approvals', () => {
    it('passes canonical absolute sources and targets to the native approval gate', async () => {
      const approve = vi.fn(async () => true);
      service = new ExplorerService({ ...deps, approveMutation: approve });
      session = await service.openSession(7, root);
      await mkdir(path.join(root, 'src'));
      await writeFile(path.join(root, 'src', 'file.txt'), 'data');
      await mkdir(path.join(root, 'dst'));
      await service.action(7, action({ operation: 'copy', paths: ['src'], destination: 'dst' }));
      expect(approve).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'copy', paths: ['src'], destination: 'dst' }),
        [path.join(root, 'src'), path.join(root, 'dst', 'src')],
        7
      );
    });
  });
});
