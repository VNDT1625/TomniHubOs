import type { PackageListing } from '@/common/packages';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/components/layout/Sider', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/HubHome/catalog', () => ({ HUB_APPS: [], parseRecentHubApps: () => [] }));
vi.mock('@/renderer/pages/manager/useManagerStore', () => ({ useManagerStore: () => ({}) }));
vi.mock('@/common/packages/studioCompatibility', () => ({
  createStudioCompatibilityLegacyFallbackDestination: () => '/',
  isStudioPackageGateNavigationState: () => false,
}));
vi.mock('@/renderer/pages/company/CompanyPage', () => ({ default: () => null }));
vi.mock('@/renderer/pages/hub/PackageAppHost', () => ({
  getFirstRunnablePackageModule: () => undefined,
  PackageAppHost: () => null,
}));
vi.mock('@/renderer/pages/hub/packageClient', () => ({ packageClient: {} }));
vi.mock('@/renderer/pages/hub/StoreProductDetail', () => ({ default: () => null }));
vi.mock('@/renderer/pages/hub/StoreProductDetail/permissionConsent', () => ({
  requestPackagePermissionUpdateConsent: () => Promise.resolve(undefined),
}));

const { orderStorePackageListings, requiresPaidStoreActivation } =
  await import('@/renderer/pages/hub/HubWorkspacePage');

const createListing = (id: string, name: string, state: PackageListing['state'] = 'available'): PackageListing => ({
  manifest: {
    schemaVersion: 1,
    id,
    publisherId: 'com.tomni',
    name,
    description: `${name} package`,
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=0.0.0' },
    modules: [
      {
        id: `${id}.surface`,
        title: `${name} Surface`,
        surface: `apps/${id}`,
        pinnable: true,
      },
    ],
    permissions: [],
    dependencies: [],
    tags: ['productivity'],
    artifact: {
      integrity: 'sha256-test',
      sizeBytes: 1,
      signature: { algorithm: 'ed25519', keyId: 'test', value: 'signature' },
    },
  },
  delivery: 'downloaded-package',
  trust: 'signed-first-party',
  state,
  compatible: true,
  updateAvailable: false,
  enabled: state === 'installed',
});

describe('Hub Store search ordering', () => {
  it('puts backend-selected installed matches first with a stable tie break', () => {
    const results = orderStorePackageListings([
      createListing('com.tomni.zeta', 'Task Builder', 'installed'),
      createListing('com.tomni.alpha', 'Task Board', 'available'),
      createListing('com.tomni.beta', 'Task Editor', 'installed'),
    ]);

    expect(results.map((listing) => listing.manifest.id)).toEqual([
      'com.tomni.beta',
      'com.tomni.zeta',
      'com.tomni.alpha',
    ]);
  });

  it('keeps installed packages first when browsing the catalog without a query', () => {
    const results = orderStorePackageListings([
      createListing('com.tomni.available', 'Available'),
      createListing('com.tomni.installed', 'Installed', 'installed'),
    ]);

    expect(results.map((listing) => listing.manifest.id)).toEqual(['com.tomni.installed', 'com.tomni.available']);
  });

  it('treats only a non-zero active signed offer as requiring checkout before activation', () => {
    const paid = createListing('com.tomni.paid', 'Paid app');
    paid.offer = {
      schemaVersion: 1,
      offerId: 'offer-paid',
      productId: 'product-paid',
      package: {
        packageId: paid.manifest.id,
        packageVersion: paid.manifest.version,
        publisherId: paid.manifest.publisherId,
      },
      sellerKind: 'first-party',
      price: { currency: 'USD', amountMinor: 499 },
      taxTreatment: 'exclusive',
      revision: 'offer-r1',
      active: true,
    };
    expect(requiresPaidStoreActivation(paid)).toBe(true);
    expect(requiresPaidStoreActivation({ ...paid, offer: { ...paid.offer, active: false } })).toBe(false);
    expect(
      requiresPaidStoreActivation({ ...paid, offer: { ...paid.offer, price: { currency: 'USD', amountMinor: 0 } } })
    ).toBe(false);
  });
});
