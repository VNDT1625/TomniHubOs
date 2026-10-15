/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { createConnectionRegistry } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { createServiceHost } from '@process/integrations/connections/hosts/exec/serviceHost';
import type { ProgramProbe } from '@process/integrations/connections/hosts/exec/webEmbedHost';
import {
  createPackageServiceControl,
  PackageServiceError,
  type PackageServiceControl,
  type PackageServiceStatus,
} from '@process/integrations/runtime/packageServices';
import { createServiceSlots } from '@process/integrations/runtime/repoProcessPorts';
import { createJsonSetupMarkerStore } from '@process/integrations/runtime/repoProcessStores';
import type { PackagePersistentContributionEvidence } from '@process/resources/packageProcessRuntime/persistentContributionSupervisor';
import { makeHarness, settle, type HarnessOptions } from '../../runtime/repoProcessHarness';

const PACKAGE_ID = 'com.community.discord-bot';
const KEY = 'service:bot';
const SECRET = 'discord-token-secret-123456';
const ref = { packageId: PACKAGE_ID, connectionId: 'bot' } as const;

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const botService = (extra: Record<string, unknown> = {}) => ({
  kind: 'service',
  id: 'bot',
  title: 'Discord bot',
  process: {
    services: [
      {
        id: 'bot',
        cwd: 'source/bot',
        setup: [['npm', 'install']],
        start: ['node', 'index.js'],
        ready: { port: 4201 },
        env: [{ name: 'DISCORD_TOKEN', required: true }],
      },
    ],
  },
  ...extra,
});

type WorldOptions = {
  harness?: HarnessOptions;
  probe?: ProgramProbe;
  slots?: ReturnType<typeof createServiceSlots>;
  restart?: { max: number; windowMs: number; backoffMs: number[] };
};

/** A real registry, state store and service control over a package on disk and fake operating-system ports. */
const makeWorld = async (raw: unknown = botService(), options: WorldOptions = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-service-'));
  roots.push(root);
  const packageDirectory = path.join(root, 'pkg');
  await mkdir(path.join(packageDirectory, 'source', 'bot'), { recursive: true });
  await writeFile(path.join(packageDirectory, 'source', 'bot', 'index.js'), 'console.log("bot v1")');
  await writeFile(path.join(packageDirectory, 'source', 'bot', 'package.json'), '{"name":"bot"}');

  const harness = makeHarness({ secrets: { DISCORD_TOKEN: SECRET }, ...options.harness });
  const markerFile = path.join(root, 'markers.json');
  const markers = createJsonSetupMarkerStore(markerFile);
  const adapter = parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections: [raw] });
  const probe = vi.fn<ProgramProbe>(options.probe ?? (async () => ({ ok: true })));
  const evidence: PackagePersistentContributionEvidence[] = [];
  const slots = options.slots ?? createServiceSlots(6);

  /** `build` is also the restart: new store reader, host, registry and control over the same files. */
  const build = async () => {
    const store = createJsonConnectionStateStore(path.join(root, 'state.json'));
    await store.initialize();
    let services: PackageServiceControl | undefined;
    const host = createServiceHost({
      programProbe: probe,
      control: {
        stop: (request) => services?.stop(request) ?? Promise.resolve(),
        reconcile: (keep) => services?.reconcile(keep) ?? Promise.resolve(),
      },
    });
    const registry = createConnectionRegistry({
      store,
      hosts: [host],
      loadPackage: async (packageId) =>
        packageId === PACKAGE_ID ? { packageId, packageVersion: '1.0.0', packageDirectory, adapter } : undefined,
      listInstalledPackageIds: async () => [PACKAGE_ID],
    });
    services = createPackageServiceControl({
      registry,
      portsFor: (scope) => ({
        ...harness.ports,
        setupMarkers: markers.scoped(`${scope.packageId}|service:${scope.connectionId}|${scope.packageVersion}|`),
      }),
      recordEvidence: async (entry) => {
        evidence.push(entry);
      },
      clearSetup: (packageId, connectionId) => markers.clear(`${packageId}|service:${connectionId}|`),
      slots,
      ...(options.restart === undefined ? {} : { timing: { restart: options.restart } }),
    });
    return { store, registry, services };
  };

  const first = await build();
  await first.registry.syncPackage(PACKAGE_ID);
  const turnOn = async (key = KEY) => {
    const approval = await first.registry.describe(PACKAGE_ID, key);
    return first.registry.enable(PACKAGE_ID, key, approval.approvalHash);
  };
  return { root, packageDirectory, harness, probe, evidence, slots, markerFile, turnOn, build, ...first };
};

