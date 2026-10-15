import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILE_VIEWER_CHANNELS } from '@/common/integrations/library/libraryContracts';
import { readViewerDocument, type FileViewerLimits } from '@process/integrations/fileViewer/fileReader';
import { registerFileViewerBridge } from '@process/integrations/fileViewer/fileViewerBridge';
import { openRegularFile } from '@process/integrations/fileViewer/safeFile';
import { createViewGrants } from '@process/integrations/fileViewer/viewGrants';

const roots: string[] = [];
/** A fresh directory whose own path is already canonical (no 8.3 or /var aliases). */
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-viewer-'));
  roots.push(root);
  return realpath(root);
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SMALL: FileViewerLimits = { textBytes: 16, imageBytes: 32, pdfBytes: 64 };
const codeOf = async (action: Promise<unknown>): Promise<string | undefined> =>
  action.then(
    () => undefined,
    (error: unknown) => (error as { code?: string }).code
  );

describe('Main path validation for the file viewer', () => {
  it('refuses relative, traversing, network and stream paths', async () => {
    const dir = await temp();
    await writeFile(path.join(dir, 'a.txt'), 'x');
    const bad: unknown[] = [
      'a.txt',
      '.\\a.txt',
      `${dir}${path.sep}..${path.sep}${path.basename(dir)}${path.sep}a.txt`,
      '\\\\server\\share\\a.txt',
      '//server/share/a.txt',
      `${path.join(dir, 'a.txt')}\u0000.png`,
      `${path.join(dir, 'a.txt')}:stream`,
      '',
      42,
    ];
    const codes = await Promise.all(bad.map((candidate) => codeOf(openRegularFile(candidate))));
    expect(codes).toEqual(bad.map(() => 'DENIED'));
  });

  it('refuses directories and reports a missing file as NOT_FOUND', async () => {
    const dir = await temp();
    expect(await codeOf(openRegularFile(dir))).toBe('DENIED');
    expect(await codeOf(openRegularFile(path.join(dir, 'gone.txt')))).toBe('NOT_FOUND');
  });

  it('refuses a file reached through a linked directory (no symlink escape)', async () => {
    const dir = await temp();
    const outside = await temp();
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    const link = path.join(dir, 'link');
    await symlink(outside, link, 'junction');
    expect(await codeOf(openRegularFile(path.join(link, 'secret.txt')))).toBe('DENIED');
    expect(await codeOf(readViewerDocument(path.join(link, 'secret.txt')))).toBe('DENIED');
  });

  it('refuses a file that is itself a symbolic link', async (context) => {
    const dir = await temp();
    await writeFile(path.join(dir, 'real.txt'), 'real');
    try {
      await symlink(path.join(dir, 'real.txt'), path.join(dir, 'alias.txt'), 'file');
    } catch {
      context.skip(); // Creating file symlinks needs a privilege this host does not grant.
      return;
    }
    expect(await codeOf(openRegularFile(path.join(dir, 'alias.txt')))).toBe('DENIED');
  });

  it('caps text (cut and flagged) and refuses oversized images and PDFs', async () => {
    const dir = await temp();
    await writeFile(path.join(dir, 'big.txt'), 'a'.repeat(100));
    await writeFile(path.join(dir, 'big.png'), Buffer.alloc(33, 1));
    await writeFile(path.join(dir, 'big.pdf'), Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(100)]));
    const text = await readViewerDocument(path.join(dir, 'big.txt'), SMALL);
    expect(text.content).toMatchObject({ kind: 'text', truncated: true });
    expect((text.content as { text: string }).text).toHaveLength(SMALL.textBytes);
    expect(text.sizeBytes).toBe(100);
    expect((await readViewerDocument(path.join(dir, 'big.png'), SMALL)).content).toEqual({
      kind: 'too-large',
      limitBytes: 32,
    });
    expect((await readViewerDocument(path.join(dir, 'big.pdf'), SMALL)).content).toEqual({
      kind: 'too-large',
      limitBytes: 64,
    });
  });
});

