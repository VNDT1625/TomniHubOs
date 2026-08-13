/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* oxlint-disable no-await-in-loop -- redirect and stream boundaries must remain sequential. */

import { createHash } from 'node:crypto';
import { parseModelPackManifest } from '../modelPackManifest';
import type { ModelRegistryStore } from '../modelRegistryStore';
import type { ModelCatalogTrustMetadata } from '../modelPackTypes';
import {
  ModelPackServiceError,
  type ModelPackCatalogCache,
  type ModelPackCatalogDocument,
  type ModelPackCatalogEntry,
  type ModelPackCatalogRefresh,
  type ModelPackCatalogSource,
} from './types';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_METADATA_BYTES = 256 * 1024;
const DEFAULT_MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 512;

const isPrivateIpv4 = (hostname: string): boolean => {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
};

const isPrivateHost = (hostname: string): boolean => {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  if (isPrivateIpv4(normalized)) return true;
  if (!normalized.includes(':')) return false;
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized)
  );
};

export const parseStrictRemoteUrl = (raw: string, redirect = false): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new ModelPackServiceError('invalid-url', 'Model Pack URL is invalid.', { cause: error });
  }
  if (url.protocol !== 'https:') {
    throw new ModelPackServiceError(
      redirect ? 'redirect-downgrade' : 'invalid-url',
      'Model Pack network access requires HTTPS.'
    );
  }
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new ModelPackServiceError('invalid-url', 'Model Pack URLs cannot contain credentials or non-HTTPS ports.');
  }
  if (isPrivateHost(url.hostname)) {
    throw new ModelPackServiceError('private-network-url', 'Model Pack URLs cannot target local or private hosts.');
  }
  return url;
};

export type StrictHttpsFetcherOptions = {
  /** Pre-provisioned origins; every initial URL and redirect must remain on this allowlist. */
  allowedOrigins: readonly string[];
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxRedirects?: number;
};

export class StrictHttpsFetcher {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly allowedOrigins = new Set<string>();

  public constructor(options: StrictHttpsFetcherOptions) {
    if (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.length === 0) {
      throw new ModelPackServiceError('invalid-url', 'At least one trusted Model Pack origin is required.');
    }
    for (const rawOrigin of options.allowedOrigins) {
      const parsed = parseStrictRemoteUrl(rawOrigin);
      if (rawOrigin !== parsed.origin) {
        throw new ModelPackServiceError('invalid-url', 'Trusted Model Pack origins must be canonical origins.');
      }
      this.allowedOrigins.add(parsed.origin);
    }
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  }

