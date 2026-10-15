/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createPackageCapabilityBroker } from '@process/resources/packageCapability/broker';
import {
  postPackageNotification,
  setPackageNotificationHandler,
} from '@process/system/hubActivity/notificationSources/packageNotificationPort';

const request = { version: 1 as const, packageId: 'tomny.demo', runtimeId: 'r1' };

describe('notifications.post package capability', () => {
  it('needs the declared notifications.show permission', () => {
    const broker = createPackageCapabilityBroker({ isPackageActive: () => true, postNotification: () => true });
    expect(() =>
      broker.activate({ id: 'tomny.demo', permissions: ['host.ipc'] }, { ...request, capability: 'notifications.post' })
    ).toThrow('PACKAGE_CAPABILITY_NOT_DECLARED');
  });

  it('hands validated posts to the hub and records a receipt', () => {
    const postNotification = vi.fn((_packageId: string, args: unknown) => Boolean((args as { title?: string }).title));
    const broker = createPackageCapabilityBroker({ isPackageActive: () => true, postNotification });
    const lease = broker.activate(
      { id: 'tomny.demo', permissions: ['notifications.show'] },
      { ...request, capability: 'notifications.post' }
    );
    const accepted = broker.invoke({
      ...request,
      leaseId: lease.leaseId,
      name: 'notifications.post',
      args: { title: 'Done' },
    });
    expect(accepted).toMatchObject({
      ok: true,
      data: { accepted: true },
      receipt: { syscall: 'notifications.post', status: 'completed' },
    });
    expect(postNotification).toHaveBeenCalledWith('tomny.demo', { title: 'Done' });
    const refused = broker.invoke({
      ...request,
      leaseId: lease.leaseId,
      name: 'notifications.post',
      args: { title: '' },
    });
    expect(refused).toMatchObject({ ok: true, data: { accepted: false }, receipt: { status: 'denied' } });
    expect(broker.invoke({ ...request, leaseId: lease.leaseId, name: 'host.runtime.info' })).toMatchObject({
      ok: false,
      code: 'PACKAGE_CAPABILITY_SYSCALL_DENIED',
    });
  });

  it('refuses posts until the hub registers, and never throws through the port', () => {
    setPackageNotificationHandler(undefined);
    expect(postPackageNotification('tomny.demo', { title: 'x' })).toBe(false);
    setPackageNotificationHandler(() => {
      throw new Error('boom');
    });
    expect(postPackageNotification('tomny.demo', { title: 'x' })).toBe(false);
    setPackageNotificationHandler(undefined);
  });
});
