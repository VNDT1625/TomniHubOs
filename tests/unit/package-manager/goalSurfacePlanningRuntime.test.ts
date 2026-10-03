import { describe, expect, it, vi } from 'vitest';

import type { CapabilityQuery, PackageIdentity, PackageListing } from '@/common/packages';
import {
  createGoalSurfacePlanningRuntime,
  requiresPurchaseFromSignedOffer,
} from '@/process/resources/packageCapability/goalSurfacePlanningRuntime';

const hubIdentity: PackageIdentity = {
  packageId: 'com.tomni.hub',
  packageVersion: '1.0.0',
  publisherId: 'com.tomni',
};

const query: CapabilityQuery = {
  schemaVersion: 1,
  queryId: 'goal-create-app-workspace',
  requester: hubIdentity,
  capability: 'workspace.write',
  purpose: 'Create an app.',
  dataLocation: 'local-only',
  requireUi: true,
  requireOffline: false,
  idempotencyKey: 'goal-create-app-workspace-1',
};

const listing = (overrides: Partial<PackageListing> = {}): PackageListing => ({
  manifest: {
    schemaVersion: 1,
    id: 'com.tomni.ide',
    publisherId: 'com.tomni',
    name: 'IDE',
    description: 'Build apps.',
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=1.0.0' },
    modules: [{ id: 'ide', title: 'IDE', surface: 'apps/ide', pinnable: true }],
    permissions: [],
    dependencies: [],
    tags: ['code'],
    contributions: { version: 1, apps: [{ id: 'ide', title: 'IDE', moduleId: 'ide' }] },
    aiAccess: {
      schemaVersion: 1,
      operations: [
        {
          id: 'workspace.write-files',
          capability: 'workspace.write',
          inputSchemaVersion: 1,
          dataClasses: ['workspace'],
          destinationIds: ['local:ide'],
        },
      ],
    },
  },
  delivery: 'downloaded-package',
  trust: 'signed-store',
  publicationReview: {
    schemaVersion: 1,
    disposition: 'auto-approved',
    fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviewedAt: '2026-08-20T00:00:00.000Z',
  },
  state: 'available',
  updateAvailable: false,
  compatible: true,
  enabled: false,
  ...overrides,
});

const build = (storeListings: readonly PackageListing[]) => {
  const ensureStoreReady = vi.fn(async () => undefined);
  const store = { list: vi.fn(async () => storeListings) };
  const runtime = createGoalSurfacePlanningRuntime({
    hubIdentity,
    deriver: { derive: async () => [query] },
    store,
    ensureStoreReady,
    requiresPurchase: () => false,
    evaluatedAt: () => '2026-08-20T00:00:00.000Z',
  });
  return { runtime, store, ensureStoreReady };
};

describe('Goal Surface planning runtime', () => {
  it('reads only the ready Store catalog and selects an installed eligible Surface locally', async () => {
    const { runtime, store, ensureStoreReady } = build([
      listing({
        state: 'installed',
        enabled: true,
        installedManifest: listing().manifest,
        installedTrust: 'signed-store',
        installedPublicationReview: listing().publicationReview,
      }),
    ]);

    await expect(
      runtime.plan({ requestId: 'create-app-1', goal: 'Create an app.', requestedAt: '2026-08-20T00:00:00.000Z' })
    ).resolves.toMatchObject({
      steps: [{ kind: 'execute-local', candidate: { package: { packageId: 'com.tomni.ide' } } }],
    });
    expect(ensureStoreReady).toHaveBeenCalledOnce();
    expect(store.list).toHaveBeenCalledWith({ type: 'app' });
  });

  it('returns a deterministic proposal only for an available Surface and never mutates Store', async () => {
    const { runtime, store } = build([listing()]);

    const plan = await runtime.plan({
      requestId: 'create-app-2',
      goal: 'Create an app.',
      requestedAt: '2026-08-20T00:00:00.000Z',
    });

    expect(plan.steps).toMatchObject([
      { kind: 'propose-install', proposal: { proposalId: expect.stringMatching(/^surface-proposal-[a-f0-9]{24}$/) } },
    ]);
    expect(Object.keys(store)).toEqual(['list']);
  });

  it('marks a signed non-zero offer as purchase-required without trusting UI price text', async () => {
    const runtime = createGoalSurfacePlanningRuntime({
      hubIdentity,
      deriver: { derive: async () => [query] },
      store: {
        list: async () => [
          listing({
            offer: {
              schemaVersion: 1,
              offerId: 'offer-ide-1',
              productId: 'product-ide',
              package: { packageId: 'com.tomni.ide', packageVersion: '1.0.0', publisherId: 'com.tomni' },
              sellerKind: 'first-party',
              price: { currency: 'USD', amountMinor: 499 },
              taxTreatment: 'exclusive',
              revision: 'offer-revision-1',
              active: true,
            },
          }),
        ],
      },
      ensureStoreReady: async () => undefined,
    });

    const plan = await runtime.plan({
      requestId: 'create-app-paid-1',
      goal: 'Create an app.',
      requestedAt: '2026-08-20T00:00:00.000Z',
    });

    expect(plan.steps).toMatchObject([{ kind: 'propose-install', proposal: { requiresPurchase: true } }]);
    const [step] = plan.steps;
    if (step?.kind !== 'propose-install') throw new Error('Expected a Store install proposal.');
    expect(requiresPurchaseFromSignedOffer(step.proposal.candidate)).toBe(true);
  });

  it('fails before calling the model or Store when the Main Store readiness gate fails', async () => {
    const deriver = { derive: vi.fn(async () => [query]) };
    const store = { list: vi.fn(async () => [listing()]) };
    const runtime = createGoalSurfacePlanningRuntime({
      hubIdentity,
      deriver,
      store,
      ensureStoreReady: async () => {
        throw new Error('STORE_NOT_READY');
      },
      requiresPurchase: () => false,
    });

    await expect(
      runtime.plan({ requestId: 'create-app-3', goal: 'Create an app.', requestedAt: '2026-08-20T00:00:00.000Z' })
    ).rejects.toThrow('STORE_NOT_READY');
    expect(deriver.derive).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();
  });
});
