/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeps the MTUI Understand cache available without the IDE. The query commands
 * (`summary`, `info`, `context`, `map`) read `.tomni/understand/summary.json`;
 * `mtui understand build` produces it deterministically and offline.
 *
 * Main-process module. An older MTUI binary without `understand` is tolerated:
 * the query commands then keep their filesystem fallback.
 */

import { runMtuiInRoot } from './mtuiBridge';

const UNDERSTAND_QUERY_COMMANDS: ReadonlySet<string> = new Set(['summary', 'info', 'context', 'map']);

const inflightBuilds = new Map<string, Promise<void>>();

/** True when the MTUI invocation reads the Understand cache. */
export const readsUnderstandCache = (args: readonly string[]): boolean => UNDERSTAND_QUERY_COMMANDS.has(args[0] ?? '');

/** Runs one build per root at a time; concurrent callers share it. Failures are not fatal. */
const buildOnce = (rootPath: string): Promise<void> => {
  const running = inflightBuilds.get(rootPath);
  if (running) return running;
  const build = runMtuiInRoot(['--json', 'understand', 'build'], rootPath)
    .then((): void => undefined)
    .catch((): void => undefined)
    .finally(() => {
      inflightBuilds.delete(rootPath);
    });
  inflightBuilds.set(rootPath, build);
  return build;
};

/**
 * Builds the cache before the first query when it is missing, and refreshes it in the
 * background when MTUI writes have marked files stale.
 */
export async function ensureUnderstandCache(rootPath: string): Promise<void> {
  const status = await runMtuiInRoot(['--json', 'understand', 'status'], rootPath).catch((): undefined => undefined);
  if (!status || status.ok !== true) return;
  if (status.exists === false) {
    await buildOnce(rootPath);
    return;
  }
  const stalePaths = typeof status.stale_marker_paths === 'number' ? status.stale_marker_paths : 0;
  if (status.full_rebuild_required === true || stalePaths > 0) void buildOnce(rootPath);
}
