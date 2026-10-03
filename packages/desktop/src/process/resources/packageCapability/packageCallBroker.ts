import type { PackageCapabilityLease, PackageCapabilityReceipt, PackageIdentity } from '@/common/packages';
import type { RunBudget, RunIntent } from '@/common/foundation/runTypes';
import type { OutcomeReceipt } from '@/common/foundation/receiptTypes';
import { RunKernel } from '@/process/foundation/runKernel';
import type { PackageCapabilityBroker } from './broker';

const PACKAGE_CAPABILITY_ABI_VERSION = 1 as const;

type RuntimeLeaseReference = Pick<PackageCapabilityLease, 'leaseId' | 'packageId' | 'runtimeId'>;

export type PackageCallBrokerErrorCode =
  | 'PACKAGE_CALL_REQUEST_INVALID'
  | 'PACKAGE_CALL_IDENTITY_UNAVAILABLE'
  | 'PACKAGE_CALL_RUNTIME_UNAVAILABLE'
  | 'PACKAGE_CALL_DELEGATION_INVALID';

export class PackageCallBrokerError extends Error {
  public constructor(
    readonly code: PackageCallBrokerErrorCode,
    cause?: unknown
  ) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'PackageCallBrokerError';
  }
}

export type PackageCalleeInvocation = Readonly<{
  callId: string;
  caller: PackageIdentity;
  callee: PackageIdentity;
  capability: string;
  childRunId: string;
  childTaskId: string;
  capabilityGrant: readonly string[];
  budget: RunBudget;
  signal?: AbortSignal;
}>;

export type PackageToPackageCallRequest = Readonly<{
  callId: string;
  caller: PackageIdentity;
  callee: PackageIdentity;
  callerRuntime: RuntimeLeaseReference;
  calleeRuntime: RuntimeLeaseReference;
  parentIntent: RunIntent;
  childRunId: string;
  childTaskId: string;
  capability: string;
  purpose: string;
  narrowedCapabilityGrant: readonly string[];
  budget: RunBudget;
  invokeCallee: (invocation: PackageCalleeInvocation) => Promise<{ evidenceRefs: readonly string[] }>;
  signal?: AbortSignal;
}>;

export type PackageToPackageCallResult = Readonly<{
  parentReceipt: OutcomeReceipt;
  childReceipt: OutcomeReceipt;
  callerCapabilityReceipt: PackageCapabilityReceipt;
  calleeCapabilityReceipt: PackageCapabilityReceipt;
}>;

export type PackageCallBrokerDeps = Readonly<{
  kernel?: RunKernel;
  nativeCapabilityBroker: Pick<PackageCapabilityBroker, 'invoke'>;
  resolveActivePackageIdentity: (packageId: string) => PackageIdentity | undefined;
}>;

export type PackageCallBroker = Readonly<{
  invoke: (request: PackageToPackageCallRequest) => Promise<PackageToPackageCallResult>;
}>;

const packageCallCapability = (callee: PackageIdentity, capability: string): string =>
  `package.call:${callee.packageId}:${capability}`;

const requireNonBlank = (value: string, code: PackageCallBrokerErrorCode): string => {
  const normalized = value.trim();
  if (!normalized) throw new PackageCallBrokerError(code);
  return normalized;
};

const requireIdentity = (identity: PackageIdentity): PackageIdentity => {
  requireNonBlank(identity.packageId, 'PACKAGE_CALL_REQUEST_INVALID');
  requireNonBlank(identity.packageVersion, 'PACKAGE_CALL_REQUEST_INVALID');
  requireNonBlank(identity.publisherId, 'PACKAGE_CALL_REQUEST_INVALID');
  return identity;
};