describe('service host: what the person approves', () => {
  it('lists every command, port and variable NAME, says when it starts, and starts nothing when turned on', async () => {
    const world = await makeWorld();
    const { subject } = await world.registry.describe(PACKAGE_ID, KEY);
    const text = subject.lines.map((line) => `${line.label}: ${line.value}`).join(' | ');
    expect(text).toContain('npm install');
    expect(text).toContain('node index.js');
    expect(text).toContain('127.0.0.1:4201');
    expect(text).toContain('DISCORD_TOKEN');
    expect(text).toContain('only when you press Start, never when the Hub starts');
    expect(text).toContain('not restricted');
    expect(text).not.toContain(SECRET);
    expect(subject.files).toEqual(['source/bot/index.js', 'source/bot/package.json']);

    const state = await world.turnOn();
    expect(state).toMatchObject({ enabled: true, status: 'on', installed: ['service:bot'] });
    expect(world.harness.spawns).toHaveLength(0);
    expect(world.services.list()).toEqual([]);
  });

  it('needs a new approval when a file the service runs changes after it was shown', async () => {
    const world = await makeWorld();
    const before = await world.registry.describe(PACKAGE_ID, KEY);
    await writeFile(path.join(world.packageDirectory, 'source', 'bot', 'index.js'), 'require("evil")');
    expect((await world.registry.describe(PACKAGE_ID, KEY)).approvalHash).not.toBe(before.approvalHash);
    await expect(world.registry.enable(PACKAGE_ID, KEY, before.approvalHash)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
  });

  it('is unsupported, with a readable reason, when a program is missing or a folder is not usable', async () => {
    const missing = await makeWorld(botService(), {
      probe: async (program) =>
        program === 'npm' ? { ok: false, reason: '"npm" is not installed or not on PATH.' } : { ok: true },
    });
    const [view] = await missing.registry.view(PACKAGE_ID);
    expect(view?.state).toMatchObject({ status: 'unsupported', reason: '"npm" is not installed or not on PATH.' });
    expect(missing.probe.mock.calls.map(([program]) => program)).not.toContain('node');
    await expect(missing.turnOn()).rejects.toMatchObject({ code: 'RUNTIME_MISSING' });

    const folder = await makeWorld(
      botService({
        process: { services: [{ id: 'bot', cwd: 'source/nowhere', start: ['node', 'x.js'], ready: { port: 4205 } }] },
      })
    );
    expect((await folder.registry.view(PACKAGE_ID))[0]?.state).toMatchObject({ status: 'unsupported' });
  });
});

describe('service lifecycle (fake operating system)', () => {
  it('never starts by itself: not when turned on, not at startup, not after a restart of the application', async () => {
    const world = await makeWorld();
    await world.turnOn();
    // Startup: reconcile of the registry (what `ConnectionRuntime.start` runs), also on a fresh set of objects.
    await world.registry.reconcile();
    const restarted = await world.build();
    await restarted.registry.reconcile();
    await restarted.registry.syncPackage(PACKAGE_ID);
    expect(world.harness.spawns).toHaveLength(0);
    expect(restarted.services.list()).toEqual([]);
    expect(world.slots.inUse()).toBe(0);
  });

  it('starts only on the explicit start: setup once, then the program, with the secret only in its environment', async () => {
    const world = await makeWorld();
    await world.turnOn();
    const seen: (readonly PackageServiceStatus[])[] = [];
    world.services.subscribe((services) => seen.push(services));

    const status = await world.services.start(ref);

    expect(status).toMatchObject({
      packageId: PACKAGE_ID,
      connectionId: 'bot',
      title: 'Discord bot',
      state: 'running',
    });
    expect(status.services).toEqual([{ id: 'bot', state: 'ready', restarts: 0 }]);
    expect(world.harness.spawns.map((record) => record.req.args[0])).toEqual(['install', 'index.js']);
    const bot = world.harness.spawns[1]?.req;
    expect(bot?.env['DISCORD_TOKEN']).toBe(SECRET);
    expect(bot?.env['PORT']).toBe('4201');
    expect(bot?.env['HOST']).toBe('127.0.0.1');
    expect(bot?.env['GITHUB_TOKEN']).toBeUndefined();
    expect(world.evidence.map((entry) => entry.phase)).toEqual(['admitted', 'started']);
    expect(JSON.stringify(world.evidence)).not.toContain(SECRET);
    expect(world.services.list()).toHaveLength(1);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.[0]?.state).toBe('running');
    expect(JSON.stringify(seen)).not.toContain(SECRET);

    // Pressing Start again reuses the running service.
    await world.services.start(ref);
    expect(world.harness.spawns).toHaveLength(2);
  });

  it('masks a secret in the log it hands to the sidebar', async () => {
    const world = await makeWorld();
    await world.turnOn();
    await world.services.start(ref);
    world.harness.spawns[1]?.print(`token=${SECRET}\n`);
    await settle();
    const lines = world.services.logs(ref, 'bot');
    expect(JSON.stringify(lines)).not.toContain(SECRET);
    expect(lines.length).toBeGreaterThan(0);
    expect(world.services.logs(ref, 'unknown')).toEqual([]);
  });

  it('stops when the connection is turned off, and forgets its setup markers', async () => {
    const world = await makeWorld();
    await world.turnOn();
    await world.services.start(ref);
    expect(await readFile(world.markerFile, 'utf8')).toContain(`${PACKAGE_ID}|service:bot|1.0.0|`);

    await world.registry.disable(PACKAGE_ID, KEY);

    expect(world.harness.kills).toHaveLength(1);
    expect(world.slots.inUse()).toBe(0);
    expect(world.services.list()).toEqual([]);
    expect(JSON.parse(await readFile(world.markerFile, 'utf8')).marks).toEqual([]);
    await expect(world.services.start(ref)).rejects.toMatchObject({ code: 'NOT_ENABLED' });
    // Turned off twice is not an error.
    await expect(world.registry.disable(PACKAGE_ID, KEY)).resolves.toMatchObject({ enabled: false });
  });

  it('stops when the package is removed, when reconcile no longer keeps it, and when the application quits', async () => {
    const removed = await makeWorld();
    await removed.turnOn();
    await removed.services.start(ref);
    await removed.registry.removePackage(PACKAGE_ID);
    expect(removed.harness.kills).toHaveLength(1);
    expect(removed.slots.inUse()).toBe(0);

    const reconciled = await makeWorld();
    await reconciled.turnOn();
    await reconciled.services.start(ref);
    await reconciled.services.reconcile(new Set([`${PACKAGE_ID}\u0000${KEY}`]));
    expect(reconciled.harness.kills).toHaveLength(0);
    await reconciled.services.reconcile(new Set());
    expect(reconciled.harness.kills).toHaveLength(1);
    expect(reconciled.services.list()).toEqual([]);

    const quitting = await makeWorld();
    await quitting.turnOn();
    await quitting.services.start(ref);
    await quitting.services.dispose();
    expect(quitting.harness.kills).toHaveLength(1);
    expect(quitting.slots.inUse()).toBe(0);
    expect(quitting.services.list()).toEqual([]);
  });

  it('refuses to start, and spawns nothing, when it is off or what would run changed after approval', async () => {
    const world = await makeWorld();
    await expect(world.services.start(ref)).rejects.toMatchObject({ code: 'NOT_ENABLED' });
    await expect(world.services.start({ packageId: PACKAGE_ID, connectionId: 'other' })).rejects.toBeInstanceOf(
      PackageServiceError
    );

    await world.turnOn();
    await writeFile(path.join(world.packageDirectory, 'source', 'bot', 'index.js'), 'require("evil")');
    await expect(world.services.start(ref)).rejects.toMatchObject({ code: 'NEEDS_APPROVAL' });
    expect(world.harness.spawns).toHaveLength(0);
    expect(world.services.list()).toEqual([]);
  });

  it('reports a failed start in the list with its reason, and a new start replaces the failed row', async () => {
    // No setup command: a finished setup process would free the port in the fake operating system.
    const world = await makeWorld(
      botService({
        process: {
          services: [
            {
              id: 'bot',
              cwd: 'source/bot',
              start: ['node', 'index.js'],
              ready: { port: 4201 },
              env: [{ name: 'DISCORD_TOKEN', required: true }],
            },
          ],
        },
      }),
      { harness: { alreadyListening: [4201], owner: 'node.exe (pid 4)' } }
    );
    await world.turnOn();
    const error: unknown = await world.services.start(ref).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PackageServiceError);
    expect(error).toMatchObject({ code: 'PORT_IN_USE' });
    expect((error as Error).message).toContain('node.exe (pid 4)');
    expect(world.slots.inUse()).toBe(0);
    const [row] = world.services.list();
    expect(row).toMatchObject({ state: 'error', error: { code: 'PORT_IN_USE' } });
    expect(JSON.stringify(row)).not.toContain(SECRET);

    // The person frees the port and presses Start again.
    world.harness.listening.delete(4201);
    const again = await world.services.start(ref);
    expect(again.state).toBe('running');
    expect(world.services.list()).toHaveLength(1);
  });

  it('asks for the missing variable instead of starting without it', async () => {
    const world = await makeWorld(botService(), { harness: { secrets: {} } });
    await world.turnOn();
    await expect(world.services.start(ref)).rejects.toMatchObject({ code: 'NEEDS_INPUT' });
    expect(world.harness.spawns.filter((record) => record.req.args[0] === 'index.js')).toHaveLength(0);
    expect(world.slots.inUse()).toBe(0);
  });

  it('counts against the app-wide limit', async () => {
    const world = await makeWorld(botService(), { slots: createServiceSlots(0) });
    await world.turnOn();
    await expect(world.services.start(ref)).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    expect(world.harness.spawns).toHaveLength(0);
  });

  it('shows an error row when the program crashes for good, and Start begins again', async () => {
    const world = await makeWorld(botService(), { restart: { max: 0, windowMs: 60_000, backoffMs: [0] } });
    await world.turnOn();
    await world.services.start(ref);
    world.harness.spawns[1]?.exit(1);
    await settle();
    const [row] = world.services.list();
    expect(row?.state).toBe('error');
    expect(row?.error?.code).toBe('RESTART_LIMIT');

    const restarted = await world.services.start(ref);
    expect(restarted.state).toBe('running');
    expect(world.harness.spawns.filter((record) => record.req.args[0] === 'index.js')).toHaveLength(2);
  });

  it('a listener that throws does not disturb the service', async () => {
    const world = await makeWorld();
    await world.turnOn();
    world.services.subscribe(() => {
      throw new Error('boom');
    });
    const stop = world.services.subscribe(() => undefined);
    await expect(world.services.start(ref)).resolves.toMatchObject({ state: 'running' });
    stop();
  });
});
