import { randomUUID } from 'node:crypto';

import {
  PACKAGE_CAPABILITY_ABI_VERSION,
  type PackageCapabilityErrorCode,
  type PackageCapabilityLease,
  type PackageCapabilityLeaseRequest,
  type PackageCapabilityReceipt,
  type PackageCapabilityResult,
  type PackageCapabilitySyscall,
  type PackageManifest,
  type PackageNativeCapability,
} from '@/common/packages';

const LEASE_DURATION_MS = 60_000;
const CAPABILITY_PERMISSION: Readonly<Record<PackageNativeCapability, string>> = {
  'host.runtime.info': 'host.ipc',
  'notifications.post': 'notifications.show',
  'sessions.report': 'sidebar.sessions',
  'model.invoke': 'model.invoke',
};

type LeaseRecord = PackageCapabilityLease & { revoked: boolean };

export type PackageCapabilityBroker = Readonly<{
  activate: (
    manifest: Pick<PackageManifest, 'id' | 'permissions'>,
    request: PackageCapabilityLeaseRequest
  ) => PackageCapabilityLease;
  invoke: (request: PackageCapabilitySyscall) => PackageCapabilityResult;
  cancel: (leaseId: string, packageId: string, runtimeId: string) => boolean;
  revokePackage: (packageId: string) => void;
  verifyLease: (
    leaseId: string,
    packageId: string,
    runtimeId: string,
    capability: PackageNativeCapability
  ) => boolean;
  authorizeLease: (
    leaseId: string,
    packageId: string,
    runtimeId: string,
    capability: PackageNativeCapability
  ) => PackageCapabilityLease | undefined;
}>;

export type PackageCapabilityBrokerDeps = Readonly<{
  isPackageActive: (packageId: string) => boolean;
  now?: () => number;
  createId?: () => string;
  /**
   * Hands a package notification to the notification hub. It validates the untrusted
   * arguments and returns false when it rejects them (malformed, rate-limited, disabled).
   */
  postNotification?: (packageId: string, args: unknown) => boolean;
  /**
   * Replaces the sessions a package shows under Active. The package id comes from the lease, never from
   * the payload; returns false when the payload is rejected (malformed, over the limits).
   */
  reportSessions?: (packageId: string, args: unknown) => boolean;
}>;

export class PackageCapabilityBrokerError extends Error {
  constructor(readonly code: PackageCapabilityErrorCode) {
    super(code);
    this.name = 'PackageCapabilityBrokerError';
  }
}

const requireNonBlank = (value: unknown, code: PackageCapabilityErrorCode): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new PackageCapabilityBrokerError(code);
  return normalized;
};

const requireLeaseRequest = (request: PackageCapabilityLeaseRequest): void => {
  if (request.version !== PACKAGE_CAPABILITY_ABI_VERSION)
    throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_REQUEST_INVALID');
  requireNonBlank(request.packageId, 'PACKAGE_CAPABILITY_REQUEST_INVALID');
  requireNonBlank(request.runtimeId, 'PACKAGE_CAPABILITY_REQUEST_INVALID');
  if (!(request.capability in CAPABILITY_PERMISSION))
    throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_REQUEST_INVALID');
};

const requireSyscall = (request: PackageCapabilitySyscall): void => {
  if (request.version !== PACKAGE_CAPABILITY_ABI_VERSION || !(request.name in CAPABILITY_PERMISSION)) {
    throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_REQUEST_INVALID');
  }
  requireNonBlank(request.leaseId, 'PACKAGE_CAPABILITY_REQUEST_INVALID');
  requireNonBlank(request.packageId, 'PACKAGE_CAPABILITY_REQUEST_INVALID');
  requireNonBlank(request.runtimeId, 'PACKAGE_CAPABILITY_REQUEST_INVALID');
};

const receipt = (
  createId: () => string,
  now: () => number,
  lease: PackageCapabilityLease,
  status: PackageCapabilityReceipt['status']
): PackageCapabilityReceipt => ({
  receiptId: createId(),
  packageId: lease.packageId,
  runtimeId: lease.runtimeId,
  capability: lease.capability,
  syscall: lease.capability,
  status,
  recordedAt: new Date(now()).toISOString(),
});

/**
 * Main-process supervisor for the package native capability ABI. It is
 * deliberately transport-neutral: a package runtime must be authenticated by a
 * bridge before it can call this broker.
 */
