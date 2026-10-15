/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat } from 'node:fs/promises';
import type { LibraryEntrySummary } from '@/common/integrations/library/libraryContracts';
import { extensionOf } from '../fileViewer/fileKinds';
import { canonicalizePickedFile, HubFileError, toFileError } from '../fileViewer/safeFile';
import { sameLibraryPath, type LibraryRecord, type LibraryStore } from './libraryStore';

/**
 * Whether the file is still where the Library recorded it. A link, a directory or an absent path all count as missing:
 * the entry then offers "pick again" instead of reading through whatever now sits at that path.
 */
const isPresent = async (target: string): Promise<boolean> => {
  try {
    const info = await lstat(target);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
};

const summarize = async (record: LibraryRecord): Promise<LibraryEntrySummary> => ({
  id: record.id,
  name: record.name,
  path: record.path,
  extension: extensionOf(record.name),
  addedAt: record.addedAt,
  missing: !(await isPresent(record.path)),
});

export type LibraryService = Readonly<{
  list: () => Promise<LibraryEntrySummary[]>;
  get: (id: string) => Promise<LibraryEntrySummary | undefined>;
  /** Case-insensitive match of every word of `query` against the file name or path. */
  search: (query: string, limit?: number) => Promise<LibraryEntrySummary[]>;
  /** The recorded path of an entry, for Main-side reads only (never sent to the renderer as authority). */
  resolvePath: (id: string) => Promise<string | undefined>;
  /** Adds files the person picked natively; each is canonicalised and must be a regular file. */
  addPicked: (pickedPaths: readonly string[]) => Promise<LibraryEntrySummary[]>;
  repick: (id: string, pickedPath: string) => Promise<LibraryEntrySummary>;
  remove: (id: string) => Promise<void>;
}>;

export const SEARCH_RESULT_LIMIT = 50;
const MAX_PICK_BATCH = 100;

export const createLibraryService = (store: LibraryStore, ready: Promise<void> = Promise.resolve()): LibraryService => {
  const get = async (id: string): Promise<LibraryEntrySummary | undefined> => {
    await ready;
    const record = store.get(id);
    return record ? summarize(record) : undefined;
  };

  return {
    list: async () => {
      await ready;
      return Promise.all(store.list().map(summarize));
    },
    get,
    search: async (query, limit = SEARCH_RESULT_LIMIT) => {
      await ready;
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 0);
      const bounded = Math.max(0, Math.min(Math.trunc(limit), SEARCH_RESULT_LIMIT));
      const matches = store
        .list()
        .filter((record) => {
          const haystack = `${record.name}\n${record.path}`.toLowerCase();
          return words.every((word) => haystack.includes(word));
        })
        .slice(0, bounded);
      return Promise.all(matches.map(summarize));
    },
    resolvePath: async (id) => {
      await ready;
      return store.get(id)?.path;
    },
    addPicked: async (pickedPaths) => {
      await ready;
      if (pickedPaths.length > MAX_PICK_BATCH) throw new HubFileError('LIMIT_EXCEEDED');
      const added: LibraryEntrySummary[] = [];
      for (const picked of pickedPaths) {
        // oxlint-disable-next-line no-await-in-loop -- the store serialises writes; order is the pick order.
        const canonical = await canonicalizePickedFile(picked);
        // oxlint-disable-next-line no-await-in-loop
        added.push(await summarize(await store.add(canonical)));
      }
      return added;
    },
    repick: async (id, pickedPath) => {
      await ready;
      if (!store.get(id)) throw new HubFileError('NOT_FOUND');
      const canonical = await canonicalizePickedFile(pickedPath);
      if (store.list().some((record) => record.id !== id && sameLibraryPath(record.path, canonical))) {
        throw new HubFileError('INVALID_REQUEST');
      }
      const next = await store.repath(id, canonical).catch((error: unknown) => {
        throw toFileError(error);
      });
      if (!next) throw new HubFileError('NOT_FOUND');
      return summarize(next);
    },
    remove: async (id) => {
      await ready;
      if (!(await store.remove(id))) throw new HubFileError('NOT_FOUND');
    },
  };
};
