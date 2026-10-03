import { describe, expect, it } from 'vitest';

import { PACKAGE_CAPABILITY_ABI_VERSION, type PackageIdentity } from '@/common/packages';
import type { RunIntent } from '@/common/foundation/runTypes';
import { RunKernel } from '@/process/foundation/runKernel';
import { SecurityAdapter } from '@/process/foundation/securityAdapter';
import { TrustBroker } from '@/process/foundation/trustBroker';
import {
  createPackageCallBroker,
  type PackageCallBrokerError,
} from '@/process/resources/packageCapability/packageCallBroker';
import { createPackageCapabilityBroker } from '@/process/resources/packageCapability/broker';

const caller: PackageIdentity = {
  packageId: 'com.tomni.workflow',
  packageVersion: '1.0.0',
  publisherId: 'com.tomni',
};
const callee: PackageIdentity = {
  packageId: 'com.tomni.web',
  packageVersion: '1.2.0',
  publisherId: 'com.tomni',
};
const capability = 'web.research';
const delegatedCapability = `package.call:${callee.packageId}:${capability}`;

const parentIntent = (overrides: Partial<RunIntent> = {}): RunIntent => ({
  runId: 'run_package_parent',
  rootTaskId: 'task_package_parent',
  surface: `package:${caller.packageId}`,
  goal: 'Research sources for a user request.',
  constraints: [],
  successCriteria: ['A cited source set exists.'],
  workspaceScope: 'workspace:default',
  userId: 'user_1',
  createdAt: Date.UTC(2026, 7, 14),
  correlationId: 'correlation_package_call',
  policyVersion: 'policy_1',
  capabilityGrant: [delegatedCapability, 'workspace.read'],
  budget: { maxEstimatedCostMB: 256, maxSteps: 3 },
  ...overrides,
});

const createFixture = () => {
  let sequence = 0;
  const identities = new Map<string, PackageIdentity>([
    [caller.packageId, caller],
    [callee.packageId, callee],
  ]);
  const nativeCapabilityBroker = createPackageCapabilityBroker({
    isPackageActive: (packageId) => identities.has(packageId),
    createId: () => `native_${++sequence}`,
    now: () => Date.UTC(2026, 7, 14),
  });
  const callerRuntime = nativeCapabilityBroker.activate(
    { id: caller.packageId, permissions: ['host.ipc'] },
    {
      version: PACKAGE_CAPABILITY_ABI_VERSION,
      packageId: caller.packageId,
      runtimeId: 'runtime_workflow',
      capability: 'host.runtime.info',
    }
  );
  const calleeRuntime = nativeCapabilityBroker.activate(
    { id: callee.packageId, permissions: ['host.ipc'] },
    {
      version: PACKAGE_CAPABILITY_ABI_VERSION,
      packageId: callee.packageId,
      runtimeId: 'runtime_web',
      capability: 'host.runtime.info',
    }
  );
  const kernel = new RunKernel({
    securityAdapter: new SecurityAdapter(
      new TrustBroker({ allowedCapabilities: [delegatedCapability, 'workspace.read', 'target.execute'] })
    ),
  });
  return {
    callerRuntime,
    calleeRuntime,
    identities,
    kernel,
    broker: createPackageCallBroker({
      kernel,
      nativeCapabilityBroker,
      resolveActivePackageIdentity: (packageId) => identities.get(packageId),
    }),
  };
};