const sameIdentity = (left: PackageIdentity, right: PackageIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const requireNarrowedGrant = (request: PackageToPackageCallRequest): readonly string[] => {
  if (request.narrowedCapabilityGrant.length === 0) {
    throw new PackageCallBrokerError('PACKAGE_CALL_DELEGATION_INVALID');
  }
  const grant = request.narrowedCapabilityGrant.map((capability) =>
    requireNonBlank(capability, 'PACKAGE_CALL_DELEGATION_INVALID')
  );
  if (
    new Set(grant).size !== grant.length ||
    !grant.includes(packageCallCapability(request.callee, request.capability))
  ) {
    throw new PackageCallBrokerError('PACKAGE_CALL_DELEGATION_INVALID');
  }
  return grant;
};

const requireRuntimeLease = (
  nativeCapabilityBroker: Pick<PackageCapabilityBroker, 'invoke'>,
  identity: PackageIdentity,
  lease: RuntimeLeaseReference
): PackageCapabilityReceipt => {
  if (lease.packageId !== identity.packageId) throw new PackageCallBrokerError('PACKAGE_CALL_RUNTIME_UNAVAILABLE');
  const result = nativeCapabilityBroker.invoke({
    version: PACKAGE_CAPABILITY_ABI_VERSION,
    leaseId: lease.leaseId,
    packageId: lease.packageId,
    runtimeId: lease.runtimeId,
    name: 'host.runtime.info',
  });
  if (!result.ok) throw new PackageCallBrokerError('PACKAGE_CALL_RUNTIME_UNAVAILABLE');
  return result.receipt;
};

/**
 * Main-process-only package-call seam awaiting IPC registration. It deliberately
 * uses the existing native capability broker for runtime identity and the
 * RunKernel (and therefore TrustBroker) for policy, leases, cancellation, and
 * durable caller/child receipts. A renderer cannot call this module directly.
 */
export const createPackageCallBroker = (deps: PackageCallBrokerDeps): PackageCallBroker => {
  const kernel = deps.kernel ?? new RunKernel();

  return {
    invoke: async (request) => {
      requireNonBlank(request.callId, 'PACKAGE_CALL_REQUEST_INVALID');
      requireNonBlank(request.childRunId, 'PACKAGE_CALL_REQUEST_INVALID');
      requireNonBlank(request.childTaskId, 'PACKAGE_CALL_REQUEST_INVALID');
      requireNonBlank(request.capability, 'PACKAGE_CALL_REQUEST_INVALID');
      requireNonBlank(request.purpose, 'PACKAGE_CALL_REQUEST_INVALID');
      const caller = requireIdentity(request.caller);
      const callee = requireIdentity(request.callee);
      if (caller.packageId === callee.packageId || request.childRunId === request.parentIntent.runId) {
        throw new PackageCallBrokerError('PACKAGE_CALL_REQUEST_INVALID');
      }
      const activeCaller = deps.resolveActivePackageIdentity(caller.packageId);
      const activeCallee = deps.resolveActivePackageIdentity(callee.packageId);
      if (!activeCaller || !sameIdentity(activeCaller, caller)) {
        throw new PackageCallBrokerError('PACKAGE_CALL_IDENTITY_UNAVAILABLE');
      }
      if (!activeCallee || !sameIdentity(activeCallee, callee)) {
        throw new PackageCallBrokerError('PACKAGE_CALL_IDENTITY_UNAVAILABLE');
      }

      const callerCapabilityReceipt = requireRuntimeLease(deps.nativeCapabilityBroker, caller, request.callerRuntime);
      const calleeCapabilityReceipt = requireRuntimeLease(deps.nativeCapabilityBroker, callee, request.calleeRuntime);
      const narrowedCapabilityGrant = requireNarrowedGrant(request);
      const childIntent: RunIntent = {
        ...request.parentIntent,
        runId: request.childRunId,
        rootTaskId: request.childTaskId,
        parentRunId: request.parentIntent.runId,
        surface: `package:${callee.packageId}`,
        goal: request.purpose,
        capabilityGrant: narrowedCapabilityGrant,
        budget: request.budget,
      };

      try {
        const result = await kernel.executeRunWithChild(
          request.parentIntent,
          [
            {
              id: `package-caller:${caller.packageId}`,
              factors: { packageCall: 1 },
              estimatedCostMB: 1,
              priority: 1,
            },
          ],
          childIntent,
          [
            {
              id: `package-callee:${callee.packageId}:${request.capability}`,
              factors: { packageCall: 1 },
              estimatedCostMB: request.budget.maxEstimatedCostMB,
              priority: 1,
            },
          ],
          async (_leaseId, signal) =>
            request.invokeCallee({
              callId: request.callId,
              caller,
              callee,
              capability: request.capability,
              childRunId: childIntent.runId,
              childTaskId: childIntent.rootTaskId,
              capabilityGrant: narrowedCapabilityGrant,
              budget: request.budget,
              signal,
            }),
          [
            `package-call:${request.callId}`,
            `package-caller:${caller.packageId}@${caller.packageVersion}`,
            `package-callee:${callee.packageId}@${callee.packageVersion}`,
            `package-capability-receipt:${callerCapabilityReceipt.receiptId}`,
            `package-capability-receipt:${calleeCapabilityReceipt.receiptId}`,
          ],
          request.signal
        );
        return { ...result, callerCapabilityReceipt, calleeCapabilityReceipt };
      } catch (error) {
        if (error instanceof PackageCallBrokerError) throw error;
        throw new PackageCallBrokerError('PACKAGE_CALL_DELEGATION_INVALID', error);
      }
    },
  };
};
