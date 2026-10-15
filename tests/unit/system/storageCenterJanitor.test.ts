import { describe, expect, it, vi } from 'vitest';
import { createStorageCenterJanitor } from '@/process/system/storageCenterJanitor';

const policy = {
  version: 1 as const,
  automaticCleanup: true,
  lowDiskWatermarkBytes: 1,
  categories: {
    technicalCache: { management: 'ttl-managed' as const, retentionDays: 14 },
    models: { management: 'lru-managed' as const, quotaBytes: 1_000_000 },
    adapters: { management: 'lru-managed' as const, quotaBytes: 1_000_000 },
    packageDownloads: { management: 'lru-managed' as const, quotaBytes: 1_000_000 },
    logs: { management: 'ttl-managed' as const, retentionDays: 30 },
    worktrees: { management: 'inspect-only' as const },
    userData: { management: 'protected' as const },
  },
};

describe('Storage Center janitor', () => {
  it('runs only once per day and passes the persisted policy to its service', async () => {
    const readMarker = vi.fn(async () => 0);
    const writeMarker = vi.fn(async () => undefined);
    const runCleanup = vi.fn(async () => ({ reclaimedBytes: 12, removedFiles: 1, skippedFiles: 0 }));
    const previewCleanup = vi.fn(async () => ({
      planId: 'plan',
      candidates: [
        {
          rootId: 'temp',
          category: 'technicalCache' as const,
          bytes: 12,
          reason: 'expired' as const,
          relativePath: 'old.tmp',
          modifiedAt: 1,
        },
      ],
      reclaimableBytes: 12,
    }));
    const createService = vi.fn(() => ({ previewCleanup, runCleanup }) as never);
    const janitor = createStorageCenterJanitor({
      loadPolicy: async () => policy,
      createService,
      readMarker,
      writeMarker,
      now: () => new Date('2026-10-08T00:00:00.000Z'),
    });

    await expect(janitor.runIfDue()).resolves.toEqual({ state: 'cleaned', reclaimedBytes: 12, removedFiles: 1 });
    expect(createService).toHaveBeenCalledWith(policy);
    expect(runCleanup).toHaveBeenCalledWith({ planId: 'plan' });
    expect(writeMarker).toHaveBeenCalledWith(Date.parse('2026-10-08T00:00:00.000Z'));
  });

  it('does not run a disabled policy', async () => {
    const previewCleanup = vi.fn();
    const janitor = createStorageCenterJanitor({
      loadPolicy: async () => ({ ...policy, automaticCleanup: false }),
      createService: () => ({ previewCleanup }) as never,
      readMarker: async () => 0,
      writeMarker: async () => undefined,
      now: () => new Date('2026-10-08T00:00:00.000Z'),
    });

    await expect(janitor.runIfDue()).resolves.toEqual({ state: 'disabled' });
    expect(previewCleanup).not.toHaveBeenCalled();
  });
});
