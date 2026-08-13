/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { CatalogAvailability } from '../../../../common/packages';
import {
  catalogDigest,
  createSerializedCatalogExecutor,
  fileExists,
  parseCatalogRevisionMarker,
  quarantineCatalogFile,
  readBoundedJson,
  writeJsonAtomically,
  type CatalogRevisionMarker,
} from './persistence';
import {
  CatalogFederationError,
  type CachedCatalogProviderItems,
  type CatalogFederationCache,
  type CatalogFederationCacheKey,
  type CatalogProviderItem,
} from './types';

const DEFAULT_MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_CONFIGURED_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;
const MAX_DISPLAY_LENGTH = 300;
const MAX_SUMMARY_LENGTH = 4_000;
const MAX_SOURCE_ID_LENGTH = 512;

export type DurableFederatedCatalogCacheOptions = {
  rootDir: string;
  maxCacheAgeMs?: number;
  now?: () => Date;
};

type DurableCacheDocument = CachedCatalogProviderItems & {
  schemaVersion: 1;
  key: CatalogFederationCacheKey;
  digest: string;
};

type CachePaths = {
  active: string;
  recovery: string;
  rollback: string;
  marker: string;
  quarantine: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });

const parseBoundedString = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || hasControlCharacters(value)) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', `${field} is invalid.`);
  }
  return value;
};

const parseOptionalHttpsUrl = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  const parsed = new URL(parseBoundedString(value, 'Cached catalog icon URL', 2_048));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog icon URL must be credential-free HTTPS.');
  }
  return parsed.toString();
};

const parseIsoDate = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', `${field} is invalid.`);
  }
  return value;
};

const parseCacheKey = (value: unknown): CatalogFederationCacheKey => {
  if (!isRecord(value)) throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache key is invalid.');
  if (value.source !== 'tomni-store' && value.source !== 'microsoft-store') {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache source is invalid.');
  }
  if (
    typeof value.query !== 'string' ||
    !value.query ||
    value.query.length > 200 ||
    hasControlCharacters(value.query) ||
    typeof value.region !== 'string' ||
    !/^[A-Z]{2}$/.test(value.region) ||
    typeof value.limit !== 'number' ||
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > 50
  ) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache request identity is invalid.');
  }
  return { source: value.source, query: value.query, region: value.region, limit: value.limit };
};

const cacheKeysMatch = (left: CatalogFederationCacheKey, right: CatalogFederationCacheKey): boolean =>
  left.source === right.source &&
  left.query === right.query &&
  left.region === right.region &&
  left.limit === right.limit;

const parseAvailability = (value: unknown): CatalogAvailability => {
  if (!['available', 'installed', 'unavailable', 'unknown'].includes(String(value))) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog availability is invalid.');
  }
  return value as CatalogAvailability;
};

