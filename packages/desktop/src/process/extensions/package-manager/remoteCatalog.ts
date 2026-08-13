/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPrivateKey, createPublicKey, sign as signBytes, verify } from 'node:crypto';
import path from 'node:path';
import semver from 'semver';
import {
  parsePackageManifest,
  type PackageCatalogEntry,
  type PackageManifest,
  type PackageSigningKeyPolicy,
  type PackageTrust,
} from '../../../common/packages';
import { verifyArtifactSignature } from './artifactSecurity';
import {
  canonicalizeCatalogValue,
  catalogDigest,
  createSerializedCatalogExecutor,
  fileExists,
  parseCatalogRevisionMarker,
  quarantineCatalogFile,
  readBoundedJson,
  writeJsonAtomically,
  type CatalogRevisionMarker,
} from './catalog-federation/persistence';

const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_CATALOG_PACKAGES = 2_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_CATALOG_VALIDITY_MS = 31 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_CONFIGURED_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export type RemotePackageCatalogDocument = {
  schemaVersion: 1;
  revision: number;
  issuedAt: string;
  expiresAt: string;
  packages: PackageCatalogEntry[];
  signature: {
    algorithm: 'ed25519';
    keyId: string;
    value: string;
  };
};

export type UnsignedRemotePackageCatalogDocument = Omit<RemotePackageCatalogDocument, 'signature'>;

export type RemoteCatalogValidationOptions = {
  now?: Date;
  allowExpired?: boolean;
};

type RemoteCatalogLoaderOptions = {
  url: string;
  cachePath: string;
  fallbackCatalog: readonly PackageCatalogEntry[];
  trustedKeys: Readonly<Record<string, string>>;
  signingPolicies?: Readonly<Record<string, PackageSigningKeyPolicy>>;
  fetcher?: typeof fetch;
  now?: () => Date;
  maxCacheAgeMs?: number;
};

type CachedRemoteCatalog = {
  schemaVersion: 1;
  cachedAt: string;
  document: unknown;
};

