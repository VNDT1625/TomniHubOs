import { lstat, readdir, unlink } from 'node:fs/promises';
// oxlint-disable no-await-in-loop -- bounded sequential traversal and revalidation prevent cleanup races.
import path from 'node:path';
import type {
  StorageCenterCategoryId,
  StorageCenterCleanupPreview,
  StorageCenterManagement,
  StorageCenterSummary,
} from '@/common/types/platform/storageCenter';

export type StorageCleanupEntry = Readonly<{
  id: string;
  bytes: number;
  lastUsedAt: number;
  pinned: boolean;
  active: boolean;
}>;

export type StorageCleanupPreviewInput = Readonly<{
  category: StorageCenterCategoryId;
  quotaBytes: number;
  entries: readonly StorageCleanupEntry[];
}>;

export type StorageLruCleanupPreview = Readonly<{
  beforeBytes: number;
  reclaimableBytes: number;
  candidates: readonly StorageCleanupEntry[];
  skipped: readonly Readonly<{ id: string; reason: 'pinned' | 'active' | 'protected' }>[];
}>;

export type StorageCenterRoot = Readonly<{
  id: string;
  category: StorageCenterCategoryId;
  label: string;
  path: string;
  management: StorageCenterManagement;
  retentionDays?: number;
}>;

export type StorageCenterCleanupPlan = StorageCenterCleanupPreview &
  Readonly<{
    planId: string;
    candidates: readonly (StorageCenterCleanupPreview['candidates'][number] &
      Readonly<{ relativePath: string; modifiedAt: number }>)[];
  }>;

export type StorageCenterCleanupResult = Readonly<{
  reclaimedBytes: number;
  removedFiles: number;
  skippedFiles: number;
}>;

export type StorageCenterService = Readonly<{
  getSummary: () => Promise<StorageCenterSummary>;
  previewCleanup: () => Promise<StorageCenterCleanupPlan>;
  runCleanup: (request: { planId: string }) => Promise<StorageCenterCleanupResult>;
  previewLruCleanup: (input: StorageCleanupPreviewInput) => StorageLruCleanupPreview;
}>;

export type StorageCenterServiceOptions = Readonly<{
  roots: readonly StorageCenterRoot[];
  maxFilesPerRoot?: number;
  now?: () => Date;
  planId?: () => string;
}>;

type RootScan = Readonly<{ bytes: number; files: number; state: 'ready' | 'unavailable' | 'error' }>;
type ExpiredFile = Readonly<{ root: StorageCenterRoot; relativePath: string; bytes: number; modifiedAt: number }>;

const NEVER_AUTOMATICALLY_CLEAN: ReadonlySet<StorageCenterCategoryId> = new Set(['userData', 'worktrees']);

const validEntry = (entry: StorageCleanupEntry): boolean =>
  entry.id.trim().length > 0 &&
  Number.isSafeInteger(entry.bytes) &&
  entry.bytes >= 0 &&
  Number.isSafeInteger(entry.lastUsedAt) &&
  entry.lastUsedAt >= 0;

const isAbsoluteDirectory = (candidate: string): boolean => path.isAbsolute(candidate) && candidate.trim().length > 0;

const isRootSafe = (root: StorageCenterRoot): boolean =>
  root.id.trim().length > 0 && root.label.trim().length > 0 && isAbsoluteDirectory(root.path);

const normalizedForContainment = (candidate: string): string =>
  process.platform === 'win32' ? path.resolve(candidate).toLowerCase() : path.resolve(candidate);

const isContained = (root: string, candidate: string): boolean => {
  const normalizedRoot = normalizedForContainment(root);
  const normalizedCandidate = normalizedForContainment(candidate);
  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
};

export const createStorageCleanupPreview = (input: StorageCleanupPreviewInput): StorageLruCleanupPreview => {
  if (!Number.isSafeInteger(input.quotaBytes) || input.quotaBytes < 0) {
    throw new Error('STORAGE_CLEANUP_INVALID_QUOTA');
  }
  if (input.entries.some((entry) => !validEntry(entry))) {
    throw new Error('STORAGE_CLEANUP_INVALID_ENTRY');
  }

  const beforeBytes = input.entries.reduce((total, entry) => total + entry.bytes, 0);
  if (NEVER_AUTOMATICALLY_CLEAN.has(input.category)) {
    return {
      beforeBytes,
      reclaimableBytes: 0,
      candidates: [],
      skipped: input.entries.map((entry) => ({ id: entry.id, reason: 'protected' as const })),
    };
  }

  const skipped: Array<Readonly<{ id: string; reason: 'pinned' | 'active' }>> = [];
  const eligible: StorageCleanupEntry[] = [];
  for (const entry of input.entries) {
    if (entry.pinned) skipped.push({ id: entry.id, reason: 'pinned' });
    else if (entry.active) skipped.push({ id: entry.id, reason: 'active' });
    else eligible.push(entry);
  }

  let remainingBytes = beforeBytes;
  const candidates: StorageCleanupEntry[] = [];
  for (const entry of eligible.toSorted(
    (left, right) => left.lastUsedAt - right.lastUsedAt || left.id.localeCompare(right.id)
  )) {
    if (remainingBytes <= input.quotaBytes) break;
    candidates.push(entry);
    remainingBytes -= entry.bytes;
  }

  return {
    beforeBytes,
    reclaimableBytes: candidates.reduce((total, entry) => total + entry.bytes, 0),
    candidates,
    skipped,
  };
};

