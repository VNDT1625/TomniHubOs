/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { createConnectionRegistry } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { createHookHost } from '@process/integrations/connections/hosts/exec/hookHost';
import { computeHookId } from '@process/integrations/hooks/hookPinning';
import { createHookRegistry, type HookRegistry } from '@process/integrations/hooks/hookRegistry';
import { createHookLimiter } from '@process/integrations/hooks/hookRunner';

const PACKAGE_ID = 'com.community.formatter';
const PLUGIN = 'source/plugins/fmt';

const PRELUDE = `
const fs = require('fs');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => main());
`;

let base: string;
let seq = 0;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tomny-hookhost-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const script = (marker: string, stdout = '', comment = ''): string => `${PRELUDE}
// ${comment}
function main() {
  fs.appendFileSync(${JSON.stringify(marker)}, 'x');
  ${stdout === '' ? '' : `process.stdout.write(${JSON.stringify(stdout)});`}
}
`;

const hookConnection = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'hook',
  id,
  event: 'PostToolUse',
  matcher: 'Write|Edit',
  command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.js',
  args: [],
  timeoutSec: 20,
  plugin: PLUGIN,
  ...extra,
});

type World = Awaited<ReturnType<typeof makeWorld>>;

/** Real connection registry and state store, a real hook registry with real scripts, over a package on disk. */
const makeWorld = async (connections: unknown[], options: { forgetApprovals?: boolean } = {}) => {
  seq += 1;
  const root = path.join(base, `world${seq}`);
  const packageDirectory = path.join(root, 'pkg');
  const marker = path.join(root, 'ran');
  await mkdir(path.join(packageDirectory, PLUGIN, 'scripts'), { recursive: true });
  await writeFile(path.join(packageDirectory, PLUGIN, 'scripts', 'format.js'), script(marker));
  await writeFile(path.join(packageDirectory, PLUGIN, 'scripts', 'other.js'), script(marker));
  await mkdir(path.join(root, 'hooks'), { recursive: true });

  const adapter = parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections });
  const stateFile = path.join(root, 'state.json');
  const newHookRegistry = async (): Promise<HookRegistry> => {
    const hooks = createHookRegistry({
      storeFilePath: path.join(root, 'hooks', 'user-hooks.json'),
      auditFilePath: path.join(root, 'hooks', 'audit.jsonl'),
      limiter: createHookLimiter(),
    });
    await hooks.initialize();
    return hooks;
  };
  const build = async (hooks: HookRegistry) => {
    const store = createJsonConnectionStateStore(stateFile);
    await store.initialize();
    let connectionRegistry: ReturnType<typeof createConnectionRegistry> | undefined;
    const host = createHookHost({
      getRegistry: async () => hooks,
      enabledHooks: async () => (await connectionRegistry?.enabledOfKind('hook')) ?? [],
      ...(options.forgetApprovals === undefined ? {} : { forgetApprovals: options.forgetApprovals }),
    });
    connectionRegistry = createConnectionRegistry({
      store,
      hosts: [host],
      loadPackage: async (packageId) =>
        packageId === PACKAGE_ID ? { packageId, packageVersion: '1.0.0', packageDirectory, adapter } : undefined,
      listInstalledPackageIds: async () => [PACKAGE_ID],
    });
    return { registry: connectionRegistry, store };
  };
  const hooks = await newHookRegistry();
  const { registry, store } = await build(hooks);
  await registry.syncPackage(PACKAGE_ID);
  const turnOn = async (key: string) => {
    const approval = await registry.describe(PACKAGE_ID, key);
    return registry.enable(PACKAGE_ID, key, approval.approvalHash);
  };
  return { root, packageDirectory, marker, hooks, registry, store, turnOn, newHookRegistry, build };
};

const KEY = 'hook:format-on-edit';
const toolPayload = { tool_name: 'Write', session_id: 's-1' };
const scriptPath = (world: World, name = 'format.js'): string =>
  path.join(world.packageDirectory, PLUGIN, 'scripts', name);

describe('hook host: what the person approves', { timeout: 60_000 }, () => {
  it('shows exactly what the hook registry describes, and pins the script content into the approval', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    const { subject, approvalHash } = await world.registry.describe(PACKAGE_ID, KEY);
    expect(subject.kind).toBe('hook');
    expect(subject.files).toEqual([`${PLUGIN}/scripts/format.js`]);
    const text = subject.lines.map((line) => `${line.label}: ${line.value}`).join(' | ');
    expect(text).toContain('Event: PostToolUse');
    expect(text).toContain('Matcher: Write|Edit');
    expect(text).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/format.js');
    expect(text).toContain('Outgoing network of the hook: unrestricted');
    // No real path of this machine is shown.
    expect(text).not.toContain(world.packageDirectory);

    // Turn it on, then ask the registry itself: same lines, in the same order.
    await world.turnOn(KEY);
    const [view] = await world.hooks.listHooks();
    const description = await world.hooks.describeHook(view?.id ?? '');
    expect(description).toBeDefined();
    const labelled = (description?.lines ?? []).map((line) => line.value);
    expect(subject.lines.map((line) => line.value)).toEqual(labelled);
    expect(approvalHash).toMatch(/^sha256-/);

    // The script is part of the approval.
    await writeFile(scriptPath(world), script(world.marker, '', 'edited'));
    const changed = await world.registry.describe(PACKAGE_ID, KEY);
    expect(changed.approvalHash).not.toBe(approvalHash);
    await expect(world.registry.enable(PACKAGE_ID, KEY, approvalHash)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
  });

  it('turning it on needs the approval hash and registers nothing before that', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    await expect(world.registry.enable(PACKAGE_ID, KEY, 'sha256-forged')).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(await world.hooks.listHooks()).toEqual([]);
  });
});

