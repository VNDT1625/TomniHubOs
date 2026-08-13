/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { basename, extname, isAbsolute, relative, sep } from 'node:path';
import type {
  ViuLocalAssetInput,
  ViuLocalAssetIo,
  ViuLocalAssetKind,
  ViuLocalAssetRef,
  ViuLocalAssetStat,
} from './types';
import { ViuLocalAssetError } from './types';

type AllowedAssetType = {
  kind: ViuLocalAssetKind;
  mimeTypes: readonly string[];
};

export const VIU_LOCAL_ASSET_TYPES: Readonly<Record<string, AllowedAssetType>> = Object.freeze({
  '.png': { kind: 'image', mimeTypes: ['image/png'] },
  '.jpg': { kind: 'image', mimeTypes: ['image/jpeg'] },
  '.jpeg': { kind: 'image', mimeTypes: ['image/jpeg'] },
  '.webp': { kind: 'image', mimeTypes: ['image/webp'] },
  '.avif': { kind: 'image', mimeTypes: ['image/avif'] },
  '.gif': { kind: 'image', mimeTypes: ['image/gif'] },
  '.ktx2': { kind: 'image', mimeTypes: ['image/ktx2'] },
  '.hdr': { kind: 'image', mimeTypes: ['image/vnd.radiance'] },
  '.mp4': { kind: 'video', mimeTypes: ['video/mp4'] },
  '.webm': { kind: 'video', mimeTypes: ['video/webm'] },
  '.mov': { kind: 'video', mimeTypes: ['video/quicktime'] },
  '.glb': { kind: 'model', mimeTypes: ['model/gltf-binary'] },
  '.gltf': { kind: 'model', mimeTypes: ['model/gltf+json'] },
});

type PrivateAssetRecord = {
  sourcePath: string;
  grantPath: string;
  canonicalPath: string;
  canonicalGrantPath: string;
  ref: ViuLocalAssetRef;
};

export type ViuLocalAssetServiceOptions = {
  /** Defaults to false on Windows and true elsewhere. */
  caseSensitivePaths?: boolean;
};

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const missing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const cloneRef = (ref: ViuLocalAssetRef): ViuLocalAssetRef => ({ ...ref });

const assertStat = (stat: ViuLocalAssetStat): void => {
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || !Number.isFinite(stat.mtimeMs) || stat.mtimeMs < 0) {
    throw new ViuLocalAssetError('IO_ERROR', 'The local asset returned invalid filesystem metadata.');
  }
};

/**
 * Main-process-only registry for user-granted local assets.
 *
 * It stores paths privately and exposes only opaque protocol-ready references.
 * No asset bytes are copied, uploaded, or returned in public metadata.
 */
export class ViuLocalAssetService {
  private readonly records = new Map<string, PrivateAssetRecord>();
  private readonly pathIndex = new Map<string, string>();
  private readonly caseSensitivePaths: boolean;
  private operation: Promise<void> = Promise.resolve();