const visitRootFiles = async (
  root: StorageCenterRoot,
  maxFiles: number
): Promise<Readonly<{ scan: RootScan; files: readonly ExpiredFile[] }>> => {
  try {
    const rootStat = await lstat(root.path);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      return { scan: { bytes: 0, files: 0, state: 'unavailable' }, files: [] };

    let bytes = 0;
    let files = 0;
    const found: ExpiredFile[] = [];
    const pending = [root.path];
    while (pending.length > 0 && files < maxFiles) {
      const directory = pending.pop();
      if (!directory) break;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (files >= maxFiles) return { scan: { bytes, files, state: 'error' }, files: found };
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          pending.push(candidate);
          continue;
        }
        if (!entry.isFile()) continue;
        const details = await lstat(candidate);
        if (details.isSymbolicLink() || !details.isFile()) continue;
        const relativePath = path.relative(root.path, candidate);
        if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(path.sep).includes('..')) continue;
        bytes += details.size;
        files += 1;
        found.push({ root, relativePath, bytes: details.size, modifiedAt: details.mtimeMs });
      }
    }
    return { scan: { bytes, files, state: 'ready' }, files: found };
  } catch {
    return { scan: { bytes: 0, files: 0, state: 'unavailable' }, files: [] };
  }
};

export const createStorageCenterService = ({
  roots,
  maxFilesPerRoot = 100_000,
  now = () => new Date(),
  planId = () => crypto.randomUUID(),
}: StorageCenterServiceOptions): StorageCenterService => {
  if (!Number.isSafeInteger(maxFilesPerRoot) || maxFilesPerRoot < 1 || maxFilesPerRoot > 1_000_000) {
    throw new Error('STORAGE_CENTER_INVALID_SCAN_BOUND');
  }
  if (roots.some((root) => !isRootSafe(root))) throw new Error('STORAGE_CENTER_INVALID_ROOT');
  if (new Set(roots.map((root) => root.id)).size !== roots.length) throw new Error('STORAGE_CENTER_DUPLICATE_ROOT');

  let activePlan: { id: string; candidates: readonly ExpiredFile[] } | undefined;

  const scanAll = async (): Promise<ReadonlyMap<string, Awaited<ReturnType<typeof visitRootFiles>>>> => {
    const scanned = await Promise.all(
      roots.map(async (root) => [root.id, await visitRootFiles(root, maxFilesPerRoot)] as const)
    );
    return new Map(scanned);
  };

  return {
    async getSummary(): Promise<StorageCenterSummary> {
      const scans = await scanAll();
      const grouped = new Map<StorageCenterCategoryId, StorageCenterSummary['categories'][number]>();
      for (const root of roots) {
        const scan = scans.get(root.id)?.scan ?? { bytes: 0, files: 0, state: 'unavailable' as const };
        const prior = grouped.get(root.category);
        grouped.set(root.category, {
          category: root.category,
          bytes: (prior?.bytes ?? 0) + scan.bytes,
          files: (prior?.files ?? 0) + scan.files,
          state:
            prior?.state === 'error' || scan.state === 'error'
              ? 'error'
              : prior?.state === 'unavailable' || scan.state === 'unavailable'
                ? 'unavailable'
                : 'ready',
        });
      }
      const categories = [...grouped.values()].toSorted((left, right) => left.category.localeCompare(right.category));
      return { totalBytes: categories.reduce((total, category) => total + category.bytes, 0), categories };
    },

    async previewCleanup(): Promise<StorageCenterCleanupPlan> {
      const scans = await scanAll();
      const nowMs = now().getTime();
      const candidates = [...scans.values()].flatMap(({ files }) =>
        files.filter((file) => {
          const retentionDays = file.root.retentionDays;
          return (
            file.root.management === 'ttl-managed' &&
            !NEVER_AUTOMATICALLY_CLEAN.has(file.root.category) &&
            retentionDays !== undefined &&
            file.modifiedAt <= nowMs - retentionDays * 24 * 60 * 60 * 1000
          );
        })
      );
      const id = planId();
      activePlan = { id, candidates };
      return {
        planId: id,
        candidates: candidates.map((file) => ({
          rootId: file.root.id,
          category: file.root.category,
          bytes: file.bytes,
          reason: 'expired' as const,
          relativePath: file.relativePath,
          modifiedAt: file.modifiedAt,
        })),
        reclaimableBytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
      };
    },

    async runCleanup({ planId: requestedPlanId }): Promise<StorageCenterCleanupResult> {
      const plan = activePlan;
      activePlan = undefined;
      if (!plan || plan.id !== requestedPlanId) throw new Error('STORAGE_CLEANUP_PLAN_INVALID');

      let reclaimedBytes = 0;
      let removedFiles = 0;
      let skippedFiles = 0;
      for (const candidate of plan.candidates) {
        const filePath = path.resolve(candidate.root.path, candidate.relativePath);
        if (!isContained(candidate.root.path, filePath)) {
          skippedFiles += 1;
          continue;
        }
        try {
          const current = await lstat(filePath);
          if (
            current.isSymbolicLink() ||
            !current.isFile() ||
            current.size !== candidate.bytes ||
            current.mtimeMs !== candidate.modifiedAt
          ) {
            skippedFiles += 1;
            continue;
          }
          await unlink(filePath);
          reclaimedBytes += candidate.bytes;
          removedFiles += 1;
        } catch {
          skippedFiles += 1;
        }
      }
      return { reclaimedBytes, removedFiles, skippedFiles };
    },

    previewLruCleanup: createStorageCleanupPreview,
  };
};
