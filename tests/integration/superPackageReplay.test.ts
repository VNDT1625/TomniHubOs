import { describe, expect, it } from 'vitest';

import { PACKAGE_CAPABILITY_ABI_VERSION, parseCommerceOrderLifecycle } from '@/common/packages';
import type { RunIntent } from '@/common/foundation/runTypes';
import { HubExecutionAdapter, type HubTargetKind } from '@/process/foundation/hubExecutionAdapter';
import { RunKernel } from '@/process/foundation/runKernel';
import { TrustBroker } from '@/process/foundation/trustBroker';
import { createPackageCapabilityBroker } from '@/process/resources/packageCapability/broker';

const FIXTURE_PACKAGE = {
  id: 'com.tomni.private-research',
  permissions: ['host.ipc'],
} as const;

type PrivateReplayCheckpoint = Readonly<{
  completedStepIds: readonly string[];
  priorFailureLesson: Readonly<{
    code: 'POSTING_CLOSED';
    evidenceRef: string;
    requiredAction: 'skip-application';
  }>;
}>;

type PrivateSuperPackageFixture = Readonly<{
  recordPriorFailure: () => Promise<Awaited<ReturnType<HubExecutionAdapter['execute']>>>;
  replay: () => Promise<Awaited<ReturnType<HubExecutionAdapter['execute']>>>;
  packageInvocationCount: () => number;
  checkpoint: () => PrivateReplayCheckpoint | undefined;
  eventsFor: (runId: string) => readonly string[];
}>;

const paidCommerceLifecycle = () => {
  const packageIdentity = {
    packageId: FIXTURE_PACKAGE.id,
    packageVersion: '1.0.0',
    publisherId: 'com.tomni',
  };
  const offer = {
    schemaVersion: 1,
    offerId: 'offer_private_research',
    productId: 'product_private_research',
    package: packageIdentity,
    sellerKind: 'first-party',
    price: { currency: 'USD', amountMinor: 500 },
    taxTreatment: 'exclusive',
    revision: 'rev_1',
    active: true,
  } as const;
  const order = {
    schemaVersion: 1,
    orderId: 'order_private_research',
    accountId: 'account_private',
    offer,
    state: 'paid',
    idempotencyKey: 'order_private_research_create',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:02:00.000Z',
  } as const;
  const authorized = {
    schemaVersion: 1,
    paymentEventId: 'payment_private_authorized',
    orderId: order.orderId,
    providerEventId: 'provider_private_authorized',
    kind: 'authorized',
    amount: offer.price,
    idempotencyKey: 'payment_private_authorized',
    occurredAt: '2026-08-14T00:01:00.000Z',
  } as const;
  const captured = {
    ...authorized,
    paymentEventId: 'payment_private_captured',
    providerEventId: 'provider_private_captured',
    kind: 'captured',
    idempotencyKey: 'payment_private_captured',
    occurredAt: '2026-08-14T00:02:00.000Z',
  } as const;
  const entitlement = {
    schemaVersion: 1,
    entitlementId: 'entitlement_private_research',
    accountId: order.accountId,
    offerId: offer.offerId,
    package: packageIdentity,
    state: 'active',
    issuedAt: captured.occurredAt,
  } as const;
  return {
    order,
    paymentEvents: [authorized, captured],
    refunds: [],
    entitlement,
    activeGrant: {
      schemaVersion: 1,
      grantId: 'grant_private_research',
      accountId: order.accountId,
      offerId: offer.offerId,
      package: packageIdentity,
      entitlementId: entitlement.entitlementId,
      policyVersion: 'store_v1',
      expiresAt: '2026-09-14T00:00:00.000Z',
    },
  } as const;
};

const fixtureIntent = (runId: string, goal: string): RunIntent => ({
  runId,
  rootTaskId: `${runId}:task`,
  surface: 'private-super-package',
  goal,
  constraints: ['safe_only'],
  successCriteria: ['replay receives a governed receipt'],
  workspaceScope: 'C:/private-workspace',
  userId: 'account_private',
  createdAt: 1,
  correlationId: `${runId}:correlation`,
  policyVersion: 'super-package-v1',
  capabilityGrant: ['target.execute', 'workspace.read'],
  budget: { maxEstimatedCostMB: 64, maxSteps: 2 },
});

