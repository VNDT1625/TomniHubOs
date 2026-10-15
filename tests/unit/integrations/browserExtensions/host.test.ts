import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionHostManager,
  extensionKeepKey,
  type ExtensionLoaderPort,
} from '@process/integrations/browserExtensions/host';
import { createExtensionStore } from '@process/integrations/browserExtensions/store';
import { MV3_MANIFEST, createFakeLoader, useTempRoots, writeExtension } from './extensionFixture';

const temp = useTempRoots();

const setup = async () => {
  const root = await temp();
  const fake = createFakeLoader();
  const stateFile = path.join(root, 'state.json');
  const workingRoot = path.join(root, 'tomny-extensions');
  const onLoadError = vi.fn();
  const open = async (loader: ExtensionLoaderPort = fake.loader) => {
    const store = createExtensionStore(stateFile);
    await store.initialize();
    return {
      store,
      manager: createExtensionHostManager({ loader, store, workingRoot, onLoadError, log: () => undefined }),
    };
  };
  const source = await writeExtension(path.join(root, 'pkg', '1.0.0', 'source', 'ext'));
  return { root, fake, open, source, workingRoot, onLoadError };
};

const input = (sourceRoot: string) => ({ packageId: 'com.community.ext', connectionId: 'ublock', sourceRoot });
const KEEP = new Set([extensionKeepKey('com.community.ext', 'ublock')]);