const parseProviderItem = (value: unknown, key: CatalogFederationCacheKey, nowMs: number): CatalogProviderItem => {
  if (!isRecord(value) || !isRecord(value.display) || !isRecord(value.offer)) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog item is invalid.');
  }
  const display = value.display;
  const offer = value.offer;
  if (offer.source !== key.source) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog item has mismatched source provenance.');
  }
  const sourceItemId = parseBoundedString(offer.sourceItemId, 'Cached catalog source item ID', MAX_SOURCE_ID_LENGTH);
  if (!isRecord(offer.provenance)) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog provenance is missing.');
  }
  const method = offer.provenance.method;
  const validMethod =
    (key.source === 'tomni-store' && method === 'api') ||
    (key.source === 'microsoft-store' && (method === 'api' || method === 'winget-msstore'));
  if (!validMethod) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog provenance method is invalid.');
  }
  const lastSeenAt = parseIsoDate(offer.lastSeenAt, 'Cached catalog last-seen time');
  if (Date.parse(lastSeenAt) > nowMs + MAX_CLOCK_SKEW_MS || offer.region !== key.region) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog observation context is invalid.');
  }

  let price: CatalogProviderItem['offer']['price'];
  if (offer.price !== undefined) {
    if (
      !isRecord(offer.price) ||
      typeof offer.price.amount !== 'number' ||
      !Number.isFinite(offer.price.amount) ||
      offer.price.amount < 0 ||
      typeof offer.price.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(offer.price.currency)
    ) {
      throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog price is invalid.');
    }
    price = { amount: offer.price.amount, currency: offer.price.currency };
  }

  let rating: CatalogProviderItem['offer']['rating'];
  if (offer.rating !== undefined) {
    if (
      !isRecord(offer.rating) ||
      typeof offer.rating.value !== 'number' ||
      !Number.isFinite(offer.rating.value) ||
      offer.rating.value < 0 ||
      offer.rating.value > 5 ||
      (offer.rating.count !== undefined &&
        (typeof offer.rating.count !== 'number' || !Number.isSafeInteger(offer.rating.count) || offer.rating.count < 0))
    ) {
      throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog rating is invalid.');
    }
    rating = {
      value: offer.rating.value,
      ...(typeof offer.rating.count === 'number' ? { count: offer.rating.count } : {}),
    };
  }

  let trustSignal: CatalogProviderItem['offer']['trustSignal'];
  if (offer.trustSignal !== undefined) {
    if (!isRecord(offer.trustSignal)) {
      throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog trust signal is invalid.');
    }
    if (key.source === 'tomni-store' && offer.trustSignal.kind === 'tomni-review') {
      trustSignal = {
        kind: 'tomni-review',
        tier: parseBoundedString(offer.trustSignal.tier, 'Cached catalog review tier', 100),
      };
    } else if (key.source === 'microsoft-store' && offer.trustSignal.kind === 'microsoft-certification') {
      trustSignal = {
        kind: 'microsoft-certification',
        ...(offer.trustSignal.publisher !== undefined
          ? { publisher: parseBoundedString(offer.trustSignal.publisher, 'Cached catalog publisher', 500) }
          : {}),
      };
    } else {
      throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Cached catalog trust signal mismatches its source.');
    }
  }

  const iconUrl = parseOptionalHttpsUrl(display.iconUrl);
  return {
    display: {
      name: parseBoundedString(display.name, 'Cached catalog display name', MAX_DISPLAY_LENGTH),
      ...(display.summary !== undefined
        ? { summary: parseBoundedString(display.summary, 'Cached catalog summary', MAX_SUMMARY_LENGTH) }
        : {}),
      ...(iconUrl ? { iconUrl } : {}),
    },
    offer: {
      source: key.source,
      sourceItemId,
      provenance: {
        method,
        ...(offer.provenance.revision !== undefined
          ? {
              revision: parseBoundedString(offer.provenance.revision, 'Cached catalog provenance revision', 200),
            }
          : {}),
      },
      lastSeenAt,
      region: key.region,
      ...(offer.version !== undefined
        ? { version: parseBoundedString(offer.version, 'Cached catalog version', 200) }
        : {}),
      ...(price ? { price } : {}),
      ...(rating ? { rating } : {}),
      availability: parseAvailability(offer.availability),
      ...(trustSignal ? { trustSignal } : {}),
    },
  };
};

const documentPayload = (document: Omit<DurableCacheDocument, 'digest'>): Omit<DurableCacheDocument, 'digest'> =>
  document;

const parseDocument = (
  value: unknown,
  expectedKey: CatalogFederationCacheKey,
  maxCacheAgeMs: number,
  now: Date
): DurableCacheDocument => {
  if (!isRecord(value)) throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache is invalid.');
  const key = parseCacheKey(value.key);
  if (!cacheKeysMatch(key, expectedKey)) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache belongs to another request.');
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.digest !== 'string' ||
    !Array.isArray(value.items) ||
    value.items.length > key.limit
  ) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache envelope is invalid.');
  }
  const issuedAt = parseIsoDate(value.issuedAt, 'Catalog cache issue time');
  const expiresAt = parseIsoDate(value.expiresAt, 'Catalog cache expiry time');
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (issuedMs > now.getTime() + MAX_CLOCK_SKEW_MS || expiresMs <= issuedMs || expiresMs - issuedMs > maxCacheAgeMs) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache validity window is invalid.');
  }
  const items = value.items.map((item) => parseProviderItem(item, key, now.getTime()));
  const unsigned = {
    schemaVersion: 1 as const,
    key,
    revision: value.revision,
    issuedAt,
    expiresAt,
    items,
  };
  if (value.digest !== catalogDigest(documentPayload(unsigned))) {
    throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache digest does not match its contents.');
  }
  return { ...unsigned, digest: value.digest };
};

const cachePaths = (rootDir: string, key: CatalogFederationCacheKey): CachePaths => {
  const identity = createHash('sha256').update(JSON.stringify(key)).digest('hex');
  const directory = path.join(rootDir, identity.slice(0, 2), identity);
  return {
    active: path.join(directory, 'active.json'),
    recovery: path.join(directory, 'recovery.json'),
    rollback: path.join(directory, 'rollback.json'),
    marker: path.join(directory, 'marker.json'),
    quarantine: path.join(directory, 'quarantine'),
  };
};

const validateConfiguredAge = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 60_000 || value > MAX_CONFIGURED_CACHE_AGE_MS) {
    throw new Error('Federated catalog cache age must be between one minute and seven days.');
  }
  return value;
};

