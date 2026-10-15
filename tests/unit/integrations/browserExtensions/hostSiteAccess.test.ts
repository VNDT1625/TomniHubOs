import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionHostManager,
  ExtensionHostError,
  extensionKeepKey,
  type ExtensionLoaderPort,
} from '@process/integrations/browserExtensions/host';
import { createExtensionStore } from '@process/integrations/browserExtensions/store';
import type { SiteAccessConfig } from '@/common/integrations/extensions/siteAccess';
import { createFakeLoader, useTempRoots, writeExtension } from './extensionFixture';

const temp = useTempRoots();

const BROAD = {
  manifest_version: 3,
  name: 'Broad',
  version: '1.0.0',
  background: { service_worker: 'sw.js' },
  host_permissions: ['<all_urls>', 'https://github.com/*'],
  content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
};

const KEEP = new Set([extensionKeepKey('com.community.ext', 'ublock')]);
const cfg = (mode: SiteAccessConfig['mode'], sites: string[] = []): SiteAccessConfig => ({
  mode,
  sites,
  sessionSites: [],
});

const setup = async () => {
  const root = await temp();
  const fake = createFakeLoader();
  const stateFile = path.join(root, 'state.json');
  const workingRoot = path.join(root, 'tomny-extensions');
  const source = await writeExtension(path.join(root, 'pkg', '1.0.0', 'source', 'ext'), BROAD);
  const copyFile = path.join(workingRoot, 'com.community.ext', 'ublock', 'manifest.json');
  const copyManifest = async () =>
    JSON.parse(await readFile(copyFile, 'utf8')) as {
      key?: string;
      host_permissions?: string[];
      content_scripts?: { matches: string[] }[];
    };
  const open = async (loader: ExtensionLoaderPort, choice: () => SiteAccessConfig) => {
    const state = createExtensionStore(stateFile);
    await state.initialize();
    return {
      store: state,
      manager: createExtensionHostManager({
        loader,
        store: state,
        workingRoot,
        siteAccessOf: () => choice(),
        onLoadError: vi.fn(),
        log: () => undefined,
      }),
    };
  };
  return { root, fake, source, workingRoot, copyFile, copyManifest, open };
};

const input = (sourceRoot: string) => ({ packageId: 'com.community.ext', connectionId: 'ublock', sourceRoot });