const createPrivateSuperPackageReplayFixture = (
  options: {
    trustBroker?: TrustBroker;
    commerce?: unknown;
  } = {}
): PrivateSuperPackageFixture => {
  const kernel = new RunKernel();
  const trustBroker =
    options.trustBroker ??
    new TrustBroker(
      {
        allowedCapabilities: ['target.execute', 'workspace.read'],
        allowedNetworkHosts: ['research.private.example'],
        allowedOrigins: ['app://private-super-package'],
      },
      { now: () => Date.UTC(2026, 7, 14) }
    );
  const commerce = options.commerce ?? paidCommerceLifecycle();
  let sequence = 0;
  let packageInvocations = 0;
  let replayCheckpoint: PrivateReplayCheckpoint | undefined;
  const packageBroker = createPackageCapabilityBroker({
    isPackageActive: (packageId) => packageId === FIXTURE_PACKAGE.id,
    now: () => Date.UTC(2026, 7, 14),
    createId: () => `private-package-${++sequence}`,
  });

  const execute = async (
    runId: string,
    targetId: string,
    kind: HubTargetKind,
    invokePackage: boolean,
    goal: string
  ): Promise<Awaited<ReturnType<HubExecutionAdapter['execute']>>> => {
    const hub = new HubExecutionAdapter(
      kernel,
      [
        {
          id: targetId,
          kind,
          priority: 1,
          estimatedCostMB: 64,
          requestedCapabilities: ['workspace.read'],
          networkHost: kind === 'cloud' ? 'research.private.example' : undefined,
          execute: async () => {
            if (!invokePackage) {
              return {
                text: 'prior failure lesson: posting closed; application skipped',
                evidenceRefs: ['checkpoint:private-super-package', 'lesson:POSTING_CLOSED'],
              };
            }

            const lifecycle = parseCommerceOrderLifecycle(commerce);
            if (
              lifecycle.order.state !== 'paid' ||
              lifecycle.entitlement?.state !== 'active' ||
              lifecycle.activeGrant === undefined
            ) {
              throw new Error('PAID_PACKAGE_ACTIVATION_REQUIRED');
            }

            const lease = packageBroker.activate(FIXTURE_PACKAGE, {
              version: PACKAGE_CAPABILITY_ABI_VERSION,
              packageId: FIXTURE_PACKAGE.id,
              runtimeId: 'private-super-package-runtime',
              capability: 'host.runtime.info',
            });
            const syscall = packageBroker.invoke({
              version: PACKAGE_CAPABILITY_ABI_VERSION,
              leaseId: lease.leaseId,
              packageId: FIXTURE_PACKAGE.id,
              runtimeId: 'private-super-package-runtime',
              name: 'host.runtime.info',
            });
            if (!syscall.ok) throw new Error(syscall.code);
            packageInvocations += 1;
            return {
              text: 'research found posting closed',
              evidenceRefs: [`package:${syscall.receipt.receiptId}`, 'research:posting-closed'],
            };
          },
        },
      ],
      { trustBroker, origin: 'app://private-super-package' }
    );
    return hub.execute(fixtureIntent(runId, goal));
  };

  return {
    recordPriorFailure: async () => {
      const result = await execute(
        'super-package-prior-failure',
        'private-research-cloud',
        'cloud',
        true,
        'Check the application posting before opening the profile package.'
      );
      if (result.receipt.status === 'verified') {
        replayCheckpoint = {
          completedStepIds: ['research-posting'],
          priorFailureLesson: {
            code: 'POSTING_CLOSED',
            evidenceRef: 'research:posting-closed',
            requiredAction: 'skip-application',
          },
        };
      }
      return result;
    },
    replay: async () => {
      if (replayCheckpoint === undefined || !replayCheckpoint.completedStepIds.includes('research-posting')) {
        throw new Error('PRIVATE_SUPER_PACKAGE_CHECKPOINT_REQUIRED');
      }
      if (replayCheckpoint.priorFailureLesson.requiredAction !== 'skip-application') {
        throw new Error('PRIVATE_SUPER_PACKAGE_LESSON_REQUIRED');
      }
      return execute(
        'super-package-replay',
        'private-replay-decision',
        'local',
        false,
        'Replay the verified private workflow without re-applying to a closed posting.'
      );
    },
    packageInvocationCount: () => packageInvocations,
    checkpoint: () => replayCheckpoint,
    eventsFor: (runId) => kernel.eventStore.getEventsByRunId(runId).map((event) => event.eventType),
  };
};

describe('private Super Package replay fixture', () => {
  it('replays a checkpointed graph with a prior failure lesson through Run, Trust, package, and ordinary-payment seams', async () => {
    const fixture = createPrivateSuperPackageReplayFixture();

    const priorFailure = await fixture.recordPriorFailure();
    const replay = await fixture.replay();

    expect(priorFailure).toMatchObject({
      targetId: 'private-research-cloud',
      receipt: { status: 'verified', evidenceRefs: expect.arrayContaining(['research:posting-closed']) },
    });
    expect(fixture.checkpoint()).toEqual({
      completedStepIds: ['research-posting'],
      priorFailureLesson: {
        code: 'POSTING_CLOSED',
        evidenceRef: 'research:posting-closed',
        requiredAction: 'skip-application',
      },
    });
    expect(replay).toMatchObject({
      targetId: 'private-replay-decision',
      text: 'prior failure lesson: posting closed; application skipped',
      receipt: {
        status: 'verified',
        evidenceRefs: ['checkpoint:private-super-package', 'lesson:POSTING_CLOSED'],
      },
    });
    expect(fixture.packageInvocationCount()).toBe(1);
    expect(fixture.eventsFor('super-package-prior-failure')).toContain('outcome.verified');
    expect(fixture.eventsFor('super-package-replay')).toContain('outcome.verified');
  });

  it('does not reach the package when Trust denies the cloud target or commercial evidence is invalid', async () => {
    const trustDenied = createPrivateSuperPackageReplayFixture({
      trustBroker: new TrustBroker({
        allowedCapabilities: ['target.execute', 'workspace.read'],
        allowedNetworkHosts: ['research.private.example'],
        allowedOrigins: [],
      }),
    });
    const denied = await trustDenied.recordPriorFailure();

    expect(denied.receipt.status).not.toBe('verified');
    expect(trustDenied.packageInvocationCount()).toBe(0);
    expect(trustDenied.checkpoint()).toBeUndefined();

    const invalidCommerce = paidCommerceLifecycle();
    const commerceDenied = createPrivateSuperPackageReplayFixture({
      commerce: {
        ...invalidCommerce,
        activeGrant: { ...invalidCommerce.activeGrant, accountId: 'another-account' },
      },
    });
    const unlicensed = await commerceDenied.recordPriorFailure();

    expect(unlicensed.receipt.status).not.toBe('verified');
    expect(commerceDenied.packageInvocationCount()).toBe(0);
    expect(commerceDenied.checkpoint()).toBeUndefined();
  });
});
