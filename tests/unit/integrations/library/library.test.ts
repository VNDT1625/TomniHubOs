import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_CHANNELS } from '@/common/integrations/library/libraryContracts';
import { registerLibraryBridge } from '@process/integrations/library/libraryBridge';
import { createLibraryPort, getLibraryPort, setActiveLibraryPort } from '@process/integrations/library/libraryPort';
import { createLibraryService } from '@process/integrations/library/libraryService';
import { createJsonLibraryStore } from '@process/integrations/library/libraryStore';
import { createViewGrants } from '@process/integrations/fileViewer/viewGrants';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-library-'));
  roots.push(root);
  return realpath(root);
};
afterEach(async () => {
  setActiveLibraryPort(undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const setup = async () => {
  const dir = await temp();
  const docs = path.join(dir, 'docs');
  const stateDir = path.join(dir, 'state');
  await mkdir(docs);
  const stateFile = path.join(stateDir, 'library.json');
  let counter = 0;
  const store = createJsonLibraryStore(stateFile, { newId: () => `e${(counter += 1)}`, now: () => 1000 + counter });
  await store.initialize();
  const service = createLibraryService(store);
  const file = async (name: string, text = name) => {
    const target = path.join(docs, name);
    await writeFile(target, text);
    return target;
  };
  return { dir, docs, stateFile, store, service, file };
};

describe('Library store', () => {
  it('keeps only paths: adding a file never copies or touches it', async () => {
    const { dir, docs, stateFile, service, file } = await setup();
    const original = await file('plan.md', '# plan');
    const [added] = await service.addPicked([original]);
    expect(added).toMatchObject({ name: 'plan.md', path: original, missing: false, extension: '.md' });
    expect(await readdir(docs)).toEqual(['plan.md']);
    expect(await readFile(original, 'utf8')).toBe('# plan');
    expect((await readdir(path.dirname(stateFile))).sort()).toEqual(['library.json']);
    const saved = JSON.parse(await readFile(stateFile, 'utf8')) as { entries: Array<Record<string, unknown>> };
    expect(Object.keys(saved.entries[0]!).sort()).toEqual(['addedAt', 'id', 'name', 'path']);
    expect(JSON.stringify(saved)).not.toContain('# plan');
    expect(await readdir(dir)).toEqual(['docs', 'state']);
  });

  it('survives a restart, lists oldest first and lists a path once', async () => {
    const { stateFile, service, file, store } = await setup();
    const a = await file('a.txt');
    const b = await file('b.txt');
    await service.addPicked([a, b]);
    await service.addPicked([a]);
    const reopened = createJsonLibraryStore(stateFile);
    await reopened.initialize();
    expect(reopened.list().map((record) => record.name)).toEqual(['a.txt', 'b.txt']);
    expect(store.list()).toHaveLength(2);
  });

  it('writes atomically and serialises concurrent writes', async () => {
    const { stateFile, store, docs } = await setup();
    const names = Array.from({ length: 20 }, (_, index) => path.join(docs, `f${index}.txt`));
    await Promise.all(names.map((name) => store.add(name)));
    const saved = JSON.parse(await readFile(stateFile, 'utf8')) as { schemaVersion: number; entries: unknown[] };
    expect(saved.schemaVersion).toBe(1);
    expect(saved.entries).toHaveLength(20);
    expect((await readdir(path.dirname(stateFile))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('treats a corrupt or foreign file as an empty Library and drops invalid records', async () => {
    const { stateFile, store } = await setup();
    await store.add('C:\\keep\\a.txt');
    await writeFile(stateFile, '{not json');
    const corrupt = createJsonLibraryStore(stateFile);
    await corrupt.initialize();
    expect(corrupt.list()).toEqual([]);
    await writeFile(
      stateFile,
      JSON.stringify({
        schemaVersion: 1,
        entries: [{ id: 'ok', path: '/x/ok.txt', name: 'ok.txt', addedAt: 1 }, { id: 'bad' }, 'junk'],
      })
    );
    const partial = createJsonLibraryStore(stateFile);
    await partial.initialize();
    expect(partial.list().map((record) => record.id)).toEqual(['ok']);
  });

  it('rolls the in-memory list back when a write fails', async () => {
    const { dir, docs } = await setup();
    const blocker = path.join(dir, 'blocker');
    await writeFile(blocker, 'a file where a directory is needed');
    const store = createJsonLibraryStore(path.join(blocker, 'library.json'));
    await store.initialize();
    await expect(store.add(path.join(docs, 'x.txt'))).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
});

describe('Library service: missing files and re-pick', () => {
  it('marks a moved or deleted file "missing" and keeps its entry', async () => {
    const { service, file, docs } = await setup();
    const original = await file('report.txt');
    const [entry] = await service.addPicked([original]);
    await rename(original, path.join(docs, 'renamed.txt'));
    const [after] = await service.list();
    expect(after).toMatchObject({ id: entry!.id, missing: true, path: original });
    expect((await service.get(entry!.id))?.missing).toBe(true);
  });

  it('re-picks onto a new file, keeping the id and clearing the missing mark', async () => {
    const { service, file, docs } = await setup();
    const original = await file('report.txt');
    const [entry] = await service.addPicked([original]);
    await rename(original, path.join(docs, 'renamed.txt'));
    const moved = path.join(docs, 'renamed.txt');
    const repicked = await service.repick(entry!.id, moved);
    expect(repicked).toMatchObject({ id: entry!.id, name: 'renamed.txt', path: moved, missing: false });
    expect(await service.list()).toHaveLength(1);
    expect(await readdir(docs)).toEqual(['renamed.txt']);
  });

  it("refuses a re-pick of a file that is gone, of another entry's file, and of an unknown entry", async () => {
    const { service, file, docs } = await setup();
    const a = await file('a.txt');
    const b = await file('b.txt');
    const [first, second] = await service.addPicked([a, b]);
    await expect(service.repick(first!.id, path.join(docs, 'nope.txt'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.repick(first!.id, b)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(service.repick('unknown', a)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.get(second!.id))?.path).toBe(b);
  });

  it('refuses to add a directory, a relative path or a missing file, and removes entries without deleting files', async () => {
    const { service, file, docs } = await setup();
    await expect(service.addPicked([docs])).rejects.toMatchObject({ code: 'DENIED' });
    await expect(service.addPicked(['relative.txt'])).rejects.toMatchObject({ code: 'DENIED' });
    await expect(service.addPicked([path.join(docs, 'nope.txt')])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const original = await file('keep.txt');
    const [entry] = await service.addPicked([original]);
    await service.remove(entry!.id);
    expect(await service.list()).toEqual([]);
    expect(await readdir(docs)).toEqual(['keep.txt']);
    await expect(service.remove(entry!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('treats a file replaced by a link as missing instead of reading through it', async (context) => {
    const { service, file, docs } = await setup();
    const original = await file('swap.txt');
    const elsewhere = await file('elsewhere.txt');
    const [entry] = await service.addPicked([original]);
    await rm(original);
    try {
      await symlink(elsewhere, original, 'file');
    } catch {
      context.skip(); // Creating file symlinks needs a privilege this host does not grant.
      return;
    }
    expect((await service.get(entry!.id))?.missing).toBe(true);
    expect(await readdir(docs)).toContain('swap.txt');
  });
});

describe('LibraryPort', () => {
  it('is read-only: it can list, search and get, and nothing else', async () => {
    const { service, file } = await setup();
    const port = createLibraryPort(service);
    expect(Object.keys(port).sort()).toEqual(['get', 'list', 'search']);
    await service.addPicked([await file('Budget 2026.xlsx'), await file('notes.md')]);
    expect((await port.list()).map((entry) => entry.name)).toEqual(['Budget 2026.xlsx', 'notes.md']);
    expect((await port.search('budget xlsx')).map((entry) => entry.name)).toEqual(['Budget 2026.xlsx']);
    expect(await port.search('nothing-like-this')).toEqual([]);
    expect(await port.search('o', 0)).toEqual([]);
    const [only] = await port.search('notes');
    expect(await port.get(only!.id)).toMatchObject({ name: 'notes.md' });
    expect(await port.get('unknown')).toBeUndefined();
  });

  it('waits for the store to finish loading before answering', async () => {
    const { stateFile, store, file } = await setup();
    await store.add(await file('early.txt'));
    const fresh = createJsonLibraryStore(stateFile);
    const service = createLibraryService(fresh, fresh.initialize());
    expect((await createLibraryPort(service).list()).map((entry) => entry.name)).toEqual(['early.txt']);
  });

  it('is published while the Library runs and withdrawn after', async () => {
    const { service } = await setup();
    expect(getLibraryPort()).toBeUndefined();
    const port = createLibraryPort(service);
    setActiveLibraryPort(port);
    expect(getLibraryPort()).toBe(port);
    setActiveLibraryPort(undefined);
    expect(getLibraryPort()).toBeUndefined();
  });
});

type Handler = (event: unknown, raw: unknown) => Promise<{ ok: boolean; code?: string; data?: unknown }>;

describe('Library IPC', () => {
  const bridge = async (picked: string[] | null) => {
    const ctx = await setup();
    const handlers = new Map<string, Handler>();
    const pickFiles = vi.fn(async (_event: unknown, _multiple: boolean) => picked);
    const grants = createViewGrants();
    registerLibraryBridge({
      ipcMain: {
        handle: (channel: string, handler: unknown) => void handlers.set(channel, handler as Handler),
        removeHandler: (channel: string) => void handlers.delete(channel),
      },
      verifySender: (event) => (event as { trusted?: boolean }).trusted === true,
      service: ctx.service,
      grants,
      pickFiles,
    });
    const call = (channel: string, raw?: unknown, trusted = true) => handlers.get(channel)!({ trusted }, raw);
    return { ...ctx, call, pickFiles, grants, handlers };
  };

  it('adds only what the native picker returns and never accepts a path from the renderer', async () => {
    const { call, file, pickFiles } = await bridge(null);
    const picked = await file('a.txt');
    expect(await call(LIBRARY_CHANNELS.add, { path: picked })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(pickFiles).not.toHaveBeenCalled();
    expect(await call(LIBRARY_CHANNELS.add)).toEqual({ ok: true, data: [] });
    expect(await call(LIBRARY_CHANNELS.add, undefined, false)).toEqual({ ok: false, code: 'DENIED' });
  });

  it('adds picked files, lists them, re-picks and removes through the dialog-backed channels', async () => {
    const first = await bridge([]);
    const a = await first.file('a.txt');
    const b = await first.file('b.txt');
    // Same Main-side picker answer for every dialog in this scenario.
    first.pickFiles.mockResolvedValueOnce([a]);
    const added = await first.call(LIBRARY_CHANNELS.add);
    expect(added).toMatchObject({ ok: true, data: [{ name: 'a.txt', missing: false }] });
    const entryId = (added.data as Array<{ id: string }>)[0]!.id;
    await rm(a);
    expect(await first.call(LIBRARY_CHANNELS.list)).toMatchObject({ ok: true, data: [{ id: entryId, missing: true }] });
    first.pickFiles.mockResolvedValueOnce([b]);
    expect(await first.call(LIBRARY_CHANNELS.repick, { entryId })).toMatchObject({
      ok: true,
      data: { id: entryId, name: 'b.txt', missing: false },
    });
    first.pickFiles.mockResolvedValueOnce(null);
    expect(await first.call(LIBRARY_CHANNELS.repick, { entryId })).toEqual({ ok: false, code: 'CANCELLED' });
    expect(await first.call(LIBRARY_CHANNELS.repick, { entryId: 'unknown' })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await first.call(LIBRARY_CHANNELS.remove, { entryId })).toEqual({ ok: true, data: null });
    expect(await first.call(LIBRARY_CHANNELS.list)).toEqual({ ok: true, data: [] });
  });

  it('adds a file opened from Explorer by its view id only', async () => {
    const { call, grants, file } = await bridge(null);
    const target = await file('seen.md');
    const viewId = grants.issue(target);
    expect(await call(LIBRARY_CHANNELS.addFromView, { viewId })).toMatchObject({
      ok: true,
      data: { name: 'seen.md', path: target },
    });
    expect(await call(LIBRARY_CHANNELS.addFromView, { viewId: 'unknown' })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await call(LIBRARY_CHANNELS.addFromView, { viewId, path: target })).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });
});
