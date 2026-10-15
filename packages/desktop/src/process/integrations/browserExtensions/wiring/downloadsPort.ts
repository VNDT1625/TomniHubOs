/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The real {@link DownloadsPort}: the downloads of the Browser profile, recorded as Electron reports them
 * (docs/platform/repotopackage-design.md sections 12.3 and 15.1).
 *
 * This only observes. A `will-download` listener that does not call `preventDefault` leaves Electron's behavior as it
 * was: nothing is started, saved or stopped here. An extension cannot start a download (`downloads.download` is
 * refused), so every entry was begun by the Browser itself.
 *
 * Records keep the file name, never the folder. At most 500 are kept; finished ones go first when the limit is reached.
 */

import type {
  DownloadDelta,
  DownloadRecord,
  DownloadState,
  DownloadsPort,
  DownloadsPortEvent,
} from '@process/integrations/browserExtensions/api/groups/data/downloads';

/** The part of Electron's `DownloadItem` this uses. */
export type DownloadItemLike = Readonly<{
  getURL: () => string;
  getFilename: () => string;
  getMimeType: () => string;
  getTotalBytes: () => number;
  getReceivedBytes: () => number;
  isPaused: () => boolean;
  cancel: () => void;
  on: (event: 'updated' | 'done', listener: (event: unknown, state: string) => void) => unknown;
}>;

type WillDownloadListener = (event: unknown, item: DownloadItemLike) => void;

/** The part of the Browser profile `Session` this uses. */
export type DownloadSessionLike = Readonly<{
  on: (event: 'will-download', listener: WillDownloadListener) => unknown;
  removeListener: (event: 'will-download', listener: WillDownloadListener) => unknown;
}>;

export type DownloadsPortWithDispose = DownloadsPort & Readonly<{ dispose: () => void }>;

const MAX_RECORDS = 500;
/** The fields whose changes are sent as `downloads.onChanged`. Bytes change too often to be sent. */
const REPORTED: readonly (keyof DownloadRecord)[] = ['state', 'paused', 'totalBytes', 'error', 'endTime', 'exists'];

export const createDownloadsPort = (
  session: DownloadSessionLike,
  now: () => Date = () => new Date()
): DownloadsPortWithDispose => {
  const records = new Map<number, DownloadRecord>();
  const items = new Map<number, DownloadItemLike>();
  const listeners = new Set<(event: DownloadsPortEvent) => void>();
  let nextId = 1;

  const emit = (event: DownloadsPortEvent): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch {
        // A listener that fails must not stop the download.
      }
    }
  };

  const trim = (): void => {
    for (const [id, record] of records) {
      if (records.size <= MAX_RECORDS) break;
      if (record.state !== 'in_progress') {
        records.delete(id);
        items.delete(id);
      }
    }
  };

  /** Re-reads the item and sends the reported fields that changed. */
  const refresh = (
    id: number,
    state: DownloadState,
    extra: Readonly<{ error?: string; endTime?: string }> = {}
  ): void => {
    const item = items.get(id);
    const previous = records.get(id);
    if (item === undefined || previous === undefined) return;
    const url = item.getURL();
    const next: DownloadRecord = {
      ...previous,
      url,
      finalUrl: url,
      filename: item.getFilename(),
      mime: item.getMimeType(),
      state,
      paused: item.isPaused(),
      bytesReceived: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      exists: state === 'complete',
      ...(extra.error === undefined ? {} : { error: extra.error }),
      ...(extra.endTime === undefined ? {} : { endTime: extra.endTime }),
    };
    records.set(id, next);
    const delta: Record<string, { current?: unknown; previous?: unknown }> = {};
    for (const key of REPORTED) {
      if (previous[key] !== next[key]) delta[key] = { current: next[key], previous: previous[key] };
    }
    if (Object.keys(delta).length > 0) emit({ type: 'changed', id, delta: delta as DownloadDelta });
  };

  const onWillDownload: WillDownloadListener = (_started, item) => {
    const id = nextId;
    nextId += 1;
    const url = item.getURL();
    const record: DownloadRecord = {
      id,
      url,
      finalUrl: url,
      filename: item.getFilename(),
      mime: item.getMimeType(),
      state: 'in_progress',
      paused: item.isPaused(),
      bytesReceived: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      startTime: now().toISOString(),
      exists: false,
    };
    items.set(id, item);
    records.set(id, record);
    trim();
    emit({ type: 'created', record });
    item.on('updated', (_event, state) => {
      refresh(id, state === 'interrupted' ? 'interrupted' : 'in_progress');
    });
    item.on('done', (_event, state) => {
      const endTime = now().toISOString();
      if (state === 'completed') refresh(id, 'complete', { endTime });
      else if (state === 'cancelled') refresh(id, 'interrupted', { endTime, error: 'USER_CANCELED' });
      else refresh(id, 'interrupted', { endTime, error: 'NETWORK_FAILED' });
    });
  };

  session.on('will-download', onWillDownload);

  return {
    list: () => [...records.values()],
    cancel: (id) => {
      const record = records.get(id);
      const item = items.get(id);
      if (record === undefined || item === undefined || record.state !== 'in_progress') return false;
      item.cancel();
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      session.removeListener('will-download', onWillDownload);
      listeners.clear();
    },
  };
};
