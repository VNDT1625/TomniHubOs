/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ViuLocalAssetService, type ViuLocalAssetIo, type ViuLocalAssetStat } from '@/process/ide/viu/assets';

type FakeEntryKind = 'file' | 'directory' | 'other';

type FakeFileSystem = {
  io: ViuLocalAssetIo;
  add: (path: string, kind: FakeEntryKind, size?: number, mtimeMs?: number) => void;
  alias: (source: string, canonical: string) => void;
  remove: (path: string) => void;
};

const notFound = (): NodeJS.ErrnoException => Object.assign(new Error('not found'), { code: 'ENOENT' });

const fakeFileSystem = (): FakeFileSystem => {
  const entries = new Map<string, ViuLocalAssetStat>();
  const aliases = new Map<string, string>();

  const add = (path: string, kind: FakeEntryKind, size = 0, mtimeMs = 1_000): void => {
    entries.set(path, {
      size,
      mtimeMs,
      dev: 1,
      ino: entries.size + 1,
      isFile: () => kind === 'file',
      isDirectory: () => kind === 'directory',
    });
  };

  return {
    io: {
      realpath: async (path) => {
        const canonical = aliases.get(path) ?? path;
        if (!entries.has(canonical)) throw notFound();
        return canonical;
      },
      stat: async (path) => {
        const entry = entries.get(path);
        if (!entry) throw notFound();
        return entry;
      },
    },
    add,
    alias: (source, canonical) => aliases.set(source, canonical),
    remove: (path) => entries.delete(path),
  };
};

const setupImage = () => {
  const fs = fakeFileSystem();
  const grantPath = resolve('fixtures', 'viu-assets');
  const assetPath = join(grantPath, 'hero.png');
  fs.add(grantPath, 'directory');
  fs.add(assetPath, 'file', 4_096, 2_000);
  return { fs, grantPath, assetPath };
};