describe('extension host manager', () => {
  it('loads the working copy (with a pinned key), not the package folder', async () => {
    const { fake, open, source, workingRoot } = await setup();
    const { manager } = await open();

    const { extensionId } = await manager.enable(input(source));

    const directory = path.join(workingRoot, 'com.community.ext', 'ublock');
    expect([...fake.loaded]).toEqual([[extensionId, directory]]);
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    expect(manager.loadedIds()).toEqual([extensionId]);
    expect(JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'))).not.toHaveProperty('key');
  });

  it('is idempotent: enabling twice loads one extension', async () => {
    const { fake, open, source } = await setup();
    const { manager } = await open();
    const first = await manager.enable(input(source));
    const second = await manager.enable(input(source));
    expect(second.extensionId).toBe(first.extensionId);
    expect(fake.loaded.size).toBe(1);
  });

  it('unloads and removes the working copy on disable, and disabling again is not an error', async () => {
    const { fake, open, source, workingRoot } = await setup();
    const { manager, store } = await open();
    await manager.enable(input(source));

    await manager.disable('com.community.ext', 'ublock');
    await manager.disable('com.community.ext', 'ublock');

    expect(fake.loaded.size).toBe(0);
    expect(store.listLoaded()).toEqual([]);
    await expect(stat(path.join(workingRoot, 'com.community.ext', 'ublock'))).rejects.toThrow();
  });

  it('keeps the id and the extension storage when the package moves to a new version folder', async () => {
    const { fake, open, source, root } = await setup();
    const { manager } = await open();
    const first = await manager.enable(input(source));
    const stored = fake.storage.get(first.extensionId);
    if (stored) stored.setting = 'dark';

    const updated = await writeExtension(path.join(root, 'pkg', '1.1.0', 'source', 'ext'), {
      ...MV3_MANIFEST,
      version: '1.1.0',
    });
    await manager.disable('com.community.ext', 'ublock'); // the registry switches a changed connection off first
    const second = await manager.enable(input(updated));

    expect(second.extensionId).toBe(first.extensionId);
    expect(fake.storage.get(second.extensionId)).toEqual({ setting: 'dark' });
  });

  it('keeps the id too when enabling again straight over the loaded copy', async () => {
    const { open, source, root } = await setup();
    const { manager } = await open();
    const first = await manager.enable(input(source));
    const updated = await writeExtension(path.join(root, 'pkg', '2.0.0', 'source', 'ext'));
    expect((await manager.enable(input(updated))).extensionId).toBe(first.extensionId);
  });

  it('reports a load error in plain words and leaves no copy or record behind', async () => {
    const { fake, open, source, workingRoot } = await setup();
    const { manager, store } = await open();
    fake.fail.message = 'Manifest is not valid: service worker missing';

    await expect(manager.enable(input(source))).rejects.toThrow(/Không nạp được tiện ích: Manifest is not valid/);

    expect(store.listLoaded()).toEqual([]);
    await expect(stat(path.join(workingRoot, 'com.community.ext', 'ublock'))).rejects.toThrow();
    expect(manager.loadedIds()).toEqual([]);
  });

  it('refuses an id that does not match the pinned key and unloads it', async () => {
    const { fake, open, source } = await setup();
    const { manager } = await open();
    fake.fail.reportId = 'p'.repeat(32);
    await expect(manager.enable(input(source))).rejects.toThrow(/không khớp/);
    expect(fake.loaded.size).toBe(0);
  });

  it('refuses Manifest V2 with a background before anything is loaded', async () => {
    const { fake, open, root } = await setup();
    const { manager } = await open();
    const mv2 = await writeExtension(path.join(root, 'mv2'), {
      manifest_version: 2,
      name: 'Old',
      version: '1',
      background: { scripts: ['bg.js'] },
    });
    await expect(manager.enable(input(mv2))).rejects.toThrow(/cần bản Manifest V3/);
    expect(fake.loaded.size).toBe(0);
  });

  it('serializes overlapping calls', async () => {
    const { fake, open, source } = await setup();
    const { manager } = await open();
    const results = await Promise.allSettled([
      manager.enable(input(source)),
      manager.disable('com.community.ext', 'ublock'),
      manager.enable(input(source)),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(fake.loaded.size).toBe(1);
  });
});

describe('extension host manager at startup', () => {
  it('loads enabled extensions again in a new process with the same id', async () => {
    const { open, source } = await setup();
    const before = await open();
    const { extensionId } = await before.manager.enable(input(source));

    const freshLoader = createFakeLoader(); // a restart: Electron remembers nothing
    const after = await open(freshLoader.loader);
    expect(freshLoader.loaded.size).toBe(0);
    await after.manager.reconcile(KEEP);

    expect([...freshLoader.loaded.keys()]).toEqual([extensionId]);
  });

  it('does not load twice when reconcile runs again', async () => {
    const { fake, open, source } = await setup();
    const { manager } = await open();
    await manager.enable(input(source));
    await manager.reconcile(KEEP);
    await manager.reconcile(KEEP);
    expect(fake.loaded.size).toBe(1);
  });

  it('removes extensions that are no longer kept', async () => {
    const { fake, open, source, workingRoot } = await setup();
    const { manager, store } = await open();
    await manager.enable(input(source));

    await manager.reconcile(new Set());

    expect(fake.loaded.size).toBe(0);
    expect(store.listLoaded()).toEqual([]);
    await expect(stat(path.join(workingRoot, 'com.community.ext', 'ublock'))).rejects.toThrow();
  });

  it('records why a kept extension could not be loaded and tells the caller, without stopping the others', async () => {
    const { open, source, onLoadError, root } = await setup();
    const before = await open();
    await before.manager.enable(input(source));
    const other = await writeExtension(path.join(root, 'other'));
    await before.manager.enable({ packageId: 'com.community.ext', connectionId: 'other', sourceRoot: other });

    const restarted = createFakeLoader();
    const loader: ExtensionLoaderPort = {
      ...restarted.loader,
      load: async (directory) => {
        if (directory.endsWith('ublock')) throw new Error('Could not load extension from disk');
        return restarted.loader.load(directory);
      },
    };
    const after = await open(loader);
    await after.manager.reconcile(
      new Set([extensionKeepKey('com.community.ext', 'ublock'), extensionKeepKey('com.community.ext', 'other')])
    );

    expect(onLoadError).toHaveBeenCalledWith(
      'com.community.ext',
      'ublock',
      expect.stringContaining('Không nạp được tiện ích')
    );
    expect(after.store.getLoaded('com.community.ext', 'ublock')?.lastError).toContain('Không nạp được tiện ích');
    expect(restarted.loaded.size).toBe(1);
  });

  it('refuses a damaged working copy at startup instead of loading it under another id', async () => {
    const { open, source, onLoadError, workingRoot } = await setup();
    const before = await open();
    await before.manager.enable(input(source));
    await writeFile(
      path.join(workingRoot, 'com.community.ext', 'ublock', 'manifest.json'),
      JSON.stringify(MV3_MANIFEST)
    );

    const fresh = createFakeLoader();
    const after = await open(fresh.loader);
    await after.manager.reconcile(KEEP);

    expect(fresh.loaded.size).toBe(0);
    expect(onLoadError).toHaveBeenCalledWith('com.community.ext', 'ublock', expect.stringContaining('không còn khớp'));
  });

  it('dispose unloads every loaded extension, keeps the working copies, and can run twice', async () => {
    const { fake, open, source, workingRoot } = await setup();
    const { manager } = await open();
    await manager.enable(input(source));

    await manager.dispose();
    await manager.dispose();

    expect(fake.loaded.size).toBe(0);
    expect(manager.loadedIds()).toEqual([]);
    expect(manager.loadedRecords()).toEqual([]);
    await expect(stat(path.join(workingRoot, 'com.community.ext', 'ublock'))).resolves.toBeDefined();
  });
});
