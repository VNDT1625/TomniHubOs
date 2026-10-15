import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isConfinedIconPath,
  readExtensionIconDataUrl,
} from '@process/integrations/browserExtensions/state/extensionIcon';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-png')]);

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-icon-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const manifestWith = (extra: Record<string, unknown>): string =>
  JSON.stringify({ manifest_version: 3, name: 'Icon', version: '1', ...extra });

const writeManifest = (extra: Record<string, unknown>): Promise<void> =>
  writeFile(path.join(directory, 'manifest.json'), manifestWith(extra), 'utf8');

describe('readExtensionIconDataUrl', () => {
  it('reads a png named by the toolbar icon as a data URL', async () => {
    await writeManifest({ action: { default_icon: 'img/icon.png' } });
    await mkdir(path.join(directory, 'img'));
    await writeFile(path.join(directory, 'img', 'icon.png'), PNG);
    expect(await readExtensionIconDataUrl(directory)).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  it('picks the largest size of an icons map', async () => {
    await writeManifest({ icons: { '16': 'small.png', '128': 'big.png' } });
    await writeFile(path.join(directory, 'big.png'), PNG);
    await writeFile(path.join(directory, 'small.png'), Buffer.from('tiny'));
    expect(await readExtensionIconDataUrl(directory)).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  it('refuses a path that leaves the extension folder, even when the file exists', async () => {
    const outside = path.join(path.dirname(directory), `outside-${path.basename(directory)}.png`);
    await writeFile(outside, PNG);
    try {
      await writeManifest({ action: { default_icon: `../${path.basename(outside)}` } });
      expect(await readExtensionIconDataUrl(directory)).toBeUndefined();
      await writeManifest({ action: { default_icon: outside } });
      expect(await readExtensionIconDataUrl(directory)).toBeUndefined();
    } finally {
      await rm(outside, { force: true });
    }
  });

  it('refuses svg, a file whose bytes are not the image type, and a file over the size cap', async () => {
    await writeManifest({ action: { default_icon: 'icon.svg' } });
    await writeFile(path.join(directory, 'icon.svg'), '<svg onload="alert(1)"/>');
    expect(await readExtensionIconDataUrl(directory)).toBeUndefined();

    await writeManifest({ action: { default_icon: 'icon.png' } });
    await writeFile(path.join(directory, 'icon.png'), '<html>not a png</html>');
    expect(await readExtensionIconDataUrl(directory)).toBeUndefined();

    await writeFile(path.join(directory, 'icon.png'), Buffer.concat([PNG, Buffer.alloc(70 * 1024)]));
    expect(await readExtensionIconDataUrl(directory)).toBeUndefined();
  });

  it('gives nothing when the manifest declares no usable icon', async () => {
    await writeManifest({});
    expect(await readExtensionIconDataUrl(directory)).toBeUndefined();
  });

  it('refuses a symlink that points out of the folder (where the platform allows links)', async () => {
    const target = path.join(path.dirname(directory), `link-target-${path.basename(directory)}.png`);
    await writeFile(target, PNG);
    try {
      await writeManifest({ action: { default_icon: 'link.png' } });
      await symlink(target, path.join(directory, 'link.png'));
    } catch {
      // Creating links needs a privilege on some systems; there is nothing to test there.
      await rm(target, { force: true });
      return;
    }
    expect(await readExtensionIconDataUrl(directory)).toBeUndefined();
    await rm(target, { force: true });
  });
});

describe('isConfinedIconPath', () => {
  it('accepts plain relative paths and refuses traversal, absolute and drive forms', () => {
    expect(isConfinedIconPath('icons/a.png')).toBe(true);
    expect(isConfinedIconPath('../a.png')).toBe(false);
    expect(isConfinedIconPath('a/../../b.png')).toBe(false);
    expect(isConfinedIconPath('/etc/a.png')).toBe(false);
    expect(isConfinedIconPath('C:/a.png')).toBe(false);
    expect(isConfinedIconPath('..\\a.png')).toBe(false);
    expect(isConfinedIconPath('a\u0000.png')).toBe(false);
  });
});