describe('hook host: turning on and off', { timeout: 60_000 }, () => {
  it('registers a package hook pinned to the registry hash, and it runs only because of that approval', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    const state = await world.turnOn(KEY);
    expect(state).toMatchObject({ enabled: true, status: 'on' });
    const [view] = await world.hooks.listHooks();
    expect(view).toMatchObject({ source: 'package', pluginId: PACKAGE_ID, status: 'ready', active: true });
    expect(state.installed).toEqual([view?.id]);

    const entry = world.hooks.getEntry(view?.id ?? '');
    const description = await world.hooks.describeHook(view?.id ?? '');
    expect(entry?.approval?.hash).toBe(description?.hash);

    const summary = await world.hooks.run('PostToolUse', toolPayload);
    expect(summary.perHook).toHaveLength(1);
    expect(existsSync(world.marker)).toBe(true);
  });

  it('only tightens: a hook that answers "allow" grants nothing', async () => {
    const world = await makeWorld([hookConnection('gate', { event: 'PreToolUse', matcher: '*' })]);
    await writeFile(
      scriptPath(world),
      script(
        world.marker,
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })
      )
    );
    await world.registry.syncPackage(PACKAGE_ID);
    await world.turnOn('hook:gate');
    const summary = await world.hooks.run('PreToolUse', toolPayload);
    expect(summary.perHook).toHaveLength(1);
    expect(summary.merged.blocked).toBe(false);
    expect(summary.merged.permissionDecision).toBeUndefined();
  });

  it('disable unregisters the hook, keeps its approval, and a second disable is not an error', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    await world.turnOn(KEY);
    await world.registry.disable(PACKAGE_ID, KEY);
    expect(await world.hooks.listHooks()).toEqual([]);
    await world.hooks.run('PostToolUse', toolPayload);
    expect(existsSync(world.marker)).toBe(false);
    await expect(world.registry.disable(PACKAGE_ID, KEY)).resolves.toMatchObject({ enabled: false });

    // The approval stayed in the hook registry: registering the same hook again finds it approved (content pinned).
    const [again] = await world.hooks.registerPackageHooks(PACKAGE_ID, [
      {
        handler: {
          event: 'PostToolUse',
          matcher: 'Write|Edit',
          command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.js',
          args: [],
          timeoutSec: 20,
          form: 'exec',
          unsupported: false,
        },
        pluginRoot: path.join(world.packageDirectory, PLUGIN),
      },
    ]);
    expect(again?.approved).toBe(true);
  });

  it('forgets the approval when asked to', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')], { forgetApprovals: true });
    await world.turnOn(KEY);
    await world.registry.disable(PACKAGE_ID, KEY);
    const [again] = await world.hooks.registerPackageHooks(PACKAGE_ID, [
      {
        handler: {
          event: 'PostToolUse',
          matcher: 'Write|Edit',
          command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.js',
          args: [],
          timeoutSec: 20,
          form: 'exec',
          unsupported: false,
        },
        pluginRoot: path.join(world.packageDirectory, PLUGIN),
      },
    ]);
    expect(again?.approved).toBe(false);
    expect(again?.status).toBe('needs-approval');
  });

  it('turning one hook off keeps the other hooks of the same package registered', async () => {
    const world = await makeWorld([
      hookConnection('format-on-edit'),
      hookConnection('other', { command: '${CLAUDE_PLUGIN_ROOT}/scripts/other.js', matcher: 'Bash' }),
    ]);
    await world.turnOn(KEY);
    await world.turnOn('hook:other');
    expect((await world.hooks.listHooks()).map((view) => view.status)).toEqual(['ready', 'ready']);

    await world.registry.disable(PACKAGE_ID, KEY);
    const remaining = await world.hooks.listHooks();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ matcher: 'Bash', status: 'ready' });
  });

  it('removing the package unregisters its hooks', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    await world.turnOn(KEY);
    await world.registry.removePackage(PACKAGE_ID);
    expect(await world.hooks.listHooks()).toEqual([]);
  });
});

