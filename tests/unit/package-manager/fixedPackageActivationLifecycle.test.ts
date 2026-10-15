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

    it.each(['com.tomni.browser', 'com.tomni.ide'])(
    'stops optional native host before disable/uninstall and restores it only after re-enable (%s)',
    async (packageId) => {
      let listing = {
        state: 'available',
        enabled: false,
        compatible: true,
        revoked: false,
        installedTrust: undefined,
        installedManifest: undefined,
      } as Pick<PackageListing, 'state' | 'enabled' | 'compatible' | 'revoked' | 'installedTrust' | 'installedManifest'>;
      const listeners = new Set<(event: PackageStateChangedEvent) => void>();
      const activate = vi.fn(async () => undefined);
      const deactivate = vi.fn(async () => undefined);
      const lifecycle = createFixedPackageActivationLifecycle(packageId, {
        packages: {
          status: async () => listing as PackageListing,
          onStateChanged: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
          },
        },
        canActivate: (item) => item.installedTrust === 'signed-first-party' &&
          item.installedManifest?.id === packageId && item.installedManifest.publisherId === 'com.tomni',
        activate,
        deactivate,
      });
      const announce = (): void => listeners.forEach((listener) => listener({ id: packageId, state: listing.state }));
      await lifecycle.initialize();
      expect(activate).not.toHaveBeenCalled();
      listing = { state: 'installed', enabled: true, compatible: true, revoked: false,
        installedTrust: 'signed-store', installedManifest: {
          id: packageId, publisherId: 'com.tomni',
        } as PackageListing['installedManifest'] };
      announce();
      await flush();
      expect(activate).not.toHaveBeenCalled();
      listing = { ...listing, installedTrust: 'signed-first-party' };
      announce();
      await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));

      await lifecycle.quiesce();
      expect(deactivate).toHaveBeenCalledTimes(1);
      listing = { ...listing, enabled: false };
      announce();
      await lifecycle.resume();
      expect(activate).toHaveBeenCalledTimes(1);

      listing = { ...listing, enabled: true };
      announce();
      await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(2));
      await lifecycle.quiesce();
      expect(deactivate).toHaveBeenCalledTimes(2);
      listing = { ...listing, state: 'available', enabled: false, installedManifest: undefined };
      announce();
      await lifecycle.resume();
      expect(activate).toHaveBeenCalledTimes(2);

      listing = { ...listing, state: 'installed', enabled: true,
        installedManifest: { id: packageId, publisherId: 'com.tomni' } as PackageListing['installedManifest'] };
      announce();
      await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(3));
      listing = { ...listing, compatible: false };
      announce();
      await vi.waitFor(() => expect(deactivate).toHaveBeenCalledTimes(3));
      await lifecycle.dispose();
    }
  );

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
