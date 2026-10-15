export type StorageCenterCategoryId =
  | 'technicalCache'
  | 'models'
  | 'adapters'
  | 'packageDownloads'
  | 'logs'
  | 'worktrees'
  | 'userData';

export type StorageCenterManagement = 'ttl-managed' | 'lru-managed' | 'inspect-only' | 'protected';
export type StorageCenterState = 'ready' | 'scanning' | 'busy' | 'unavailable' | 'protected' | 'error';

export const STORAGE_CENTER_CATEGORY_IDS: readonly StorageCenterCategoryId[] = [
  'technicalCache',
  'models',
  'adapters',
  'packageDownloads',
  'logs',
  'worktrees',
  'userData',
];

export type StorageCenterCategoryPolicy = Readonly<{
  management: StorageCenterManagement;
  quotaBytes?: number;
  retentionDays?: number;
}>;

export type StorageCenterPolicy = Readonly<{
  version: 1;
  automaticCleanup: boolean;
  lowDiskWatermarkBytes: number;
  categories: Readonly<Record<StorageCenterCategoryId, StorageCenterCategoryPolicy>>;
}>;

export type StorageCenterCategorySummary = Readonly<{
  category: StorageCenterCategoryId;
  bytes: number;
  files: number;
  state: StorageCenterState;
}>;

export type StorageCenterSummary = Readonly<{
  totalBytes: number;
  categories: readonly StorageCenterCategorySummary[];
}>;

export type StorageCenterCleanupCandidate = Readonly<{
  rootId: string;
  category: StorageCenterCategoryId;
  bytes: number;
  reason: 'expired';
  relativePath: string;
  modifiedAt: number;
}>;

export type StorageCenterCleanupPreview = Readonly<{
  planId: string;
  candidates: readonly StorageCenterCleanupCandidate[];
  reclaimableBytes: number;
}>;

export type StorageCenterCleanupResult = Readonly<{
  reclaimedBytes: number;
  removedFiles: number;
  skippedFiles: number;
}>;

const MEBIBYTE = 1024 * 1024;
const MIN_QUOTA_BYTES = MEBIBYTE;
const MAX_QUOTA_BYTES = 1024 * 1024 * 1024 * 1024;

const lruPolicy = (quotaBytes: number): StorageCenterCategoryPolicy => ({
  management: 'lru-managed',
  quotaBytes,
});

export const createDefaultStorageCenterPolicy = (): StorageCenterPolicy => ({
  version: 1,
  automaticCleanup: true,
  lowDiskWatermarkBytes: 2 * 1024 * 1024 * 1024,
  categories: {
    technicalCache: { management: 'ttl-managed', retentionDays: 14 },
    models: lruPolicy(20 * 1024 * 1024 * 1024),
    adapters: lruPolicy(5 * 1024 * 1024 * 1024),
    packageDownloads: lruPolicy(5 * 1024 * 1024 * 1024),
    logs: { management: 'ttl-managed', retentionDays: 30 },
    worktrees: { management: 'inspect-only' },
    userData: { management: 'protected' },
  },
});

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export const validateStorageCenterPolicy = (policy: StorageCenterPolicy): StorageCenterPolicy => {
  if (policy.version !== 1 || !isPositiveSafeInteger(policy.lowDiskWatermarkBytes)) {
    throw new Error('STORAGE_POLICY_INVALID');
  }

  for (const categoryId of STORAGE_CENTER_CATEGORY_IDS) {
    const category = policy.categories[categoryId];
    if (!category) throw new Error('STORAGE_POLICY_INVALID');
    if (categoryId === 'userData' && category.management !== 'protected') {
      throw new Error('STORAGE_POLICY_PROTECTED_CATEGORY');
    }
    if (categoryId === 'worktrees' && category.management !== 'inspect-only') {
      throw new Error('STORAGE_POLICY_WORKTREE_MANAGEMENT');
    }
    if (category.management === 'lru-managed') {
      if (
        !isPositiveSafeInteger(category.quotaBytes) ||
        category.quotaBytes < MIN_QUOTA_BYTES ||
        category.quotaBytes > MAX_QUOTA_BYTES
      ) {
        throw new Error('STORAGE_POLICY_INVALID_QUOTA');
      }
    }
    if (category.management === 'ttl-managed') {
      if (!Number.isSafeInteger(category.retentionDays) || category.retentionDays < 1 || category.retentionDays > 365) {
        throw new Error('STORAGE_POLICY_INVALID_RETENTION');
      }
    }
  }

  return policy;
};
