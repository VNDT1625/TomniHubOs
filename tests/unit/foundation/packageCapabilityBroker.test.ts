import { describe, expect, it } from 'vitest';

import { PACKAGE_CAPABILITY_ABI_VERSION } from '@/common/packages';
import {
  createPackageCapabilityBroker,
  type PackageCapabilityBrokerError,
} from '@/process/resources/packageCapability/broker';

const manifest = { id: 'com.tomni.pilot', permissions: ['host.ipc'] };

describe('Package capability broker', () => {
  it('issues a bounded manifest-declared lease and records deterministic syscall evidence', () => {
    let time = Date.UTC(2026, 7, 13);
    let sequence = 0;
    const broker = createPackageCapabilityBroker({
      isPackageActive: (packageId) => packageId === 'com.tomni.pilot',
      now: () => time,
      createId: () => `id-${++sequence}`,
    });
    const lease = broker.activate(manifest, {
      version: PACKAGE_CAPABILITY_ABI_VERSION,
      packageId: 'com.tomni.pilot',
      runtimeId: 'runtime-1',
      capability: 'host.runtime.info',
    });

    expect(
      broker.invoke({
        version: 1,
        leaseId: lease.leaseId,
        packageId: manifest.id,
        runtimeId: 'runtime-1',
        name: 'host.runtime.info',
      })
    ).toEqual({
      ok: true,
      data: { abiVersion: 1, packageId: manifest.id },
      receipt: {
        receiptId: 'id-2',
        packageId: manifest.id,
        runtimeId: 'runtime-1',
        capability: 'host.runtime.info',
        syscall: 'host.runtime.info',
        status: 'completed',
        recordedAt: new Date(time).toISOString(),
      },
    });

    time += 60_000;
    expect(
      broker.invoke({
        version: 1,
        leaseId: lease.leaseId,
        packageId: manifest.id,
        runtimeId: 'runtime-1',
        name: 'host.runtime.info',
      })
    ).toEqual({
      ok: false,
      code: 'PACKAGE_CAPABILITY_LEASE_EXPIRED',
    });
  });

  it('fails closed for inactive, undeclared, cancelled, and cross-runtime requests', () => {
    const broker = createPackageCapabilityBroker({ isPackageActive: (packageId) => packageId === 'com.tomni.pilot' });
    expect(() =>
      broker.activate(
        { ...manifest, permissions: [] },
        { version: 1, packageId: manifest.id, runtimeId: 'runtime-1', capability: 'host.runtime.info' }
      )
    ).toThrowError(
      expect.objectContaining({ code: 'PACKAGE_CAPABILITY_NOT_DECLARED' }) as PackageCapabilityBrokerError
    );

    const lease = broker.activate(manifest, {
      version: 1,
      packageId: manifest.id,
      runtimeId: 'runtime-1',
      capability: 'host.runtime.info',
    });
    expect(
      broker.invoke({
        version: 1,
        leaseId: lease.leaseId,
        packageId: manifest.id,
        runtimeId: 'runtime-2',
        name: 'host.runtime.info',
      })
    ).toEqual({
      ok: false,
      code: 'PACKAGE_CAPABILITY_LEASE_UNAVAILABLE',
    });
    expect(broker.cancel(lease.leaseId, manifest.id, 'runtime-1')).toBe(true);
    expect(
      broker.invoke({
        version: 1,
        leaseId: lease.leaseId,
        packageId: manifest.id,
        runtimeId: 'runtime-1',
        name: 'host.runtime.info',
      })
    ).toEqual({
      ok: false,
      code: 'PACKAGE_CAPABILITY_LEASE_REVOKED',
    });
  });
});