describe('Viu local asset grants', () => {
  it('returns stable protocol-ready metadata without exposing an absolute path', async () => {
    const { fs, grantPath, assetPath } = setupImage();
    const service = new ViuLocalAssetService(fs.io);
    const ref = await service.grant({ path: assetPath, grantPath, mimeType: 'IMAGE/PNG; charset=binary' });

    expect(ref).toMatchObject({
      protocolUrl: `viu-asset://local/${ref.id}`,
      displayName: 'hero.png',
      extension: '.png',
      mimeType: 'image/png',
      kind: 'image',
      sizeBytes: 4_096,
      missing: false,
    });
    expect(ref.id).toMatch(/^viu_asset_[a-f0-9]{64}$/u);
    expect(ref.metadataSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(ref)).not.toContain(grantPath);
  });

  it('deduplicates the same canonical file and resolves its path only through the service', async () => {
    const { fs, grantPath, assetPath } = setupImage();
    const service = new ViuLocalAssetService(fs.io);
    const first = await service.grant({ path: assetPath, grantPath, mimeType: 'image/png' });
    const second = await service.grant({ path: assetPath, grantPath, mimeType: 'image/png' });

    expect(second.id).toBe(first.id);
    expect(service.listAssetRefs()).toHaveLength(1);
    await expect(service.resolveAssetPath(first.id)).resolves.toBe(assetPath);
  });

  it('supports an exact-file grant', async () => {
    const { fs, assetPath } = setupImage();
    const service = new ViuLocalAssetService(fs.io);

    await expect(
      service.grant({ path: assetPath, grantPath: assetPath, mimeType: 'image/png' })
    ).resolves.toMatchObject({
      displayName: 'hero.png',
      missing: false,
    });
  });

  it('rejects relative paths and non-file selections', async () => {
    const { fs, grantPath } = setupImage();
    const service = new ViuLocalAssetService(fs.io);

    await expect(service.grant({ path: 'hero.png', grantPath, mimeType: 'image/png' })).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    await expect(service.grant({ path: grantPath, grantPath, mimeType: 'image/png' })).rejects.toMatchObject({
      code: 'NOT_A_FILE',
    });
  });

  it('rejects traversal and symlink escapes after canonicalization', async () => {
    const { fs, grantPath } = setupImage();
    const service = new ViuLocalAssetService(fs.io);
    const outsidePath = resolve('fixtures', 'private', 'secret.png');
    const traversalPath = join(grantPath, '..', 'private', 'secret.png');
    const symlinkPath = join(grantPath, 'linked-secret.png');
    fs.add(outsidePath, 'file', 100, 3_000);
    fs.alias(symlinkPath, outsidePath);

    await expect(service.grant({ path: traversalPath, grantPath, mimeType: 'image/png' })).rejects.toMatchObject({
      code: 'GRANT_ESCAPE',
    });
    await expect(service.grant({ path: symlinkPath, grantPath, mimeType: 'image/png' })).rejects.toMatchObject({
      code: 'GRANT_ESCAPE',
    });
  });

  it('rejects invalid grants, disallowed extensions, and untrusted MIME declarations', async () => {
    const { fs, grantPath } = setupImage();
    const service = new ViuLocalAssetService(fs.io);
    const invalidGrant = resolve('fixtures', 'invalid-grant');
    const textPath = join(grantPath, 'payload.txt');
    const imagePath = join(grantPath, 'mismatch.png');
    fs.add(invalidGrant, 'other');
    fs.add(textPath, 'file', 10);
    fs.add(imagePath, 'file', 10);

    await expect(
      service.grant({ path: imagePath, grantPath: invalidGrant, mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'INVALID_GRANT' });
    await expect(service.grant({ path: textPath, grantPath, mimeType: 'text/plain' })).rejects.toMatchObject({
      code: 'DISALLOWED_EXTENSION',
    });
    await expect(
      service.grant({ path: imagePath, grantPath, mimeType: 'application/octet-stream' })
    ).rejects.toMatchObject({
      code: 'DISALLOWED_MIME',
    });
    await expect(service.grant({ path: imagePath, grantPath, mimeType: 'video/mp4' })).rejects.toMatchObject({
      code: 'MIME_MISMATCH',
    });
  });

  it('rejects a granted symlink whose canonical target changes later', async () => {
    const fs = fakeFileSystem();
    const originalGrant = resolve('fixtures', 'original-assets');
    const replacementGrant = resolve('fixtures', 'replacement-assets');
    const userGrantPath = resolve('fixtures', 'selected-assets-link');
    const canonicalAsset = join(originalGrant, 'hero.png');
    const userAssetPath = join(userGrantPath, 'hero.png');
    fs.add(originalGrant, 'directory');
    fs.add(replacementGrant, 'directory');
    fs.add(canonicalAsset, 'file', 100);
    fs.alias(userGrantPath, originalGrant);
    fs.alias(userAssetPath, canonicalAsset);
    const service = new ViuLocalAssetService(fs.io);
    const ref = await service.grant({ path: userAssetPath, grantPath: userGrantPath, mimeType: 'image/png' });

    fs.alias(userGrantPath, replacementGrant);

    await expect(service.resolveAssetPath(ref.id)).rejects.toMatchObject({ code: 'GRANT_CHANGED' });
  });

  it('marks a disappeared file missing and relinks it without changing the asset id', async () => {
    const { fs, grantPath, assetPath } = setupImage();
    const service = new ViuLocalAssetService(fs.io);
    const original = await service.grant({ path: assetPath, grantPath, mimeType: 'image/png' });
    fs.remove(assetPath);

    await expect(service.resolveAssetPath(original.id)).rejects.toMatchObject({ code: 'ASSET_MISSING' });
    expect(service.getAssetRef(original.id)?.missing).toBe(true);

    const replacementPath = join(grantPath, 'hero-restored.png');
    fs.add(replacementPath, 'file', 8_192, 4_000);
    const relinked = await service.relink(original.id, {
      path: replacementPath,
      grantPath,
      mimeType: 'image/png',
    });

    expect(relinked.id).toBe(original.id);
    expect(relinked.protocolUrl).toBe(original.protocolUrl);
    expect(relinked.missing).toBe(false);
    expect(relinked.metadataSha256).not.toBe(original.metadataSha256);
    await expect(service.resolveAssetPath(original.id)).resolves.toBe(replacementPath);
  });

  it('does not allow relinking one id onto a path already owned by another id', async () => {
    const { fs, grantPath, assetPath } = setupImage();
    const secondPath = join(grantPath, 'second.png');
    fs.add(secondPath, 'file', 200);
    const service = new ViuLocalAssetService(fs.io);
    const first = await service.grant({ path: assetPath, grantPath, mimeType: 'image/png' });
    await service.grant({ path: secondPath, grantPath, mimeType: 'image/png' });

    await expect(
      service.relink(first.id, { path: secondPath, grantPath, mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'ASSET_ALREADY_GRANTED' });
  });

  it('rejects path resolution for an unknown opaque id', async () => {
    const { fs } = setupImage();
    const service = new ViuLocalAssetService(fs.io);

    await expect(service.resolveAssetPath('viu_asset_unknown')).rejects.toMatchObject({ code: 'UNKNOWN_ASSET' });
  });
});
