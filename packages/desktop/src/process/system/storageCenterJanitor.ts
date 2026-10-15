import type { StorageCenterPolicy } from '@/common/types/platform/storageCenter';
import type { StorageCenterService } from './storageCenterService';

const DAY_MS = 24 * 60 * 60 * 1000;

export type StorageCenterJanitorResult =
  | Readonly<{ state: 'disabled' | 'not-due' | 'nothing-to-clean' }>
  | Readonly<{ state: 'cleaned'; reclaimedBytes: number; removedFiles: number }>;

export type StorageCenterJanitorOptions = Readonly<{
  loadPolicy: () => Promise<StorageCenterPolicy>;
  createService: (policy: StorageCenterPolicy) => StorageCenterService;
  readMarker: () => Promise<number | undefined>;
  writeMarker: (at: number) => Promise<void>;
  now?: () => Date;
}>;

export type StorageCenterJanitor = Readonly<{ runIfDue: () => Promise<StorageCenterJanitorResult> }>;

export const createStorageCenterJanitor = ({
  loadPolicy,
  createService,
  readMarker,
  writeMarker,
  now = () => new Date(),
}: StorageCenterJanitorOptions): StorageCenterJanitor => {
  let running: Promise<StorageCenterJanitorResult> | undefined;

  const run = async (): Promise<StorageCenterJanitorResult> => {
    const policy = await loadPolicy();
    if (!policy.automaticCleanup) return { state: 'disabled' };

    const nowMs = now().getTime();
    const lastRun = await readMarker();
    if (lastRun !== undefined && nowMs - lastRun < DAY_MS) return { state: 'not-due' };

    const service = createService(policy);
    const preview = await service.previewCleanup();
    if (preview.candidates.length === 0) {
      await writeMarker(nowMs);
      return { state: 'nothing-to-clean' };
    }

    const result = await service.runCleanup({ planId: preview.planId });
    await writeMarker(nowMs);
    return { state: 'cleaned', reclaimedBytes: result.reclaimedBytes, removedFiles: result.removedFiles };
  };

  return {
    runIfDue: async (): Promise<StorageCenterJanitorResult> => {
      running ??= run().finally(() => {
        running = undefined;
      });
      return running;
    },
  };
};
