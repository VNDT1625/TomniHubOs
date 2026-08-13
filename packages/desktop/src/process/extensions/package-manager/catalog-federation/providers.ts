/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CatalogAvailability, LinkedMicrosoftAppRecord, PackageListing } from '../../../../common/packages';
import type { PackageManagerService } from '../PackageManagerService';
import { CatalogFederationError, type CatalogProvider, type WindowsMicrosoftStoreAdapter } from './types';
import { normalizeProductId, parseLinkedMicrosoftAppRecord } from './validation';

const availabilityForPackage = (listing: PackageListing): CatalogAvailability => {
  if (listing.state === 'installed') return 'installed';
  if (listing.state === 'quarantined') return 'unavailable';
  if (listing.state === 'failed') return 'unknown';
  return 'available';
};

export const createTomniCatalogProvider = (
  service: PackageManagerService,
  now: () => Date = () => new Date()
): CatalogProvider => ({
  source: 'tomni-store',
  search: async (request) =>
    (await service.search({ query: request.query })).slice(0, request.limit).map((listing) => ({
      display: {
        name: listing.manifest.name,
        ...(listing.manifest.description ? { summary: listing.manifest.description } : {}),
      },
      offer: {
        source: 'tomni-store',
        sourceItemId: listing.manifest.id,
        provenance: { method: 'api' },
        lastSeenAt: now().toISOString(),
        region: request.region,
        version: listing.manifest.version,
        availability: availabilityForPackage(listing),
        trustSignal: { kind: 'tomni-review', tier: listing.trust },
      },
    })),
  install: async (sourceItemId) => {
    const listing = await service.install(sourceItemId);
    if (listing.state !== 'installed' || !listing.installedVersion) {
      throw new CatalogFederationError('CATALOG_SOURCE_UNAVAILABLE', 'Tomni package install did not become active.');
    }
    return {
      provider: 'tomni-package-manager',
      status: 'completed',
      verification: 'verified',
      installedVersion: listing.installedVersion,
    };
  },
  uninstall: async (sourceItemId) => {
    const listing = await service.uninstall(sourceItemId);
    if (listing.state !== 'available') {
      throw new CatalogFederationError(
        'CATALOG_SOURCE_UNAVAILABLE',
        'Tomni package uninstall did not become available.'
      );
    }
    return {
      provider: 'tomni-package-manager',
      status: 'completed',
      verification: 'verified',
    };
  },
  enable: async (sourceItemId) => {
    const listing = await service.enable(sourceItemId);
    if (listing.state !== 'installed' || !listing.enabled || !listing.installedVersion) {
      throw new CatalogFederationError('CATALOG_SOURCE_UNAVAILABLE', 'Tomni package enable did not become active.');
    }
    return {
      provider: 'tomni-package-manager',
      status: 'completed',
      verification: 'verified',
      installedVersion: listing.installedVersion,
    };
  },
  disable: async (sourceItemId) => {
    const listing = await service.disable(sourceItemId);
    if (listing.state !== 'installed' || listing.enabled) {
      throw new CatalogFederationError('CATALOG_SOURCE_UNAVAILABLE', 'Tomni package disable did not become inactive.');
    }
    return {
      provider: 'tomni-package-manager',
      status: 'completed',
      verification: 'verified',
      installedVersion: listing.installedVersion,
    };
  },
  rollback: async (sourceItemId) => {
    const listing = await service.rollback(sourceItemId);
    if (listing.state !== 'installed' || !listing.installedVersion) {
      throw new CatalogFederationError(
        'CATALOG_SOURCE_UNAVAILABLE',
        'Tomni package rollback did not restore an installed version.'
      );
    }
    return {
      provider: 'tomni-package-manager',
      status: 'completed',
      verification: 'verified',
      installedVersion: listing.installedVersion,
    };
  },
  reconcile: async ({ authorization }) => {
    if (
      authorization.action !== 'install' &&
      authorization.action !== 'uninstall' &&
      authorization.action !== 'enable' &&
      authorization.action !== 'disable' &&
      authorization.action !== 'rollback'
    ) {
      return { state: 'unknown' };
    }
    // A rollback has no target revision in the durable authorization record, so current installation state
    // cannot prove that the interrupted mutation actually restored the previous version.
    if (authorization.action === 'rollback') return { state: 'unknown' };
    const listing = await service.status(authorization.sourceItemId);
    if (authorization.action === 'install' || authorization.action === 'enable') {
      if (listing.state !== 'installed' || !listing.installedVersion) return { state: 'not-satisfied' };
      return {
        state: 'satisfied',
        result: {
          provider: 'tomni-package-manager',
          status: 'completed',
          verification: 'verified',
          installedVersion: listing.installedVersion,
        },
      };
    }
    if (authorization.action === 'disable') {
      if (listing.state !== 'installed' || listing.enabled) return { state: 'not-satisfied' };
    } else if (listing.state !== 'available') return { state: 'not-satisfied' };
    return {
      state: 'satisfied',
      result: {
        provider: 'tomni-package-manager',
        status: 'completed',
        verification: 'verified',
      },
    };
  },
});

export const createMicrosoftStoreCatalogProvider = (
  adapter: WindowsMicrosoftStoreAdapter,
  linkedApps: readonly LinkedMicrosoftAppRecord[] = [],
  now: () => Date = () => new Date()
): CatalogProvider => {
  const links = new Map(
    linkedApps.map((record) => {
      const parsed = parseLinkedMicrosoftAppRecord(record);
      return [parsed.microsoft.productId, parsed] as const;
    })
  );
  return {
    source: 'microsoft-store',
    search: async (request) =>
      (await adapter.search(request.query, request.limit ?? 20)).map((hit) => {
        const link = links.get(normalizeProductId(hit.productId));
        return {
          display: { name: hit.name },
          offer: {
            source: 'microsoft-store',
            sourceItemId: normalizeProductId(hit.productId),
            provenance: { method: 'winget-msstore' },
            lastSeenAt: now().toISOString(),
            region: request.region,
            ...(hit.version ? { version: hit.version } : {}),
            availability: 'available',
            trustSignal: {
              kind: 'microsoft-certification',
              ...(link ? { publisher: link.microsoft.publisherIdentity } : {}),
            },
          },
        };
      }),
    // This adapter deliberately has no installed-state probe; recovery must never rerun an external action.
    reconcile: async () => ({ state: 'unknown' }),
    install: async (sourceItemId, region) => {
      const productId = normalizeProductId(sourceItemId);
      const link = links.get(productId);
      if (!link) {
        await adapter.openStoreProduct(productId);
        return {
          provider: 'store-uri',
          status: 'delegated-to-store',
          verification: 'not-applicable',
        };
      }
      const identity = await adapter.installLinked(link, region);
      return {
        provider: 'winget-msstore',
        status: 'completed',
        verification: 'verified',
        installedVersion: identity.version,
      };
    },
    launch: async (sourceItemId, region) => {
      const productId = normalizeProductId(sourceItemId);
      const link = links.get(productId);
      if (!link) {
        throw new CatalogFederationError(
          'CATALOG_ACTION_UNSUPPORTED',
          'Microsoft app has no reviewed Linked App record.'
        );
      }
      const identity = await adapter.launchLinked(link, region);
      return {
        provider: 'store-uri',
        status: 'completed',
        verification: 'verified',
        installedVersion: identity.version,
      };
    },
    openStorePage: async (sourceItemId) => {
      await adapter.openStoreProduct(sourceItemId);
      return {
        provider: 'store-uri',
        status: 'delegated-to-store',
        verification: 'not-applicable',
      };
    },
  };
};
