/* oxlint-disable no-await-in-loop -- scenarios build one world at a time */
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseAdapterDocument, type AdapterDocument } from '@/common/packages/adapter';
import { createExtensionHostManager } from '@process/integrations/browserExtensions/host';
import { createExtensionStore } from '@process/integrations/browserExtensions/store';
import { createConnectionRegistry, type LoadedPackage } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { createExtensionHost } from '@process/integrations/connections/hosts/exec/extensionHost';
import { ConnectionError, type HostContext } from '@process/integrations/connections/core/types';
import { MV3_MANIFEST, createFakeLoader, useTempRoots, writeExtension } from '../../browserExtensions/extensionFixture';

const temp = useTempRoots();
const PACKAGE_ID = 'com.community.ext';
const KEY = 'extension:ublock';

const connectionJson = (extra: Record<string, unknown> = {}) => ({
  kind: 'extension',
  id: 'ublock',
  title: 'Fixture extension',
  format: 'chrome-mv3',
  root: 'source/ext',
  permissions: ['storage', 'alarms'],
  hostPermissions: ['https://*.example.com/*'],
  unsupported: ['sidePanel'],
  ...extra,
});

const adapterOf = (...connections: Record<string, unknown>[]): AdapterDocument =>
  parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections });

type World = Awaited<ReturnType<typeof createWorld>>;

/** One package on disk, one registry with the extension host over a fake loader, restartable with `restart()`. */
const createWorld = async (
  options: { manifest?: Record<string, unknown>; connection?: Record<string, unknown> } = {}
) => {
  const root = await temp();
  const packageDirectory = path.join(root, 'packages', PACKAGE_ID, '1.0.0');
  const extensionDirectory = path.join(packageDirectory, 'source', 'ext');
  await writeExtension(extensionDirectory, options.manifest ?? MV3_MANIFEST);
  let adapter = adapterOf(connectionJson(options.connection));
  let version = '1.0.0';
  let fake = createFakeLoader();
  const loadErrors = vi.fn();

  const build = async () => {
    const extensionStore = createExtensionStore(path.join(root, 'tomny-extensions-state.json'));
    await extensionStore.initialize();
    const manager = createExtensionHostManager({
      loader: fake.loader,
      store: extensionStore,
      workingRoot: path.join(root, 'tomny-extensions'),
      onLoadError: loadErrors,
      log: () => undefined,
    });
    const state = createJsonConnectionStateStore(path.join(root, 'connections.json'));
    await state.initialize();
    const registry = createConnectionRegistry({
      store: state,
      hosts: [createExtensionHost({ manager: async () => manager })],
      loadPackage: async (): Promise<LoadedPackage> => ({
        packageId: PACKAGE_ID,
        packageVersion: version,
        packageDirectory,
        adapter,
      }),
      listInstalledPackageIds: async () => [PACKAGE_ID],
    });
    return { registry, state, manager };
  };

  let current = await build();
  return {
    root,
    extensionDirectory,
    packageDirectory,
    get fake() {
      return fake;
    },
    get registry() {
      return current.registry;
    },
    get state() {
      return current.state;
    },
    loadErrors,
    setAdapter: (next: AdapterDocument) => {
      adapter = next;
    },
    setVersion: (next: string) => {
      version = next;
    },
    /** The app is closed and opened again: Electron forgets extensions, Main reads its files. */
    restart: async () => {
      fake = createFakeLoader();
      current = await build();
    },
  };
};

const approve = async (world: World) => {
  await world.registry.syncPackage(PACKAGE_ID);
  const { approvalHash } = await world.registry.describe(PACKAGE_ID, KEY);
  return world.registry.enable(PACKAGE_ID, KEY, approvalHash);
};

