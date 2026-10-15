import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inspectManifest, MV3_REQUIRED_REASON } from '@process/integrations/browserExtensions/manifest';
import {
  extensionIdFromKey,
  generateExtensionKey,
  prepareWorkingCopy,
  scanExtensionSource,
  verifyWorkingCopy,
  workingDirectoryFor,
} from '@process/integrations/browserExtensions/workingCopy';
import { MV3_MANIFEST, useTempRoots, writeExtension } from './extensionFixture';

const temp = useTempRoots();

const prepare = async (
  overrides: Partial<Parameters<typeof prepareWorkingCopy>[0]> & { sourceRoot: string; workingRoot: string }
) =>
  prepareWorkingCopy({
    packageId: 'com.community.ext',
    connectionId: 'ublock',
    generateKey: async () => generateExtensionKey(),
    ...overrides,
  });

describe('manifest inspection', () => {
  it('summarizes what a Manifest V3 extension asks for', () => {
    const verdict = inspectManifest(MV3_MANIFEST);
    expect(verdict).toMatchObject({
      ok: true,
      summary: {
        manifestVersion: 3,
        permissions: ['storage', 'alarms'],
        hostPermissions: ['https://*.example.com/*'],
        contentScriptMatches: ['https://news.example.org/*'],
        hasBackground: true,
      },
    });
  });

  it('refuses MV2 with a background script, naming Manifest V3, but accepts MV2 without one', () => {
    const v2 = { manifest_version: 2, name: 'Old', version: '1', permissions: ['tabs', 'https://a.example/*'] };
    expect(inspectManifest({ ...v2, background: { scripts: ['bg.js'] } })).toEqual({
      ok: false,
      reason: MV3_REQUIRED_REASON,
    });
    expect(MV3_REQUIRED_REASON).toContain('cần bản Manifest V3');
    expect(inspectManifest(v2)).toMatchObject({
      ok: true,
      summary: { permissions: ['tabs'], hostPermissions: ['https://a.example/*'] },
    });
  });

  it('refuses a manifest that is not an object or has no usable version', () => {
    expect(inspectManifest(null).ok).toBe(false);
    expect(inspectManifest([]).ok).toBe(false);
    expect(inspectManifest({ manifest_version: 4 }).ok).toBe(false);
    expect(inspectManifest({ name: 'x' }).ok).toBe(false);
  });
});

describe('extension id from a key', () => {
  it('is 32 letters a-p, stable for one key and different for another', () => {
    const key = generateExtensionKey();
    expect(extensionIdFromKey(key)).toMatch(/^[a-p]{32}$/);
    expect(extensionIdFromKey(key)).toBe(extensionIdFromKey(key));
    expect(extensionIdFromKey(generateExtensionKey())).not.toBe(extensionIdFromKey(key));
  });

  it('rejects text that is not a public key', () => {
    expect(() => extensionIdFromKey('not base64 !')).toThrow();
    expect(() => extensionIdFromKey(Buffer.from('hello').toString('base64'))).toThrow();
  });
});

describe('scanning a source folder', () => {
  it('lists files and the ones that can run', async () => {
    const root = await temp();
    await writeExtension(path.join(root, 'ext'));
    const scan = await scanExtensionSource(path.join(root, 'ext'));
    expect(scan.files.map((file) => file.relativePath)).toContain('icons/icon.png');
    expect(scan.codeFiles).toEqual(
      expect.arrayContaining(['manifest.json', 'sw.js', 'content.js', 'popup.html', 'popup.js'])
    );
    expect(scan.codeFiles).not.toContain('icons/icon.png');
  });

  it('refuses a folder without manifest.json, a missing folder and a tree that is too deep', async () => {
    const root = await temp();
    await mkdir(path.join(root, 'empty'));
    await expect(scanExtensionSource(path.join(root, 'empty'))).rejects.toThrow(/manifest\.json/);
    await expect(scanExtensionSource(path.join(root, 'nope'))).rejects.toThrow(/thư mục/);
    const deep = path.join(root, 'deep', ...Array.from({ length: 20 }, (_unused, index) => `d${index}`));
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(root, 'deep', 'manifest.json'), '{}');
    await expect(scanExtensionSource(path.join(root, 'deep'))).rejects.toThrow(/sâu/);
  });

  it('refuses a symbolic link anywhere in the tree', async () => {
    const root = await temp();
    const source = await writeExtension(path.join(root, 'ext'));
    await writeFile(path.join(root, 'secret.txt'), 'secret');
    try {
      await symlink(path.join(root, 'secret.txt'), path.join(source, 'link.js'));
    } catch {
      return; // creating symlinks needs a privilege on some Windows setups; nothing to test then
    }
    await expect(scanExtensionSource(source)).rejects.toThrow(/liên kết/);
  });
});

