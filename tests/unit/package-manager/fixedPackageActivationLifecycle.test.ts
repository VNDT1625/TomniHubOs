import { describe, expect, it, vi } from 'vitest';
import type { PackageListing, PackageStateChangedEvent } from '@/common/packages';
import { createFixedPackageActivationLifecycle } from '@/process/resources/packageProcessRuntime/fixedPackageActivationLifecycle';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('fixed package activation lifecycle', () => {
  it('admits only an installed enabled package and tears its host down for disable, mutation, and disposal', async () => {
    let listing = { state: 'available', enabled: false } as Pick<PackageListing, 'state' | 'enabled'>;
    const listeners = new Set<(event: PackageStateChangedEvent) => void>();
    const activate = vi.fn(async () => undefined);
    const deactivate = vi.fn(async () => undefined);
    const lifecycle = createFixedPackageActivationLifecycle('com.tomni.company', {
      packages: {
        status: async () => listing as PackageListing,
        onStateChanged: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      activate,
      deactivate,
    });

    await lifecycle.initialize();
    expect(activate).not.toHaveBeenCalled();

    listing = { state: 'installed', enabled: true };
    listeners.forEach((listener) => listener({ id: 'com.tomni.company', state: 'installed' }));
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));

    listing = { state: 'installed', enabled: false };
    listeners.forEach((listener) => listener({ id: 'com.tomni.company', state: 'installed' }));
    await vi.waitFor(() => expect(deactivate).toHaveBeenCalledTimes(1));

    listing = { state: 'installed', enabled: true };
    listeners.forEach((listener) => listener({ id: 'com.tomni.company', state: 'installed' }));
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(2));

    await lifecycle.quiesce();
    expect(deactivate).toHaveBeenCalledTimes(2);
    listeners.forEach((listener) => listener({ id: 'com.tomni.company', state: 'installed' }));
    await flush();
    expect(activate).toHaveBeenCalledTimes(2);

    await lifecycle.resume();
    expect(activate).toHaveBeenCalledTimes(3);

    await lifecycle.dispose();
    expect(deactivate).toHaveBeenCalledTimes(3);
  });

  it('keeps an unavailable package host inactive', async () => {
    const activate = vi.fn(async () => undefined);
    const deactivate = vi.fn(async () => undefined);
    const lifecycle = createFixedPackageActivationLifecycle('com.tomni.pet', {
      packages: {
        status: async () => {
          throw new Error('PACKAGE_NOT_FOUND');
        },
        onStateChanged: () => () => undefined,
      },
      activate,
      deactivate,
    });

    await lifecycle.initialize();
    expect(activate).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
  });
});