describe('extension host: approval', () => {
  it('lists permissions, site access, content script matches and unsupported APIs', async () => {
    const world = await createWorld();
    await world.registry.syncPackage(PACKAGE_ID);

    const { subject } = await world.registry.describe(PACKAGE_ID, KEY);

    const text = subject.lines.map((line) => `${line.label}: ${line.value}`).join('\n');
    expect(text).toContain('Permissions: storage, alarms');
    expect(text).toContain('Site access (host permissions): https://*.example.com/*');
    expect(text).toContain('Content scripts run on: https://news.example.org/*');
    expect(text).toContain('Chrome APIs not available here: sidePanel');
    expect(subject.files).toEqual(
      expect.arrayContaining([
        'source/ext/manifest.json',
        'source/ext/sw.js',
        'source/ext/content.js',
        'source/ext/popup.html',
        'source/ext/popup.js',
      ])
    );
    expect(subject.files).not.toContain('source/ext/icons/icon.png');
  });

  it('changes the approval hash when the manifest, the service worker or an unlisted popup script changes', async () => {
    const world = await createWorld();
    await world.registry.syncPackage(PACKAGE_ID);
    const base = (await world.registry.describe(PACKAGE_ID, KEY)).approvalHash;

    await writeFile(path.join(world.extensionDirectory, 'popup.js'), 'fetch("https://evil.example/")');
    const popup = (await world.registry.describe(PACKAGE_ID, KEY)).approvalHash;
    await writeFile(path.join(world.extensionDirectory, 'sw.js'), 'self.x = 1;');
    const worker = (await world.registry.describe(PACKAGE_ID, KEY)).approvalHash;
    await writeFile(
      path.join(world.extensionDirectory, 'manifest.json'),
      JSON.stringify({ ...MV3_MANIFEST, host_permissions: ['<all_urls>'] })
    );
    const manifest = (await world.registry.describe(PACKAGE_ID, KEY)).approvalHash;

    expect(new Set([base, popup, worker, manifest]).size).toBe(4);
  });

  it('is stable when nothing changed', async () => {
    const world = await createWorld();
    await world.registry.syncPackage(PACKAGE_ID);
    const first = await world.registry.describe(PACKAGE_ID, KEY);
    const second = await world.registry.describe(PACKAGE_ID, KEY);
    expect(second.approvalHash).toBe(first.approvalHash);
  });
});

describe('extension host: support check', () => {
  it('marks Manifest V2 with a background as unsupported with the Manifest V3 reason', async () => {
    const world = await createWorld({
      manifest: { manifest_version: 2, name: 'Old', version: '1', background: { scripts: ['bg.js'] } },
      connection: { format: 'chrome-mv2' },
    });
    const [view] = await world.registry.syncPackage(PACKAGE_ID);
    expect(view?.state).toMatchObject({ status: 'unsupported' });
    expect(view?.state.reason).toContain('cần bản Manifest V3');
    await expect(world.registry.enable(PACKAGE_ID, KEY, 'sha256-' + '0'.repeat(64))).rejects.toMatchObject({
      code: 'RUNTIME_MISSING',
    });
  });

  it('marks userscripts, extensions that need a build, and roots outside source/ as unsupported', async () => {
    for (const extra of [
      { format: 'userscript' },
      { needsBuild: true },
      { root: 'adapter/ext' },
      { root: 'source/missing' },
    ]) {
      const world = await createWorld({ connection: extra });
      const [view] = await world.registry.syncPackage(PACKAGE_ID);
      expect(view?.state.status, JSON.stringify(extra)).toBe('unsupported');
      expect(view?.state.reason).toBeTruthy();
    }
  });

  it('refuses a source folder that is a link to somewhere outside the package', async () => {
    const world = await createWorld({ connection: { root: 'source/linked' } });
    const outside = await writeExtension(path.join(world.root, 'outside'));
    try {
      await symlink(outside, path.join(world.packageDirectory, 'source', 'linked'), 'junction');
    } catch {
      return; // links cannot be created in this environment
    }
    const [view] = await world.registry.syncPackage(PACKAGE_ID);
    expect(view?.state.status).toBe('unsupported');
    expect(view?.state.reason).toContain('ngoài gói');
  });
});

