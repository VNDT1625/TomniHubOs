/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* oxlint-disable no-await-in-loop -- active must be checked before the crash-recovery copy. */

import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import type { ModelCatalogTrustVerifier } from '../modelRegistryStore';
import type { ModelCatalogTrustMetadata } from '../modelPackTypes';
import path from 'node:path';
import { parseModelPackCatalogMetadata } from './catalogClient';
import { ModelPackServiceError, type ModelPackCachedCatalog, type ModelPackCatalogCache } from './types';

const SCHEMA_VERSION = 1;
const DEFAULT_OFFLINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

type CacheEnvelope = {
  schemaVersion: 1;
  cachedAt: string;
  metadataBase64: string;
  catalogBase64: string;
};

type HighestSeenMarker = {
  schemaVersion: 1;
  revision: number;
  sha256: string;
};

export type DurableModelPackCatalogCacheOptions = {
  directory: string;

  trustVerifier: ModelCatalogTrustVerifier;
  offlineMaxAgeMs?: number;
  now?: () => Date;
  randomId?: () => string;
};

const exactRecord = (value: unknown, keys: readonly string[]): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const actual = Object.keys(candidate);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(candidate, key)) ? candidate : undefined;
};

const decodeBase64 = (value: unknown): Buffer | undefined => {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return undefined;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : undefined;
};

export class DurableModelPackCatalogCache implements ModelPackCatalogCache {
  private readonly activePath: string;
  private readonly previousPath: string;
  private readonly highestPath: string;
  private readonly offlineMaxAgeMs: number;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private operation = Promise.resolve();

  public constructor(private readonly options: DurableModelPackCatalogCacheOptions) {
    if (!path.isAbsolute(options.directory)) {
      throw new ModelPackServiceError('configuration-invalid', 'Catalog cache directory must be absolute.');
    }
    this.offlineMaxAgeMs = options.offlineMaxAgeMs ?? DEFAULT_OFFLINE_MAX_AGE_MS;
    if (
      !Number.isSafeInteger(this.offlineMaxAgeMs) ||
      this.offlineMaxAgeMs <= 0 ||
      this.offlineMaxAgeMs > MAX_OFFLINE_AGE_MS
    ) {
      throw new ModelPackServiceError('configuration-invalid', 'Offline catalog max-age must be within seven days.');
    }
    this.activePath = path.join(options.directory, 'active.json');
    this.previousPath = path.join(options.directory, 'previous.json');
    this.highestPath = path.join(options.directory, 'highest-seen.json');
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
  }