  public async fetchBytes(rawUrl: string, maxBytes: number, expectedBytes?: number): Promise<Buffer> {
    let current = parseStrictRemoteUrl(rawUrl);
    this.assertAllowedOrigin(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      for (let redirects = 0; ; redirects += 1) {
        let response: Response;
        try {
          response = await this.fetcher(current, {
            redirect: 'manual',
            cache: 'no-store',
            credentials: 'omit',
            headers: { 'accept-encoding': 'identity' },
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new ModelPackServiceError('timeout', 'Model Pack request timed out.', { cause: error });
          }
          throw error;
        }
        if (REDIRECT_STATUSES.has(response.status)) {
          await response.body?.cancel().catch((): void => undefined);
          if (redirects >= this.maxRedirects) {
            throw new ModelPackServiceError('redirect-limit', 'Model Pack request exceeded redirect limit.');
          }
          const location = response.headers.get('location');
          if (!location) throw new ModelPackServiceError('http-error', 'HTTPS redirect has no Location header.');
          current = parseStrictRemoteUrl(new URL(location, current).toString(), true);
          this.assertAllowedOrigin(current);
          continue;
        }
        if (!response.ok) {
          throw new ModelPackServiceError('http-error', `Model Pack request returned HTTP ${response.status}.`);
        }
        const contentEncoding = response.headers.get('content-encoding');
        if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
          throw new ModelPackServiceError('http-error', 'Encoded responses cannot be hashed as exact catalog bytes.');
        }
        return this.readBounded(response, maxBytes, expectedBytes);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private assertAllowedOrigin(url: URL): void {
    if (!this.allowedOrigins.has(url.origin)) {
      throw new ModelPackServiceError('invalid-url', `Model Pack origin is not trusted: ${url.origin}`);
    }
  }

  private async readBounded(response: Response, maxBytes: number, expectedBytes?: number): Promise<Buffer> {
    const declaredHeader = response.headers.get('content-length');
    let declared: number | undefined;
    if (declaredHeader !== null) {
      declared = Number(declaredHeader);
      if (!Number.isSafeInteger(declared) || declared < 0) {
        throw new ModelPackServiceError('invalid-content-length', 'Response Content-Length is invalid.');
      }
      if (declared > maxBytes) {
        throw new ModelPackServiceError('download-too-large', 'Model Pack response exceeds its size limit.');
      }
      if (expectedBytes !== undefined && declared !== expectedBytes) {
        throw new ModelPackServiceError('partial-download', 'Response Content-Length does not match catalog size.');
      }
    }
    const chunks: Buffer[] = [];
    let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch((): void => undefined);
          throw new ModelPackServiceError('download-too-large', 'Model Pack response exceeds its size limit.');
        }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    }
    if (
      (declared !== undefined && received !== declared) ||
      (expectedBytes !== undefined && received !== expectedBytes)
    ) {
      throw new ModelPackServiceError('partial-download', 'Model Pack response ended before its declared size.');
    }
    return Buffer.concat(chunks, received);
  }
}

const exactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
};

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModelPackServiceError('catalog-invalid', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

export const parseModelPackCatalogMetadata = (value: unknown): ModelCatalogTrustMetadata => {
  const raw = record(value, 'Catalog metadata');
  if (!exactKeys(raw, ['schemaVersion', 'revision', 'version', 'expiresAt', 'sha256'], ['signature', 'keyId'])) {
    throw new ModelPackServiceError('catalog-invalid', 'Catalog metadata fields are invalid.');
  }
  if (
    raw.schemaVersion !== 1 ||
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) <= 0 ||
    typeof raw.version !== 'string' ||
    raw.version.length === 0 ||
    typeof raw.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.expiresAt)) ||
    typeof raw.sha256 !== 'string' ||
    !SHA256_PATTERN.test(raw.sha256) ||
    (raw.signature !== undefined && typeof raw.signature !== 'string') ||
    (raw.keyId !== undefined && typeof raw.keyId !== 'string') ||
    Boolean(raw.signature) !== Boolean(raw.keyId)
  ) {
    throw new ModelPackServiceError('catalog-invalid', 'Catalog metadata is malformed.');
  }
  return raw as ModelCatalogTrustMetadata;
};

export const parseModelPackCatalog = (value: unknown, maxEntries = DEFAULT_MAX_ENTRIES): ModelPackCatalogDocument => {
  const raw = record(value, 'Model Pack catalog');
  if (!exactKeys(raw, ['schemaVersion', 'revision', 'entries']) || raw.schemaVersion !== 1) {
    throw new ModelPackServiceError('catalog-invalid', 'Model Pack catalog header is invalid.');
  }
  if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) <= 0 || !Array.isArray(raw.entries)) {
    throw new ModelPackServiceError('catalog-invalid', 'Model Pack catalog revision or entries are invalid.');
  }
  if (raw.entries.length > maxEntries) {
    throw new ModelPackServiceError('catalog-invalid', 'Model Pack catalog has too many entries.');
  }
  const keys = new Set<string>();
  const entries = raw.entries.map((candidate): ModelPackCatalogEntry => {
    const entry = record(candidate, 'Model Pack catalog entry');
    if (!exactKeys(entry, ['manifest', 'artifact'])) {
      throw new ModelPackServiceError('catalog-invalid', 'Model Pack catalog entry fields are invalid.');
    }
    const manifest = parseModelPackManifest(entry.manifest);
    const artifact = record(entry.artifact, 'Model Pack artifact');
    if (
      !exactKeys(artifact, ['url', 'size', 'sha256']) ||
      typeof artifact.url !== 'string' ||
      !Number.isSafeInteger(artifact.size) ||
      (artifact.size as number) <= 0 ||
      typeof artifact.sha256 !== 'string' ||
      !SHA256_PATTERN.test(artifact.sha256)
    ) {
      throw new ModelPackServiceError('catalog-invalid', 'Model Pack artifact metadata is invalid.');
    }
    parseStrictRemoteUrl(artifact.url);
    const key = `${manifest.id}@${manifest.version}`;
    if (keys.has(key)) throw new ModelPackServiceError('catalog-invalid', `Duplicate Model Pack entry: ${key}`);
    keys.add(key);
    return {
      manifest,
      artifact: { url: artifact.url, size: artifact.size as number, sha256: artifact.sha256 },
    };
  });
  return { schemaVersion: 1, revision: raw.revision as number, entries };
};

