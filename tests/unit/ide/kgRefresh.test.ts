/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyRepoChangesToGraph,
  captureStaleMarkerSnapshots,
  createKeyedTaskSerializer,
  createLiveGraphUpdater,
  persistKnowledgeGraphArtifacts,
  type KnowledgeGraphArtifactIo,
} from '@/process/ide/kgRefresh';
import { createKnowledgeGraphBuilder, fingerprintOf } from '@/process/ide/knowledgeGraphBuilder';
import { assessGraphFreshness } from '@/process/ide/graphFreshness';
import { collectRepoFiles } from '@/process/ide/repoGraph';
import type { KnowledgeGraph, RepoChangeEvent } from '@/process/ide/understandTypes';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const makeTempRepo = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tomni-live-graph-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  return root;
};

const collectFiles = (rootPath: string) =>
  collectRepoFiles(rootPath, {
    listDir: async (dir) =>
      (await fs.readdir(dir, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        fullPath: path.join(dir, entry.name),
        isDir: entry.isDirectory(),
      })),
    readFile: (filePath) => fs.readFile(filePath, 'utf-8'),
    toRel: (filePath) => path.relative(rootPath, filePath).replace(/\\/g, '/'),
  });

const artifactPaths = (rootPath: string) => ({
  graphPath: path.join(rootPath, '.store', 'graph.json'),
  summaryPath: path.join(rootPath, '.tomni', 'understand', 'summary.json'),
  staleMarkerPaths: ['.tomni', '.omni', '.tomny'].map((dir) => path.join(rootPath, dir, 'understand', 'stale.json')),
});

const readGraph = async (filePath: string): Promise<KnowledgeGraph | null> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as KnowledgeGraph;
  } catch {
    return null;
  }
};