  public store(metadataBytes: Buffer, catalogBytes: Buffer): Promise<void> {
    return this.serialized(async () => {
      const metadata = this.parseMetadata(metadataBytes);
      await this.assertTrusted(metadata);
      const digest = createHash('sha256').update(catalogBytes).digest('hex');
      if (digest !== metadata.sha256) {
        throw new ModelPackServiceError('catalog-tampered', 'Cached catalog bytes do not match signed metadata.');
      }
      const currentMarker = await this.readHighest(false);
      if (
        currentMarker &&
        (metadata.revision < currentMarker.revision ||
          (metadata.revision === currentMarker.revision && metadata.sha256 !== currentMarker.sha256))
      ) {
        throw new ModelPackServiceError('cache-stale', 'Catalog cache update would roll back highest-seen trust.');
      }
      const marker: HighestSeenMarker = {
        schemaVersion: SCHEMA_VERSION,
        revision: metadata.revision,
        sha256: metadata.sha256,
      };
      const envelope: CacheEnvelope = {
        schemaVersion: SCHEMA_VERSION,
        cachedAt: this.now().toISOString(),
        metadataBase64: metadataBytes.toString('base64'),
        catalogBase64: catalogBytes.toString('base64'),
      };
      const envelopeBytes = Buffer.from(JSON.stringify(envelope), 'utf8');
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      const previousActive = await readFile(this.activePath).catch(
        (error: NodeJS.ErrnoException): Buffer | undefined => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        }
      );
      if (previousActive) await this.atomicWrite(this.previousPath, previousActive);
      await this.atomicWrite(this.activePath, envelopeBytes);
      await this.atomicWrite(this.highestPath, Buffer.from(JSON.stringify(marker), 'utf8'));
      await this.atomicWrite(this.previousPath, envelopeBytes);
    });
  }

  public load(): Promise<ModelPackCachedCatalog> {
    return this.serialized(async () => {
      const marker = await this.readHighest(true);

      if (!marker) throw new ModelPackServiceError('cache-unavailable', 'Highest-seen marker is unavailable.');
      for (const candidatePath of [this.activePath, this.previousPath]) {
        const candidate = await this.readCandidate(candidatePath, marker);
        if (candidate) return candidate;
      }
      throw new ModelPackServiceError('cache-unavailable', 'No valid trusted offline catalog cache is available.');
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  }

  private parseMetadata(bytes: Buffer) {
    try {
      return parseModelPackCatalogMetadata(JSON.parse(bytes.toString('utf8')) as unknown);
    } catch (error) {
      if (error instanceof ModelPackServiceError) throw error;
      throw new ModelPackServiceError('catalog-invalid', 'Cached catalog metadata is not valid JSON.', {
        cause: error,
      });
    }
  }

  private async assertTrusted(metadata: ModelCatalogTrustMetadata): Promise<void> {
    const trust = await this.options.trustVerifier.verify(Object.freeze({ ...metadata }));
    const bound =
      trust.trusted === true &&
      ((trust.method === 'signature' && metadata.keyId === trust.keyId && Boolean(metadata.signature)) ||
        (trust.method === 'pinned-digest' && metadata.sha256 === trust.sha256));
    if (!bound) {
      throw new ModelPackServiceError('catalog-tampered', 'Cached catalog metadata is not signed by a trusted root.');
    }
  }

  private async readHighest(required: boolean): Promise<HighestSeenMarker | undefined> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.highestPath, 'utf8')) as unknown;
    } catch (error) {
      if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ModelPackServiceError('cache-unavailable', 'Highest-seen catalog marker is absent or corrupt.', {
        cause: error,
      });
    }
    const raw = exactRecord(value, ['schemaVersion', 'revision', 'sha256']);
    if (
      !raw ||
      raw.schemaVersion !== SCHEMA_VERSION ||
      !Number.isSafeInteger(raw.revision) ||
      (raw.revision as number) <= 0 ||
      typeof raw.sha256 !== 'string' ||
      !SHA256_PATTERN.test(raw.sha256)
    ) {
      throw new ModelPackServiceError('cache-unavailable', 'Highest-seen catalog marker is invalid.');
    }
    return { schemaVersion: SCHEMA_VERSION, revision: raw.revision as number, sha256: raw.sha256 };
  }

  private async readCandidate(
    candidatePath: string,
    marker: HighestSeenMarker
  ): Promise<ModelPackCachedCatalog | undefined> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(candidatePath, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
    const raw = exactRecord(value, ['schemaVersion', 'cachedAt', 'metadataBase64', 'catalogBase64']);
    if (!raw || raw.schemaVersion !== SCHEMA_VERSION || typeof raw.cachedAt !== 'string') return undefined;
    const cachedAt = Date.parse(raw.cachedAt);
    const now = this.now().getTime();
    if (!Number.isFinite(cachedAt) || cachedAt > now || now - cachedAt > this.offlineMaxAgeMs) return undefined;
    const metadataBytes = decodeBase64(raw.metadataBase64);
    const catalogBytes = decodeBase64(raw.catalogBase64);
    if (!metadataBytes || !catalogBytes) return undefined;
    try {
      const metadata = this.parseMetadata(metadataBytes);
      await this.assertTrusted(metadata);
      if (
        Date.parse(metadata.expiresAt) <= now ||
        metadata.revision !== marker.revision ||
        metadata.sha256 !== marker.sha256 ||
        createHash('sha256').update(catalogBytes).digest('hex') !== metadata.sha256
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return { metadataBytes, catalogBytes, cachedAt: raw.cachedAt };
  }

  private async atomicWrite(destination: string, bytes: Buffer): Promise<void> {
    const temporaryPath = `${destination}.${this.randomId()}.tmp`;
    const temporary = await open(temporaryPath, 'wx', 0o600);
    try {
      await temporary.writeFile(bytes);
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    try {
      await rename(temporaryPath, destination);
      await chmod(destination, 0o600).catch((): void => undefined);
    } finally {
      await unlink(temporaryPath).catch((): void => undefined);
    }
  }
}
