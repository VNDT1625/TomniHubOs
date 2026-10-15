/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubActivityRegistry } from '@process/system/hubActivity/hubActivityRegistry';
import { FileHubActivityStore, restoreHubActivityGrid } from '@process/system/hubActivity/hubActivityStore';

let directory: string;
let filePath: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'hub-activity-'));
  filePath = path.join(directory, 'runs', 'hub-activity.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('FileHubActivityStore', () => {
  it('round-trips saved items and starts empty when there is no file', async () => {
    const store = new FileHubActivityStore(filePath);
    expect(await store.load()).toEqual([]);
    const registry = new HubActivityRegistry();
    registry.upsert('agent', 'a', { status: 'done', title: 'Báo cáo' });
    const items = registry.snapshot().items;
    await store.save(items);
    expect(await store.load()).toEqual(items);
  });

  it('treats corrupt or non-array files as an empty grid instead of failing', async () => {
    const store = new FileHubActivityStore(filePath);
    await store.save([]);
    await writeFile(filePath, '{ truncated', 'utf8');
    expect(await store.load()).toEqual([]);
    await writeFile(filePath, '{"not":"an array"}', 'utf8');
    expect(await store.load()).toEqual([]);
  });
});

describe('restoreHubActivityGrid', () => {
  it('hydrates a fresh registry from disk and keeps the file current', async () => {
    const previousRun = new HubActivityRegistry({ now: () => 10_000 });
    previousRun.upsert('agent', 'a', { status: 'done', title: 'Trước restart', startedAt: 9_000 });
    await new FileHubActivityStore(filePath).save(previousRun.snapshot().items);

    const registry = new HubActivityRegistry({ now: () => 10_000, persistDelayMs: 5 });
    restoreHubActivityGrid(registry, filePath);
    await vi.waitFor(() => expect(registry.get('agent', 'a')?.title).toBe('Trước restart'));

    registry.upsert('agent', 'b', { status: 'running', startedAt: 10_000 });
    await vi.waitFor(async () => {
      const persisted = await new FileHubActivityStore(filePath).load();
      expect(persisted).toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceId: 'b', status: 'running' })])
      );
    });
    registry.dispose();
  });
});