describe('file viewer content kinds', () => {
  it('reads text, Markdown, code, images and PDF', async () => {
    const dir = await temp();
    await writeFile(path.join(dir, 'n.txt'), '﻿hello');
    await writeFile(path.join(dir, 'r.md'), '# Title');
    await writeFile(path.join(dir, 'c.ts'), 'export const a = 1;');
    await writeFile(path.join(dir, 'i.png'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(dir, 'd.pdf'), '%PDF-1.7 body');
    const read = (name: string) => readViewerDocument(path.join(dir, name));
    expect((await read('n.txt')).content).toEqual({ kind: 'text', text: 'hello', truncated: false });
    expect((await read('r.md')).content).toEqual({ kind: 'markdown', text: '# Title', truncated: false });
    expect((await read('c.ts')).content).toEqual({
      kind: 'code',
      text: 'export const a = 1;',
      language: 'typescript',
      truncated: false,
    });
    expect((await read('i.png')).content).toEqual({ kind: 'image', mime: 'image/png', base64: 'AQID' });
    const pdf = await read('d.pdf');
    expect(pdf.content).toMatchObject({ kind: 'pdf', mime: 'application/pdf' });
    expect(pdf.canOpenExternal).toBe(true);
    expect((await read('c.ts')).canOpenExternal).toBe(false);
  });

  it('shows HTML as source, rejects fake PDFs and binary data, and sniffs unknown extensions', async () => {
    const dir = await temp();
    await writeFile(path.join(dir, 'p.html'), '<script>alert(1)</script>');
    await writeFile(path.join(dir, 'fake.pdf'), 'not a pdf');
    await writeFile(path.join(dir, 'blob.bin'), Buffer.from([0x41, 0, 0x42]));
    await writeFile(path.join(dir, 'Dockerfile'), 'FROM node');
    const read = (name: string) => readViewerDocument(path.join(dir, name));
    expect((await read('p.html')).content).toMatchObject({ kind: 'code', language: 'xml' });
    expect((await read('fake.pdf')).content).toEqual({ kind: 'unsupported' });
    expect((await read('blob.bin')).content).toEqual({ kind: 'unsupported' });
    expect((await read('Dockerfile')).content).toMatchObject({ kind: 'text', text: 'FROM node' });
  });
});

describe('view grants', () => {
  it('issues one stable id per path and drops the least recently issued id past the cap', () => {
    let next = 0;
    const grants = createViewGrants({ max: 2, newId: () => `id-${(next += 1)}` });
    const a = grants.issue('/a');
    expect(grants.issue('/a')).toBe(a);
    grants.issue('/b');
    grants.issue('/a'); // refresh a, so b is now the oldest
    grants.issue('/c');
    expect(grants.resolve(a)).toBe('/a');
    expect(grants.resolve('id-2')).toBeUndefined();
    expect(grants.resolve('nope')).toBeUndefined();
  });
});

type Reply = { ok: boolean; code?: string; data?: { viewId: string; name: string } & Record<string, unknown> };
type Handler = (event: { sender: { id: number } }, raw: unknown) => Promise<Reply>;

const bridge = async (options: { trusted?: boolean; explorer?: (relative: string) => Promise<string> } = {}) => {
  const dir = await temp();
  await writeFile(path.join(dir, 'a.txt'), 'hello');
  await writeFile(path.join(dir, 'run.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'i.png'), Buffer.from([1]));
  await mkdir(path.join(dir, 'folder'));
  const handlers = new Map<string, Handler>();
  const openPath = vi.fn(async (_target: string) => '');
  const libraryPaths = new Map<string, string>([
    ['lib-1', path.join(dir, 'a.txt')],
    ['lib-js', path.join(dir, 'run.js')],
    ['lib-png', path.join(dir, 'i.png')],
  ]);
  const unregister = registerFileViewerBridge({
    ipcMain: {
      handle: (channel: string, handler: unknown) => void handlers.set(channel, handler as Handler),
      removeHandler: (channel: string) => void handlers.delete(channel),
    },
    verifySender: () => options.trusted !== false,
    grants: createViewGrants(),
    resolveExplorerFile: options.explorer ?? (async (_owner, _session, relative) => path.join(dir, relative)),
    resolveLibraryPath: async (id) => libraryPaths.get(id),
    openPath,
  });
  const call = (channel: string, raw: unknown) => handlers.get(channel)!({ sender: { id: 1 } }, raw);
  return { dir, call, openPath, unregister, handlers };
};

const fail = (code: string) => ({ ok: false, code });
const explorerError = (code: string) => async (): Promise<string> => {
  throw Object.assign(new Error(code), { code });
};

describe('file viewer IPC', () => {
  it('serves only the trusted sender', async () => {
    const { call } = await bridge({ trusted: false });
    expect(await call(FILE_VIEWER_CHANNELS.read, { ref: { kind: 'library', id: 'lib-1' } })).toEqual(fail('DENIED'));
  });

  it('rejects any payload that carries a path or extra field', async () => {
    const { call, dir } = await bridge();
    const target = path.join(dir, 'a.txt');
    expect(await call(FILE_VIEWER_CHANNELS.read, { ref: { kind: 'view', id: 'x' }, path: target })).toEqual(
      fail('INVALID_REQUEST')
    );
    expect(await call(FILE_VIEWER_CHANNELS.read, { ref: { kind: 'path', id: target } })).toEqual(
      fail('INVALID_REQUEST')
    );
    expect(await call(FILE_VIEWER_CHANNELS.read, { ref: { kind: 'view', id: 'x'.repeat(200) } })).toEqual(
      fail('INVALID_REQUEST')
    );
    expect(await call(FILE_VIEWER_CHANNELS.openFromExplorer, { sessionId: 's', relativePath: 'a', extra: 1 })).toEqual(
      fail('INVALID_REQUEST')
    );
  });

  it('opens an Explorer file as an opaque id and reads it back', async () => {
    const { call, dir } = await bridge();
    const opened = await call(FILE_VIEWER_CHANNELS.openFromExplorer, { sessionId: 's', relativePath: 'a.txt' });
    expect(opened).toMatchObject({ ok: true, data: { name: 'a.txt' } });
    expect(JSON.stringify(opened)).not.toContain(dir);
    const read = await call(FILE_VIEWER_CHANNELS.read, { ref: { kind: 'view', id: opened.data!.viewId } });
    expect(read).toMatchObject({ ok: true, data: { name: 'a.txt', content: { kind: 'text', text: 'hello' } } });
    expect(JSON.stringify(read)).not.toContain(dir);
  });

  it('maps Explorer refusals to stable codes and never issues an id for a folder', async () => {
    const expired = await bridge({ explorer: explorerError('SESSION_EXPIRED') });
    const request = { sessionId: 's', relativePath: 'a' };
    expect(await expired.call(FILE_VIEWER_CHANNELS.openFromExplorer, request)).toEqual(fail('DENIED'));
    const missing = await bridge({ explorer: explorerError('NOT_FOUND') });
    expect(await missing.call(FILE_VIEWER_CHANNELS.openFromExplorer, request)).toEqual(fail('NOT_FOUND'));
    const { call } = await bridge();
    expect(await call(FILE_VIEWER_CHANNELS.openFromExplorer, { sessionId: 's', relativePath: 'folder' })).toEqual(
      fail('DENIED')
    );
  });

  it('answers NOT_FOUND for an unknown reference and reads a Library entry by id', async () => {
    const { call } = await bridge();
    expect(await call(FILE_VIEWER_CHANNELS.read, { ref: { kind: 'view', id: 'unknown' } })).toEqual(fail('NOT_FOUND'));
    expect(await call(FILE_VIEWER_CHANNELS.read, { ref: { kind: 'library', id: 'lib-1' } })).toMatchObject({
      ok: true,
      data: { content: { kind: 'text', text: 'hello' } },
    });
  });

  it('hands only data types to the operating system, never a script or program', async () => {
    const { call, openPath, dir } = await bridge();
    expect(await call(FILE_VIEWER_CHANNELS.openExternal, { ref: { kind: 'library', id: 'lib-js' } })).toEqual(
      fail('DENIED')
    );
    expect(openPath).not.toHaveBeenCalled();
    expect(await call(FILE_VIEWER_CHANNELS.openExternal, { ref: { kind: 'library', id: 'lib-png' } })).toEqual({
      ok: true,
      data: null,
    });
    expect(openPath).toHaveBeenCalledWith(path.join(dir, 'i.png'));
  });

  it('removes its handlers on unregister', async () => {
    const { unregister, handlers } = await bridge();
    expect(handlers.size).toBe(Object.keys(FILE_VIEWER_CHANNELS).length);
    unregister();
    expect(handlers.size).toBe(0);
  });
});
