/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ WebContentsView: vi.fn(), app: {}, session: {} }));

import { WebEmbedError, webEmbedAllowedOrigins, webEmbedStartUrl } from '@/common/integrations/webEmbed/webEmbed';
import { parseAdapterDocument, type AdapterConnection } from '@/common/packages/adapter';
import { BROWSER_PROFILE_PARTITION } from '@process/integrations/browserExtensions/profile';
import { createConnectionRegistry } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { createWebEmbedHost, type ProgramProbe } from '@process/integrations/connections/hosts/exec/webEmbedHost';
import { createServiceSlots } from '@process/integrations/runtime/repoProcessPorts';
import { createJsonSetupMarkerStore } from '@process/integrations/runtime/repoProcessStores';
import {
  createWebEmbedAppService,
  resolvePackageSecret,
  type WebEmbedAppService,
} from '@process/integrations/runtime/webEmbedApps';
import {
  createWebEmbedTabOpener,
  decideAppNavigation,
  type AppNavigationEvent,
  type GuardedWebContents,
} from '@process/integrations/runtime/webEmbedTabs';
import type { PackagePersistentContributionEvidence } from '@process/resources/packageProcessRuntime/persistentContributionSupervisor';
import type { PackageSecretInfo } from '@process/resources/packageSecrets/packageSecretPort';
import { makeHarness, type HarnessOptions } from '../../runtime/repoProcessHarness';

const PACKAGE_ID = 'com.community.medisign';
const KEY = 'web-embed:medisign';
const SECRET = 'sekret-value-123456';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const processApp = (extra: Record<string, unknown> = {}, withSetup = true) => ({
  kind: 'web-embed',
  id: 'medisign',
  title: 'MediSign',
  process: {
    services: [
      {
        id: 'api',
        cwd: 'source/api',
        ...(withSetup ? { setup: [['npm', 'install']] } : {}),
        start: ['node', 'server.js'],
        ready: { port: 4101 },
        env: [{ name: 'DB_KEY', required: true }],
      },
      { id: 'web', cwd: 'source/web', start: ['npm', 'run', 'dev'], ready: { port: 4102 } },
    ],
    embed: { service: 'web', path: '/app' },
  },
  ...extra,
});

const urlApp = (extra: Record<string, unknown> = {}) => ({
  kind: 'web-embed',
  id: 'docs',
  title: 'Docs',
  url: 'https://docs.example.com/app',
  origins: ['https://cdn.example.com'],
  ...extra,
});

const connectionOf = (raw: unknown): AdapterConnection => {
  const [connection] = parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: [raw],
  }).connections;
  if (connection?.kind !== 'web-embed') throw new Error('fixture is not a valid web-embed connection');
  return connection;
};

type WorldOptions = {
  harness?: HarnessOptions;
  probe?: ProgramProbe;
  slots?: ReturnType<typeof createServiceSlots>;
};