describe('live knowledge graph lifecycle', () => {
  it('publishes create/change/delete nodes and edges before clearing every stale marker', async () => {
    const root = await makeTempRepo();
    await fs.writeFile(path.join(root, 'src', 'a.ts'), "import { b } from './b';\nexport const a = b;\n");
    await fs.writeFile(path.join(root, 'src', 'b.ts'), 'export const b = 1;\n');
    const builder = createKnowledgeGraphBuilder({
      chat: async () => '[]',
      collectFiles,
      now: () => 100,
    });
    const initial = await builder.build(root, 'live-structural', { summaryCap: 0 });
    const paths = artifactPaths(root);
    await persistKnowledgeGraphArtifacts(initial, paths);
    for (const marker of paths.staleMarkerPaths) {
      await fs.mkdir(path.dirname(marker), { recursive: true });
      await fs.writeFile(marker, JSON.stringify({ paths: ['src/a.ts'] }));
    }

    await fs.writeFile(path.join(root, 'src', 'a.ts'), "import { c } from './c';\nexport const a = c;\n");
    await fs.writeFile(path.join(root, 'src', 'c.ts'), 'export const c = 2;\n');
    await fs.rm(path.join(root, 'src', 'b.ts'));
    const updater = createLiveGraphUpdater({
      loadGraph: () => readGraph(paths.graphPath),
      captureStaleMarkers: () => captureStaleMarkerSnapshots(paths.staleMarkerPaths),
      rebuildGraph: async (_rootPath, previous, event) => {
        if (!previous) throw new Error('expected persisted graph');
        return applyRepoChangesToGraph(previous, event, async (repoRoot, relPath) => {
          try {
            return await fs.readFile(path.join(repoRoot, relPath), 'utf-8');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          }
        });
      },
      persistArtifacts: (graph, context) =>
        persistKnowledgeGraphArtifacts(graph, paths, undefined, {
          processedPaths: [...context.event.changed, ...context.event.removed],
          staleMarkerSnapshots: context.staleMarkerSnapshots,
        }),
    });
    const event: RepoChangeEvent = { rootPath: root, changed: ['src/a.ts', 'src/c.ts'], removed: ['src/b.ts'] };

    const updated = await updater.enqueue(event);
    const summary = JSON.parse(await fs.readFile(paths.summaryPath, 'utf-8')) as {
      edges: Array<{ from: string; to: string }>;
    };

    expect(updated.nodes.map((node) => node.id)).toEqual(['src/a.ts', 'src/c.ts']);
    expect(updated.edges).toEqual([{ from: 'src/a.ts', to: 'src/c.ts' }]);
    expect(summary.edges).toEqual(updated.edges);
    const markerExists = await Promise.all(
      paths.staleMarkerPaths.map((marker) =>
        fs
          .stat(marker)
          .then(() => true)
          .catch(() => false)
      )
    );
    expect(markerExists).toEqual([false, false, false]);
  });

  it('serializes rapid debounced batches so graph artifact publishes never overlap', async () => {
    const root = await makeTempRepo();
    const base: KnowledgeGraph = {
      rootPath: root,
      version: 5,
      builtAt: 0,
      nodes: [],
      edges: [],
      tours: [],
      truncated: false,
      fileCount: 0,
    };
    let releaseFirst!: () => void;
    let signalFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const updater = createLiveGraphUpdater({
      loadGraph: async () => base,
      rebuildGraph: async (_rootPath, _previous, event) => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(`start:${event.changed[0]}`);
        if (event.changed[0] === 'first.ts') {
          signalFirstStarted();
          await firstGate;
        }
        order.push(`end:${event.changed[0]}`);
        active--;
        return { ...base, builtAt: base.builtAt + order.length };
      },
      persistArtifacts: async () => undefined,
    });

    const first = updater.enqueue({ rootPath: root, changed: ['first.ts'], removed: [] });
    await firstStarted;
    const second = updater.enqueue({ rootPath: root, changed: ['second.ts'], removed: [] });
    releaseFirst();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
    expect(order).toEqual(['start:first.ts', 'end:first.ts', 'start:second.ts', 'end:second.ts']);
  });

  it('publishes a Live change after an overlapping full build so the final fingerprint is newest', async () => {
    const root = await makeTempRepo();
    const serializer = createKeyedTaskSerializer();
    const oldContent = 'export const value = 1;\n';
    const latestContent = 'export const value = 2;\n';
    let persisted: KnowledgeGraph | null = null;
    let releaseFull!: () => void;
    let signalScanned!: () => void;
    const fullGate = new Promise<void>((resolve) => {
      releaseFull = resolve;
    });
    const scanned = new Promise<void>((resolve) => {
      signalScanned = resolve;
    });
    const base: KnowledgeGraph = {
      rootPath: root,
      version: 5,
      builtAt: 1,
      sourceSnapshotAt: 1,
      nodes: [],
      edges: [],
      tours: [],
      truncated: false,
      fileCount: 0,
    };

    const full = serializer.run(root, async () => {
      const scannedContent = oldContent;
      signalScanned();
      await fullGate;
      persisted = await applyRepoChangesToGraph(
        base,
        { rootPath: root, changed: ['src/value.ts'], removed: [] },
        async () => scannedContent
      );
    });
    await scanned;
    const live = serializer.run(root, async () => {
      if (!persisted) throw new Error('full build must publish first');
      persisted = await applyRepoChangesToGraph(
        persisted,
        { rootPath: root, changed: ['src/value.ts'], removed: [] },
        async () => latestContent
      );
    });
    releaseFull();
    await Promise.all([full, live]);

    expect(persisted?.nodes[0]?.fingerprint).toBe(fingerprintOf(latestContent));
  });

  it('processes the complete stale-marker union before clearing an incremental generation', async () => {
    const root = await makeTempRepo();
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    await fs.writeFile(path.join(root, 'src', 'b.ts'), 'export const b = 1;\n');
    const builder = createKnowledgeGraphBuilder({ chat: async () => '[]', collectFiles, now: () => 1 });
    const paths = artifactPaths(root);
    await persistKnowledgeGraphArtifacts(await builder.build(root, 'live-structural', { summaryCap: 0 }), paths);
    const marker = paths.staleMarkerPaths[0];
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, JSON.stringify({ paths: ['src/a.ts', 'src/b.ts'] }));
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 2;\n');
    await fs.writeFile(path.join(root, 'src', 'b.ts'), 'export const b = 2;\n');
    let rebuiltEvent: RepoChangeEvent | undefined;
    const updater = createLiveGraphUpdater({
      loadGraph: () => readGraph(paths.graphPath),
      captureStaleMarkers: () => captureStaleMarkerSnapshots(paths.staleMarkerPaths),
      rebuildGraph: async (_rootPath, previous, event) => {
        if (!previous) throw new Error('expected persisted graph');
        rebuiltEvent = event;
        return applyRepoChangesToGraph(previous, event, (repoRoot, relPath) =>
          fs.readFile(path.join(repoRoot, relPath), 'utf-8').catch(() => null)
        );
      },
      persistArtifacts: (graph, context) =>
        persistKnowledgeGraphArtifacts(graph, paths, undefined, {
          processedPaths: [...context.event.changed, ...context.event.removed],
          staleMarkerSnapshots: context.staleMarkerSnapshots,
        }),
    });

    const updated = await updater.enqueue({ rootPath: root, changed: ['src/a.ts'], removed: [] });

    expect(rebuiltEvent?.changed).toEqual(['src/a.ts', 'src/b.ts']);
    expect(updated.nodes.find((node) => node.id === 'src/b.ts')?.symbols[0]?.name).toBe('b');
    await expect(fs.stat(marker)).rejects.toThrow();
  });

  it('forces a full structural walk before clearing an overflow stale marker', async () => {
    const root = await makeTempRepo();
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    const builder = createKnowledgeGraphBuilder({ chat: async () => '[]', collectFiles, now: () => 1 });
    const paths = artifactPaths(root);
    await persistKnowledgeGraphArtifacts(await builder.build(root, 'live-structural', { summaryCap: 0 }), paths);
    const marker = paths.staleMarkerPaths[0];
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(
      marker,
      JSON.stringify({ fullRebuildRequired: true, paths: ['src/a.ts'], updatedAt: 'overflow-1' })
    );
    const snapshots = await captureStaleMarkerSnapshots(paths.staleMarkerPaths);
    const previous = await readGraph(paths.graphPath);
    if (!previous) throw new Error('expected persisted graph');

    await persistKnowledgeGraphArtifacts(previous, paths, undefined, {
      processedPaths: ['src/a.ts'],
      staleMarkerSnapshots: snapshots,
    });
    await expect(fs.stat(marker)).resolves.toBeDefined();

    await fs.writeFile(path.join(root, 'src', 'unlisted.ts'), 'export const unlisted = true;\n');
    let fullBuilds = 0;
    const updater = createLiveGraphUpdater({
      loadGraph: () => readGraph(paths.graphPath),
      captureStaleMarkers: () => captureStaleMarkerSnapshots(paths.staleMarkerPaths),
      rebuildGraph: async (rootPath, current, event, context) => {
        if (context.fullRebuildRequired) {
          fullBuilds++;
          return builder.build(rootPath, 'live-structural', { previous: current, summaryCap: 0 });
        }
        if (!current) throw new Error('expected persisted graph');
        return applyRepoChangesToGraph(current, event, (repoRoot, relPath) =>
          fs.readFile(path.join(repoRoot, relPath), 'utf-8').catch(() => null)
        );
      },
      persistArtifacts: (graph, context) =>
        persistKnowledgeGraphArtifacts(graph, paths, undefined, {
          processedPaths: [...context.event.changed, ...context.event.removed],
          staleMarkerSnapshots: context.staleMarkerSnapshots,
          fullStructuralRebuild: context.fullRebuildRequired,
        }),
    });

    const updated = await updater.enqueue({ rootPath: root, changed: ['src/a.ts'], removed: [] });

    expect(fullBuilds).toBe(1);
    expect(updated.nodes.map((node) => node.id)).toContain('src/unlisted.ts');
    await expect(fs.stat(marker)).rejects.toThrow();
  });

  it('preserves a newer stale-marker generation appended while artifacts publish', async () => {
    const root = await makeTempRepo();
    const paths = artifactPaths(root);
    const marker = paths.staleMarkerPaths[0];
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, JSON.stringify({ updatedAt: 'before', paths: ['src/a.ts'] }));
    const snapshots = await captureStaleMarkerSnapshots(paths.staleMarkerPaths);
    const graph: KnowledgeGraph = {
      rootPath: root,
      version: 5,
      builtAt: 1,
      nodes: [],
      edges: [],
      tours: [],
      truncated: false,
      fileCount: 0,
    };
    const io: KnowledgeGraphArtifactIo = {
      mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
      readFile: (filePath) => fs.readFile(filePath, 'utf-8').catch(() => null),
      writeFile: (filePath, content) => fs.writeFile(filePath, content, 'utf-8'),
      rename: async (from, to) => {
        await fs.rename(from, to);
        if (to === paths.summaryPath) {
          await fs.writeFile(marker, JSON.stringify({ updatedAt: 'after', paths: ['src/a.ts', 'src/new.ts'] }));
        }
      },
      remove: (filePath) => fs.rm(filePath, { force: true }).then(() => undefined),
    };

    await persistKnowledgeGraphArtifacts(graph, paths, io, {
      processedPaths: ['src/a.ts'],
      staleMarkerSnapshots: snapshots,
    });

    expect(JSON.parse(await fs.readFile(marker, 'utf-8'))).toMatchObject({
      updatedAt: 'after',
      paths: ['src/a.ts', 'src/new.ts'],
    });
  });

  it('preserves a new-file marker appended after a full scan snapshot', async () => {
    const root = await makeTempRepo();
    const paths = artifactPaths(root);
    const marker = paths.staleMarkerPaths[0];
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, JSON.stringify({ updatedAt: 'scan-start', paths: ['src/a.ts'] }));
    const snapshots = await captureStaleMarkerSnapshots(paths.staleMarkerPaths);
    await fs.writeFile(
      marker,
      JSON.stringify({ updatedAt: 'after-scan', paths: ['src/a.ts', 'src/new-after-scan.ts'] })
    );
    const graph: KnowledgeGraph = {
      rootPath: root,
      version: 5,
      builtAt: 2,
      sourceSnapshotAt: 1,
      nodes: [],
      edges: [],
      tours: [],
      truncated: false,
      fileCount: 0,
    };

    await persistKnowledgeGraphArtifacts(graph, paths, undefined, {
      staleMarkerSnapshots: snapshots,
      fullStructuralRebuild: true,
    });

    expect(JSON.parse(await fs.readFile(marker, 'utf-8'))).toMatchObject({
      updatedAt: 'after-scan',
      paths: ['src/a.ts', 'src/new-after-scan.ts'],
    });
  });

  it('holds the shared canonical lock across marker generation reads and compare-remove', async () => {
    const root = await makeTempRepo();
    const paths = artifactPaths(root);
    const marker = paths.staleMarkerPaths[0];
    const expectedLock = path.join(root, '.tomni', 'understand', 'stale.lock');
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, JSON.stringify({ paths: ['src/a.ts'] }));
    let locked = false;
    const events: string[] = [];
    const io: KnowledgeGraphArtifactIo = {
      mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
      acquireMarkerLock: async (lockDir) => {
        expect(lockDir).toBe(expectedLock);
        expect(locked).toBe(false);
        locked = true;
        events.push('acquire');
        return async () => {
          events.push('release');
          locked = false;
        };
      },
      readFile: async (filePath) => {
        expect(locked).toBe(true);
        events.push(`read:${path.basename(filePath)}`);
        return fs.readFile(filePath, 'utf-8').catch(() => null);
      },
      writeFile: (filePath, content) => fs.writeFile(filePath, content, 'utf-8'),
      rename: (from, to) => fs.rename(from, to),
      remove: async (filePath) => {
        if (filePath === marker) expect(locked).toBe(true);
        events.push(`remove:${path.basename(filePath)}`);
        await fs.rm(filePath, { force: true });
      },
    };
    const snapshots = await captureStaleMarkerSnapshots(paths.staleMarkerPaths, io);
    const graph: KnowledgeGraph = {
      rootPath: root,
      version: 5,
      builtAt: 1,
      nodes: [],
      edges: [],
      tours: [],
      truncated: false,
      fileCount: 0,
    };

    await persistKnowledgeGraphArtifacts(graph, paths, io, {
      processedPaths: ['src/a.ts'],
      staleMarkerSnapshots: snapshots,
    });

    expect(locked).toBe(false);
    expect(events.filter((event) => event === 'acquire')).toHaveLength(2);
    expect(events.filter((event) => event === 'release')).toHaveLength(2);
    await expect(fs.stat(marker)).rejects.toThrow();
  });

  it('keeps migration stale markers when either atomic artifact publish fails', async () => {
    const root = await makeTempRepo();
    const paths = artifactPaths(root);
    const graph: KnowledgeGraph = {
      rootPath: root,
      version: 5,
      builtAt: 1,
      nodes: [],
      edges: [],
      tours: [],
      truncated: false,
      fileCount: 0,
    };
    for (const marker of paths.staleMarkerPaths) {
      await fs.mkdir(path.dirname(marker), { recursive: true });
      await fs.writeFile(marker, JSON.stringify({ paths: ['src/a.ts'] }));
    }
    const io: KnowledgeGraphArtifactIo = {
      mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
      readFile: (filePath) => fs.readFile(filePath, 'utf-8').catch(() => null),
      writeFile: (filePath, content) => fs.writeFile(filePath, content, 'utf-8'),
      rename: async (from, to) => {
        if (to === paths.summaryPath) throw new Error('summary publish failed');
        await fs.rename(from, to);
      },
      remove: (filePath) => fs.rm(filePath, { force: true }).then(() => undefined),
    };

    await expect(persistKnowledgeGraphArtifacts(graph, paths, io)).rejects.toThrow('summary publish failed');
    await expect(Promise.all(paths.staleMarkerPaths.map((marker) => fs.stat(marker)))).resolves.toHaveLength(3);
  });

  it('reads .omni and .tomny stale markers as migration fallbacks but prefers .tomni', async () => {
    const root = await makeTempRepo();
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    const builder = createKnowledgeGraphBuilder({ chat: async () => '[]', collectFiles, now: () => 1 });
    const graph = await builder.build(root, 'live-structural', { summaryCap: 0 });
    const omni = path.join(root, '.omni', 'understand', 'stale.json');
    const tomny = path.join(root, '.tomny', 'understand', 'stale.json');
    const tomni = path.join(root, '.tomni', 'understand', 'stale.json');
    await fs.mkdir(path.dirname(omni), { recursive: true });
    await fs.writeFile(omni, JSON.stringify({ paths: ['src/a.ts'] }));

    expect((await assessGraphFreshness(graph, { collectFiles })).markerChanged).toEqual(['src/a.ts']);
    await fs.rm(omni);
    await fs.mkdir(path.dirname(tomny), { recursive: true });
    await fs.writeFile(tomny, JSON.stringify({ paths: ['src/legacy.ts'] }));
    expect((await assessGraphFreshness(graph, { collectFiles })).markerChanged).toEqual(['src/legacy.ts']);
    await fs.mkdir(path.dirname(tomni), { recursive: true });
    await fs.writeFile(tomni, JSON.stringify({ paths: [] }));
    expect((await assessGraphFreshness(graph, { collectFiles })).staleMarker).toBe(false);
  });
});