describe('hook host: what cannot be switched on', { timeout: 60_000 }, () => {
  it('a package hook in shell form is unsupported and cannot be turned on', async () => {
    const world = await makeWorld([hookConnection('shelly', { command: 'echo hi', args: undefined })]);
    const [view] = await world.registry.view(PACKAGE_ID);
    expect(view?.state.status).toBe('unsupported');
    expect(view?.state.reason).toContain('exec form');
    await expect(world.turnOn('hook:shelly')).rejects.toMatchObject({ code: 'RUNTIME_MISSING' });
    expect(await world.hooks.listHooks()).toEqual([]);
  });

  it('an event this version does not fire is unsupported, with the reason', async () => {
    const world = await makeWorld([hookConnection('compact', { event: 'PreCompact' })]);
    const [view] = await world.registry.view(PACKAGE_ID);
    expect(view?.state.status).toBe('unsupported');
    expect(view?.state.reason).toContain('PreCompact');
    await expect(world.turnOn('hook:compact')).rejects.toMatchObject({ code: 'RUNTIME_MISSING' });
  });

  it('a script outside the plugin folder or missing is unsupported', async () => {
    const outside = await makeWorld([hookConnection('escape', { command: '${CLAUDE_PLUGIN_ROOT}/../../../etc/x.js' })]);
    expect((await outside.registry.view(PACKAGE_ID))[0]?.state.status).toBe('unsupported');
    const missing = await makeWorld([hookConnection('gone', { command: '${CLAUDE_PLUGIN_ROOT}/scripts/gone.js' })]);
    expect((await missing.registry.view(PACKAGE_ID))[0]?.state.status).toBe('unsupported');
    const folder = await makeWorld([hookConnection('nofolder', { plugin: 'source/plugins/nowhere' })]);
    expect((await folder.registry.view(PACKAGE_ID))[0]?.state.status).toBe('unsupported');
  });
});

describe('hook host: content change and restart', { timeout: 60_000 }, () => {
  it('a script that changes after approval turns the connection off and the hook off', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    await world.turnOn(KEY);
    await writeFile(scriptPath(world), script(world.marker, '', 'swapped'));

    const views = await world.registry.syncPackage(PACKAGE_ID);
    expect(views[0]?.state).toMatchObject({ enabled: false, status: 'needs-input' });
    expect(await world.hooks.listHooks()).toEqual([]);
    await world.hooks.run('PostToolUse', toolPayload);
    expect(existsSync(world.marker)).toBe(false);
  });

  it('a script swapped behind the registry stops the hook before it runs', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    await world.turnOn(KEY);
    await writeFile(scriptPath(world), script(world.marker, '', 'swapped after approval'));
    const summary = await world.hooks.run('PostToolUse', toolPayload);
    expect(summary.perHook[0]?.errorCode).toBe('approval-stale');
    expect(existsSync(world.marker)).toBe(false);
  });

  it('reconcile restores enabled hooks after a restart without a new approval, and drops orphans', async () => {
    const world = await makeWorld([
      hookConnection('format-on-edit'),
      hookConnection('other', { command: '${CLAUDE_PLUGIN_ROOT}/scripts/other.js', matcher: 'Bash' }),
    ]);
    await world.turnOn(KEY);
    await world.turnOn('hook:other');
    await world.registry.setAutoStart(PACKAGE_ID, KEY, true);
    await world.registry.setAutoStart(PACKAGE_ID, 'hook:other', true);

    // Restart: a new hook registry (memory is empty), the same state and approval files.
    const restartedHooks = await world.newHookRegistry();
    expect(await restartedHooks.listHooks()).toEqual([]);
    const { registry: restartedRegistry } = await world.build(restartedHooks);
    await restartedRegistry.reconcile();
    const restored = await restartedHooks.listHooks();
    expect(restored.map((view) => view.status)).toEqual(['ready', 'ready']);
    await restartedHooks.run('PostToolUse', toolPayload);
    expect(existsSync(world.marker)).toBe(true);

    // One connection is turned off elsewhere; reconcile removes what is no longer kept.
    await restartedRegistry.disable(PACKAGE_ID, 'hook:other');
    await restartedRegistry.reconcile();
    const left = await restartedHooks.listHooks();
    expect(left).toHaveLength(1);
    expect(left[0]?.matcher).toBe('Write|Edit');
  });

  it('reconcile unregisters a package that has no kept connection', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    await world.turnOn(KEY);
    // The state file loses the connection (package gone or off) while the hook is still registered in memory.
    await world.store.removePackage(PACKAGE_ID);
    await world.registry.reconcile();
    expect(await world.hooks.listHooks()).toEqual([]);
  });

  it('uses the same identity as the hook registry', async () => {
    const world = await makeWorld([hookConnection('format-on-edit')]);
    const state = await world.turnOn(KEY);
    const expected = computeHookId('package', PACKAGE_ID, {
      event: 'PostToolUse',
      matcher: 'Write|Edit',
      command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.js',
      args: [],
      timeoutSec: 20,
      form: 'exec',
      unsupported: false,
    });
    expect(state.installed).toEqual([expected]);
  });
});