/** A real registry, state store, setup markers and app service over a package on disk and fake operating-system ports. */
const makeWorld = async (raw: unknown, options: WorldOptions = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-webembed-'));
  roots.push(root);
  const packageDirectory = path.join(root, 'pkg');
  for (const folder of ['api', 'web']) await mkdir(path.join(packageDirectory, 'source', folder), { recursive: true });
  await writeFile(path.join(packageDirectory, 'source', 'api', 'server.js'), 'console.log("api v1")');
  await writeFile(path.join(packageDirectory, 'source', 'api', 'package.json'), '{"name":"api"}');
  await writeFile(path.join(packageDirectory, 'source', 'web', 'package.json'), '{"name":"web"}');

  const harness = makeHarness({ secrets: { DB_KEY: SECRET }, ...options.harness });
  const store = createJsonConnectionStateStore(path.join(root, 'state.json'));
  await store.initialize();
  const markerFile = path.join(root, 'markers.json');
  const markers = createJsonSetupMarkerStore(markerFile);
  const adapter = parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections: [raw] });
  const probe = vi.fn<ProgramProbe>(options.probe ?? (async () => ({ ok: true })));
  const evidence: PackagePersistentContributionEvidence[] = [];
  const slots = options.slots ?? createServiceSlots(6);
  let apps: WebEmbedAppService | undefined;
  const host = createWebEmbedHost({
    programProbe: probe,
    control: {
      stop: (request) => apps?.stop(request) ?? Promise.resolve(),
      reconcile: (keep) => apps?.reconcile(keep) ?? Promise.resolve(),
    },
  });
  const registry = createConnectionRegistry({
    store,
    hosts: [host],
    loadPackage: async (packageId) =>
      packageId === PACKAGE_ID ? { packageId, packageVersion: '1.0.0', packageDirectory, adapter } : undefined,
    listInstalledPackageIds: async () => [PACKAGE_ID],
  });
  apps = createWebEmbedAppService({
    registry,
    portsFor: (scope) => ({
      ...harness.ports,
      setupMarkers: markers.scoped(`${scope.packageId}|${scope.connectionId}|${scope.packageVersion}|`),
    }),
    recordEvidence: async (entry) => {
      evidence.push(entry);
    },
    clearSetup: (packageId, connectionId) => markers.clear(`${packageId}|${connectionId}|`),
    slots,
  });
  await registry.syncPackage(PACKAGE_ID);
  const service = apps;

  const turnOn = async (key = KEY) => {
    const approval = await registry.describe(PACKAGE_ID, key);
    return registry.enable(PACKAGE_ID, key, approval.approvalHash);
  };
  return {
    root,
    packageDirectory,
    harness,
    registry,
    apps: service,
    probe,
    evidence,
    slots,
    markerFile,
    turnOn,
    store,
  };
};

const ref = { packageId: PACKAGE_ID, connectionId: 'medisign' } as const;

