/** Versioned contracts for supervised native package capabilities. */

export const PACKAGE_CAPABILITY_ABI_VERSION = 1;

export const PACKAGE_NATIVE_CAPABILITIES = ['host.runtime.info'] as const;

export type PackageNativeCapability = (typeof PACKAGE_NATIVE_CAPABILITIES)[number];

export type PackageCapabilityLeaseRequest = Readonly<{
  version: typeof PACKAGE_CAPABILITY_ABI_VERSION;
  packageId: string;
  runtimeId: string;
  capability: PackageNativeCapability;
}>;

export type PackageCapabilityLease = Readonly<{
  version: typeof PACKAGE_CAPABILITY_ABI_VERSION;
  leaseId: string;
  packageId: string;
  runtimeId: string;
  capability: PackageNativeCapability;
  expiresAt: string;
}>;

export type PackageCapabilitySyscall = Readonly<{
  version: typeof PACKAGE_CAPABILITY_ABI_VERSION;
  leaseId: string;
  packageId: string;
  runtimeId: string;
  name: 'host.runtime.info';
}>;

export type PackageCapabilityReceipt = Readonly<{
  receiptId: string;
  packageId: string;
  runtimeId: string;
  capability: PackageNativeCapability;
  syscall: PackageCapabilitySyscall['name'];
  status: 'completed' | 'cancelled' | 'denied';
  recordedAt: string;
}>;

export type PackageCapabilityResult =
  | Readonly<{
      ok: true;
      data: { abiVersion: typeof PACKAGE_CAPABILITY_ABI_VERSION; packageId: string };
      receipt: PackageCapabilityReceipt;
    }>
  | Readonly<{ ok: false; code: PackageCapabilityErrorCode; receipt?: PackageCapabilityReceipt }>;

export type PackageCapabilityErrorCode =
  | 'PACKAGE_CAPABILITY_REQUEST_INVALID'
  | 'PACKAGE_CAPABILITY_PACKAGE_INACTIVE'
  | 'PACKAGE_CAPABILITY_NOT_DECLARED'
  | 'PACKAGE_CAPABILITY_LEASE_UNAVAILABLE'
  | 'PACKAGE_CAPABILITY_LEASE_EXPIRED'
  | 'PACKAGE_CAPABILITY_LEASE_REVOKED'
  | 'PACKAGE_CAPABILITY_SYSCALL_DENIED';
