/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Durable, Main-owned list of Library documents (docs/platform/repotopackage-design.md section 14, S11).
 *
 * The store keeps where a file is, never the file: nothing here reads, copies or moves user content, and the only file
 * it writes is its own JSON. Writes are atomic (temporary file, then rename) and serialised. Failing closed: a missing,
 * unreadable or corrupt file is an empty Library, and a record that fails validation is dropped.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const MAX_ENTRIES = 5_000;

const entrySchema = z
  .object({
    id: z.string().min(1).max(64),
    path: z.string().min(1).max(2048),
    name: z.string().min(1).max(255),
    addedAt: z.number().int().nonnegative(),
  })
  .strict();

export type LibraryRecord = z.infer<typeof entrySchema>;

const fileSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(z.unknown()).max(MAX_ENTRIES) });

export type LibraryStore = Readonly<{
  initialize: () => Promise<void>;
  /** Oldest first. Returns copies. */
  list: () => LibraryRecord[];
  get: (id: string) => LibraryRecord | undefined;
  /** Adds a document by canonical path; the same path is never listed twice (the existing record is returned). */
  add: (filePath: string) => Promise<LibraryRecord>;
  /** Points an entry at another file, keeping its id; the same path as another entry is refused. */
  repath: (id: string, filePath: string) => Promise<LibraryRecord | undefined>;
  remove: (id: string) => Promise<boolean>;
}>;

export const sameLibraryPath = (left: string, right: string): boolean =>
  process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

export const createJsonLibraryStore = (
  filePath: string,
  options: { now?: () => number; newId?: () => string } = {}
): LibraryStore => {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const records = new Map<string, LibraryRecord>();
  let writes: Promise<void> = Promise.resolve();

  const persist = (): Promise<void> => {
    const snapshot = JSON.stringify({ schemaVersion: 1, entries: [...records.values()] }, null, 2);
    const task = writes.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, filePath);
    });
    // A failed write must not poison later writes, but the caller still sees the failure.
    writes = task.catch((): undefined => undefined);
    return task;
  };

  const mutate = async <T>(change: () => T): Promise<T> => {
    const before = new Map(records);
    const result = change();
    try {
      await persist();
    } catch (error) {
      records.clear();
      for (const [key, value] of before) records.set(key, value);
      throw error;
    }
    return result;
  };

  const findByPath = (target: string): LibraryRecord | undefined =>
    [...records.values()].find((record) => sameLibraryPath(record.path, target));

  return {
    initialize: async () => {
      records.clear();
      let text: string;
      try {
        text = await readFile(filePath, 'utf8');
      } catch {
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return;
      }
      const file = fileSchema.safeParse(raw);
      if (!file.success) return;
      for (const item of file.data.entries) {
        const parsed = entrySchema.safeParse(item);
        if (parsed.success && !records.has(parsed.data.id) && !findByPath(parsed.data.path)) {
          records.set(parsed.data.id, parsed.data);
        }
      }
    },
    list: () => [...records.values()].map((record) => structuredClone(record)),
    get: (id) => {
      const record = records.get(id);
      return record ? { ...record } : undefined;
    },
    add: async (target) => {
      const existing = findByPath(target);
      if (existing) return { ...existing };
      if (records.size >= MAX_ENTRIES) throw new Error('The Library is full.');
      const record = entrySchema.parse({
        id: newId(),
        path: target,
        name: path.basename(target),
        addedAt: now(),
      });
      await mutate(() => {
        records.set(record.id, record);
      });
      return { ...record };
    },
    repath: async (id, target) => {
      const current = records.get(id);
      if (!current) return undefined;
      const owner = findByPath(target);
      if (owner && owner.id !== id) throw new Error('That file is already in the Library.');
      const next = entrySchema.parse({ ...current, path: target, name: path.basename(target) });
      await mutate(() => {
        records.set(id, next);
      });
      return { ...next };
    },
    remove: async (id) => {
      if (!records.has(id)) return false;
      await mutate(() => {
        records.delete(id);
      });
      return true;
    },
  };
};
