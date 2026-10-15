import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractZipSafely,
  ExtensionSourceError,
  inspectExtensionFolder,
  readExtensionManifest,
  installExtensionFromFolder,
  installExtensionFromZip,
} from '@process/integrations/repoSources/folder';
import {
  cleanRoots,
  fakeDeps,
  makeRoot,
  MANIFEST_V3,
  writeFolder,
  zipOf,
  type FakeRun,
  type ZipSpec,
} from './extensionFixtures';

afterEach(cleanRoots);

const codeOfAsync = async (action: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await action();
  } catch (error) {
    return error instanceof ExtensionSourceError ? error.code : `other:${String(error)}`;
  }
  return undefined;
};

const folderWith = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const root = await makeRoot();
  await writeFolder(root, files);
  return root;
};

const zipFileOf = async (spec: ZipSpec): Promise<string> => {
  const root = await makeRoot();
  const file = path.join(root, 'ext.zip');
  await writeFile(file, await zipOf(spec));
  return file;
};

const nothingRan = (run: FakeRun): void => {
  expect(run.builds).toEqual([]);
  expect(run.installs).toEqual([]);
};

describe('inspectExtensionFolder', () => {
  it('accepts a Manifest V3 folder and counts files', async () => {
    const folder = await folderWith({
      'manifest.json': MANIFEST_V3,
      'js/app.js': '1',
      '_locales/en/messages.json': '{}',
    });
    const info = await inspectExtensionFolder(folder);
    expect(info.manifest).toMatchObject({ manifestVersion: 3, name: 'Sample', version: '1.2.3' });
    expect(info.fileCount).toBe(3);
  });

  it('ignores .git and node_modules, which the packager drops anyway', async () => {
    const folder = await folderWith({
      'manifest.json': MANIFEST_V3,
      '.git/config': 'x',
      'node_modules/a/index.js': 'x',
    });
    expect((await inspectExtensionFolder(folder)).fileCount).toBe(1);
  });

  it('refuses relative paths, missing paths and files', async () => {
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3 });
    expect(await codeOfAsync(() => inspectExtensionFolder('relative/dir'))).toBe('SOURCE_NOT_FOUND');
    expect(await codeOfAsync(() => inspectExtensionFolder(path.join(folder, 'missing')))).toBe('SOURCE_NOT_FOUND');
    expect(await codeOfAsync(() => inspectExtensionFolder(path.join(folder, 'manifest.json')))).toBe(
      'SOURCE_NOT_FOUND'
    );
  });

  it('refuses a missing, malformed or unsupported manifest', async () => {
    const cases: Array<Record<string, string>> = [
      { 'a.js': '1' },
      { 'manifest.json': '{ nope' },
      { 'manifest.json': '[]' },
      { 'manifest.json': JSON.stringify({ name: 'x' }) },
      {
        'manifest.json': JSON.stringify({
          manifest_version: 2,
          name: 'x',
          version: '1',
          background: { scripts: ['b.js'] },
        }),
      },
    ];
    for (const files of cases) {
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      expect(await codeOfAsync(async () => inspectExtensionFolder(await folderWith(files)))).toBe('EXTENSION_INVALID');
    }
    const summary = await readExtensionManifest(await folderWith({ 'manifest.json': MANIFEST_V3 }));
    expect(summary.manifestVersion).toBe(3);
  });

  it('refuses an oversized manifest, too many files, big files and deep trees', async () => {
    const big = await folderWith({ 'manifest.json': MANIFEST_V3, 'a.js': '12345678' });
    expect(await codeOfAsync(() => inspectExtensionFolder(big, { limits: { maxManifestBytes: 5 } }))).toBe('TOO_LARGE');
    expect(await codeOfAsync(() => inspectExtensionFolder(big, { limits: { maxFiles: 1 } }))).toBe('TOO_LARGE');
    expect(await codeOfAsync(() => inspectExtensionFolder(big, { limits: { maxFileBytes: 4 } }))).toBe('TOO_LARGE');
    expect(await codeOfAsync(() => inspectExtensionFolder(big, { limits: { maxTotalBytes: 20 } }))).toBe('TOO_LARGE');
    const deep = await folderWith({ 'manifest.json': MANIFEST_V3, 'a/b/c/d.js': '1' });
    expect(await codeOfAsync(() => inspectExtensionFolder(deep, { limits: { maxDepth: 2 } }))).toBe('ARCHIVE_UNSAFE');
  });

  it('refuses unsafe names', async () => {
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3, 'con.js': '1' });
    expect(await codeOfAsync(() => inspectExtensionFolder(folder))).toBe('ARCHIVE_UNSAFE');
  });

  it('refuses a junction or symlink anywhere in the tree and a link as the root', async () => {
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3 });
    const outside = await folderWith({ 'secret.txt': 'x' });
    await mkdir(path.join(folder, 'sub'));
    await symlink(outside, path.join(folder, 'sub', 'link'), 'junction');
    expect(await codeOfAsync(() => inspectExtensionFolder(folder))).toBe('ARCHIVE_UNSAFE');
    const holder = await makeRoot();
    const linkRoot = path.join(holder, 'ext');
    await symlink(await folderWith({ 'manifest.json': MANIFEST_V3 }), linkRoot, 'junction');
    expect(await codeOfAsync(() => inspectExtensionFolder(linkRoot))).toBe('ARCHIVE_UNSAFE');
  });

  it('stops when cancelled', async () => {
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3 });
    const controller = new AbortController();
    controller.abort();
    expect(await codeOfAsync(() => inspectExtensionFolder(folder, { signal: controller.signal }))).toBe('CANCELLED');
  });
});