type RemoteCachePaths = {
  active: string;
  recovery: string;
  rollback: string;
  marker: string;
  quarantine: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseIsoDate = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid date.`);
  }
  return value;
};

const parsePositiveRevision = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Store catalog revision must be a positive safe integer.');
  }
  return value;
};

const parseCatalogSignature = (value: unknown): RemotePackageCatalogDocument['signature'] => {
  if (!isRecord(value) || value.algorithm !== 'ed25519' || typeof value.keyId !== 'string' || !value.keyId.trim()) {
    throw new Error('Store catalog signature header is invalid.');
  }
  if (typeof value.value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value.value)) {
    throw new Error('Store catalog signature is not valid Ed25519 base64.');
  }
  if (Buffer.from(value.value, 'base64').byteLength !== 64) {
    throw new Error('Store catalog signature must contain exactly 64 bytes.');
  }
  return { algorithm: 'ed25519', keyId: value.keyId.trim(), value: value.value };
};

export const remoteCatalogSignaturePayload = (
  document: Pick<
    RemotePackageCatalogDocument,
    'schemaVersion' | 'revision' | 'issuedAt' | 'expiresAt' | 'packages' | 'signature'
  >
): string =>
  canonicalizeCatalogValue({
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    issuedAt: document.issuedAt,
    expiresAt: document.expiresAt,
    packages: document.packages,
    signature: { algorithm: document.signature.algorithm, keyId: document.signature.keyId },
  });

export const signRemotePackageCatalog = (
  document: UnsignedRemotePackageCatalogDocument,
  keyId: string,
  privateKeyPem: string
): RemotePackageCatalogDocument => {
  if (!keyId.trim()) throw new Error('Store catalog signing key ID is required.');
  const unsigned = {
    ...document,
    signature: { algorithm: 'ed25519' as const, keyId: keyId.trim(), value: '' },
  };
  const value = signBytes(
    null,
    Buffer.from(remoteCatalogSignaturePayload(unsigned)),
    createPrivateKey(privateKeyPem)
  ).toString('base64');
  return { ...unsigned, signature: { ...unsigned.signature, value } };
};

const derivePackageTrust = (
  manifest: PackageManifest,
  trustedKeys: Readonly<Record<string, string>>,
  signingPolicies: Readonly<Record<string, PackageSigningKeyPolicy>>
): Extract<PackageTrust, 'signed-first-party' | 'signed-store'> => {
  const signature = manifest.artifact?.signature;
  if (!signature) return 'signed-store';
  const policy = signingPolicies[signature.keyId];
  if (!policy || trustedKeys[signature.keyId] !== policy.publicKey || manifest.publisherId !== policy.publisherId) {
    return 'signed-store';
  }
  return policy.trust;
};

const downloadableEntry = (
  value: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  signingPolicies: Readonly<Record<string, PackageSigningKeyPolicy>>
): PackageCatalogEntry => {
  if (!isRecord(value)) throw new Error('Store catalog package entry must be an object.');
  if (value.delivery !== 'downloaded-package') {
    throw new Error('Remote Store catalog only accepts downloaded packages.');
  }
  if (typeof value.artifactUrl !== 'string') throw new Error('Remote Store package needs an artifact URL.');
  const artifactUrl = new URL(value.artifactUrl);
  if (artifactUrl.protocol !== 'https:' || artifactUrl.username || artifactUrl.password) {
    throw new Error('Remote Store artifact URL must be credential-free HTTPS.');
  }
  const manifest = parsePackageManifest(value.manifest);
  verifyArtifactSignature(manifest, trustedKeys);
  return {
    delivery: value.delivery,
    trust: derivePackageTrust(manifest, trustedKeys, signingPolicies),
    artifactUrl: artifactUrl.toString(),
    manifest,
  };
};

export const parseRemotePackageCatalog = (
  value: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  signingPolicies: Readonly<Record<string, PackageSigningKeyPolicy>> = {},
  { now = new Date(), allowExpired = false }: RemoteCatalogValidationOptions = {}
): RemotePackageCatalogDocument => {
  if (!isRecord(value)) throw new Error('Store catalog must be an object.');
  if (value.schemaVersion !== 1 || !Array.isArray(value.packages) || value.packages.length > MAX_CATALOG_PACKAGES) {
    throw new Error('Store catalog envelope is invalid.');
  }
  const revision = parsePositiveRevision(value.revision);
  const issuedAt = parseIsoDate(value.issuedAt, 'Store catalog issue time');
  const expiresAt = parseIsoDate(value.expiresAt, 'Store catalog expiry time');
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (
    issuedMs > now.getTime() + MAX_CLOCK_SKEW_MS ||
    expiresMs <= issuedMs ||
    expiresMs - issuedMs > MAX_CATALOG_VALIDITY_MS
  ) {
    throw new Error('Store catalog validity window is invalid.');
  }
  if (!allowExpired && expiresMs <= now.getTime()) throw new Error('Store catalog has expired.');

  const signature = parseCatalogSignature(value.signature);
  const trustedKey = trustedKeys[signature.keyId];
  if (!trustedKey) throw new Error(`Store catalog signing key is not trusted: ${signature.keyId}`);
  const signedDocument = {
    schemaVersion: 1 as const,
    revision,
    issuedAt,
    expiresAt,
    packages: value.packages as PackageCatalogEntry[],
    signature,
  };
  if (
    !verify(
      null,
      Buffer.from(remoteCatalogSignaturePayload(signedDocument)),
      createPublicKey(trustedKey),
      Buffer.from(signature.value, 'base64')
    )
  ) {
    throw new Error('Store catalog signature verification failed.');
  }

  const ids = new Set<string>();
  const packages = value.packages.map((entry) => {
    const parsed = downloadableEntry(entry, trustedKeys, signingPolicies);
    if (ids.has(parsed.manifest.id)) throw new Error(`Duplicate Store package: ${parsed.manifest.id}`);
    ids.add(parsed.manifest.id);
    return parsed;
  });
  return { schemaVersion: 1, revision, issuedAt, expiresAt, packages, signature };
};

const PACKAGE_TRUST_RANK: Readonly<Record<PackageTrust, number>> = {
  'signed-store': 1,
  'signed-first-party': 2,
  'trusted-first-party': 3,
};

const mergeCatalogs = (
  fallbackCatalog: readonly PackageCatalogEntry[],
  remoteCatalog: readonly PackageCatalogEntry[]
): readonly PackageCatalogEntry[] => {
  const entries = new Map(fallbackCatalog.map((entry) => [entry.manifest.id, entry]));
  for (const entry of remoteCatalog) {
    const existing = entries.get(entry.manifest.id);
    if (
      existing &&
      (existing.manifest.publisherId !== entry.manifest.publisherId ||
        PACKAGE_TRUST_RANK[entry.trust] < PACKAGE_TRUST_RANK[existing.trust] ||
        semver.lte(entry.manifest.version, existing.manifest.version))
    ) {
      continue;
    }
    entries.set(entry.manifest.id, entry);
  }
  return [...entries.values()];
};

const readCatalogText = async (response: Response): Promise<string> => {
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_CATALOG_BYTES) {
    throw new Error('Remote Store catalog exceeds the size limit.');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_CATALOG_BYTES) {
    throw new Error('Remote Store catalog exceeds the size limit.');
  }
  return text;
};

const remoteCachePaths = (cachePath: string): RemoteCachePaths => ({
  active: cachePath,
  recovery: `${cachePath}.recovery`,
  rollback: `${cachePath}.rollback`,
  marker: `${cachePath}.marker`,
  quarantine: `${cachePath}.quarantine`,
});

const validateMaxCacheAge = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 60_000 || value > MAX_CONFIGURED_CACHE_AGE_MS) {
    throw new Error('Remote catalog cache age must be between one minute and seven days.');
  }
  return value;
};

export const createRemotePackageCatalogLoader = ({
  url,
  cachePath,
  fallbackCatalog,
  trustedKeys,
  signingPolicies = {},
  fetcher = fetch,
  now = () => new Date(),
  maxCacheAgeMs = DEFAULT_MAX_CACHE_AGE_MS,
}: RemoteCatalogLoaderOptions): (() => Promise<readonly PackageCatalogEntry[]>) => {
  const catalogUrl = new URL(url);
  if (catalogUrl.protocol !== 'https:' || catalogUrl.username || catalogUrl.password) {
    throw new Error('Remote Store catalog URL must use credential-free HTTPS.');
  }
  if (!path.isAbsolute(cachePath)) throw new Error('Remote Store catalog cache path must be absolute.');
  const boundedCacheAge = validateMaxCacheAge(maxCacheAgeMs);
  const paths = remoteCachePaths(cachePath);
  const serialize = createSerializedCatalogExecutor();

  const readMarker = async (): Promise<CatalogRevisionMarker | undefined> => {
    if (!(await fileExists(paths.marker))) return undefined;
    try {
      return parseCatalogRevisionMarker(await readBoundedJson(paths.marker, 16 * 1_024));
    } catch (error) {
      await quarantineCatalogFile(paths.marker, paths.quarantine, now());
      throw new Error('Remote Store cache anti-rollback marker is corrupt.', { cause: error });
    }
  };

  const parseCachedCandidate = async (
    candidatePath: string
  ): Promise<{ cache: CachedRemoteCatalog; document: RemotePackageCatalogDocument; digest: string }> => {
    const value = await readBoundedJson(candidatePath, MAX_CATALOG_BYTES + 64 * 1_024);
    if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.cachedAt !== 'string') {
      throw new Error('Remote Store cache envelope is invalid.');
    }
    const cachedAt = parseIsoDate(value.cachedAt, 'Remote Store cache time');
    if (Date.parse(cachedAt) > now().getTime() + MAX_CLOCK_SKEW_MS) {
      throw new Error('Remote Store cache time is in the future.');
    }
    const document = parseRemotePackageCatalog(value.document, trustedKeys, signingPolicies, {
      now: now(),
      allowExpired: true,
    });
    return {
      cache: { schemaVersion: 1, cachedAt, document: value.document },
      document,
      digest: catalogDigest(value.document),
    };
  };

  const storeCache = async (rawDocument: unknown, document: RemotePackageCatalogDocument): Promise<void> => {
    await serialize(async () => {
      const marker = await readMarker();
      const digest = catalogDigest(rawDocument);
      if (marker && document.revision < marker.revision) {
        throw new Error(`Store catalog rollback rejected: revision ${document.revision} is below ${marker.revision}.`);
      }
      if (marker && document.revision === marker.revision && digest !== marker.digest) {
        throw new Error('Store catalog equivocation rejected: the committed revision has different contents.');
      }
      const cachedAt = now().toISOString();
      const cache: CachedRemoteCatalog = { schemaVersion: 1, cachedAt, document: rawDocument };

      if (marker && (await fileExists(paths.active))) {
        try {
          const current = await parseCachedCandidate(paths.active);
          if (current.document.revision === marker.revision && current.digest === marker.digest) {
            await writeJsonAtomically(paths.rollback, current.cache);
          }
        } catch {
          await quarantineCatalogFile(paths.active, paths.quarantine, now());
        }
      }
      await writeJsonAtomically(paths.active, cache);
      await writeJsonAtomically(paths.recovery, cache);
      await writeJsonAtomically(paths.marker, {
        schemaVersion: 1,
        revision: document.revision,
        digest,
        committedAt: cachedAt,
      } satisfies CatalogRevisionMarker);
    });
  };

  const loadCache = async (): Promise<RemotePackageCatalogDocument | undefined> =>
    serialize(async () => {
      const marker = await readMarker();
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
          throw new Error('Remote Store cache exists without its anti-rollback marker.');
        }
        return undefined;
      }

      let foundExpired = false;
      for (const candidate of [paths.active, paths.recovery, paths.rollback]) {
        if (!(await fileExists(candidate))) continue;
        let parsed: Awaited<ReturnType<typeof parseCachedCandidate>>;
        try {
          parsed = await parseCachedCandidate(candidate);
        } catch {
          await quarantineCatalogFile(candidate, paths.quarantine, now());
          continue;
        }
        if (parsed.document.revision !== marker.revision || parsed.digest !== marker.digest) continue;
        const cacheAge = now().getTime() - Date.parse(parsed.cache.cachedAt);
        if (cacheAge > boundedCacheAge || Date.parse(parsed.document.expiresAt) <= now().getTime()) {
          foundExpired = true;
          continue;
        }
        if (candidate !== paths.active) await writeJsonAtomically(paths.active, parsed.cache);
        return parsed.document;
      }
      if (foundExpired) return undefined;
      throw new Error('Remote Store cache has no snapshot matching the highest committed revision.');
    });

  return async (): Promise<readonly PackageCatalogEntry[]> => {
    let remoteError: unknown;
    try {
      const response = await fetcher(catalogUrl, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Remote Store catalog returned HTTP ${response.status}.`);
      if (response.redirected && response.url) {
        const finalUrl = new URL(response.url);
        if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password) {
          throw new Error('Remote Store catalog redirected to an unsafe URL.');
        }
      }
      const rawDocument = JSON.parse(await readCatalogText(response)) as unknown;
      const document = parseRemotePackageCatalog(rawDocument, trustedKeys, signingPolicies, { now: now() });
      await storeCache(rawDocument, document);
      return mergeCatalogs(fallbackCatalog, document.packages);
    } catch (error) {
      remoteError = error;
    }

    try {
      const cached = await loadCache();
      if (cached) return mergeCatalogs(fallbackCatalog, cached.packages);
    } catch {
      // Fail closed to the bundled catalog when durable cache integrity cannot be established.
    }
    if (fallbackCatalog.length > 0) return [...fallbackCatalog];
    throw remoteError;
  };
};
