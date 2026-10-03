import { describe, expect, it } from 'vitest';

import { resolveCapability, type CapabilityQuery, type PackageListing } from '@/common/packages';
import { createStoreSurfaceCandidateProvider } from '@/process/resources/packageCapability/storeSurfaceCandidateProvider';

const query: CapabilityQuery = {
  schemaVersion: 1,
  queryId: 'query_create_app',
  requester: { packageId: 'com.tomni.hub', packageVersion: '1.0.0', publisherId: 'com.tomni' },
  capability: 'workspace.write',
  purpose: 'Create an app.',
  dataLocation: 'local-only',
  requireUi: true,
  requireOffline: false,
  idempotencyKey: 'query_create_app_1',
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

describe('Store Surface candidate provider', () => {
  it('lets the shared resolver choose a reviewed enabled local Surface before an equivalent Store install candidate', async () => {
    const provider = createStoreSurfaceCandidateProvider({
      list: async () => [
        listing(),
        listing({ manifest: { ...listing().manifest, id: 'com.tomni.ide-local' }, state: 'installed', enabled: true }),
      ],
    });

    const candidates = await provider.collect(query);

    expect(resolveCapability(query, candidates).selectedCandidateId).toBe(
      'surface:com.tomni.ide-local:1.0.0:workspace.write-files'
    );
  });

  it('does not make an unreviewed, revoked, or disabled Surface executable', async () => {
    const provider = createStoreSurfaceCandidateProvider({
      list: async () => [
        listing({ publicationReview: undefined }),
        listing({ revoked: true }),
        listing({ state: 'installed' }),
      ],
    });

    const candidates = await provider.collect(query);

    expect(candidates.map((candidate) => candidate.state)).toEqual(['unavailable', 'unavailable', 'unavailable']);
    expect(candidates.flatMap((candidate) => candidate.reasonCodes)).toEqual(
      expect.arrayContaining(['STORE_REVIEW_REQUIRED', 'STORE_REVOKED', 'PACKAGE_DISABLED'])
    );
  });

  it('does not treat a package without exactly one declared Surface as AI-eligible', async () => {
    const provider = createStoreSurfaceCandidateProvider({
      list: async () => [listing({ manifest: { ...listing().manifest, contributions: undefined } })],
    });

    const [candidate] = await provider.collect(query);

    expect(candidate).toMatchObject({
      state: 'unavailable',
      reasonCodes: expect.arrayContaining(['SURFACE_CONTRIBUTION_REQUIRED']),
    });
  });

  it('carries an exact signed Store offer as proposal data without making it executable or entitled', async () => {
    const offer = {
      schemaVersion: 1 as const,
      offerId: 'offer-ide-1',
      productId: 'product-ide',
      package: { packageId: 'com.tomni.ide', packageVersion: '1.0.0', publisherId: 'com.tomni' },
      sellerKind: 'first-party' as const,
      price: { currency: 'USD', amountMinor: 499 },
      taxTreatment: 'exclusive' as const,
      revision: 'offer-revision-1',
      active: true,
    };
    const provider = createStoreSurfaceCandidateProvider({ list: async () => [listing({ offer })] });

    const [candidate] = await provider.collect(query);

    expect(candidate).toMatchObject({ state: 'installable', offer });
  });

  it('binds an installed candidate to its installed identity and review, not a newer catalog entry', async () => {
    const installedManifest = { ...listing().manifest, version: '1.0.0' };
    const newerCatalogManifest = { ...listing().manifest, version: '2.0.0', aiAccess: undefined };
    const provider = createStoreSurfaceCandidateProvider({
      list: async () => [
        listing({
          manifest: newerCatalogManifest,
          state: 'installed',
          enabled: true,
          installedVersion: '1.0.0',
          installedManifest,
          installedTrust: 'signed-store',
          installedPublicationReview: listing().publicationReview,
        }),
      ],
    });

    const resolution = resolveCapability(query, await provider.collect(query));

    expect(resolution.selectedCandidateId).toBe('surface:com.tomni.ide:1.0.0:workspace.write-files');
  });
});