describe('installExtensionFromFolder', () => {
  it('builds the chosen folder as it is and installs the archive, then discards it', async () => {
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3, 'a.js': '1' });
    const run = await fakeDeps();
    const result = await installExtensionFromFolder(run.deps, folder);
    expect(result).toMatchObject({ from: 'folder', extensionName: 'Sample', extensionVersion: '1.2.3' });
    expect(result.extensionId).toBeUndefined();
    expect(run.builds).toEqual([{ source: path.resolve(folder), allowLocalOutsideWorkspace: true }]);
    expect(run.manifestSeen[0]).toBe(MANIFEST_V3);
    expect(run.installs).toHaveLength(1);
    expect(run.discarded).toEqual(run.installs);
  });

  it('does not build an invalid folder', async () => {
    const run = await fakeDeps();
    expect(await codeOfAsync(async () => installExtensionFromFolder(run.deps, await folderWith({ 'a.js': '1' })))).toBe(
      'EXTENSION_INVALID'
    );
    nothingRan(run);
  });

  it('discards and does not install an unverified archive', async () => {
    const run = await fakeDeps({ verified: false });
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3 });
    expect(await codeOfAsync(() => installExtensionFromFolder(run.deps, folder))).toBe('UNVERIFIED_ARCHIVE');
    expect(run.installs).toEqual([]);
    expect(run.discarded).toHaveLength(1);
  });

  it('discards and does not install a package without an extension connection', async () => {
    const run = await fakeDeps({
      connections: [
        { kind: 'command', id: 'c', title: 'c', description: 'd', path: 'source/c.md', format: 'markdown' },
      ],
    });
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3 });
    expect(await codeOfAsync(() => installExtensionFromFolder(run.deps, folder))).toBe('NOT_AN_EXTENSION');
    expect(run.installs).toEqual([]);
    expect(run.discarded).toHaveLength(1);
  });

  it('still discards the archive when the install fails, and passes the failure on', async () => {
    const run = await fakeDeps({
      install: () => Promise.reject(new Error('install failed')),
    });
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3 });
    await expect(installExtensionFromFolder(run.deps, folder)).rejects.toThrow('install failed');
    expect(run.discarded).toHaveLength(1);
  });

  it('does not install when cancelled after the build', async () => {
    const controller = new AbortController();
    const run = await fakeDeps();
    const originalBuild = run.deps.build;
    const deps = {
      ...run.deps,
      build: async (request: Parameters<typeof originalBuild>[0]) => {
        const result = await originalBuild(request);
        controller.abort();
        return result;
      },
    };
    const folder = await folderWith({ 'manifest.json': MANIFEST_V3 });
    expect(await codeOfAsync(() => installExtensionFromFolder(deps, folder, { signal: controller.signal }))).toBe(
      'CANCELLED'
    );
    expect(run.installs).toEqual([]);
    expect(run.discarded).toHaveLength(1);
  });
});

