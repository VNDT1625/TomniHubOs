/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `kgRefresh` — deterministically patch ONE file's structural node in a
 * persisted knowledge graph after an edit, WITHOUT calling a model.
 *
 * This is the shared core behind both the `ide.kg-refresh-file` IPC handler and
 * the team-collab rule "editing a file must update the codebase graph" — when a
 * host or a peer writes/edits a file through the team session, the host runs
 * this so the Understand graph it serves to peers stays accurate. Semantic
 * summaries still come from an explicit, model-backed rebuild; this only keeps
 * the cheap structural facts (symbols / language / fingerprint / layer / import
 * membership) current, so it is safe to run on every save.
 *
 * Pure-ish: all fs is injected ({@link KgRefreshDeps}) so it is unit-testable
 * without Electron / disk. The default wiring (`refreshGraphFileOnDisk`) reads
 * and writes the same `userData/ide-knowledge/<hash>.json` the KG bridge uses.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import {
  aggregateModules,
  buildKnowledgeDiagrams,
  buildRepoSummaryPayload,
  detectLanguage,
  enrichSymbolRangesAndCalls,
  extractSymbols,
  fallbackSummary,
  fingerprintOf,
  inferLayer,
  KNOWLEDGE_GRAPH_VERSION,
} from './knowledgeGraphBuilder';
import { buildGraphFromFiles } from './repoGraph';
import type { KnowledgeGraph, KnowledgeNode, RepoChangeEvent } from './understandTypes';

/** Targets published together for one current knowledge-graph revision. */
export type KnowledgeGraphArtifactPaths = {
  graphPath: string;
  summaryPath: string;
  staleMarkerPaths: string[];
};

/** Injected atomic-file primitives for deterministic persistence tests. */
export type KnowledgeGraphArtifactIo = {
  mkdir: (dir: string) => Promise<void>;
  readFile: (filePath: string) => Promise<string | null>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (filePath: string) => Promise<void>;
  /** Cross-process lock shared with MTUI's stale-marker writer. */
  acquireMarkerLock?: (lockDir: string) => Promise<() => Promise<void>>;
};

const STALE_LOCK_MAX_ATTEMPTS = 50;
const STALE_LOCK_RETRY_MS = 10;
const STALE_LOCK_RECOVERY_MS = 30_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const acquireDefaultMarkerLock = async (lockDir: string): Promise<() => Promise<void>> => {
  await fsp.mkdir(path.dirname(lockDir), { recursive: true });
  for (let attempt = 0; attempt < STALE_LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      await fsp.mkdir(lockDir);
      return async (): Promise<void> => {
        await fsp.rmdir(lockDir).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const stat = await fsp.stat(lockDir);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_RECOVERY_MS) {
          const staleDir = `${lockDir}.stale.${process.pid}.${Date.now()}`;
          await fsp.rename(lockDir, staleDir);
          await fsp.rmdir(staleDir);
          continue;
        }
      } catch {
        // Another process may have recovered the same stale directory first.
      }
      await delay(STALE_LOCK_RETRY_MS);
    }
  }
  throw new Error(`Timed out acquiring stale marker lock: ${lockDir}`);
};

