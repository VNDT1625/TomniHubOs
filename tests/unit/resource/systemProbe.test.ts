import { describe, expect, it } from 'vitest';
import { createSystemProbe } from '@/process/resource/systemProbe';

describe('system probe normalization', () => {
  it('fails closed to zero cores for non-finite core readings', async () => {
    const probe = createSystemProbe({
      getTotalMemBytes: () => 16 * 1024 * 1024 * 1024,
      getCpuCoreCount: () => Number.NaN,
      getHasDiscreteGPU: async () => false,
      getFreeDiskBytes: async () => 100 * 1024 * 1024,
    });

    await expect(probe()).resolves.toMatchObject({ totalMemMB: 16_384, cpuCores: 0, hasDiscreteGPU: false });
  });
});