describe('site access reaches the loaded content scripts', () => {
  it('on-click loads the extension without its broad content scripts and host permissions', async () => {
    const { fake, open, source, copyManifest } = await setup();
    const { manager } = await open(fake.loader, () => cfg('on-click'));

    const { extensionId } = await manager.enable(input(source));

    const copy = await copyManifest();
    expect(copy.content_scripts).toEqual([]);
    expect(copy.host_permissions).toEqual(['https://github.com/*']);
    expect(copy.key).toMatch(/.+/);
    expect(manager.loadedIds()).toEqual([extensionId]);
  });

  it('never changes the package folder: the source manifest keeps its broad patterns', async () => {
    const { fake, open, source } = await setup();
    const before = await readFile(path.join(source, 'manifest.json'), 'utf8');
    const { manager } = await open(fake.loader, () => cfg('on-click'));

    await manager.enable(input(source));
    await manager.setSiteAccess((await manager.enable(input(source))).extensionId, cfg('all-sites'));

    expect(await readFile(path.join(source, 'manifest.json'), 'utf8')).toBe(before);
  });

  it('a change of mode reloads the extension at once, with the same id and storage', async () => {
    const { fake, open, source, copyManifest } = await setup();
    let choice = cfg('on-click');
    const { manager } = await open(fake.loader, () => choice);
    const { extensionId } = await manager.enable(input(source));
    const first = fake.storage.get(extensionId);
    if (first) first.setting = 'kept';
    const load = vi.spyOn(fake.loader, 'load');

    choice = cfg('all-sites');
    await manager.setSiteAccess(extensionId, choice);

    expect(load).toHaveBeenCalledTimes(1);
    expect(manager.loadedIds()).toEqual([extensionId]);
    expect((await copyManifest()).content_scripts).toEqual([{ matches: ['<all_urls>'], js: ['content.js'] }]);
    expect(fake.storage.get(extensionId)).toEqual({ setting: 'kept' });
  });

  it('a granted site reloads with exactly that origin, and revoking the grant (back to on-click) removes it', async () => {
    const { fake, open, source, copyManifest } = await setup();
    let choice = cfg('on-click');
    const { manager } = await open(fake.loader, () => choice);
    const { extensionId } = await manager.enable(input(source));

    choice = cfg('on-site', ['https://a.example.com']);
    await manager.setSiteAccess(extensionId, choice);
    expect((await copyManifest()).content_scripts).toEqual([
      { matches: ['https://a.example.com/*'], js: ['content.js'] },
    ]);
    expect((await copyManifest()).host_permissions).toEqual(['https://github.com/*', 'https://a.example.com/*']);

    choice = cfg('on-click');
    await manager.setSiteAccess(extensionId, choice);
    expect((await copyManifest()).content_scripts).toEqual([]);
  });

  it('restores a wider choice after a narrower one, because the source is kept (the copy never narrows its own source)', async () => {
    const { fake, open, source, copyManifest } = await setup();
    let choice = cfg('on-click');
    const { manager } = await open(fake.loader, () => choice);
    const { extensionId } = await manager.enable(input(source));

    choice = cfg('all-sites');
    await manager.setSiteAccess(extensionId, choice);

    expect((await copyManifest()).host_permissions).toEqual(['<all_urls>', 'https://github.com/*']);
  });

  it('a restart applies the saved choice at startup', async () => {
    const { fake, open, source, copyManifest } = await setup();
    const before = await open(fake.loader, () => cfg('on-click'));
    const { extensionId } = await before.manager.enable(input(source));

    const fresh = createFakeLoader();
    const after = await open(fresh.loader, () => cfg('on-site', ['https://a.example.com']));
    await after.manager.reconcile(KEEP);

    expect([...fresh.loaded.keys()]).toEqual([extensionId]);
    expect((await copyManifest()).content_scripts).toEqual([
      { matches: ['https://a.example.com/*'], js: ['content.js'] },
    ]);
  });

  it('a malformed content script is skipped at load and recorded in the record, the rest still loads', async () => {
    const { root, fake, open } = await setup();
    const bad = await writeExtension(path.join(root, 'bad', 'source'), {
      ...BROAD,
      host_permissions: [],
      content_scripts: [
        { matches: ['https://*.example.*/*'], js: ['content.js'] },
        { matches: ['https://news.example.org/*'], js: ['content.js'] },
      ],
    });
    const { manager, store } = await open(fake.loader, () => cfg('all-sites'));

    const { extensionId } = await manager.enable({
      packageId: 'com.community.ext',
      connectionId: 'ublock',
      sourceRoot: bad,
    });

    expect(manager.loadedIds()).toEqual([extensionId]);
    expect(store.getLoaded('com.community.ext', 'ublock')?.lastError).toContain('không hợp lệ');
  });

  it('a change that fails to load rejects with the reason, and the record says why', async () => {
    const { fake, open, source } = await setup();
    let choice = cfg('on-click');
    const { manager, store } = await open(fake.loader, () => choice);
    const { extensionId } = await manager.enable(input(source));

    fake.fail.message = 'Manifest is not valid: service worker missing';
    choice = cfg('all-sites');
    await expect(manager.setSiteAccess(extensionId, choice)).rejects.toBeInstanceOf(ExtensionHostError);

    expect(manager.loadedIds()).toEqual([]);
    expect(store.getLoaded('com.community.ext', 'ublock')?.lastError).toContain('Manifest is not valid');
  });

  it('a change for an extension that is not loaded does nothing (it applies at the next load)', async () => {
    const { fake, open } = await setup();
    const { manager } = await open(fake.loader, () => cfg('on-click'));
    await expect(manager.setSiteAccess('a'.repeat(32), cfg('all-sites'))).resolves.toBeUndefined();
    expect(fake.loaded.size).toBe(0);
  });

  it('still refuses a copy whose key was changed by hand, before it rewrites or loads it', async () => {
    const { fake, open, source, copyFile } = await setup();
    const { manager } = await open(fake.loader, () => cfg('on-click'));
    await manager.enable(input(source));
    const tampered = JSON.parse(await readFile(copyFile, 'utf8')) as Record<string, unknown>;
    await writeFile(copyFile, JSON.stringify({ ...tampered, key: 'MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAMFTX' }));

    const { manager: restarted } = await open(createFakeLoader().loader, () => cfg('on-click'));
    await restarted.reconcile(KEEP);

    expect(restarted.loadedIds()).toEqual([]);
  });
});