describe('extension host: enable, disable, restart', () => {
  it('loads the extension on enable and unloads it on disable', async () => {
    const world = await createWorld();

    const state = await approve(world);

    expect(state).toMatchObject({ enabled: true, status: 'on' });
    expect(world.fake.loaded.size).toBe(1);
    expect(state.installed).toEqual([...world.fake.loaded.keys()]);

    expect(await world.registry.disable(PACKAGE_ID, KEY)).toMatchObject({ enabled: false, status: 'off' });
    expect(world.fake.loaded.size).toBe(0);
  });

  it('needs the approval the person was shown', async () => {
    const world = await createWorld();
    await world.registry.syncPackage(PACKAGE_ID);
    await expect(world.registry.enable(PACKAGE_ID, KEY, 'sha256-' + '1'.repeat(64))).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(world.fake.loaded.size).toBe(0);
  });

  it('loads enabled extensions again after a restart, with the same id, and nothing else', async () => {
    const world = await createWorld();
    const state = await approve(world);
    await world.registry.setAutoStart(PACKAGE_ID, KEY, true);

    await world.restart();
    expect(world.fake.loaded.size).toBe(0);
    await world.registry.reconcile();

    expect([...world.fake.loaded.keys()]).toEqual(state.installed);
    expect(world.state.get(PACKAGE_ID, KEY)).toMatchObject({ enabled: true, status: 'on' });
  });

  it('does not load a disabled extension after a restart', async () => {
    const world = await createWorld();
    await approve(world);
    await world.registry.disable(PACKAGE_ID, KEY);
    await world.restart();
    await world.registry.reconcile();
    expect(world.fake.loaded.size).toBe(0);
  });

  it('shows the reason as the connection status when the load fails on enable', async () => {
    const world = await createWorld();
    await world.registry.syncPackage(PACKAGE_ID);
    const { approvalHash } = await world.registry.describe(PACKAGE_ID, KEY);
    world.fake.fail.message = 'Could not load extension from disk';

    await expect(world.registry.enable(PACKAGE_ID, KEY, approvalHash)).rejects.toBeInstanceOf(ConnectionError);

    expect(world.state.get(PACKAGE_ID, KEY)).toMatchObject({ enabled: false, status: 'error' });
    expect(world.state.get(PACKAGE_ID, KEY)?.lastError).toContain('Không nạp được tiện ích');
    expect(world.fake.loaded.size).toBe(0);
  });

  it('tells the caller when an enabled extension cannot be loaded again at startup', async () => {
    const world = await createWorld();
    await approve(world);
    await world.registry.setAutoStart(PACKAGE_ID, KEY, true);
    await world.restart();
    world.fake.fail.message = 'Extension is corrupted';

    await world.registry.reconcile();

    // A start-again extension that cannot load stays off, and the record carries the reason.
    expect(world.state.get(PACKAGE_ID, KEY)).toMatchObject({ enabled: false });
    expect(world.state.get(PACKAGE_ID, KEY)?.lastError).toContain('Extension is corrupted');
    expect(world.fake.loaded.size).toBe(0);
  });

  it('keeps the extension id and storage when the package updates without changing the extension', async () => {
    const world = await createWorld();
    const state = await approve(world);
    const [id] = state.installed ?? [];
    const stored = world.fake.storage.get(id ?? '');
    if (stored) stored.setting = 'dark';

    world.setVersion('1.0.1');
    const [view] = await world.registry.syncPackage(PACKAGE_ID);

    expect(view?.state).toMatchObject({ enabled: true, status: 'on', packageVersion: '1.0.1' });
    expect([...world.fake.loaded.keys()]).toEqual([id]);
    expect(world.fake.storage.get(id ?? '')).toEqual({ setting: 'dark' });
  });

  it('turns an extension off for approval when its code changed, and gets the same id after approving again', async () => {
    const world = await createWorld();
    const state = await approve(world);
    const [id] = state.installed ?? [];

    await writeFile(path.join(world.extensionDirectory, 'content.js'), 'document.body.remove();');
    const [view] = await world.registry.syncPackage(PACKAGE_ID);

    expect(view?.state).toMatchObject({ enabled: false, status: 'needs-input' });
    expect(world.fake.loaded.size).toBe(0);

    const again = await approve(world);
    expect(again.installed).toEqual([id]);
  });

  it('removes the extension when the package is removed', async () => {
    const world = await createWorld();
    await approve(world);
    await world.registry.removePackage(PACKAGE_ID);
    expect(world.fake.loaded.size).toBe(0);
    await world.restart();
    await world.registry.reconcile();
    expect(world.fake.loaded.size).toBe(0);
  });

  it('keeps the Web Store id when the connection carries the public key', async () => {
    const { generateExtensionKey, extensionIdFromKey } =
      await import('@process/integrations/browserExtensions/workingCopy');
    const publicKey = generateExtensionKey();
    const world = await createWorld({ connection: { publicKey } });
    const state = await approve(world);
    expect(state.installed).toEqual([extensionIdFromKey(publicKey)]);
  });
});

describe('extension host: contract', () => {
  it('reads nothing outside the package: check and describe use the package directory only', async () => {
    const world = await createWorld();
    const host = createExtensionHost({ manager: async () => ({}) as never });
    const context: HostContext = {
      packageId: PACKAGE_ID,
      packageVersion: '1.0.0',
      packageDirectory: world.packageDirectory,
      readPackageFile: async () => Buffer.from(''),
    };
    const [connection] = adapterOf(connectionJson()).connections;
    await expect(host.check(context, connection as never)).resolves.toEqual({ ok: true });
    await expect(host.describe(context, connection as never)).resolves.toMatchObject({ kind: 'extension' });
  });
});