describe('web-embed host: what the person approves', () => {
  it('shows the exact address and origins of a url app, starts nothing, and records it as on', async () => {
    const world = await makeWorld(urlApp());
    const { subject } = await world.registry.describe(PACKAGE_ID, 'web-embed:docs');
    const text = JSON.stringify(subject.lines);
    expect(text).toContain('https://docs.example.com/app');
    expect(text).toContain('https://docs.example.com, https://cdn.example.com');
    expect(subject.files).toEqual([]);

    const state = await world.turnOn('web-embed:docs');
    expect(state).toMatchObject({ enabled: true, status: 'on', installed: ['app:docs'] });
    expect(world.harness.spawns).toHaveLength(0);
    expect(world.probe).not.toHaveBeenCalled();
  });

  it('lists every command, setup command, port and variable NAME of a process app, never a value', async () => {
    const world = await makeWorld(processApp());
    const { subject } = await world.registry.describe(PACKAGE_ID, KEY);
    const text = subject.lines.map((line) => `${line.label}: ${line.value}`).join(' | ');
    expect(text).toContain('npm install');
    expect(text).toContain('node server.js');
    expect(text).toContain('npm run dev');
    expect(text).toContain('127.0.0.1:4101');
    expect(text).toContain('http://127.0.0.1:4102/app');
    expect(text).toContain('DB_KEY');
    expect(text).toContain(path.join(world.packageDirectory, 'source', 'api'));
    expect(text).not.toContain(SECRET);
    // The files the commands run are part of the approval.
    expect(subject.files).toEqual(['source/api/package.json', 'source/api/server.js', 'source/web/package.json']);
  });

  it('needs a new approval when a file the app runs changes after it was approved', async () => {
    const world = await makeWorld(processApp());
    const before = await world.registry.describe(PACKAGE_ID, KEY);
    await writeFile(path.join(world.packageDirectory, 'source', 'api', 'server.js'), 'require("evil")');
    const after = await world.registry.describe(PACKAGE_ID, KEY);
    expect(after.approvalHash).not.toBe(before.approvalHash);
    await expect(world.registry.enable(PACKAGE_ID, KEY, before.approvalHash)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
  });

  it('does not consult this machine when describing, so installing a runtime later keeps an approval valid', async () => {
    const world = await makeWorld(processApp(), {
      probe: async (program) =>
        program === 'npm' ? { ok: false, reason: '"npm" is not installed or not on PATH.' } : { ok: true },
    });
    const calls = world.probe.mock.calls.length;
    await world.registry.describe(PACKAGE_ID, KEY);
    expect(world.probe.mock.calls.length).toBe(calls);
  });

  it('is unsupported with a readable reason when a program is missing, and node needs no probe', async () => {
    const world = await makeWorld(processApp(), {
      probe: async (program) =>
        program === 'npm' ? { ok: false, reason: '"npm" is not installed or not on PATH.' } : { ok: true },
    });
    const [view] = await world.registry.view(PACKAGE_ID);
    expect(view?.state).toMatchObject({ status: 'unsupported', reason: '"npm" is not installed or not on PATH.' });
    const probed = world.probe.mock.calls.map(([program]) => program);
    expect(probed).toContain('npm');
    expect(probed).not.toContain('node');
    await expect(world.turnOn()).rejects.toMatchObject({ code: 'RUNTIME_MISSING' });
  });

  it('is unsupported when a working folder is missing or an address has a password', async () => {
    const folder = await makeWorld(
      processApp({
        process: {
          services: [{ id: 'web', cwd: 'source/nowhere', start: ['npm', 'start'], ready: { port: 4105 } }],
          embed: { service: 'web' },
        },
      })
    );
    expect((await folder.registry.view(PACKAGE_ID))[0]?.state).toMatchObject({ status: 'unsupported' });

    const credentials = await makeWorld(urlApp({ url: 'https://user:pw@docs.example.com/' }));
    expect((await credentials.registry.view(PACKAGE_ID))[0]?.state).toMatchObject({ status: 'unsupported' });
  });
});

describe('web-embed process lifecycle (fake operating system)', () => {
  it('starts nothing when turned on; opening starts services in order, runs setup once, and returns Main-chosen address', async () => {
    const world = await makeWorld(processApp());
    await world.turnOn();
    expect(world.harness.spawns).toHaveLength(0);
    await expect(world.apps.launch({ packageId: PACKAGE_ID, connectionId: 'missing' })).rejects.toMatchObject({
      code: 'NOT_ENABLED',
    });

    const launch = await world.apps.launch(ref);

    expect(launch.url).toBe('http://127.0.0.1:4102/app');
    expect(launch.allowedOrigins).toEqual([
      'http://127.0.0.1:4101',
      'http://localhost:4101',
      'http://127.0.0.1:4102',
      'http://localhost:4102',
    ]);
    // setup (npm install) of api, then api, then web.
    expect(world.harness.spawns.map((record) => record.req.args[0])).toEqual(['install', 'server.js', 'run']);
    const api = world.harness.spawns[1]?.req;
    expect(api?.env['DB_KEY']).toBe(SECRET);
    expect(api?.env['PORT']).toBe('4101');
    expect(api?.env['HOST']).toBe('127.0.0.1');
    expect(api?.env['GITHUB_TOKEN']).toBeUndefined();
    expect(world.harness.spawns[2]?.req.env['DB_KEY']).toBeUndefined();
    expect(world.apps.services(ref).map((entry) => entry.state)).toEqual(['ready', 'ready']);
    expect(world.evidence.map((entry) => entry.phase)).toEqual(['admitted', 'started']);
    expect(JSON.stringify(world.evidence)).not.toContain(SECRET);

    // Opening again reuses the running app.
    await world.apps.launch(ref);
    expect(world.harness.spawns).toHaveLength(3);
  });

  it('keeps setup markers per package, connection and version, and clears them when turned off', async () => {
    const world = await makeWorld(processApp());
    await world.turnOn();
    await world.apps.launch(ref);
    expect(await readFile(world.markerFile, 'utf8')).toContain(`${PACKAGE_ID}|medisign|1.0.0|`);

    await world.registry.disable(PACKAGE_ID, KEY);
    expect(JSON.parse(await readFile(world.markerFile, 'utf8')).marks).toEqual([]);
    expect(world.harness.kills.map((kill) => kill.pid).toSorted()).toEqual(
      [world.harness.spawns[1]?.pid, world.harness.spawns[2]?.pid].toSorted()
    );
    expect(world.slots.inUse()).toBe(0);
    expect(world.apps.services(ref)).toEqual([]);

    // Turned on again: dependencies are installed again, never assumed.
    await world.turnOn();
    await world.apps.launch(ref);
    expect(world.harness.spawns.filter((record) => record.req.args[0] === 'install')).toHaveLength(2);
  });

  it('stops the processes when the package is removed or reconcile no longer keeps the connection', async () => {
    const removed = await makeWorld(processApp());
    await removed.turnOn();
    await removed.apps.launch(ref);
    await removed.registry.removePackage(PACKAGE_ID);
    expect(removed.harness.kills).toHaveLength(2);
    expect(removed.slots.inUse()).toBe(0);

    const reconciled = await makeWorld(processApp());
    await reconciled.turnOn();
    await reconciled.apps.launch(ref);
    await reconciled.apps.reconcile(new Set([`${PACKAGE_ID}\u0000${KEY}`]));
    expect(reconciled.harness.kills).toHaveLength(0);
    await reconciled.apps.reconcile(new Set());
    expect(reconciled.harness.kills).toHaveLength(2);
  });

  it('refuses to start, and spawns nothing, when what would run changed after approval', async () => {
    const world = await makeWorld(processApp());
    await world.turnOn();
    await writeFile(path.join(world.packageDirectory, 'source', 'api', 'server.js'), 'require("evil")');
    await expect(world.apps.launch(ref)).rejects.toMatchObject({ code: 'NEEDS_APPROVAL' });
    expect(world.harness.spawns).toHaveLength(0);
  });

  it('reports the port owner when a port is taken, and an unset variable as input needed', async () => {
    const taken = await makeWorld(processApp({}, false), {
      harness: { alreadyListening: [4101], owner: 'node.exe (pid 4)' },
    });
    await taken.turnOn();
    const error: unknown = await taken.apps.launch(ref).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebEmbedError);
    expect(error).toMatchObject({ code: 'PORT_IN_USE' });
    expect((error as Error).message).toContain('node.exe (pid 4)');
    expect(taken.harness.spawns).toHaveLength(0);
    expect(taken.slots.inUse()).toBe(0);

    const unset = await makeWorld(processApp(), { harness: { secrets: {} } });
    await unset.turnOn();
    await expect(unset.apps.launch(ref)).rejects.toMatchObject({ code: 'NEEDS_INPUT' });
    expect(unset.harness.spawns).toHaveLength(0);
  });

  it('refuses to start when the app-wide service limit would be passed', async () => {
    const world = await makeWorld(processApp(), { slots: createServiceSlots(1) });
    await world.turnOn();
    await expect(world.apps.launch(ref)).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    expect(world.harness.spawns).toHaveLength(0);
  });

  it('answers a url app without starting any process', async () => {
    const world = await makeWorld(urlApp());
    await world.turnOn('web-embed:docs');
    const launch = await world.apps.launch({ packageId: PACKAGE_ID, connectionId: 'docs' });
    expect(launch).toEqual({
      title: 'Docs',
      url: 'https://docs.example.com/app',
      allowedOrigins: ['https://docs.example.com', 'https://cdn.example.com'],
    });
    expect(world.harness.spawns).toHaveLength(0);
  });
});