export type ModelPackCatalogClientOptions = {
  source: ModelPackCatalogSource;
  registry: ModelRegistryStore;

  cache?: ModelPackCatalogCache;
  network?: StrictHttpsFetcher;
  maxMetadataBytes?: number;
  maxCatalogBytes?: number;
  maxEntries?: number;
};

export class ModelPackCatalogClient {
  private readonly network: StrictHttpsFetcher;

  public constructor(private readonly options: ModelPackCatalogClientOptions) {
    parseStrictRemoteUrl(options.source.metadataUrl);
    parseStrictRemoteUrl(options.source.catalogUrl);
    this.network =
      options.network ??
      new StrictHttpsFetcher({
        allowedOrigins: [
          ...new Set([new URL(options.source.metadataUrl).origin, new URL(options.source.catalogUrl).origin]),
        ],
      });
  }

  public async refresh(expectedRegistryRevision: number): Promise<ModelPackCatalogRefresh> {
    const metadataBytes = await this.network.fetchBytes(
      this.options.source.metadataUrl,
      this.options.maxMetadataBytes ?? DEFAULT_MAX_METADATA_BYTES
    );
    let metadataValue: unknown;
    try {
      metadataValue = JSON.parse(metadataBytes.toString('utf8')) as unknown;
    } catch (error) {
      throw new ModelPackServiceError('catalog-invalid', 'Catalog metadata is not valid JSON.', { cause: error });
    }
    const metadata = parseModelPackCatalogMetadata(metadataValue);
    const catalogBytes = await this.network.fetchBytes(
      this.options.source.catalogUrl,
      this.options.maxCatalogBytes ?? DEFAULT_MAX_CATALOG_BYTES
    );
    const digest = createHash('sha256').update(catalogBytes).digest('hex');
    if (digest !== metadata.sha256) {
      throw new ModelPackServiceError('catalog-tampered', 'Exact catalog bytes do not match signed SHA-256.');
    }
    let catalogValue: unknown;
    try {
      catalogValue = JSON.parse(catalogBytes.toString('utf8')) as unknown;
    } catch (error) {
      throw new ModelPackServiceError('catalog-invalid', 'Model Pack catalog is not valid JSON.', { cause: error });
    }
    const document = parseModelPackCatalog(catalogValue, this.options.maxEntries);
    if (document.revision !== metadata.revision) {
      throw new ModelPackServiceError('catalog-tampered', 'Catalog payload revision is not bound to signed metadata.');
    }
    const snapshot = await this.options.registry.acceptCatalog(metadata, expectedRegistryRevision);
    await this.options.cache?.store(metadataBytes, catalogBytes);
    return { metadata, document, registryRevision: snapshot.revision };
  }

  public async loadOffline(expectedRegistryRevision: number): Promise<ModelPackCatalogRefresh> {
    if (!this.options.cache) {
      throw new ModelPackServiceError('cache-unavailable', 'Offline catalog cache is not configured.');
    }
    const cached = await this.options.cache.load();
    let metadataValue: unknown;
    let catalogValue: unknown;
    try {
      metadataValue = JSON.parse(cached.metadataBytes.toString('utf8')) as unknown;
      catalogValue = JSON.parse(cached.catalogBytes.toString('utf8')) as unknown;
    } catch (error) {
      throw new ModelPackServiceError('cache-unavailable', 'Offline catalog cache contains invalid JSON.', {
        cause: error,
      });
    }
    const metadata = parseModelPackCatalogMetadata(metadataValue);
    if (createHash('sha256').update(cached.catalogBytes).digest('hex') !== metadata.sha256) {
      throw new ModelPackServiceError('catalog-tampered', 'Offline catalog exact bytes do not match signed metadata.');
    }
    const document = parseModelPackCatalog(catalogValue, this.options.maxEntries);
    if (document.revision !== metadata.revision) {
      throw new ModelPackServiceError('catalog-tampered', 'Offline catalog revision is not bound to metadata.');
    }
    const snapshot = await this.options.registry.acceptCatalog(metadata, expectedRegistryRevision);
    return { metadata, document, registryRevision: snapshot.revision };
  }
}