describe('working copy', () => {
  it('adds a key, keeps the source untouched, and copies every file', async () => {
    const root = await temp();
    const source = await writeExtension(path.join(root, 'source', 'ext'));
    const before = await readFile(path.join(source, 'manifest.json'), 'utf8');

    const copy = await prepare({ sourceRoot: source, workingRoot: path.join(root, 'work') });

    expect(copy.directory).toBe(path.join(root, 'work', 'com.community.ext', 'ublock'));
    const manifest = JSON.parse(await readFile(path.join(copy.directory, 'manifest.json'), 'utf8')) as { key: string };
    expect(manifest.key).toBe(copy.key);
    expect(extensionIdFromKey(manifest.key)).toBe(copy.extensionId);
    expect(await readFile(path.join(source, 'manifest.json'), 'utf8')).toBe(before);
    expect(await readFile(path.join(copy.directory, 'icons', 'icon.png'), 'utf8')).toBe('not-really-a-png');
    expect(await readdir(path.join(root, 'work', 'com.community.ext'))).toEqual(['ublock']);
  });

  it('gives the same id after an update that moves the source to a new folder', async () => {
    const root = await temp();
    const remembered = generateExtensionKey();
    const generateKey = vi.fn(async () => remembered);
    const v1 = await writeExtension(path.join(root, 'pkg', '1.0.0', 'source', 'ext'));
    const v2 = await writeExtension(path.join(root, 'pkg', '1.1.0', 'source', 'ext'), {
      ...MV3_MANIFEST,
      version: '1.1.0',
    });

    const first = await prepare({ sourceRoot: v1, workingRoot: path.join(root, 'work'), generateKey });
    const second = await prepare({ sourceRoot: v2, workingRoot: path.join(root, 'work'), generateKey });

    expect(second.extensionId).toBe(first.extensionId);
    expect(second.directory).toBe(first.directory);
    expect(JSON.parse(await readFile(path.join(second.directory, 'manifest.json'), 'utf8'))).toMatchObject({
      version: '1.1.0',
    });
  });

  it('replaces the previous copy completely (no stale files) and leaves no staging folder', async () => {
    const root = await temp();
    const source = await writeExtension(path.join(root, 'ext'), MV3_MANIFEST, { 'old.js': '1' });
    const work = path.join(root, 'work');
    const key = generateExtensionKey();
    await prepare({ sourceRoot: source, workingRoot: work, generateKey: async () => key });
    const fresh = await writeExtension(path.join(root, 'ext2'));
    const copy = await prepare({ sourceRoot: fresh, workingRoot: work, generateKey: async () => key });

    await expect(stat(path.join(copy.directory, 'old.js'))).rejects.toThrow();
    expect(await readdir(path.join(work, 'com.community.ext'))).toEqual(['ublock']);
  });

  it('prefers the connection key (Web Store id), then the manifest key, then a generated one', async () => {
    const root = await temp();
    const manifestKey = generateExtensionKey();
    const connectionKey = generateExtensionKey();
    const generate = vi.fn(async () => generateExtensionKey());
    const plain = await writeExtension(path.join(root, 'plain'));
    const keyed = await writeExtension(path.join(root, 'keyed'), { ...MV3_MANIFEST, key: manifestKey });

    const withConnectionKey = await prepare({
      sourceRoot: keyed,
      workingRoot: path.join(root, 'w1'),
      publicKey: connectionKey,
      generateKey: generate,
    });
    const withManifestKey = await prepare({
      sourceRoot: keyed,
      workingRoot: path.join(root, 'w2'),
      generateKey: generate,
    });
    expect(withConnectionKey.extensionId).toBe(extensionIdFromKey(connectionKey));
    expect(withManifestKey.extensionId).toBe(extensionIdFromKey(manifestKey));
    expect(generate).not.toHaveBeenCalled();

    await prepare({ sourceRoot: plain, workingRoot: path.join(root, 'w3'), generateKey: generate });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('refuses MV2 with a background, an invalid key, an unsafe name, and leaves nothing behind', async () => {
    const root = await temp();
    const work = path.join(root, 'work');
    const mv2 = await writeExtension(path.join(root, 'mv2'), {
      manifest_version: 2,
      name: 'Old',
      version: '1',
      background: { scripts: ['bg.js'] },
    });
    await expect(prepare({ sourceRoot: mv2, workingRoot: work })).rejects.toThrow(/cần bản Manifest V3/);

    const ok = await writeExtension(path.join(root, 'ok'));
    await expect(prepare({ sourceRoot: ok, workingRoot: work, publicKey: 'AAAA' })).rejects.toThrow(/Khóa/);
    await expect(prepare({ sourceRoot: ok, workingRoot: work, connectionId: '../escape' })).rejects.toThrow();
    await expect(prepare({ sourceRoot: ok, workingRoot: work, packageId: 'a/b' })).rejects.toThrow();
    expect(await readdir(work).catch((): string[] => [])).toEqual([]);
  });

  it('does not accept names that could leave the working root', () => {
    expect(() => workingDirectoryFor('/work', '..', 'x')).toThrow();
    expect(() => workingDirectoryFor('/work', 'pkg', 'a\\b')).toThrow();
    expect(() => workingDirectoryFor('/work', 'pkg', '')).toThrow();
  });

  it('verifies a copy before loading: a different or removed key is refused', async () => {
    const root = await temp();
    const source = await writeExtension(path.join(root, 'ext'));
    const copy = await prepare({ sourceRoot: source, workingRoot: path.join(root, 'work') });
    await expect(verifyWorkingCopy(copy.directory, copy.extensionId)).resolves.toMatchObject({ name: 'Fixture' });
    await expect(verifyWorkingCopy(copy.directory, 'a'.repeat(32))).rejects.toThrow(/không còn khớp/);
    await writeFile(path.join(copy.directory, 'manifest.json'), JSON.stringify(MV3_MANIFEST));
    await expect(verifyWorkingCopy(copy.directory, copy.extensionId)).rejects.toThrow(/không còn khớp/);
  });
});