const secretSet = (handle: string, origin: 'own' | 'granted', fields: string[]): PackageSecretInfo => ({
  handle,
  label: handle,
  fields,
  origin,
  updatedAt: 1,
});

describe('web-embed origins and package secrets', () => {
  it('confines a process app to its own loopback ports and ignores declared origins', () => {
    const connection = connectionOf(processApp({ origins: ['https://evil.example.com'] }));
    if (connection.kind !== 'web-embed') throw new Error('fixture');
    expect(webEmbedAllowedOrigins(connection)).not.toContain('https://evil.example.com');
    expect(webEmbedStartUrl(connection)).toBe('http://127.0.0.1:4102/app');
  });

  it('reads a variable from the package own set first, skips a refused set, and returns nothing when none holds it', async () => {
    const resolve = vi.fn(async (handle: string, names: readonly string[]) => {
      if (handle === 'broken') throw new Error('refused');
      return Object.fromEntries(names.map((name) => [name, `${handle}-value`]));
    });
    const port = {
      list: async () => [
        secretSet('shared', 'granted', ['KEY']),
        secretSet('broken', 'own', ['KEY']),
        secretSet('mine', 'own', ['KEY']),
      ],
      resolve,
    };
    expect(await resolvePackageSecret(port, 'KEY')).toBe('mine-value');
    expect(resolve.mock.calls.map(([handle]) => handle)).toEqual(['broken', 'mine']);
    expect(await resolvePackageSecret(port, 'OTHER')).toBeUndefined();
  });
});

