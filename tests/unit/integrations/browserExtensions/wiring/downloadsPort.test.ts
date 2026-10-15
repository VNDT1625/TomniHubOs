import { describe, expect, it } from 'vitest';
import type { DownloadsPortEvent } from '@process/integrations/browserExtensions/api/groups/data/downloads';
import {
  createDownloadsPort,
  type DownloadItemLike,
} from '@process/integrations/browserExtensions/wiring/downloadsPort';

type Handler = (event: unknown, state: string) => void;

/** A download the Browser started: its progress and its end can be driven from the test. */
const fakeItem = (url: string, filename: string) => {
  const handlers: Record<'updated' | 'done', Handler[]> = { updated: [], done: [] };
  let received = 0;
  let cancelled = false;
  const item: DownloadItemLike = {
    getURL: () => url,
    getFilename: () => filename,
    getMimeType: () => 'application/zip',
    getTotalBytes: () => 100,
    getReceivedBytes: () => received,
    isPaused: () => false,
    cancel: () => {
      cancelled = true;
    },
    on: (event, listener) => {
      handlers[event].push(listener);
      return item;
    },
  };
  return {
    item,
    progress: (bytes: number) => {
      received = bytes;
      for (const handler of handlers.updated) handler({}, 'progressing');
    },
    finish: (state: string) => {
      for (const handler of handlers.done) handler({}, state);
    },
    wasCancelled: () => cancelled,
  };
};

const fakeSession = () => {
  let listener: ((event: unknown, item: DownloadItemLike) => void) | undefined;
  return {
    session: {
      on: (_event: 'will-download', next: (event: unknown, item: DownloadItemLike) => void) => {
        listener = next;
      },
      removeListener: () => undefined,
    },
    start: (item: DownloadItemLike) => listener?.({}, item),
  };
};

const at = new Date('2026-10-15T00:00:00.000Z');

describe('downloads the Browser starts', () => {
  it('records a download, and reports its completion as a change', () => {
    const { session, start } = fakeSession();
    const port = createDownloadsPort(session, () => at);
    const seen: DownloadsPortEvent[] = [];
    port.subscribe((event) => seen.push(event));
    const download = fakeItem('https://files.example.com/a.zip', 'a.zip');
    start(download.item);
    expect(port.list()).toEqual([
      expect.objectContaining({ id: 1, filename: 'a.zip', state: 'in_progress', exists: false }),
    ]);
    download.finish('completed');
    expect(port.list()[0]).toMatchObject({ state: 'complete', exists: true, endTime: at.toISOString() });
    expect(seen.map((event) => event.type)).toEqual(['created', 'changed']);
    expect(seen[1]).toMatchObject({
      type: 'changed',
      id: 1,
      delta: { state: { current: 'complete', previous: 'in_progress' } },
    });
  });

  it('gives a user cancel and a network failure their error names', () => {
    const { session, start } = fakeSession();
    const port = createDownloadsPort(session, () => at);
    const first = fakeItem('https://files.example.com/a.zip', 'a.zip');
    const second = fakeItem('https://files.example.com/b.zip', 'b.zip');
    start(first.item);
    start(second.item);
    first.finish('cancelled');
    second.finish('interrupted');
    expect(port.list().map((record) => [record.state, record.error])).toEqual([
      ['interrupted', 'USER_CANCELED'],
      ['interrupted', 'NETWORK_FAILED'],
    ]);
  });

  it('cancels only a download still in progress, and never reports bytes as a change', () => {
    const { session, start } = fakeSession();
    const port = createDownloadsPort(session, () => at);
    const seen: DownloadsPortEvent[] = [];
    port.subscribe((event) => seen.push(event));
    const download = fakeItem('https://files.example.com/a.zip', 'a.zip');
    start(download.item);
    download.progress(50);
    expect(seen.map((event) => event.type)).toEqual(['created']);
    expect(port.cancel(99)).toBe(false);
    expect(port.cancel(1)).toBe(true);
    expect(download.wasCancelled()).toBe(true);
    download.finish('completed');
    expect(port.cancel(1)).toBe(false);
  });

  it('cannot be built on a session that reports no downloads, so the API is left out', () => {
    expect(() => createDownloadsPort({} as never)).toThrow();
  });
});