export const createDurableFederatedCatalogCache = ({
  rootDir,
  maxCacheAgeMs = DEFAULT_MAX_CACHE_AGE_MS,
  now = () => new Date(),
}: DurableFederatedCatalogCacheOptions): CatalogFederationCache => {
  if (!path.isAbsolute(rootDir)) throw new Error('Federated catalog cache directory must be absolute.');
  const boundedMaxAge = validateConfiguredAge(maxCacheAgeMs);
  const serialize = createSerializedCatalogExecutor();

  const readMarker = async (paths: CachePaths): Promise<CatalogRevisionMarker | undefined> => {
    if (!(await fileExists(paths.marker))) return undefined;
    try {
      return parseCatalogRevisionMarker(await readBoundedJson(paths.marker, 16 * 1_024));
    } catch (error) {
      await quarantineCatalogFile(paths.marker, paths.quarantine, now());
      throw new CatalogFederationError('CATALOG_CACHE_CORRUPT', 'Catalog cache revision marker is corrupt.', {
        cause: error,
      });
    }
  };

  const load = (key: CatalogFederationCacheKey): Promise<CachedCatalogProviderItems | undefined> =>
    serialize(async () => {
      const parsedKey = parseCacheKey(key);
      const paths = cachePaths(rootDir, parsedKey);
      const marker = await readMarker(paths);
      if (!marker) {
        const orphaned = await Promise.all(
          [paths.active, paths.recovery, paths.rollback].map((candidate) => fileExists(candidate))
        );
        if (orphaned.some(Boolean)) {
          await Promise.all(
            [paths.active, paths.recovery, paths.rollback].map((candidate) =>
              quarantineCatalogFile(candidate, paths.quarantine, now())
            )
          );
          throw new CatalogFederationError(
            'CATALOG_CACHE_CORRUPT',
            'Catalog cache data exists without an anti-rollback marker.'
          );
        }
        return undefined;
      }

      let foundExpired = false;
      for (const candidate of [paths.active, paths.recovery, paths.rollback]) {
        if (!(await fileExists(candidate))) continue;
        let document: DurableCacheDocument;
        try {
          document = parseDocument(await readBoundedJson(candidate, MAX_CACHE_BYTES), parsedKey, boundedMaxAge, now());
        } catch {
          await quarantineCatalogFile(candidate, paths.quarantine, now());
          continue;
        }
        if (document.revision !== marker.revision || document.digest !== marker.digest) continue;
        if (now().getTime() > Date.parse(document.expiresAt)) {
          foundExpired = true;
          continue;
        }
        if (candidate !== paths.active) await writeJsonAtomically(paths.active, document);
        return {
          revision: document.revision,
          issuedAt: document.issuedAt,
          expiresAt: document.expiresAt,
          items: structuredClone(document.items),
        };
      }
      if (foundExpired) return undefined;
      throw new CatalogFederationError(
        'CATALOG_CACHE_ROLLBACK',
        'No catalog cache snapshot matches the highest committed revision.'
      );
    });

  const store = (key: CatalogFederationCacheKey, items: readonly CatalogProviderItem[]): Promise<void> =>
    serialize(async () => {
      const parsedKey = parseCacheKey(key);
      const timestamp = now();
      const paths = cachePaths(rootDir, parsedKey);
      const marker = await readMarker(paths);
      const revision = (marker?.revision ?? 0) + 1;
      const issuedAt = timestamp.toISOString();
      const expiresAt = new Date(timestamp.getTime() + boundedMaxAge).toISOString();
      const parsedItems = items.map((item) => parseProviderItem(item, parsedKey, timestamp.getTime()));
      if (parsedItems.length > parsedKey.limit) {
        throw new CatalogFederationError('CATALOG_REQUEST_INVALID', 'Catalog provider exceeded the requested limit.');
      }
      const unsigned = {
        schemaVersion: 1 as const,
        key: parsedKey,
        revision,
        issuedAt,
        expiresAt,
        items: parsedItems,
      };
      const document: DurableCacheDocument = { ...unsigned, digest: catalogDigest(documentPayload(unsigned)) };

      if (marker && (await fileExists(paths.active))) {
        try {
          const current = parseDocument(
            await readBoundedJson(paths.active, MAX_CACHE_BYTES),
            parsedKey,
            boundedMaxAge,
            timestamp
          );
          if (current.revision === marker.revision && current.digest === marker.digest) {
            await writeJsonAtomically(paths.rollback, current);
          }
        } catch {
          await quarantineCatalogFile(paths.active, paths.quarantine, timestamp);
        }
      }
      await writeJsonAtomically(paths.active, document);
      await writeJsonAtomically(paths.recovery, document);
      await writeJsonAtomically(paths.marker, {
        schemaVersion: 1,
        revision,
        digest: document.digest,
        committedAt: issuedAt,
      } satisfies CatalogRevisionMarker);
    });

  return { load, store };
};