describe('extractZipSafely and installExtensionFromZip', () => {
  it('installs a zip with the manifest at the root and cleans its staging folder', async () => {
    const run = await fakeDeps();
    const file = await zipFileOf({ 'manifest.json': MANIFEST_V3, 'js/app.js': '1', 'img/': '' });
    const result = await installExtensionFromZip(run.deps, file);
    expect(result).toMatchObject({ from: 'zip', extensionName: 'Sample' });
    expect(run.filesSeen[0]).toEqual(['js/app.js', 'manifest.json']);
    expect(run.installs).toHaveLength(1);
    expect((await readdir(run.staging)).filter((name) => name.startsWith('tomny-ext-'))).toEqual([]);
  });

  it('strips a single top-level folder (a GitHub download) and ignores __MACOSX', async () => {
    const run = await fakeDeps();
    const file = await zipFileOf({
      'repo-main/manifest.json': MANIFEST_V3,
      'repo-main/a.js': '1',
      '__MACOSX/repo-main/._a.js': 'x',
    });
    await installExtensionFromZip(run.deps, file);
    expect(run.filesSeen[0]).toEqual(['a.js', 'manifest.json']);
  });

  it('refuses a zip with no manifest or an ambiguous layout', async () => {
    const specs: ZipSpec[] = [
      { 'a.js': '1' },
      { 'x/manifest.json': MANIFEST_V3, 'y/b.js': '1' },
      { 'x/y/manifest.json': MANIFEST_V3 },
    ];
    for (const spec of specs) {
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const run = await fakeDeps();
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const file = await zipFileOf(spec);
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      expect(await codeOfAsync(() => installExtensionFromZip(run.deps, file))).toBe('EXTENSION_INVALID');
      nothingRan(run);
    }
  });

  it('refuses a zip whose manifest is invalid or unsupported', async () => {
    const run = await fakeDeps();
    const file = await zipFileOf({ 'manifest.json': '{ nope' });
    expect(await codeOfAsync(() => installExtensionFromZip(run.deps, file))).toBe('EXTENSION_INVALID');
    nothingRan(run);
  });

  it('refuses zip-slip names, absolute names and backslashes', async () => {
    for (const name of ['../evil.js', 'a/../../evil.js', '/abs.js', 'C:/evil.js', 'a\\..\\evil.js']) {
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const run = await fakeDeps();
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const file = await zipFileOf({ 'manifest.json': MANIFEST_V3, [name]: 'x' });
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const code = await codeOfAsync(() => installExtensionFromZip(run.deps, file));
      expect(['ARCHIVE_UNSAFE']).toContain(code);
      nothingRan(run);
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      expect(await readdir(path.dirname(run.staging))).not.toContain('evil.js');
    }
  });

  it('refuses symlink entries and unsafe or duplicate names', async () => {
    const specs: ZipSpec[] = [
      { 'manifest.json': MANIFEST_V3, link: { content: '/etc', mode: 0o120777 } },
      { 'manifest.json': MANIFEST_V3, 'con.js': '1' },
      { 'manifest.json': MANIFEST_V3, 'Dup.js': '1', 'dup.js': '2' },
    ];
    for (const spec of specs) {
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const run = await fakeDeps();
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const file = await zipFileOf(spec);
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      expect(await codeOfAsync(() => installExtensionFromZip(run.deps, file))).toBe('ARCHIVE_UNSAFE');
      nothingRan(run);
    }
  });

  it('enforces count, per-file, total, depth and archive size caps before writing', async () => {
    const spec = { 'manifest.json': MANIFEST_V3, 'a.js': '12345678', 'b/c/d/e.js': '1' };
    const file = await zipFileOf(spec);
    const out = async (limits: Parameters<typeof extractZipSafely>[2]): Promise<string | undefined> => {
      const destination = path.join(await makeRoot(), 'out');
      const code = await codeOfAsync(() => extractZipSafely(file, destination, limits));
      if (code !== undefined) {
        // Nothing but the (possibly empty) destination folder may exist after a refusal.
        const written = await readdir(destination).catch((): string[] => []);
        expect(written).toEqual([]);
      }
      return code;
    };
    expect(await out({ limits: { maxFiles: 2 } })).toBe('TOO_LARGE');
    expect(await out({ limits: { maxFileBytes: 4 } })).toBe('TOO_LARGE');
    expect(await out({ limits: { maxTotalBytes: 20 } })).toBe('TOO_LARGE');
    expect(await out({ limits: { maxDepth: 3 } })).toBe('ARCHIVE_UNSAFE');
    expect(await out({ limits: { maxArchiveBytes: 50 } })).toBe('TOO_LARGE');
    expect(await out({})).toBeUndefined();
  });

  it('refuses files that are not zips and missing files', async () => {
    const root = await makeRoot();
    const text = path.join(root, 'x.zip');
    await writeFile(text, 'not a zip at all');
    expect(await codeOfAsync(() => extractZipSafely(text, path.join(root, 'o1')))).toBe('EXTENSION_INVALID');
    expect(await codeOfAsync(() => extractZipSafely(path.join(root, 'none.zip'), path.join(root, 'o2')))).toBe(
      'SOURCE_NOT_FOUND'
    );
  });

  it('stops extraction when cancelled', async () => {
    const file = await zipFileOf({ 'manifest.json': MANIFEST_V3 });
    const controller = new AbortController();
    controller.abort();
    const destination = path.join(await makeRoot(), 'o');
    expect(await codeOfAsync(() => extractZipSafely(file, destination, { signal: controller.signal }))).toBe(
      'CANCELLED'
    );
  });
});
