/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import type { HubActivityRegistry } from './hubActivityRegistry';

/**
 * Durable copy of the Hub activity grid so Home tiles survive a restart.
 * This is display state, not authority: unlike a grant ledger, a missing or
 * corrupt file degrades to an empty grid instead of blocking startup.
 */
export class FileHubActivityStore {
  public constructor(private readonly filePath: string) {}

  /** Returns the persisted items, or an empty list when nothing usable is on disk. */
  public async load(): Promise<unknown[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[HubActivity] persisted grid unreadable, starting empty:', error);
      }
      return [];
    }
  }

  /** Writes atomically: a crash mid-save must never leave a truncated grid behind. */
  public async save(items: HubActivityItem[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(items), 'utf8');
    await rename(temporary, this.filePath);
  }
}

/** Restores the previous grid on boot and keeps the file current after every change. */
export const restoreHubActivityGrid = (registry: HubActivityRegistry, filePath: string): void => {
  const store = new FileHubActivityStore(filePath);
  registry.setPersister(async (items) => {
    try {
      await store.save(items);
    } catch (error) {
      console.warn('[HubActivity] grid write failed:', error);
    }
  });
  void store
    .load()
    .then((items) => registry.hydrate(items))
    .catch((error: unknown) => console.warn('[HubActivity] grid restore failed:', error));
};