const defaultArtifactIo: KnowledgeGraphArtifactIo = {
  mkdir: async (dir): Promise<void> => {
    await fsp.mkdir(dir, { recursive: true });
  },
  readFile: async (filePath) => {
    try {
      return await fsp.readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  writeFile: (filePath, content) => fsp.writeFile(filePath, content, 'utf-8'),
  rename: (from, to) => fsp.rename(from, to),
  remove: (filePath) => fsp.rm(filePath, { force: true }),
  acquireMarkerLock: acquireDefaultMarkerLock,
};

export type StaleMarkerSnapshot = {
  markerPath: string;
  raw: string | null;
  paths: string[];
  valid: boolean;
  fullRebuildRequired: boolean;
};

export type KnowledgeGraphPublishOptions = {
  /** Omitted for a complete rebuild, which may clear every migration marker. */
  processedPaths?: string[];
  /** Marker generations captured before an incremental rebuild began. */
  staleMarkerSnapshots?: StaleMarkerSnapshot[];
  /** Confirms the repo was fully walked, required before clearing overflow markers. */
  fullStructuralRebuild?: boolean;
};

const resolveStaleLockDir = (markerPaths: string[]): string => {
  const canonical =
    markerPaths.find((markerPath) => markerPath.replace(/\\/g, '/').includes('/.tomni/understand/')) ?? markerPaths[0];
  if (!canonical) throw new Error('At least one stale marker path is required.');
  return path.join(path.dirname(canonical), 'stale.lock');
};

const parseStaleMarkerSnapshot = (markerPath: string, raw: string | null): StaleMarkerSnapshot => {
  if (raw === null) return { markerPath, raw, paths: [], valid: true, fullRebuildRequired: false };
  try {
    const parsed = JSON.parse(raw) as { paths?: unknown; fullRebuildRequired?: unknown };
    if (!Array.isArray(parsed.paths)) {
      return { markerPath, raw, paths: [], valid: false, fullRebuildRequired: false };
    }
    return {
      markerPath,
      raw,
      paths: Array.from(
        new Set(
          parsed.paths
            .filter((item): item is string => typeof item === 'string')
            .map(normalizeRel)
            .filter(Boolean)
        )
      ).toSorted(),
      valid: true,
      fullRebuildRequired: parsed.fullRebuildRequired === true,
    };
  } catch {
    return { markerPath, raw, paths: [], valid: false, fullRebuildRequired: false };
  }
};

/** Capture exact marker generations before an incremental graph rebuild. */
export const captureStaleMarkerSnapshots = async (
  markerPaths: string[],
  io: Pick<KnowledgeGraphArtifactIo, 'readFile' | 'acquireMarkerLock'> = defaultArtifactIo
): Promise<StaleMarkerSnapshot[]> => {
  if (markerPaths.length === 0) return [];
  const release = io.acquireMarkerLock ? await io.acquireMarkerLock(resolveStaleLockDir(markerPaths)) : null;
  try {
    return await Promise.all(
      markerPaths.map(async (markerPath) => parseStaleMarkerSnapshot(markerPath, await io.readFile(markerPath)))
    );
  } finally {
    await release?.();
  }
};

/**
 * Publish the full graph and the canonical MTUI summary via temp-file renames.
 * Migration stale markers are removed only after BOTH artifacts are current.
 * On a partial failure markers remain, so readers reject the mixed revision.
 */
export const persistKnowledgeGraphArtifacts = async (
  graph: KnowledgeGraph,
  paths: KnowledgeGraphArtifactPaths,
  io: KnowledgeGraphArtifactIo = defaultArtifactIo,
  options?: KnowledgeGraphPublishOptions
): Promise<void> => {
  await Promise.all([io.mkdir(path.dirname(paths.graphPath)), io.mkdir(path.dirname(paths.summaryPath))]);
  const nonce = `${process.pid}.${Date.now()}`;
  const graphTmp = `${paths.graphPath}.${nonce}.tmp`;
  const summaryTmp = `${paths.summaryPath}.${nonce}.tmp`;
  try {
    await Promise.all([
      io.writeFile(graphTmp, JSON.stringify(graph)),
      io.writeFile(summaryTmp, JSON.stringify(buildRepoSummaryPayload(graph), null, 2)),
    ]);
    await io.rename(graphTmp, paths.graphPath);
    await io.rename(summaryTmp, paths.summaryPath);
    const snapshots = options?.staleMarkerSnapshots ?? [];
    const fullSnapshotCleanup =
      options?.processedPaths === undefined && options?.fullStructuralRebuild === true && snapshots.length > 0;
    if (options?.processedPaths !== undefined || fullSnapshotCleanup) {
      const releaseMarkerLock = io.acquireMarkerLock
        ? await io.acquireMarkerLock(resolveStaleLockDir(paths.staleMarkerPaths))
        : null;
      try {
        const processed = new Set(
          (options?.processedPaths ?? snapshots.flatMap((snapshot) => snapshot.paths)).map(normalizeRel).filter(Boolean)
        );
        const snapshotByPath = new Map(
          (options?.staleMarkerSnapshots ?? []).map((snapshot) => [snapshot.markerPath, snapshot] as const)
        );
        for (const marker of paths.staleMarkerPaths) {
          const snapshot = snapshotByPath.get(marker);
          if (
            !snapshot?.valid ||
            snapshot.raw === null ||
            snapshot.paths.some((item) => !processed.has(item)) ||
            (snapshot.fullRebuildRequired && options?.fullStructuralRebuild !== true)
          ) {
            continue;
          }
          // Current-read + remove is protected by the same cross-process lock
          // as MTUI's additive stale-marker writer, closing the CAS race.
          // eslint-disable-next-line no-await-in-loop -- each comparison guards its own marker removal.
          const current = await io.readFile(marker);
          if (current === snapshot.raw) {
            // eslint-disable-next-line no-await-in-loop -- deterministic migration cleanup order.
            await io.remove(marker);
          }
        }
      } finally {
        await releaseMarkerLock?.();
      }
    }
  } catch (error) {
    await Promise.allSettled([io.remove(graphTmp), io.remove(summaryTmp)]);
    throw error;
  }
};

/** Injected lifecycle boundaries for serialized Live graph rebuilds. */
export type LiveGraphUpdaterDeps = {
  loadGraph: (rootPath: string) => Promise<KnowledgeGraph | null>;
  captureStaleMarkers?: (rootPath: string) => Promise<StaleMarkerSnapshot[]>;
  rebuildGraph: (
    rootPath: string,
    previous: KnowledgeGraph | null,
    event: RepoChangeEvent,
    context: { fullRebuildRequired: boolean }
  ) => Promise<KnowledgeGraph>;
  persistArtifacts: (
    graph: KnowledgeGraph,
    context: {
      event: RepoChangeEvent;
      staleMarkerSnapshots: StaleMarkerSnapshot[];
      fullRebuildRequired: boolean;
    }
  ) => Promise<void>;
};

/** Read one current repository file; null means it disappeared during the save burst. */
export type LiveGraphReadFile = (rootPath: string, relPath: string) => Promise<string | null>;

const normalizeRel = (relPath: string): string => relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

/**
 * Apply one debounced save burst without walking or hashing the whole repo.
 * Only changed files are read/parsing; unchanged outgoing edges and semantic
 * summaries are retained, while removed endpoints are purged immediately.
 */
export const applyRepoChangesToGraph = async (
  previous: KnowledgeGraph,
  event: RepoChangeEvent,
  readFile: LiveGraphReadFile,
  now: () => number = Date.now
): Promise<KnowledgeGraph> => {
  const sourceSnapshotAt = now();
  const removed = new Set(event.removed.map(normalizeRel).filter(Boolean));
  const requestedChanged = Array.from(new Set(event.changed.map(normalizeRel).filter(Boolean))).filter(
    (relPath) => !removed.has(relPath)
  );
  const changedContents = new Map<string, string>();
  await Promise.all(
    requestedChanged.map(async (relPath) => {
      const content = await readFile(event.rootPath, relPath);
      if (content === null) {
        removed.add(relPath);
      } else {
        changedContents.set(relPath, content);
      }
    })
  );

  const previousById = new Map(previous.nodes.map((node) => [node.id, node] as const));
  const knownIds = new Set(previous.nodes.map((node) => node.id).filter((id) => !removed.has(id)));
  for (const relPath of changedContents.keys()) knownIds.add(relPath);
  const structural = buildGraphFromFiles(
    event.rootPath,
    Array.from(knownIds, (relPath) => ({ relPath, content: changedContents.get(relPath) ?? '' }))
  );
  const changedPaths = new Set(changedContents.keys());
  const edgeByKey = new Map<string, { from: string; to: string }>();
  for (const edge of previous.edges) {
    if (changedPaths.has(edge.from) || !knownIds.has(edge.from) || !knownIds.has(edge.to)) continue;
    edgeByKey.set(`${edge.from}\u0000${edge.to}`, edge);
  }
  for (const edge of structural.edges) edgeByKey.set(`${edge.from}\u0000${edge.to}`, edge);
  const edges = Array.from(edgeByKey.values()).toSorted(
    (left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
  );
  const importedBy = new Map<string, number>();
  for (const edge of edges) importedBy.set(edge.to, (importedBy.get(edge.to) ?? 0) + 1);
  const structuralById = new Map(structural.nodes.map((node) => [node.id, node] as const));
  const nodes: KnowledgeNode[] = Array.from(knownIds)
    .toSorted()
    .map((id) => {
      const existing = previousById.get(id);
      const structuralNode = structuralById.get(id);
      const content = changedContents.get(id);
      const changed = content !== undefined || !existing;
      const language = changed ? detectLanguage(id) : (existing?.language ?? detectLanguage(id));
      const symbols = changed
        ? enrichSymbolRangesAndCalls(content ?? '', extractSymbols(content ?? '', language))
        : (existing?.symbols ?? []);
      const node: KnowledgeNode = {
        id,
        label: structuralNode?.label ?? existing?.label ?? id.slice(id.lastIndexOf('/') + 1),
        group: structuralNode?.group ?? existing?.group ?? id.split('/')[0],
        layer: existing?.layer ?? inferLayer(id),
        summary: existing?.summary ?? '',
        summarySource: existing?.summarySource,
        tags: changed ? [] : (existing?.tags ?? []),
        symbols,
        language,
        importedBy: importedBy.get(id) ?? 0,
        fingerprint: changed ? fingerprintOf(content ?? '') : existing?.fingerprint,
      };
      if (changed || node.summarySource === 'fallback' || node.summary.length === 0) {
        node.summary = fallbackSummary(node, previous.language);
        node.summarySource = 'fallback';
      }
      return node;
    });
  const { modules, moduleEdges } = aggregateModules(nodes, edges);
  const previousModules = new Map((previous.modules ?? []).map((mod) => [mod.id, mod] as const));
  for (const mod of modules) {
    const prior = previousModules.get(mod.id);
    if (prior?.fingerprint === mod.fingerprint) mod.summary = prior.summary;
  }
  const diagrams = buildKnowledgeDiagrams(
    {
      overview: previous.overview,
      modules,
      moduleEdges,
      externals: previous.externals,
      fileCount: nodes.length,
    },
    previous.runbook ?? { commands: [], env: [], ports: [] }
  );
  return {
    ...previous,
    version: KNOWLEDGE_GRAPH_VERSION,
    builtAt: now(),
    sourceSnapshotAt,
    nodes,
    edges,
    modules,
    moduleEdges,
    diagrams,
    fileCount: nodes.length,
  };
};

/** A serialized updater; watcher-level debounce coalesces each rapid save burst. */
export const createLiveGraphUpdater = (deps: LiveGraphUpdaterDeps) => {
  let tail: Promise<KnowledgeGraph | null> = Promise.resolve(null);
  const enqueue = (event: RepoChangeEvent): Promise<KnowledgeGraph> => {
    const run = tail
      .catch((): null => null)
      .then(async () => {
        const staleMarkerSnapshots =
          (await deps.captureStaleMarkers?.(event.rootPath).catch((): StaleMarkerSnapshot[] => [])) ?? [];
        const markerPaths = staleMarkerSnapshots.flatMap((snapshot) => snapshot.paths);
        const fullRebuildRequired = staleMarkerSnapshots.some((snapshot) => snapshot.fullRebuildRequired);
        const removed = new Set(event.removed.map(normalizeRel));
        const preparedEvent: RepoChangeEvent = {
          rootPath: event.rootPath,
          changed: Array.from(new Set([...event.changed.map(normalizeRel), ...markerPaths]))
            .filter((relPath) => !removed.has(relPath))
            .toSorted(),
          removed: Array.from(removed).filter(Boolean).toSorted(),
        };
        const previous = await deps.loadGraph(event.rootPath);
        const graph = await deps.rebuildGraph(event.rootPath, previous, preparedEvent, { fullRebuildRequired });
        await deps.persistArtifacts(graph, { event: preparedEvent, staleMarkerSnapshots, fullRebuildRequired });
        return graph;
      });
    tail = run;
    return run;
  };
  return { enqueue };
};

/** Serialize mutating tasks per repository while allowing different roots to proceed independently. */
export const createKeyedTaskSerializer = () => {
  const tails = new Map<string, Promise<void>>();
  const run = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.catch((): undefined => undefined).then(task);
    const tail = result.then(
      (): void => undefined,
      (): void => undefined
    );
    tails.set(key, tail);
    void tail.finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
  return { run };
};

/** Shared production serializer for every TS graph artifact writer. */
export const knowledgeGraphArtifactMutations = createKeyedTaskSerializer();

/** Injected collaborators so the refresh is testable without disk. */
export type KgRefreshDeps = {
  /** Load the persisted graph for a repo root, or null when none exists. */
  loadGraph: (rootPath: string) => Promise<KnowledgeGraph | null>;
  /** Persist the patched graph and canonical summary as one accepted revision. */
  saveGraph: (graph: KnowledgeGraph, options?: KnowledgeGraphPublishOptions) => Promise<void>;
  /** Capture marker generations before applying the file update. */
  captureStaleMarkers?: (rootPath: string) => Promise<StaleMarkerSnapshot[]>;
  /** Read the (just-written) file content; null when unreadable. */
  readFile: (absPath: string) => Promise<string | null>;
};

/**
 * Patch the structural node for `relPath` in the repo's persisted graph from the
 * file's current content. No-op (returns null) when no graph is persisted yet.
 *
 * @returns the updated/created node, or null when there is no graph to patch.
 */
export const refreshGraphFile = async (
  deps: KgRefreshDeps,
  rootPath: string,
  relPathRaw: string,
  content: string
): Promise<KnowledgeNode | null> => {
  const relPath = normalizeRel(relPathRaw);
  if (!relPath) return null;
  const staleMarkerSnapshots =
    (await deps.captureStaleMarkers?.(rootPath).catch((): StaleMarkerSnapshot[] => [])) ?? [];
  const graph = await deps.loadGraph(rootPath);
  if (!graph) return null;
  const updated = await applyRepoChangesToGraph(
    graph,
    { rootPath, changed: [relPath], removed: [] },
    async (_repoRoot, requestedPath) =>
      requestedPath === relPath ? content : deps.readFile(path.join(rootPath, requestedPath))
  );
  const node = updated.nodes.find((candidate) => candidate.id === relPath) ?? null;
  if (!node) return null;
  await deps.saveGraph(updated, { processedPaths: [relPath], staleMarkerSnapshots });
  return node;
};

// ---------------------------------------------------------------------------
// Default on-disk wiring (mirrors knowledgeGraphBridge persistence)
// ---------------------------------------------------------------------------

const resolveStorageDir = (): string => path.join(app.getPath('userData'), 'ide-knowledge');
const graphFileName = (rootPath: string): string =>
  `${createHash('sha256').update(rootPath).digest('hex').slice(0, 32)}.json`;

/** Production fs-backed {@link KgRefreshDeps}. */
export const onDiskKgRefreshDeps: KgRefreshDeps = {
  loadGraph: async (rootPath) => {
    try {
      const target = path.join(resolveStorageDir(), graphFileName(rootPath));
      return JSON.parse(await fsp.readFile(target, 'utf-8')) as KnowledgeGraph;
    } catch {
      return null;
    }
  },
  captureStaleMarkers: (rootPath) =>
    captureStaleMarkerSnapshots(
      ['.tomni', '.omni', '.tomny'].map((dir) => path.join(rootPath, dir, 'understand', 'stale.json'))
    ),
  saveGraph: (graph, options) =>
    persistKnowledgeGraphArtifacts(
      graph,
      {
        graphPath: path.join(resolveStorageDir(), graphFileName(graph.rootPath)),
        summaryPath: path.join(graph.rootPath, '.tomni', 'understand', 'summary.json'),
        staleMarkerPaths: ['.tomni', '.omni', '.tomny'].map((dir) =>
          path.join(graph.rootPath, dir, 'understand', 'stale.json')
        ),
      },
      undefined,
      options
    ),
  readFile: async (absPath) => {
    try {
      return await fsp.readFile(absPath, 'utf-8');
    } catch {
      return null;
    }
  },
};

/**
 * Convenience: refresh a file's node by reading it from disk (post-write) using
 * the default on-disk deps. Best-effort; never throws.
 */
export const refreshGraphFileOnDisk = async (rootPath: string, relPath: string, absPath: string): Promise<void> => {
  try {
    const content = await onDiskKgRefreshDeps.readFile(absPath);
    if (content === null) return;
    await knowledgeGraphArtifactMutations.run(rootPath, () =>
      refreshGraphFile(onDiskKgRefreshDeps, rootPath, relPath, content)
    );
  } catch {
    /* best-effort — a failed graph refresh must never fail the write */
  }
};