describe('Package call broker', () => {
  it('binds active caller/callee runtimes to a narrowed delegated Run with durable evidence', async () => {
    const fixture = createFixture();
    let invocation: unknown;

    const result = await fixture.broker.invoke({
      callId: 'call_research_1',
      caller,
      callee,
      callerRuntime: fixture.callerRuntime,
      calleeRuntime: fixture.calleeRuntime,
      parentIntent: parentIntent(),
      childRunId: 'run_package_child',
      childTaskId: 'task_package_child',
      capability,
      purpose: 'Research primary sources only.',
      narrowedCapabilityGrant: [delegatedCapability],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
      invokeCallee: async (next) => {
        invocation = next;
        return { evidenceRefs: ['artifact:research-report'] };
      },
    });

    expect(invocation).toMatchObject({
      callId: 'call_research_1',
      caller,
      callee,
      capability,
      childRunId: 'run_package_child',
      capabilityGrant: [delegatedCapability],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });
    expect(result.parentReceipt.status).toBe('verified');
    expect(result.childReceipt).toMatchObject({
      status: 'verified',
      parentRunId: 'run_package_parent',
      evidenceRefs: ['artifact:research-report'],
    });
    expect(result.parentReceipt.evidenceRefs).toEqual(
      expect.arrayContaining([
        'package-call:call_research_1',
        `package-caller:${caller.packageId}@${caller.packageVersion}`,
        `package-callee:${callee.packageId}@${callee.packageVersion}`,
        `child-receipt:${result.childReceipt.receiptId}`,
      ])
    );
    expect(result.callerCapabilityReceipt.packageId).toBe(caller.packageId);
    expect(result.calleeCapabilityReceipt.packageId).toBe(callee.packageId);
    expect(fixture.kernel.resourceAdapter.getActiveLeases()).toEqual([]);
    expect(fixture.kernel.eventStore.getEventsByRunId('run_package_child')[0]).toMatchObject({
      eventType: 'run.created',
      payload: expect.objectContaining({ parentRunId: 'run_package_parent', surface: `package:${callee.packageId}` }),
    });
  });

  it('fails closed when the durable callee identity or runtime lease does not match the requested callee', async () => {
    const fixture = createFixture();
    fixture.identities.set(callee.packageId, { ...callee, packageVersion: '9.9.9' });
    let invoked = false;

    await expect(
      fixture.broker.invoke({
        callId: 'call_identity_rejected',
        caller,
        callee,
        callerRuntime: fixture.callerRuntime,
        calleeRuntime: fixture.calleeRuntime,
        parentIntent: parentIntent(),
        childRunId: 'run_package_identity_rejected',
        childTaskId: 'task_package_identity_rejected',
        capability,
        purpose: 'Research sources.',
        narrowedCapabilityGrant: [delegatedCapability],
        budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
        invokeCallee: async () => {
          invoked = true;
          return { evidenceRefs: [] };
        },
      })
    ).rejects.toMatchObject({ code: 'PACKAGE_CALL_IDENTITY_UNAVAILABLE' } as PackageCallBrokerError);
    expect(invoked).toBe(false);

    fixture.identities.set(callee.packageId, callee);
    await expect(
      fixture.broker.invoke({
        callId: 'call_runtime_rejected',
        caller,
        callee,
        callerRuntime: fixture.callerRuntime,
        calleeRuntime: fixture.callerRuntime,
        parentIntent: parentIntent(),
        childRunId: 'run_package_runtime_rejected',
        childTaskId: 'task_package_runtime_rejected',
        capability,
        purpose: 'Research sources.',
        narrowedCapabilityGrant: [delegatedCapability],
        budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
        invokeCallee: async () => ({ evidenceRefs: [] }),
      })
    ).rejects.toMatchObject({ code: 'PACKAGE_CALL_RUNTIME_UNAVAILABLE' } as PackageCallBrokerError);
  });

  it('rejects a grant or budget that could amplify the caller Run', async () => {
    const fixture = createFixture();
    let invoked = false;

    await expect(
      fixture.broker.invoke({
        callId: 'call_amplified_grant',
        caller,
        callee,
        callerRuntime: fixture.callerRuntime,
        calleeRuntime: fixture.calleeRuntime,
        parentIntent: parentIntent(),
        childRunId: 'run_package_amplified_grant',
        childTaskId: 'task_package_amplified_grant',
        capability,
        purpose: 'Research sources.',
        narrowedCapabilityGrant: [delegatedCapability, 'workspace.write'],
        budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
        invokeCallee: async () => {
          invoked = true;
          return { evidenceRefs: [] };
        },
      })
    ).rejects.toMatchObject({ code: 'PACKAGE_CALL_DELEGATION_INVALID' } as PackageCallBrokerError);
    expect(invoked).toBe(false);

    await expect(
      fixture.broker.invoke({
        callId: 'call_amplified_budget',
        caller,
        callee,
        callerRuntime: fixture.callerRuntime,
        calleeRuntime: fixture.calleeRuntime,
        parentIntent: parentIntent(),
        childRunId: 'run_package_amplified_budget',
        childTaskId: 'task_package_amplified_budget',
        capability,
        purpose: 'Research sources.',
        narrowedCapabilityGrant: [delegatedCapability],
        budget: { maxEstimatedCostMB: 512, maxSteps: 4 },
        invokeCallee: async () => ({ evidenceRefs: [] }),
      })
    ).rejects.toMatchObject({ code: 'PACKAGE_CALL_DELEGATION_INVALID' } as PackageCallBrokerError);
  });

  it('propagates cancellation through the callee and releases both Run resource leases before terminal receipts', async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const result = await fixture.broker.invoke({
      callId: 'call_cancelled',
      caller,
      callee,
      callerRuntime: fixture.callerRuntime,
      calleeRuntime: fixture.calleeRuntime,
      parentIntent: parentIntent({ runId: 'run_package_parent_cancelled' }),
      childRunId: 'run_package_child_cancelled',
      childTaskId: 'task_package_child_cancelled',
      capability,
      purpose: 'Research sources.',
      narrowedCapabilityGrant: [delegatedCapability],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
      signal: controller.signal,
      invokeCallee: async (next) => {
        receivedSignal = next.signal;
        controller.abort();
        return { evidenceRefs: ['artifact:cancelled-work'] };
      },
    });

    expect(receivedSignal).toBe(controller.signal);
    expect(result.childReceipt.status).toBe('cancelled');
    expect(result.parentReceipt.status).toBe('cancelled');
    expect(fixture.kernel.resourceAdapter.getActiveLeases()).toEqual([]);
    expect(fixture.kernel.eventStore.getEventsByRunId('run_package_child_cancelled').at(-1)?.eventType).toBe(
      'run.cancelled'
    );
    expect(fixture.kernel.eventStore.getEventsByRunId('run_package_parent_cancelled').at(-1)?.eventType).toBe(
      'run.cancelled'
    );
  });
});
