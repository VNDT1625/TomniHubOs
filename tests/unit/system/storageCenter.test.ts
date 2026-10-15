import { access, mkdtemp, mkdir, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultStorageCenterPolicy, validateStorageCenterPolicy } from '@/common/types/platform/storageCenter';
import { createStorageCenterService } from '@/process/system/storageCenterService';

const temporaryRoots: string[] = [];
const now = new Date('2026-10-08T00:00:00.000Z');

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })))
  );
});

describe('Storage Center policy contracts', () => {
  it('protects user data and keeps worktrees inspect-only by default', () => {
    const policy = createDefaultStorageCenterPolicy();

    expect(policy.automaticCleanup).toBe(true);
    expect(policy.categories.userData.management).toBe('protected');
    expect(policy.categories.worktrees.management).toBe('inspect-only');
    expect(policy.categories.models.management).toBe('lru-managed');
    expect(policy.categories.adapters.management).toBe('lru-managed');
    expect(policy.categories.packageDownloads.management).toBe('lru-managed');
  });

  it('rejects a policy that attempts to auto-clean protected user data', () => {
    const policy = createDefaultStorageCenterPolicy();
    const unsafe = {
      ...policy,
      categories: {
        ...policy.categories,
        userData: { ...policy.categories.userData, management: 'ttl-managed' as const },
      },
    };

    expect(() => validateStorageCenterPolicy(unsafe)).toThrow('STORAGE_POLICY_PROTECTED_CATEGORY');
  });

  it('rejects quotas outside bounded values', () => {
    const policy = createDefaultStorageCenterPolicy();
    const unsafe = {
      ...policy,
      categories: {
        ...policy.categories,
        models: { ...policy.categories.models, quotaBytes: 0 },
      },
    };

    expect(() => validateStorageCenterPolicy(unsafe)).toThrow('STORAGE_POLICY_INVALID_QUOTA');
  });
});

describe('Storage Center cleanup preview', () => {
  it('selects oldest inactive LRU cache entries while preserving pinned and protected items', () => {
    const preview = createStorageCenterService({ roots: [] }).previewLruCleanup({
      category: 'models',
      quotaBytes: 100,
      entries: [
        { id: 'pinned', bytes: 70, lastUsedAt: 1, pinned: true, active: false },
        { id: 'active', bytes: 40, lastUsedAt: 2, pinned: false, active: true },
        { id: 'oldest', bytes: 80, lastUsedAt: 3, pinned: false, active: false },
        { id: 'newer', bytes: 20, lastUsedAt: 4, pinned: false, active: false },
      ],
    });

    expect(preview.beforeBytes).toBe(210);
    expect(preview.reclaimableBytes).toBe(100);
    expect(preview.candidates.map((entry) => entry.id)).toEqual(['oldest', 'newer']);
    expect(preview.skipped).toEqual([
      { id: 'pinned', reason: 'pinned' },
      { id: 'active', reason: 'active' },
    ]);
  });

  it('never creates automatic cleanup candidates for protected data or worktrees', () => {
    const service = createStorageCenterService({ roots: [] });
    expect(
      service.previewLruCleanup({
        category: 'userData',
        quotaBytes: 1,
        entries: [{ id: 'chat', bytes: 100, lastUsedAt: 1, pinned: false, active: false }],
      }).candidates
    ).toEqual([]);

    expect(
      service.previewLruCleanup({
        category: 'worktrees',
        quotaBytes: 1,
        entries: [{ id: 'dirty-tree', bytes: 100, lastUsedAt: 1, pinned: false, active: false }],
      }).candidates
    ).toEqual([]);
  });
});

describe('Storage Center inventory', () => {
  it('accounts only regular files under a registered root and never follows a symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-storage-center-'));
    temporaryRoots.push(root);
    const cacheRoot = path.join(root, 'cache');
    const outside = path.join(root, 'outside');
    await Promise.all([mkdir(cacheRoot), mkdir(outside)]);
    await writeFile(path.join(cacheRoot, 'owned.bin'), '1234');
    await writeFile(path.join(outside, 'outside.bin'), '123456789');
    await symlink(outside, path.join(cacheRoot, 'escape'), 'junction');

    const service = createStorageCenterService({
      roots: [
        {
          id: 'cache',
          category: 'technicalCache',
          label: 'Technical cache',
          path: cacheRoot,
          management: 'ttl-managed',
          retentionDays: 14,
        },
      ],
      now: () => now,
    });

    await expect(service.getSummary()).resolves.toMatchObject({
      totalBytes: 4,
      categories: [{ category: 'technicalCache', bytes: 4, files: 1, state: 'ready' }],
    });
  });

  it('creates and executes an expired-file plan without touching fresh files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-storage-center-'));
    temporaryRoots.push(root);
    const cacheRoot = path.join(root, 'cache');
    await mkdir(cacheRoot);
    const oldFile = path.join(cacheRoot, 'old.tmp');
    const freshFile = path.join(cacheRoot, 'fresh.tmp');
    await Promise.all([writeFile(oldFile, 'old!'), writeFile(freshFile, 'fresh')]);
    await utimes(oldFile, new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-01T00:00:00.000Z'));

    const service = createStorageCenterService({
      roots: [
        {
          id: 'cache',
          category: 'technicalCache',
          label: 'Technical cache',
          path: cacheRoot,
          management: 'ttl-managed',
          retentionDays: 14,
        },
      ],
      now: () => now,
      planId: () => 'cleanup-plan',
    });

    const preview = await service.previewCleanup();
    expect(preview).toMatchObject({
      planId: 'cleanup-plan',
      reclaimableBytes: 4,
      candidates: [{ category: 'technicalCache', bytes: 4, reason: 'expired' }],
    });

    await expect(service.runCleanup({ planId: preview.planId })).resolves.toEqual({
      reclaimedBytes: 4,
      removedFiles: 1,
      skippedFiles: 0,
    });
    await expect(access(oldFile)).rejects.toThrow();
    await expect(access(freshFile)).resolves.toBeUndefined();
  });

  it('does not create a cleanup plan for protected or inspect-only roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-storage-center-'));
    temporaryRoots.push(root);
    const protectedRoot = path.join(root, 'private');
    const worktreeRoot = path.join(root, 'worktrees');
    await Promise.all([mkdir(protectedRoot), mkdir(worktreeRoot)]);
    await Promise.all([
      writeFile(path.join(protectedRoot, 'chat.db'), 'secret'),
      writeFile(path.join(worktreeRoot, 'dirty.txt'), 'work'),
    ]);

    const service = createStorageCenterService({
      roots: [
        { id: 'private', category: 'userData', label: 'User data', path: protectedRoot, management: 'protected' },
        { id: 'worktrees', category: 'worktrees', label: 'Worktrees', path: worktreeRoot, management: 'inspect-only' },
      ],
      now: () => now,
    });

    await expect(service.previewCleanup()).resolves.toMatchObject({ candidates: [], reclaimableBytes: 0 });
  });
});
