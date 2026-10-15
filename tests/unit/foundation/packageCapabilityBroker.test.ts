import { describe, expect, it, vi } from 'vitest';

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

describe('Package capability broker: sessions.report', () => {
  const sessionsManifest = { id: 'com.acme.board', permissions: ['sidebar.sessions'] };
  const request = { version: PACKAGE_CAPABILITY_ABI_VERSION, packageId: 'com.acme.board', runtimeId: 'r1' } as const;

  it('refuses a lease when the package did not declare sidebar.sessions', () => {
    const broker = createPackageCapabilityBroker({ isPackageActive: () => true });
    expect(() =>
      broker.activate({ id: 'com.acme.board', permissions: [] }, { ...request, capability: 'sessions.report' })
    ).toThrow('PACKAGE_CAPABILITY_NOT_DECLARED');
  });

  it('reports under the lease package id, never one named in the payload', () => {
    const reportSessions = vi.fn(() => true);
    const broker = createPackageCapabilityBroker({ isPackageActive: () => true, reportSessions });
    const lease = broker.activate(sessionsManifest, { ...request, capability: 'sessions.report' });
    const args = { sessions: [{ id: 'a', title: 'A', status: 'idle' }], packageId: 'com.victim.app' };

    const result = broker.invoke({
      version: 1,
      leaseId: lease.leaseId,
      packageId: 'com.acme.board',
      runtimeId: 'r1',
      name: 'sessions.report',
      args,
    });

    expect(reportSessions).toHaveBeenCalledWith('com.acme.board', args);
    expect(result).toMatchObject({ ok: true, data: { accepted: true }, receipt: { status: 'completed' } });
  });

  it('marks a rejected report as denied without raising an error code', () => {
    const broker = createPackageCapabilityBroker({ isPackageActive: () => true, reportSessions: () => false });
    const lease = broker.activate(sessionsManifest, { ...request, capability: 'sessions.report' });

    const result = broker.invoke({
      version: 1,
      leaseId: lease.leaseId,
      packageId: 'com.acme.board',
      runtimeId: 'r1',
      name: 'sessions.report',
      args: { sessions: 'garbage' },
    });

    expect(result).toMatchObject({ ok: true, data: { accepted: false }, receipt: { status: 'denied' } });
  });

  it('fails closed when the host wired no sessions sink', () => {
    const broker = createPackageCapabilityBroker({ isPackageActive: () => true });
    const lease = broker.activate(sessionsManifest, { ...request, capability: 'sessions.report' });
    expect(
      broker.invoke({
        version: 1,
        leaseId: lease.leaseId,
        packageId: 'com.acme.board',
        runtimeId: 'r1',
        name: 'sessions.report',
        args: { sessions: [] },
      })
    ).toEqual({ ok: false, code: 'PACKAGE_CAPABILITY_SYSCALL_DENIED' });
  });
});

describe('Package capability broker: model.invoke lease', () => {
  const modelManifest = { id: 'com.tomni.ai-challenge', permissions: ['model.invoke'] };
  const request = { version: PACKAGE_CAPABILITY_ABI_VERSION, packageId: 'com.tomni.ai-challenge', runtimeId: 'r1' } as const;

  it('refuses a lease when package did not declare model.invoke', () => {
    const broker = createPackageCapabilityBroker({ isPackageActive: () => true });
    expect(() =>
      broker.activate({ id: 'com.tomni.ai-challenge', permissions: [] }, { ...request, capability: 'model.invoke' })
    ).toThrow('PACKAGE_CAPABILITY_NOT_DECLARED');
  });

  it('activates and verifies lease for declared model.invoke', () => {
    const broker = createPackageCapabilityBroker({ isPackageActive: () => true });
    const lease = broker.activate(modelManifest, { ...request, capability: 'model.invoke' });
    expect(broker.verifyLease(lease.leaseId, 'com.tomni.ai-challenge', 'r1', 'model.invoke')).toBe(true);
    expect(broker.verifyLease(lease.leaseId, 'com.tomni.ai-challenge', 'wrong-runtime', 'model.invoke')).toBe(false);
    expect(broker.authorizeLease(lease.leaseId, 'com.tomni.ai-challenge', 'r1', 'model.invoke')).toMatchObject({
      leaseId: lease.leaseId,
      packageId: 'com.tomni.ai-challenge',
      runtimeId: 'r1',
      capability: 'model.invoke',
    });
  });
});