  public constructor(
    private readonly io: ViuLocalAssetIo,
    options: ViuLocalAssetServiceOptions = {}
  ) {
    this.caseSensitivePaths = options.caseSensitivePaths ?? process.platform !== 'win32';
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      (): undefined => undefined,
      (): undefined => undefined
    );
    return result;
  }

  private identity(path: string): string {
    return this.caseSensitivePaths ? path : path.toLocaleLowerCase('en-US');
  }

  private requireAbsolutePath(path: string): void {
    if (!path || path.includes('\0') || !isAbsolute(path)) {
      throw new ViuLocalAssetError('INVALID_PATH', 'Local asset and grant paths must be absolute.');
    }
  }

  private async canonicalize(path: string, kind: 'asset' | 'grant'): Promise<string> {
    try {
      return await this.io.realpath(path);
    } catch (error) {
      if (missing(error)) {
        throw new ViuLocalAssetError(
          kind === 'asset' ? 'ASSET_NOT_FOUND' : 'GRANT_NOT_FOUND',
          kind === 'asset' ? 'The selected local asset was not found.' : 'The granted local path was not found.'
        );
      }
      throw new ViuLocalAssetError('IO_ERROR', 'The local path could not be canonicalized.');
    }
  }

  private async readStat(path: string, kind: 'asset' | 'grant'): Promise<ViuLocalAssetStat> {
    try {
      const stat = await this.io.stat(path);
      assertStat(stat);
      return stat;
    } catch (error) {
      if (error instanceof ViuLocalAssetError) throw error;
      if (missing(error)) {
        throw new ViuLocalAssetError(
          kind === 'asset' ? 'ASSET_NOT_FOUND' : 'GRANT_NOT_FOUND',
          kind === 'asset' ? 'The selected local asset was not found.' : 'The granted local path was not found.'
        );
      }
      throw new ViuLocalAssetError('IO_ERROR', 'The local path metadata could not be read.');
    }
  }

  private isGranted(canonicalPath: string, canonicalGrantPath: string, grantStat: ViuLocalAssetStat): boolean {
    const assetIdentity = this.identity(canonicalPath);
    const grantIdentity = this.identity(canonicalGrantPath);
    if (grantStat.isFile()) return assetIdentity === grantIdentity;
    if (!grantStat.isDirectory()) {
      throw new ViuLocalAssetError('INVALID_GRANT', 'A local asset grant must refer to a file or directory.');
    }
    if (assetIdentity === grantIdentity) return false;
    const child = relative(grantIdentity, assetIdentity);
    return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  }

  private assetType(
    canonicalPath: string,
    declaredMimeType: string
  ): { extension: string; mimeType: string; kind: ViuLocalAssetKind } {
    const extension = extname(canonicalPath).toLocaleLowerCase('en-US');
    const type = VIU_LOCAL_ASSET_TYPES[extension];
    if (!type) throw new ViuLocalAssetError('DISALLOWED_EXTENSION', 'This local asset extension is not allowed.');

    const mimeType = declaredMimeType.trim().toLocaleLowerCase('en-US').split(';', 1)[0] ?? '';
    const allMimeTypes = new Set(Object.values(VIU_LOCAL_ASSET_TYPES).flatMap((candidate) => candidate.mimeTypes));
    if (!allMimeTypes.has(mimeType)) {
      throw new ViuLocalAssetError('DISALLOWED_MIME', 'This local asset MIME type is not allowed.');
    }
    if (!type.mimeTypes.includes(mimeType)) {
      throw new ViuLocalAssetError('MIME_MISMATCH', 'The local asset extension and MIME type do not agree.');
    }
    return { extension, mimeType, kind: type.kind };
  }

  private metadataHash(stat: ViuLocalAssetStat, extension: string, mimeType: string): string {
    return sha256(
      JSON.stringify({
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        dev: stat.dev ?? null,
        ino: stat.ino ?? null,
        extension,
        mimeType,
      })
    );
  }

  private async validate(
    input: ViuLocalAssetInput,
    preservedId?: string,
    expectedCanonicalGrantPath?: string
  ): Promise<PrivateAssetRecord> {
    this.requireAbsolutePath(input.path);
    this.requireAbsolutePath(input.grantPath);

    const canonicalGrantPath = await this.canonicalize(input.grantPath, 'grant');

    if (expectedCanonicalGrantPath && this.identity(canonicalGrantPath) !== this.identity(expectedCanonicalGrantPath)) {
      throw new ViuLocalAssetError('GRANT_CHANGED', 'The canonical local asset grant has changed.');
    }
    const canonicalPath = await this.canonicalize(input.path, 'asset');
    const grantStat = await this.readStat(canonicalGrantPath, 'grant');
    const assetStat = await this.readStat(canonicalPath, 'asset');
    if (!assetStat.isFile()) throw new ViuLocalAssetError('NOT_A_FILE', 'The selected local asset is not a file.');
    if (!this.isGranted(canonicalPath, canonicalGrantPath, grantStat)) {
      throw new ViuLocalAssetError('GRANT_ESCAPE', 'The selected local asset is outside the granted path.');
    }

    const { extension, mimeType, kind } = this.assetType(canonicalPath, input.mimeType);
    const id = preservedId ?? `viu_asset_${sha256(this.identity(canonicalPath))}`;
    const ref: ViuLocalAssetRef = {
      id,
      protocolUrl: `viu-asset://local/${id}`,
      displayName: basename(canonicalPath),
      extension,
      mimeType,
      kind,
      sizeBytes: assetStat.size,
      modifiedAtMs: assetStat.mtimeMs,
      metadataSha256: this.metadataHash(assetStat, extension, mimeType),
      missing: false,
    };
    return {
      sourcePath: input.path,
      grantPath: input.grantPath,
      canonicalPath,
      canonicalGrantPath,
      ref,
    };
  }

  private requireRecord(id: string): PrivateAssetRecord {
    const record = this.records.get(id);
    if (!record) throw new ViuLocalAssetError('UNKNOWN_ASSET', 'The local asset reference is unknown.');
    return record;
  }

  public async grant(input: ViuLocalAssetInput): Promise<ViuLocalAssetRef> {
    return this.exclusive(async () => {
      const validated = await this.validate(input);
      const key = this.identity(validated.canonicalPath);
      const existingId = this.pathIndex.get(key);
      if (existingId) {
        const existing = this.requireRecord(existingId);
        const refreshed = {
          ...validated,
          ref: { ...validated.ref, id: existingId, protocolUrl: existing.ref.protocolUrl },
        };
        this.records.set(existingId, refreshed);
        return cloneRef(refreshed.ref);
      }
      this.records.set(validated.ref.id, validated);
      this.pathIndex.set(key, validated.ref.id);
      return cloneRef(validated.ref);
    });
  }

  public getAssetRef(id: string): ViuLocalAssetRef | undefined {
    const ref = this.records.get(id)?.ref;
    return ref ? cloneRef(ref) : undefined;
  }

  public listAssetRefs(): ViuLocalAssetRef[] {
    return [...this.records.values()].map((record) => cloneRef(record.ref));
  }

  /** Resolve an opaque id inside the trusted service boundary only. */
  public async resolveAssetPath(id: string): Promise<string> {
    return this.exclusive(async () => {
      const current = this.requireRecord(id);
      let refreshed: PrivateAssetRecord;
      try {
        refreshed = await this.validate(
          { path: current.sourcePath, grantPath: current.grantPath, mimeType: current.ref.mimeType },
          id,
          current.canonicalGrantPath
        );
      } catch (error) {
        if (
          error instanceof ViuLocalAssetError &&
          (error.code === 'ASSET_NOT_FOUND' || error.code === 'GRANT_NOT_FOUND')
        ) {
          current.ref = { ...current.ref, missing: true };
          throw new ViuLocalAssetError('ASSET_MISSING', 'The local asset is missing and must be relinked.');
        }
        throw error;
      }

      const newKey = this.identity(refreshed.canonicalPath);
      const owner = this.pathIndex.get(newKey);
      if (owner && owner !== id) {
        throw new ViuLocalAssetError('ASSET_ALREADY_GRANTED', 'The resolved local path belongs to another asset.');
      }
      this.pathIndex.delete(this.identity(current.canonicalPath));
      this.pathIndex.set(newKey, id);
      this.records.set(id, refreshed);
      return refreshed.canonicalPath;
    });
  }

  public markMissing(id: string): ViuLocalAssetRef {
    const record = this.requireRecord(id);
    record.ref = { ...record.ref, missing: true };
    return cloneRef(record.ref);
  }

  public async relink(id: string, input: ViuLocalAssetInput): Promise<ViuLocalAssetRef> {
    return this.exclusive(async () => {
      const current = this.requireRecord(id);
      const replacement = await this.validate(input, id);
      const replacementKey = this.identity(replacement.canonicalPath);
      const owner = this.pathIndex.get(replacementKey);
      if (owner && owner !== id) {
        throw new ViuLocalAssetError('ASSET_ALREADY_GRANTED', 'The replacement path belongs to another asset.');
      }
      this.pathIndex.delete(this.identity(current.canonicalPath));
      this.pathIndex.set(replacementKey, id);
      this.records.set(id, replacement);
      return cloneRef(replacement.ref);
    });
  }
}