export const createPackageCapabilityBroker = (deps: PackageCapabilityBrokerDeps): PackageCapabilityBroker => {
  const now = deps.now ?? Date.now;
  const createId = deps.createId ?? randomUUID;
  const leases = new Map<string, LeaseRecord>();

  const getLease = (request: PackageCapabilitySyscall): LeaseRecord => {
    const lease = leases.get(request.leaseId);
    if (!lease || lease.packageId !== request.packageId || lease.runtimeId !== request.runtimeId) {
      throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_LEASE_UNAVAILABLE');
    }
    if (lease.revoked) throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_LEASE_REVOKED');
    if (Date.parse(lease.expiresAt) <= now())
      throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_LEASE_EXPIRED');
    if (!deps.isPackageActive(lease.packageId))
      throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_PACKAGE_INACTIVE');
    return lease;
  };

  return {
    activate: (manifest, request) => {
      requireLeaseRequest(request);
      if (manifest.id !== request.packageId)
        throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_REQUEST_INVALID');
      if (!deps.isPackageActive(manifest.id))
        throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_PACKAGE_INACTIVE');
      if (!manifest.permissions.includes(CAPABILITY_PERMISSION[request.capability])) {
        throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_NOT_DECLARED');
      }
      const lease: LeaseRecord = {
        version: PACKAGE_CAPABILITY_ABI_VERSION,
        leaseId: createId(),
        packageId: request.packageId,
        runtimeId: request.runtimeId,
        capability: request.capability,
        expiresAt: new Date(now() + LEASE_DURATION_MS).toISOString(),
        revoked: false,
      };
      leases.set(lease.leaseId, lease);
      const { revoked: _revoked, ...publicLease } = lease;
      return publicLease;
    },
    invoke: (request) => {
      try {
        requireSyscall(request);
        const lease = getLease(request);
        if (lease.capability !== request.name)
          throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_SYSCALL_DENIED');
        if (request.name === 'notifications.post') {
          if (!deps.postNotification) throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_SYSCALL_DENIED');
          const accepted = deps.postNotification(lease.packageId, request.args);
          return {
            ok: true,
            data: { abiVersion: PACKAGE_CAPABILITY_ABI_VERSION, packageId: lease.packageId, accepted },
            receipt: receipt(createId, now, lease, accepted ? 'completed' : 'denied'),
          };
        }
        if (request.name === 'sessions.report') {
          if (!deps.reportSessions) throw new PackageCapabilityBrokerError('PACKAGE_CAPABILITY_SYSCALL_DENIED');
          const accepted = deps.reportSessions(lease.packageId, request.args);
          return {
            ok: true,
            data: { abiVersion: PACKAGE_CAPABILITY_ABI_VERSION, packageId: lease.packageId, accepted },
            receipt: receipt(createId, now, lease, accepted ? 'completed' : 'denied'),
          };
        }
        const completedReceipt = receipt(createId, now, lease, 'completed');
        return {
          ok: true,
          data: { abiVersion: PACKAGE_CAPABILITY_ABI_VERSION, packageId: lease.packageId },
          receipt: completedReceipt,
        };
      } catch (error) {
        if (error instanceof PackageCapabilityBrokerError) return { ok: false, code: error.code };
        return { ok: false, code: 'PACKAGE_CAPABILITY_SYSCALL_DENIED' };
      }
    },
    cancel: (leaseId, packageId, runtimeId) => {
      const lease = leases.get(leaseId);
      if (!lease || lease.packageId !== packageId || lease.runtimeId !== runtimeId || lease.revoked) return false;
      lease.revoked = true;
      return true;
    },
    revokePackage: (packageId) => {
      for (const lease of leases.values()) {
        if (lease.packageId === packageId) lease.revoked = true;
      }
    },
    verifyLease: (leaseId, packageId, runtimeId, capability) => {
      const lease = leases.get(leaseId);
      if (!lease || lease.packageId !== packageId || lease.runtimeId !== runtimeId || lease.capability !== capability) {
        return false;
      }
      if (lease.revoked) return false;
      if (Date.parse(lease.expiresAt) <= now()) return false;
      if (!deps.isPackageActive(lease.packageId)) return false;
      return true;
    },
    authorizeLease: (leaseId, packageId, runtimeId, capability) => {
      const lease = leases.get(leaseId);
      if (!lease || lease.packageId !== packageId || lease.runtimeId !== runtimeId || lease.capability !== capability) {
        return undefined;
      }
      if (lease.revoked) return undefined;
      if (Date.parse(lease.expiresAt) <= now()) return undefined;
      if (!deps.isPackageActive(lease.packageId)) return undefined;
      const { revoked: _revoked, ...publicLease } = lease;
      return publicLease;
    },
  };
};
