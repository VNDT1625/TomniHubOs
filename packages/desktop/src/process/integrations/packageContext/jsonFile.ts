/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A small JSON file owned by Main (design sections 10.6 and 10.7): the Library index and the rules attachments.
 * Reads fail closed (a missing, unreadable or corrupt file reads as "nothing", so damage can only remove things from
 * the Library, never add) and writes are atomic and one at a time.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type JsonFile = Readonly<{
  /** The parsed content, or `undefined` when the file is missing, unreadable or not JSON. */
  read: () => Promise<unknown>;
  /** Replaces the content. Rejects when the file cannot be written; later writes are not poisoned by it. */
  write: (value: unknown) => Promise<void>;
}>;

export const createJsonFile = (filePath: string): JsonFile => {
  let writes: Promise<void> = Promise.resolve();
  return {
    read: async () => {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      } catch {
        return undefined;
      }
    },
    write: (value) => {
      const snapshot = JSON.stringify(value, null, 2);
      const task = writes.then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        const temporary = `${filePath}.${process.pid}.tmp`;
        await writeFile(temporary, snapshot, 'utf8');
        await rename(temporary, filePath);
      });
      writes = task.catch((): undefined => undefined);
      return task;
    },
  };
};
