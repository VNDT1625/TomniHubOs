import { ipcBridge } from '@/common';
import { getPlatformServices } from '@/common/platform';
import {
  createDefaultStorageCenterPolicy,
  validateStorageCenterPolicy,
  type StorageCenterPolicy,
} from '@/common/types/platform/storageCenter';
import { ProcessConfig } from '@process/utils/initStorage';
import { getDataPath, getTempPath } from '@process/utils/utils';
import { createStorageCenterService, type StorageCenterRoot, type StorageCenterService } from './storageCenterService';

const STORAGE_POLICY_KEY = 'storageCenter.policy';

const configuredRoots = (policy: StorageCenterPolicy): readonly StorageCenterRoot[] => {
  const platform = getPlatformServices().paths;
  return [
    {
      id: 'app-temp',
      category: 'technicalCache',
      label: 'Application temporary files',
      path: getTempPath(),
      management: 'ttl-managed',
      retentionDays: policy.categories.technicalCache.retentionDays,
    },
    {
      id: 'app-logs',
      category: 'logs',
      label: 'Application logs',
      path: platform.getLogsDir(),
      management: 'ttl-managed',
      retentionDays: policy.categories.logs.retentionDays,
    },
    {
      id: 'user-data',
      category: 'userData',
      label: 'Protected user data',
      path: getDataPath(),
      management: 'protected',
    },
  ];
};

const readPolicy = async (): Promise<StorageCenterPolicy> => {
  const stored = (await ProcessConfig.get(STORAGE_POLICY_KEY as never)) as StorageCenterPolicy | undefined;
  if (!stored) return createDefaultStorageCenterPolicy();
  try {
    return validateStorageCenterPolicy(stored);
  } catch {
    return createDefaultStorageCenterPolicy();
  }
};

const serviceFor = (policy: StorageCenterPolicy): StorageCenterService =>
  createStorageCenterService({ roots: configuredRoots(policy) });

/** Main-owned Storage Center provider registration. No arbitrary root or deletion IPC exists. */
export function registerStorageCenterBridge(): void {
  let plannedService: StorageCenterService | undefined;

  ipcBridge.storageCenter.getSummary.provider(async () => serviceFor(await readPolicy()).getSummary());
  ipcBridge.storageCenter.previewCleanup.provider(async () => {
    plannedService = serviceFor(await readPolicy());
    return plannedService.previewCleanup();
  });
  ipcBridge.storageCenter.runCleanup.provider(({ planId }) => {
    if (!plannedService) throw new Error('STORAGE_CLEANUP_PLAN_INVALID');
    return plannedService.runCleanup({ planId });
  });
  ipcBridge.storageCenter.getPolicy.provider(() => readPolicy());
  ipcBridge.storageCenter.updatePolicy.provider(async ({ policy }) => {
    const validated = validateStorageCenterPolicy(policy);
    await ProcessConfig.set(STORAGE_POLICY_KEY as never, validated as never);
    plannedService = undefined;
    return validated;
  });
}