describe('web-embed tab: the renderer cannot choose the session or address', () => {
  type FakeContents = GuardedWebContents & {
    fire: (event: 'will-navigate' | 'will-redirect', data: Partial<AppNavigationEvent>) => boolean;
    open: (url: string) => { action: 'deny' };
    loaded: string[];
  };

  const fakeContents = (): FakeContents => {
    const listeners = new Map<string, (event: AppNavigationEvent, legacyUrl?: string) => void>();
    let openHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
    const loaded: string[] = [];
    return {
      on: (event, listener) => {
        listeners.set(event, listener);
      },
      setWindowOpenHandler: (handler) => {
        openHandler = handler;
      },
      loadURL: async (url) => {
        loaded.push(url);
      },
      fire: (event, data) => {
        let prevented = false;
        listeners.get(event)?.({ preventDefault: () => (prevented = true), ...data });
        return prevented;
      },
      open: (url) => openHandler?.({ url }) ?? { action: 'deny' },
      loaded,
    };
  };

  const makeOpener = (options: { contents?: FakeContents | null; launch?: () => Promise<unknown> } = {}) => {
    const contents = options.contents === undefined ? fakeContents() : options.contents;
    const created: Array<Record<string, unknown>> = [];
    const loadedByTab: Array<[string, string]> = [];
    const destroyed: string[] = [];
    let live: string[] = [];
    const launch = vi.fn(
      options.launch ??
        (async () => ({
          title: 'MediSign',
          url: 'http://127.0.0.1:4102/app',
          allowedOrigins: ['http://127.0.0.1:4102', 'http://localhost:4102'],
        }))
    );
    const opener = createWebEmbedTabOpener({
      apps: async () => ({ launch: launch as never }),
      tabs: {
        createTab: (tabOptions) => {
          created.push({ ...tabOptions });
          const id = `tab-${created.length}`;
          live.push(id);
          return id;
        },
        destroyTab: (id) => {
          destroyed.push(id);
          live = live.filter((entry) => entry !== id);
        },
        loadURL: async (id, url) => {
          loadedByTab.push([id, url]);
        },
        listTabs: () => live.map((id) => ({ id })),
        getGuardedContents: () => contents ?? undefined,
      },
    });
    return { opener, contents, created, loadedByTab, destroyed, launch, closeAll: () => (live = []) };
  };

  it('refuses a request that names a partition, an address or anything else, before looking anything up', async () => {
    const { opener, created, launch } = makeOpener();
    for (const request of [
      { packageId: PACKAGE_ID, connectionId: 'medisign', partition: 'persist:evil' },
      { packageId: PACKAGE_ID, connectionId: 'medisign', url: 'https://evil.example.com' },
      { packageId: PACKAGE_ID },
      { packageId: 'Bad Id', connectionId: 'medisign' },
      null,
      'medisign',
    ]) {
      expect(await opener.open(request)).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    }
    expect(launch).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('creates the tab in the Browser profile session, hidden, and loads only the address Main resolved', async () => {
    const { opener, created, loadedByTab } = makeOpener();
    expect(await opener.open({ packageId: PACKAGE_ID, connectionId: 'medisign' })).toEqual({
      ok: true,
      tabId: 'tab-1',
    });
    expect(created).toEqual([{ partition: BROWSER_PROFILE_PARTITION, visible: false, background: false }]);
    expect(loadedByTab).toEqual([['tab-1', 'http://127.0.0.1:4102/app']]);
  });

  it('keeps navigation on the declared origins and sends every other web address to a normal tab', async () => {
    const { opener, contents, created } = makeOpener();
    await opener.open({ packageId: PACKAGE_ID, connectionId: 'medisign' });
    if (contents === null) throw new Error('fixture');

    expect(contents.fire('will-navigate', { url: 'http://127.0.0.1:4102/other' })).toBe(false);
    expect(contents.fire('will-redirect', { url: 'http://localhost:4102/login' })).toBe(false);
    expect(created).toHaveLength(1);

    expect(contents.fire('will-navigate', { url: 'https://example.org/page' })).toBe(true);
    expect(contents.fire('will-redirect', { url: 'http://127.0.0.1:9999/' })).toBe(true);
    expect(created.slice(1)).toEqual([
      { url: 'https://example.org/page', visible: false, background: false },
      { url: 'http://127.0.0.1:9999/', visible: false, background: false },
    ]);
    // A normal tab has no partition of its own: it uses the default Browser profile.
    expect(created.slice(1).every((entry) => entry['partition'] === undefined)).toBe(true);
  });

  it('drops non-web schemes, credentials and sub-frame navigations are left alone', async () => {
    const { opener, contents, created } = makeOpener();
    await opener.open({ packageId: PACKAGE_ID, connectionId: 'medisign' });
    if (contents === null) throw new Error('fixture');
    for (const url of [
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'data:text/html,hi',
      'tomny://x',
      '::bad',
    ]) {
      expect(contents.fire('will-navigate', { url })).toBe(true);
    }
    expect(contents.fire('will-navigate', { url: 'http://user:pw@127.0.0.1:4102/' })).toBe(true);
    expect(created).toHaveLength(1);
    expect(contents.fire('will-navigate', { url: 'https://example.org/', isMainFrame: false })).toBe(false);
  });

  it('handles window.open the same way and never opens a native window', async () => {
    const { opener, contents, created } = makeOpener();
    await opener.open({ packageId: PACKAGE_ID, connectionId: 'medisign' });
    if (contents === null) throw new Error('fixture');
    expect(contents.open('http://127.0.0.1:4102/popup')).toEqual({ action: 'deny' });
    expect(contents.loaded).toEqual(['http://127.0.0.1:4102/popup']);
    expect(contents.open('https://example.org/')).toEqual({ action: 'deny' });
    expect(created[1]).toEqual({ url: 'https://example.org/', visible: false, background: false });
    expect(contents.open('file:///etc/passwd')).toEqual({ action: 'deny' });
    expect(created).toHaveLength(2);
  });

  it('destroys a tab it cannot guard instead of leaving it open', async () => {
    const { opener, destroyed, loadedByTab } = makeOpener({ contents: null });
    expect(await opener.open({ packageId: PACKAGE_ID, connectionId: 'medisign' })).toEqual({
      ok: false,
      error: 'UNAVAILABLE',
    });
    expect(destroyed).toEqual(['tab-1']);
    expect(loadedByTab).toEqual([]);
  });

  it('focuses the existing tab of an app, and opens a new one once it was closed', async () => {
    const { opener, created, closeAll } = makeOpener();
    const request = { packageId: PACKAGE_ID, connectionId: 'medisign' };
    expect(await opener.open(request)).toEqual({ ok: true, tabId: 'tab-1' });
    expect(await opener.open(request)).toEqual({ ok: true, tabId: 'tab-1' });
    expect(created).toHaveLength(1);
    closeAll();
    expect(await opener.open(request)).toEqual({ ok: true, tabId: 'tab-2' });
  });

  it('turns failures into stable codes and never leaks an unexpected error text', async () => {
    const port = makeOpener({
      launch: async () => {
        throw new WebEmbedError('PORT_IN_USE', 'Port 4101 is already in use by node.exe (pid 4)');
      },
    });
    expect(await port.opener.open({ packageId: PACKAGE_ID, connectionId: 'medisign' })).toEqual({
      ok: false,
      error: 'PORT_IN_USE',
      detail: 'Port 4101 is already in use by node.exe (pid 4)',
    });
    const odd = makeOpener({
      launch: async () => {
        throw new Error(`C:\\secret\\path ${SECRET}`);
      },
    });
    expect(await odd.opener.open({ packageId: PACKAGE_ID, connectionId: 'medisign' })).toEqual({
      ok: false,
      error: 'UNAVAILABLE',
    });
    expect(port.created).toHaveLength(0);
  });

  it('decides each kind of target', () => {
    const allowed = ['https://app.example.com'];
    expect(decideAppNavigation('https://app.example.com/x?y=1', allowed)).toBe('allow');
    expect(decideAppNavigation('https://app.example.com:8443/x', allowed)).toBe('normal-tab');
    expect(decideAppNavigation('http://app.example.com/x', allowed)).toBe('normal-tab');
    expect(decideAppNavigation('https://app.example.com.evil.com/', allowed)).toBe('normal-tab');
    expect(decideAppNavigation('ftp://app.example.com/', allowed)).toBe('deny');
    expect(decideAppNavigation('', allowed)).toBe('deny');
  });
});
