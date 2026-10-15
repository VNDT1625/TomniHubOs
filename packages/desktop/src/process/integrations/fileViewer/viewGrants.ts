/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';

/**
 * Main-owned table of files the person opened from Explorer. The renderer only ever holds the random id; the id maps
 * to a path Explorer had already validated against its granted root. The table is in memory (a restart forgets it),
 * bounded, and least-recently-issued ids are dropped first.
 */
export type ViewGrants = Readonly<{
  /** Issues (or re-issues) the id of a canonical file path. */
  issue: (absolutePath: string) => string;
  /** The path behind an id, or undefined when it was never issued or has been dropped. */
  resolve: (id: string) => string | undefined;
}>;

export const MAX_VIEW_GRANTS = 256;

export const createViewGrants = (options: { max?: number; newId?: () => string } = {}): ViewGrants => {
  const max = options.max ?? MAX_VIEW_GRANTS;
  const newId = options.newId ?? randomUUID;
  const byId = new Map<string, string>();
  const byPath = new Map<string, string>();

  return {
    issue: (absolutePath) => {
      const existing = byPath.get(absolutePath);
      if (existing) {
        // Refresh the position so a file the person keeps opening is not the next one dropped.
        byId.delete(existing);
        byId.set(existing, absolutePath);
        return existing;
      }
      const id = newId();
      byId.set(id, absolutePath);
      byPath.set(absolutePath, id);
      while (byId.size > max) {
        const oldest = byId.keys().next();
        if (oldest.done) break;
        const dropped = byId.get(oldest.value);
        byId.delete(oldest.value);
        if (dropped !== undefined) byPath.delete(dropped);
      }
      return id;
    },
    resolve: (id) => byId.get(id),
  };
};
