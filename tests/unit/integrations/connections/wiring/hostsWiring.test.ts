/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import { createConnectionRuntime } from '@process/integrations/connections/wiring/connectionRuntime';
import { configureHookRuntime } from '@process/integrations/hookRuntime/hookDispatcher';
import { createHookRegistry, type HookRegistry } from '@process/integrations/hooks/hookRegistry';
import { createHookLimiter } from '@process/integrations/hooks/hookRunner';
import { makeHarness } from '../../runtime/repoProcessHarness';

const PACKAGE_ID = 'com.community.everything';
const WORKSPACE = path.resolve(os.tmpdir(), 'tomny-ws-wiring');

const roots: string[] = [];
afterEach(async () => {
  configureHookRuntime();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const ADAPTER = {
  schemaVersion: 1,
  generatedBy: 'classifier',
  connections: [
    {
      kind: 'hook',
      id: 'format',
      event: 'PostToolUse',
      matcher: 'Write',
      command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.js',
      args: [],
      plugin: 'source/plugins/fmt',
    },
    {
      kind: 'service',
      id: 'bot',
      title: 'Bot',
      process: {
        services: [{ id: 'bot', cwd: 'source/bot', start: ['node', 'index.js'], ready: { port: 4301 } }],
      },
    },
    { kind: 'rules', id: 'style', title: 'Style', path: 'source/rules/style.md', format: 'agents-md' },
    { kind: 'knowledge', id: 'docs', title: 'Guides', paths: ['source/docs/guide.md'] },
  ],
};

/** An installed package on disk, a fake package manager that reports it, and a hook registry that is reachable. */
const makeWorld = async () => {
  const userData = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tomny-hostswiring-')));
  roots.push(userData);
  const packagesRoot = path.join(userData, 'tomny-packages');
  const packageDirectory = path.join(packagesRoot, 'packages', PACKAGE_ID, '1.0.0');
  for (const folder of ['adapter', 'source/plugins/fmt/scripts', 'source/bot', 'source/rules', 'source/docs']) {
    await mkdir(path.join(packageDirectory, ...folder.split('/')), { recursive: true });
  }
  await writeFile(path.join(packageDirectory, 'adapter', 'adapter.json'), JSON.stringify(ADAPTER));
  await writeFile(path.join(packageDirectory, 'source', 'plugins', 'fmt', 'scripts', 'format.js'), 'process.exit(0)');
  await writeFile(path.join(packageDirectory, 'source', 'bot', 'index.js'), 'console.log("bot")');
  await writeFile(path.join(packageDirectory, 'source', 'bot', 'package.json'), '{"name":"bot"}');
  await writeFile(path.join(packageDirectory, 'source', 'rules', 'style.md'), 'Write tests first.');
  await writeFile(path.join(packageDirectory, 'source', 'docs', 'guide.md'), 'The quickstart explains widgets.');

  const listing = {
    state: 'installed',
    installedVersion: '1.0.0',
    manifest: { id: PACKAGE_ID },
    installedManifest: { id: PACKAGE_ID },
  };
  const packages = {
    status: async () => listing,
    list: async () => [listing],
    onStateChanged: () => () => undefined,
  } as unknown as Pick<PackageManagerService, 'status' | 'list' | 'onStateChanged'>;

  const harness = makeHarness();
  const newHookRegistry = async (): Promise<HookRegistry> => {
    const hooks = createHookRegistry({
      storeFilePath: path.join(userData, 'hooks', 'user-hooks.json'),
      auditFilePath: path.join(userData, 'hooks', 'audit.jsonl'),
      limiter: createHookLimiter(),
    });
    await hooks.initialize();
    return hooks;
  };
  /** One application start over the same user-data folder. */
  const boot = async () => {
    const hooks = await newHookRegistry();
    configureHookRuntime({ registry: async () => hooks });
    const runtime = createConnectionRuntime({
      stateFile: path.join(userData, 'connections.json'),
      packagesRoot,
      packages,
      webEmbed: {
        programProbe: async () => ({ ok: true }),
        portsFor: () => harness.ports,
        recordEvidence: async () => undefined,
      },
      log: () => undefined,
    });
    await runtime.start();
    return { runtime, hooks };
  };
  return { userData, harness, boot };
};

const turnOn = async (runtime: Awaited<ReturnType<ReturnType<typeof makeWorld>['boot']>>['runtime'], key: string) => {
  const approval = await runtime.registry.describe(PACKAGE_ID, key);
  return runtime.registry.enable(PACKAGE_ID, key, approval.approvalHash);
};

describe('the default hosts of the application', () => {
  it('support hook, service, rules and knowledge connections: off until the person turns them on', async () => {
    const world = await makeWorld();
    const { runtime } = await world.boot();
    const views = await runtime.registry.syncPackage(PACKAGE_ID);
    expect(views.map((view) => [view.key, view.state.status])).toEqual([
      ['hook:format', 'off'],
      ['service:bot', 'off'],
      ['rules:style', 'off'],
      ['knowledge:docs', 'off'],
    ]);
    expect(world.harness.spawns).toHaveLength(0);
    await runtime.dispose();
  });

  it('turn on without starting anything, start a service only on request, and stop it when the application quits', async () => {
    const world = await makeWorld();
    const { runtime, hooks } = await world.boot();
    await runtime.registry.syncPackage(PACKAGE_ID);
    for (const key of ['hook:format', 'service:bot', 'rules:style', 'knowledge:docs']) {
      expect(await turnOn(runtime, key)).toMatchObject({ enabled: true, status: 'on' });
    }
    expect(world.harness.spawns).toHaveLength(0);
    expect(runtime.services.list()).toEqual([]);
    expect((await hooks.listHooks()).map((hook) => [hook.source, hook.status])).toEqual([['package', 'ready']]);

    // Rules: nothing until attached. Knowledge: searchable at once.
    expect(await runtime.rules.contextFor(WORKSPACE)).toBeUndefined();
    await runtime.rules.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    expect((await runtime.rules.contextFor(WORKSPACE))?.text).toContain('Write tests first.');
    expect((await runtime.knowledge.search({ query: 'widgets' })).hits.map((hit) => hit.path)).toEqual([
      'source/docs/guide.md',
    ]);

    // The explicit Start, then quitting.
    const started = await runtime.services.start({ packageId: PACKAGE_ID, connectionId: 'bot' });
    expect(started.state).toBe('running');
    expect(world.harness.spawns).toHaveLength(1);
    await runtime.dispose();
    expect(world.harness.kills).toHaveLength(1);
    expect(runtime.services.list()).toEqual([]);
  });

  it('after a restart restore hooks, rules and knowledge from what is on, and start no service', async () => {
    const world = await makeWorld();
    const first = await world.boot();
    await first.runtime.registry.syncPackage(PACKAGE_ID);
    for (const key of ['hook:format', 'service:bot', 'rules:style', 'knowledge:docs']) {
      await turnOn(first.runtime, key);
    }
    await first.runtime.registry.setAutoStart(PACKAGE_ID, 'hook:format', true);
    await first.runtime.rules.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    await first.runtime.services.start({ packageId: PACKAGE_ID, connectionId: 'bot' });
    await first.runtime.dispose();
    const spawnsBefore = world.harness.spawns.length;

    const second = await world.boot();
    expect(world.harness.spawns).toHaveLength(spawnsBefore);
    expect(second.runtime.services.list()).toEqual([]);
    expect((await second.hooks.listHooks()).map((hook) => hook.status)).toEqual(['ready']);
    expect((await second.runtime.rules.contextFor(WORKSPACE))?.text).toContain('Write tests first.');
    expect((await second.runtime.knowledge.search({ query: 'quickstart' })).hits).toHaveLength(1);
    await second.runtime.dispose();
  });

  it('take everything back when the package is removed', async () => {
    const world = await makeWorld();
    const { runtime, hooks } = await world.boot();
    await runtime.registry.syncPackage(PACKAGE_ID);
    for (const key of ['hook:format', 'service:bot', 'rules:style', 'knowledge:docs']) {
      await turnOn(runtime, key);
    }
    await runtime.services.start({ packageId: PACKAGE_ID, connectionId: 'bot' });

    await runtime.registry.removePackage(PACKAGE_ID);

    expect(await hooks.listHooks()).toEqual([]);
    expect(runtime.services.list()).toEqual([]);
    expect(world.harness.kills).toHaveLength(1);
    expect(await runtime.knowledge.collections()).toEqual([]);
    expect(await runtime.rules.list()).toEqual([]);
    await runtime.dispose();
  });
});
