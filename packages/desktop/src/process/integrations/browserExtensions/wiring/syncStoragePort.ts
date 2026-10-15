/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The real {@link SyncStoragePort}: one JSON file per extension in a folder of the Hub's user data
 * (docs/platform/repotopackage-design.md section 12.3). The file is named by the extension id, which is validated first,
 * so no caller can name a path outside the folder.
 *
 * Writes are atomic (a temporary file, then a rename). Damaged data is an error, never an empty store: an empty store
 * would overwrite the damaged file on the next write and lose what was there.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXTENSION_ID_PATTERN } from '@process/integrations/browserExtensions/api/contract';
import type { SyncItems, SyncStoragePort } from '@process/integrations/browserExtensions/api/groups/data/storageSync';

/** The folder name under the Hub's user data that holds the files. */
export const SYNC_STORAGE_DIRECTORY = 'tomny-extension-sync';

export const createFileSyncStoragePort = (directory: string): SyncStoragePort => {
  if (!path.isAbsolute(directory)) throw new Error('The sync storage folder must be an absolute path.');
  const fileOf = (extensionId: string): string => {
    if (!EXTENSION_ID_PATTERN.test(extensionId)) throw new Error('The extension id is not well formed.');
    return path.join(directory, `${extensionId}.json`);
  };
  return {
    read: async (extensionId): Promise<SyncItems | undefined> => {
      let raw: string;
      try {
        raw = await readFile(fileOf(extensionId), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('The stored sync data is damaged.');
      }
      return parsed as SyncItems;
    },
    write: async (extensionId, items) => {
      const file = fileOf(extensionId);
      await mkdir(directory, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(items), 'utf8');
      await rename(temporary, file);
    },
  };
};
