import { describe, expect, it } from 'vitest';
import type {
  DownloadRecord,
  DownloadsPort,
  DownloadsPortEvent,
} from '@process/integrations/browserExtensions/api/groups/data/downloads';
import { ID_A, ID_B, call, manifestOf, shimWith, workerOf } from './shimFixture';
import { eventsOf } from './portsFixture';

const record = (id: number, extra: Partial<DownloadRecord> = {}): DownloadRecord => ({
  id,
  url: `https://files.example.com/${id}.zip`,
  finalUrl: `https://files.example.com/${id}.zip`,
  filename: `${id}.zip`,
  mime: 'application/zip',
  state: 'complete',
  paused: false,
  bytesReceived: 10,
  totalBytes: 10,
  startTime: '2026-10-15T00:00:00.000Z',
  exists: true,
  ...extra,
});

const fakeDownloads = (initial: readonly DownloadRecord[]) => {
  const records = [...initial];
  const listeners = new Set<(event: DownloadsPortEvent) => void>();
  const cancelled: number[] = [];
  const port: DownloadsPort = {
    list: () => records,
    cancel: (id) => {
      const found = records.find((item) => item.id === id && item.state === 'in_progress');
      if (found === undefined) return false;
      cancelled.push(id);
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    port,
    cancelled,
    emit: (event: DownloadsPortEvent) => {
      for (const listener of Array.from(listeners)) listener(event);
    },
  };
};

const setup = () => {
  const downloads = fakeDownloads([
    record(1),
    record(2, { url: 'https://other.test/notes.txt', filename: 'notes.txt', mime: 'text/plain' }),
    record(3, { state: 'in_progress', exists: false, endTime: undefined }),
  ]);
  const shim = shimWith(
    {
      [ID_A]: manifestOf({ permissions: ['downloads'] }),
      [ID_B]: manifestOf(),
    },
    { ports: { downloads: downloads.port } }
  );
  return { shim, downloads, events: eventsOf(shim) };
};

describe('chrome.downloads permission and search', () => {
  it('needs the downloads permission for every method', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_B), 'downloads.search', {})).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    expect(await call(shim, workerOf(ID_B), 'downloads.cancel', 3)).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
  });

  it('lists the downloads that match every query term, and the file name rather than a path', async () => {
    const { shim } = setup();
    const all = (await call(shim, workerOf(ID_A), 'downloads.search', {})) as { value: DownloadRecord[] };
    expect(all.value.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(await call(shim, workerOf(ID_A), 'downloads.search', { query: ['files.example', '1.zip'] })).toMatchObject({
      ok: true,
      value: [{ id: 1, filename: '1.zip' }],
    });
    expect(await call(shim, workerOf(ID_A), 'downloads.search', { state: 'in_progress' })).toMatchObject({
      ok: true,
      value: [{ id: 3 }],
    });
    expect(await call(shim, workerOf(ID_A), 'downloads.search', { limit: 1 })).toMatchObject({
      ok: true,
      value: [{ id: 1 }],
    });
  });
});

describe('chrome.downloads download, cancel and events', () => {
  it('refuses to start a download, with the reason, and checks the arguments first', async () => {
    const { shim } = setup();
    expect(
      await call(shim, workerOf(ID_A), 'downloads.download', { url: 'https://files.example.com/x.zip' })
    ).toMatchObject({
      ok: false,
      code: 'REJECTED',
      message: expect.stringContaining('no confirmation'),
    });
    expect(await call(shim, workerOf(ID_A), 'downloads.download', {})).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });

  it('cancels only a download still in progress', async () => {
    const { shim, downloads } = setup();
    expect(await call(shim, workerOf(ID_A), 'downloads.cancel', 3)).toEqual({ ok: true, value: null });
    expect(downloads.cancelled).toEqual([3]);
    expect(await call(shim, workerOf(ID_A), 'downloads.cancel', 1)).toMatchObject({
      ok: false,
      code: 'REJECTED',
    });
  });

  it('reports created and changed downloads only to extensions with the permission', () => {
    const { downloads, events } = setup();
    downloads.emit({ type: 'created', record: record(4) });
    downloads.emit({ type: 'changed', id: 4, delta: { state: { current: 'complete', previous: 'in_progress' } } });
    const created = events.filter((event) => event.name === 'downloads.onCreated');
    expect(created).toEqual([
      expect.objectContaining({ extensionId: ID_A, payload: expect.objectContaining({ id: 4 }) }),
    ]);
    expect(events.filter((event) => event.name === 'downloads.onChanged')).toEqual([
      expect.objectContaining({ extensionId: ID_A, payload: expect.objectContaining({ id: 4 }) }),
    ]);
  });

  it('lists nothing and cancels nothing when the downloads are not wired', async () => {
    const shim = shimWith({ [ID_A]: manifestOf({ permissions: ['downloads'] }) });
    expect(await call(shim, workerOf(ID_A), 'downloads.search', {})).toEqual({ ok: true, value: [] });
    expect(await call(shim, workerOf(ID_A), 'downloads.cancel', 1)).toMatchObject({ ok: false, code: 'REJECTED' });
  });
});
