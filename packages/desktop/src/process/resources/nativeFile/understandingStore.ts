import { readFile, stat } from 'node:fs/promises';
import { ensureCanonicalWorkspaceMetadata } from '@package-apps/shared/process/workspace/workspaceMetadataMigration';

import path from 'node:path';

export type UnderstandingFreshness = 'fresh' | 'stale' | 'missing' | 'building';
export type UnderstandingReferenceResult = {
  summary?: string;
  summarySource?: string;
  fingerprint?: string;
  freshness: UnderstandingFreshness;
};

type CacheFile = { path?: unknown; summary?: unknown; summarySource?: unknown; fingerprint?: unknown };
type CacheModule = { id?: unknown; summary?: unknown; fingerprint?: unknown };
type SummaryCache = { files?: unknown; modules?: unknown };

const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '');

/** Reads existing canonical Understanding data only; it never builds or summarizes. */
export const readUnderstandingReference = async (
  rootPath: string,
  relativePath: string
): Promise<UnderstandingReferenceResult> => {
  const migration = await ensureCanonicalWorkspaceMetadata(rootPath);
  if (migration.status === 'failed') {
    return { freshness: 'missing' };
  }
  const normalized = normalize(relativePath);
  const canonical = path.join(rootPath, '.tomni', 'understand');
  const stale = await stat(path.join(canonical, 'stale.json'))
    .then(() => true)
    .catch(() => false);
  const raw = await readFile(path.join(canonical, 'summary.json'), 'utf8').catch((): undefined => undefined);
  if (raw === undefined) return { freshness: stale ? 'stale' : 'missing' };
  try {
    const cache = JSON.parse(raw) as SummaryCache;
    const file = Array.isArray(cache.files)
      ? cache.files.find((item): item is CacheFile =>
          Boolean(item && typeof item === 'object' && (item as CacheFile).path === normalized)
        )
      : undefined;
    const module = Array.isArray(cache.modules)
      ? cache.modules.find((item): item is CacheModule =>
          Boolean(item && typeof item === 'object' && (item as CacheModule).id === normalized)
        )
      : undefined;
    const entry = file ?? module;
    return {
      summary: typeof entry?.summary === 'string' && entry.summary.trim() ? entry.summary : undefined,
      summarySource: file && typeof file.summarySource === 'string' ? file.summarySource : undefined,
      fingerprint: typeof entry?.fingerprint === 'string' ? entry.fingerprint : undefined,
      freshness: stale ? 'stale' : 'fresh',
    };
  } catch {
    return { freshness: stale ? 'stale' : 'missing' };
  }
};
