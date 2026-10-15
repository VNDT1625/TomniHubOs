/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LibraryEntrySummary } from '@/common/integrations/library/libraryContracts';
import type { LibraryService } from './libraryService';

/**
 * Read-only view of the Library for other Main modules (the `knowledge` host and `tomny_library_search`, T6.3).
 *
 * It cannot add, move or remove entries, and it never reads file content: a consumer that wants content reads the
 * returned `path` through its own governed file seam. An entry with `missing: true` must be skipped, not retried.
 */
export type LibraryPort = Readonly<{
  list: () => Promise<readonly LibraryEntrySummary[]>;
  /** Entries whose name or path contains every word of `query` (case-insensitive); at most `limit` (max 50). */
  search: (query: string, limit?: number) => Promise<readonly LibraryEntrySummary[]>;
  get: (id: string) => Promise<LibraryEntrySummary | undefined>;
}>;

export const createLibraryPort = (service: LibraryService): LibraryPort => ({
  list: () => service.list(),
  search: (query, limit) => service.search(query, limit),
  get: (id) => service.get(id),
});

let activePort: LibraryPort | undefined;

/** Set by the Library bootstrap while the Library is registered; undefined before start-up and after shutdown. */
export const setActiveLibraryPort = (port: LibraryPort | undefined): void => {
  activePort = port;
};

/** The running Library, or undefined when it is not registered (callers treat that as an empty Library). */
export const getLibraryPort = (): LibraryPort | undefined => activePort;
