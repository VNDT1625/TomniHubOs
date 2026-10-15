import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HookEventName, HookHandler } from '@/common/integrations/hooks';
import { createHookRegistry, type HookRegistry, type PackageHookInput } from '@process/integrations/hooks/hookRegistry';
import { createHookRegistryStore, type HookStoreIo } from '@process/integrations/hooks/hookRegistryStore';
import { createHookLimiter } from '@process/integrations/hooks/hookRunner';

/**
 * Real child processes: scripts are .js files run through process.execPath, as in hookRunner.test.ts.
 * Every script appends to a marker file when it runs, so "did not run" is observable.
 */

const PRELUDE = `
const fs = require('fs');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => main(Buffer.concat(chunks).toString('utf8')));
`;

type Env = { reg: HookRegistry; storeFile: string; auditFile: string; dir: string };

let base: string;
let seq = 0;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tomny-hookreg-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const freshDir = async (label: string): Promise<string> => {
  seq += 1;
  const dir = path.join(base, `${label}${seq}`);
  await mkdir(dir, { recursive: true });
  return dir;
};

const makeRegistry = async (dir: string): Promise<Env> => {
  const storeFile = path.join(dir, 'state', 'user-hooks.json');
  const auditFile = path.join(dir, 'state', 'audit.jsonl');
  const reg = createHookRegistry({ storeFilePath: storeFile, auditFilePath: auditFile, limiter: createHookLimiter() });
  await reg.initialize();
  return { reg, storeFile, auditFile, dir };
};

const newEnv = async (): Promise<Env> => makeRegistry(await freshDir('env'));

/** A script that records its run in `marker` and then prints `stdout` (a JSON hook answer, or nothing). */
const writeScript = async (file: string, marker: string, stdout = '', exitCode = 0, comment = ''): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const body = `${PRELUDE}
// ${comment}
function main() {
  fs.appendFileSync(${JSON.stringify(marker)}, 'x');
  ${stdout === '' ? '' : `process.stdout.write(${JSON.stringify(stdout)});`}
  process.exitCode = ${exitCode};
}
`;
  await writeFile(file, body, 'utf8');
};

const answer = (event: HookEventName, fields: Record<string, unknown>): string =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...fields } });

const ran = (marker: string): boolean => existsSync(marker);

const handlerOf = (command: string, event: HookHandler['event'] = 'PostToolUse', matcher?: string): HookHandler => ({
  event,
  command,
  args: [],
  timeoutSec: 20,
  form: 'exec',
  unsupported: false,
  ...(matcher !== undefined ? { matcher } : {}),
});

const pkg = (handler: HookHandler, pluginRoot: string): PackageHookInput => ({ handler, pluginRoot });

/** Registers one package hook and approves it exactly as the UI would: describe, then send the hash back. */
const registerApproved = async (reg: HookRegistry, packageId: string, input: PackageHookInput): Promise<string> => {
  const [view] = await reg.registerPackageHooks(packageId, [input]);
  const description = await reg.describeHook(view.id);
  expect(description).toBeDefined();
  const result = await reg.approveHook(view.id, description?.hash ?? '');
  expect(result.ok).toBe(true);
  return view.id;
};

const toolPayload = (name: string): Record<string, unknown> => ({ tool_name: name, session_id: 's-1' });

describe('HookRegistry: identity and approval', { timeout: 60_000 }, () => {
  it('derives a stable id from source, event, matcher, command, args and package id', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const first = await reg.registerPackageHooks('pkg.a', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/x.js'), root)]);
    const again = await reg.registerPackageHooks('pkg.a', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/x.js'), root)]);
    expect(first[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(again[0].id).toBe(first[0].id);

    const other = await newEnv();
    const sameElsewhere = await other.reg.registerPackageHooks('pkg.a', [
      pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/x.js'), await freshDir('plug')),
    ]);
    expect(sameElsewhere[0].id).toBe(first[0].id);

    const variants = [
      await reg.registerPackageHooks('pkg.b', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/x.js'), root)]),
      await reg.registerPackageHooks('pkg.c', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/y.js'), root)]),
      await reg.registerPackageHooks('pkg.d', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/x.js', 'PreToolUse'), root)]),
      await reg.registerPackageHooks('pkg.e', [
        pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/x.js', 'PostToolUse', 'Write'), root),
      ]),
      await reg.registerPackageHooks('pkg.f', [
        pkg({ ...handlerOf('${CLAUDE_PLUGIN_ROOT}/x.js'), args: ['--flag'] }, root),
      ]),
    ].map((views) => views[0].id);
    expect(new Set([first[0].id, ...variants]).size).toBe(variants.length + 1);
  });

  it('refuses approval with a wrong hash and never lets the caller choose the stored hash', async () => {
    const { reg, storeFile } = await newEnv();
    const root = await freshDir('plug');
    await writeScript(path.join(root, 'a.js'), path.join(root, 'm'));
    const [view] = await reg.registerPackageHooks('pkg.a', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root)]);
    expect(view.status).toBe('needs-approval');

    const forged = `sha256-${'0'.repeat(64)}`;
    const refused = await reg.approveHook(view.id, forged);
    expect(refused).toMatchObject({ ok: false, code: 'HOOK_HASH_MISMATCH' });
    expect((await reg.listHooks())[0].status).toBe('needs-approval');
    expect(existsSync(storeFile)).toBe(false);

    const description = await reg.describeHook(view.id);
    const accepted = await reg.approveHook(view.id, description?.hash ?? '');
    expect(accepted.ok).toBe(true);
    const stored = JSON.parse(await readFile(storeFile, 'utf8')) as { approvals: Record<string, { hash: string }> };
    expect(stored.approvals[view.id].hash).toBe(description?.hash);
  });

  it('does not run a package hook until it is approved', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const marker = path.join(root, 'm');
    await writeScript(path.join(root, 'a.js'), marker);
    await reg.registerPackageHooks('pkg.a', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root)]);
    const summary = await reg.run('PostToolUse', toolPayload('Write'));
    expect(summary.perHook).toHaveLength(0);
    expect(ran(marker)).toBe(false);
  });

  it('refuses to enable a shell-form package hook', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const shell: HookHandler = { ...handlerOf('echo hi'), form: 'shell' };
    delete shell.args;
    const [view] = await reg.registerPackageHooks('pkg.a', [pkg(shell, root)]);
    expect(view.status).toBe('forbidden');
    const description = await reg.describeHook(view.id);
    expect(await reg.approveHook(view.id, description?.hash ?? '')).toMatchObject({
      ok: false,
      code: 'HOOK_FORBIDDEN',
    });
  });

  it('keeps hooks of unsupported events disabled', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const handler: HookHandler = { ...handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js', 'PreCompact'), unsupported: true };
    const [view] = await reg.registerPackageHooks('pkg.a', [pkg(handler, root)]);
    expect(view.status).toBe('unsupported');
    const description = await reg.describeHook(view.id);
    expect(await reg.approveHook(view.id, description?.hash ?? '')).toMatchObject({
      ok: false,
      code: 'HOOK_UNSUPPORTED',
    });
  });
});

describe('HookRegistry: content pinning (TOCTOU)', { timeout: 60_000 }, () => {
  it('switches an approved hook off when the script changed before the registry loads it again', async () => {
    const dir = await freshDir('env');
    const first = await makeRegistry(dir);
    const root = await freshDir('plug');
    const script = path.join(root, 'a.js');
    const marker = path.join(root, 'm');
    await writeScript(script, marker);
    const input = pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root);
    const id = await registerApproved(first.reg, 'pkg.a', input);
    await first.reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(true);
    await rm(marker);

    await writeScript(script, marker, '', 0, 'edited after approval');
    const second = await makeRegistry(dir);
    const [view] = await second.reg.registerPackageHooks('pkg.a', [input]);
    expect(view.id).toBe(id);
    expect(view.status).toBe('stale');
    expect(view.enabled).toBe(false);
    const summary = await second.reg.run('PostToolUse', toolPayload('Write'));
    expect(summary.perHook).toHaveLength(0);
    expect(ran(marker)).toBe(false);
    await second.reg.flush();
    const audit = await second.reg.readAudit(10);
    expect(audit.some((record) => record.errorCode === 'approval-stale' && record.hookId === id)).toBe(true);
  });

  it('re-hashes right before the spawn: a script edited after registration does not run', async () => {
    const dir = await freshDir('env');
    const { reg, auditFile, storeFile } = await makeRegistry(dir);
    const root = await freshDir('plug');
    const script = path.join(root, 'a.js');
    const marker = path.join(root, 'm');
    await writeScript(script, marker);
    const id = await registerApproved(reg, 'pkg.a', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root));

    await writeScript(script, marker, '', 0, 'swapped between approval and run');
    const summary = await reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(false);
    expect(summary.perHook).toHaveLength(1);
    expect(summary.perHook[0].errorCode).toBe('approval-stale');
    expect(summary.merged.blocked).toBe(false);
    expect(summary.warnings.join('\n')).toContain('changed since it was approved');
    await reg.flush();
    expect(await readFile(auditFile, 'utf8')).toContain('approval-stale');

    expect((await reg.listHooks())[0].status).toBe('stale');
    const stored = JSON.parse(await readFile(storeFile, 'utf8')) as { approvals: Record<string, { enabled: boolean }> };
    expect(stored.approvals[id].enabled).toBe(false);

    // It stays off after a restart, and enabling it again needs a fresh approval of the new content.
    const restarted = await makeRegistry(dir);
    await restarted.reg.registerPackageHooks('pkg.a', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root)]);
    expect(await restarted.reg.setHookEnabled(id, true)).toMatchObject({ ok: false, code: 'HOOK_APPROVAL_REQUIRED' });
    const description = await restarted.reg.describeHook(id);
    expect((await restarted.reg.approveHook(id, description?.hash ?? '')).ok).toBe(true);
    await restarted.reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(true);
  });

  it('switches a hook off when its command text changes (a new id never inherits an approval)', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    await writeScript(path.join(root, 'a.js'), path.join(root, 'm'));
    await writeScript(path.join(root, 'b.js'), path.join(root, 'm'));
    await registerApproved(reg, 'pkg.a', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root));
    const [changed] = await reg.registerPackageHooks('pkg.a', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/b.js'), root)]);
    expect(changed.status).toBe('needs-approval');
  });

  it('pins user hook scripts too', async () => {
    const dir = await freshDir('env');
    const { reg } = await makeRegistry(dir);
    const script = path.join(dir, 'user.js');
    const marker = path.join(dir, 'm');
    await writeScript(script, marker);
    const added = await reg.addUserHook({ event: 'PostToolUse', command: script, args: [], timeoutSec: 20 });
    expect(added.ok).toBe(true);
    const id = added.ok ? added.hook.id : '';
    const description = await reg.describeHook(id);
    expect((await reg.approveHook(id, description?.hash ?? '')).ok).toBe(true);
    await reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(true);
    await rm(marker);
    await writeScript(script, marker, '', 0, 'edited');
    await reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(false);
  });
});

describe('HookRegistry: workspace hooks and consent', { timeout: 60_000 }, () => {
  const makeWorkspace = async (): Promise<{ ws: string; marker: string; script: string }> => {
    const ws = await realpath(await freshDir('ws'));
    const marker = path.join(ws, 'marker');
    const script = path.join(ws, 'scripts', 'lint.js');
    await writeScript(script, marker);
    const settings = {
      hooks: {
        PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: script, args: [] as string[] }] }],
      },
    };
    await mkdir(path.join(ws, '.claude'), { recursive: true });
    await writeFile(path.join(ws, '.claude', 'settings.json'), JSON.stringify(settings), 'utf8');
    return { ws, marker, script };
  };

  it('lists workspace hooks as needs-consent and never runs them before consent', async () => {
    const { reg } = await newEnv();
    const { ws, marker } = await makeWorkspace();
    const loaded = await reg.loadWorkspaceHooks(ws);
    expect(loaded.consented).toBe(false);
    expect(loaded.hooks).toHaveLength(1);
    expect(loaded.hooks[0]).toMatchObject({ source: 'workspace', status: 'needs-consent', active: false });
    expect(await reg.hasWorkspaceConsent(ws)).toBe(false);

    // No approval path exists without consent, and a run with the workspace selected executes nothing.
    expect(await reg.describeHook(loaded.hooks[0].id)).toBeUndefined();
    expect(await reg.approveHook(loaded.hooks[0].id, `sha256-${'1'.repeat(64)}`)).toMatchObject({
      ok: false,
      code: 'HOOK_NEEDS_CONSENT',
    });
    const summary = await reg.run('PostToolUse', toolPayload('Write'), { workspaceDir: ws });
    expect(summary.perHook).toHaveLength(0);
    expect(ran(marker)).toBe(false);
  });

  it('consent alone does not approve: workspace hooks stay unapproved until the user approves each one', async () => {
    const { reg } = await newEnv();
    const { ws, marker } = await makeWorkspace();
    expect(await reg.setWorkspaceConsent(ws, true)).toBe(true);
    expect(await reg.hasWorkspaceConsent(ws)).toBe(true);
    const loaded = await reg.loadWorkspaceHooks(ws);
    expect(loaded.hooks[0].status).toBe('needs-approval');
    await reg.run('PostToolUse', toolPayload('Write'), { workspaceDir: ws });
    expect(ran(marker)).toBe(false);

    const description = await reg.describeHook(loaded.hooks[0].id);
    expect((await reg.approveHook(loaded.hooks[0].id, description?.hash ?? '')).ok).toBe(true);
    const summary = await reg.run('PostToolUse', toolPayload('Write'), { workspaceDir: ws });
    expect(summary.perHook).toHaveLength(1);
    expect(ran(marker)).toBe(true);
    await rm(marker);

    // Revoking consent takes effect on the next run.
    expect(await reg.setWorkspaceConsent(ws, false)).toBe(true);
    await reg.run('PostToolUse', toolPayload('Write'), { workspaceDir: ws });
    expect(ran(marker)).toBe(false);
  });

  it('reads settings.local.json too, and reports a broken settings file as an issue', async () => {
    const { reg } = await newEnv();
    const { ws } = await makeWorkspace();
    const other = path.join(ws, 'scripts', 'other.js');
    await writeScript(other, path.join(ws, 'm2'));
    await writeFile(
      path.join(ws, '.claude', 'settings.local.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: other, args: [] }] }] } }),
      'utf8'
    );
    const loaded = await reg.loadWorkspaceHooks(ws);
    expect(loaded.hooks.map((hook) => hook.event).toSorted()).toEqual(['PostToolUse', 'Stop']);

    await writeFile(path.join(ws, '.claude', 'settings.local.json'), '{ nope', 'utf8');
    const broken = await reg.loadWorkspaceHooks(ws);
    expect(broken.hooks).toHaveLength(1);
    expect(broken.issues[0]).toMatchObject({ file: 'settings.local.json', code: 'invalid-config' });
  });

  it('normalizes the consent key through realpath', async () => {
    const { reg } = await newEnv();
    const { ws } = await makeWorkspace();
    expect(await reg.setWorkspaceConsent(path.join(ws, 'scripts', '..'), true)).toBe(true);
    expect(await reg.hasWorkspaceConsent(ws)).toBe(true);
    expect(await reg.setWorkspaceConsent(path.join(ws, 'does-not-exist'), true)).toBe(false);
  });
});

describe('HookRegistry: corrupt or damaged state', { timeout: 60_000 }, () => {
  it('treats a corrupt store as empty: nothing is enabled and the damaged file is kept aside', async () => {
    const dir = await freshDir('env');
    const first = await makeRegistry(dir);
    const root = await freshDir('plug');
    const marker = path.join(root, 'm');
    await writeScript(path.join(root, 'a.js'), marker);
    const input = pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root);
    await registerApproved(first.reg, 'pkg.a', input);
    await first.reg.addUserHook({ event: 'Stop', command: 'x.js', args: [], timeoutSec: 5 });

    await writeFile(first.storeFile, '{{{ garbage', 'utf8');
    const second = await makeRegistry(dir);
    const [view] = await second.reg.registerPackageHooks('pkg.a', [input]);
    expect(view.status).toBe('needs-approval');
    expect(await second.reg.listHooks()).toHaveLength(1);
    await second.reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(false);
    expect(existsSync(`${first.storeFile}.corrupt`)).toBe(true);
  });

  it('drops a bad record on its own and fails closed on a bad global switch', async () => {
    const dir = await freshDir('env');
    const storeFile = path.join(dir, 'state', 'user-hooks.json');
    await mkdir(path.dirname(storeFile), { recursive: true });
    await writeFile(
      storeFile,
      JSON.stringify({
        schemaVersion: 1,
        disableAll: 'yes',
        userHooks: [
          { event: 'Stop', command: 'ok.js', args: [], timeoutSec: 5 },
          { event: 'NotAnEvent', command: 'bad.js', timeoutSec: 5 },
          { event: 'Stop', command: 'extra.js', timeoutSec: 5, surprise: true },
        ],
        approvals: { 'not-an-id': { hash: 'x' } },
      }),
      'utf8'
    );
    const reg = createHookRegistry({ storeFilePath: storeFile, auditFilePath: path.join(dir, 'a.jsonl') });
    const report = await reg.initialize();
    expect(report).toEqual({ corrupt: false, droppedRecords: 3 });
    expect(await reg.listHooks()).toHaveLength(1);
    expect(reg.getSwitches().disableAll).toBe(true);
  });

  it('writes atomically: no temporary file is left, and a failed rename keeps the old file and state', async () => {
    const dir = await freshDir('env');
    const { reg, storeFile } = await makeRegistry(dir);
    await reg.setDisableAll(true);
    expect((await readdir(path.dirname(storeFile))).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    const calls: string[] = [];
    let failRename = false;
    const io: HookStoreIo = {
      readFile: (file) => readFile(file, 'utf8'),
      writeFile: async (file, data) => {
        calls.push(file);
        await writeFile(file, data, 'utf8');
      },
      rename: async (from, to) => {
        if (failRename) throw new Error('disk full');
        const { rename } = await import('node:fs/promises');
        await rename(from, to);
      },
      mkdir: async (target) => {
        await mkdir(target, { recursive: true });
      },
      rm: (file) => rm(file, { force: true }),
    };
    const store = createHookRegistryStore(storeFile, io);
    await store.load();
    expect(store.state().disableAll).toBe(true);
    const before = await readFile(storeFile, 'utf8');

    failRename = true;
    await expect(
      store.update((draft) => {
        draft.disableAll = false;
      })
    ).rejects.toThrow('disk full');
    expect(await readFile(storeFile, 'utf8')).toBe(before);
    expect(store.state().disableAll).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(existsSync(calls[calls.length - 1])).toBe(false);
  });

  it('reports a failed save instead of approving', async () => {
    const dir = await freshDir('env');
    const blocker = path.join(dir, 'blocker');
    await writeFile(blocker, 'a file where a directory is needed', 'utf8');
    const reg = createHookRegistry({
      storeFilePath: path.join(blocker, 'user-hooks.json'),
      auditFilePath: path.join(dir, 'a.jsonl'),
    });
    await reg.initialize();
    const root = await freshDir('plug');
    await writeScript(path.join(root, 'a.js'), path.join(root, 'm'));
    const [view] = await reg.registerPackageHooks('pkg.a', [pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root)]);
    const description = await reg.describeHook(view.id);
    expect(await reg.approveHook(view.id, description?.hash ?? '')).toMatchObject({
      ok: false,
      code: 'HOOK_STORE_FAILED',
    });
    expect((await reg.listHooks())[0].status).toBe('needs-approval');
  });
});

describe('HookRegistry: switches', { timeout: 60_000 }, () => {
  it('disableAll stops every hook at once, takes effect on the next run and survives a restart', async () => {
    const dir = await freshDir('env');
    const { reg } = await makeRegistry(dir);
    const root = await freshDir('plug');
    const marker = path.join(root, 'm');
    await writeScript(path.join(root, 'a.js'), marker);
    await registerApproved(reg, 'pkg.a', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root));

    expect(await reg.setDisableAll(true)).toBe(true);
    const off = await reg.run('PostToolUse', toolPayload('Write'));
    expect(off.perHook).toHaveLength(0);
    expect(ran(marker)).toBe(false);
    expect((await reg.listHooks())[0].active).toBe(false);

    const restarted = await makeRegistry(dir);
    expect(restarted.reg.getSwitches().disableAll).toBe(true);

    expect(await reg.setDisableAll(false)).toBe(true);
    await reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(true);
  });

  it('a per-source switch only affects that source', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const packageMarker = path.join(root, 'pm');
    const userMarker = path.join(root, 'um');
    await writeScript(path.join(root, 'a.js'), packageMarker);
    await registerApproved(reg, 'pkg.a', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root));
    const userScript = path.join(root, 'u.js');
    await writeScript(userScript, userMarker);
    const added = await reg.addUserHook({ event: 'PostToolUse', command: userScript, args: [], timeoutSec: 20 });
    const userId = added.ok ? added.hook.id : '';
    const description = await reg.describeHook(userId);
    await reg.approveHook(userId, description?.hash ?? '');

    await reg.setSourceEnabled('package', false);
    await reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(packageMarker)).toBe(false);
    expect(ran(userMarker)).toBe(true);
    expect(reg.getSwitches().sources).toEqual({ package: false, user: true, workspace: true });
  });

  it('a hook switched off by hand stays off until switched on', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const marker = path.join(root, 'm');
    await writeScript(path.join(root, 'a.js'), marker);
    const id = await registerApproved(reg, 'pkg.a', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root));
    expect((await reg.setHookEnabled(id, false)).ok).toBe(true);
    await reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(false);
    expect((await reg.setHookEnabled(id, true)).ok).toBe(true);
    await reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(true);
  });
});

describe('HookRegistry: matching, merging and failures', { timeout: 60_000 }, () => {
  it('selects hooks by tool name; non-tool events only take an empty or * matcher', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const writeMarker = path.join(root, 'w');
    const editMarker = path.join(root, 'e');
    const allMarker = path.join(root, 'all');
    await writeScript(path.join(root, 'w.js'), writeMarker);
    await writeScript(path.join(root, 'e.js'), editMarker);
    await writeScript(path.join(root, 'all.js'), allMarker);
    await registerApproved(
      reg,
      'pkg.w',
      pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/w.js', 'PostToolUse', 'Write|tomny_write'), root)
    );
    await registerApproved(reg, 'pkg.e', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/e.js', 'PostToolUse', 'Edit'), root));
    await registerApproved(reg, 'pkg.all', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/all.js', 'PostToolUse', '*'), root));

    const summary = await reg.run('PostToolUse', toolPayload('Write'));
    expect(summary.perHook).toHaveLength(2);
    expect(ran(writeMarker)).toBe(true);
    expect(ran(allMarker)).toBe(true);
    expect(ran(editMarker)).toBe(false);

    const startMarker = path.join(root, 'start');
    const startAll = path.join(root, 'startall');
    await writeScript(path.join(root, 's.js'), startMarker);
    await writeScript(path.join(root, 'sa.js'), startAll);
    await registerApproved(reg, 'pkg.s', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/s.js', 'SessionStart', 'startup'), root));
    await registerApproved(reg, 'pkg.sa', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/sa.js', 'SessionStart', '*'), root));
    await reg.run('SessionStart', { source: 'startup' });
    expect(ran(startMarker)).toBe(false);
    expect(ran(startAll)).toBe(true);
  });

  it('ignores events the runner does not support', async () => {
    const { reg } = await newEnv();
    const summary = await reg.run('PreCompact' as HookEventName, {});
    expect(summary).toMatchObject({ perHook: [], warnings: [] });
    expect(summary.merged.blocked).toBe(false);
  });

  it('runs two hooks in parallel and merges deny over ask', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const askMarker = path.join(root, 'ask');
    const denyMarker = path.join(root, 'deny');
    await writeScript(
      path.join(root, 'ask.js'),
      askMarker,
      answer('PreToolUse', { permissionDecision: 'ask', permissionDecisionReason: 'please confirm' })
    );
    await writeScript(
      path.join(root, 'deny.js'),
      denyMarker,
      answer('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: 'not allowed' })
    );
    await registerApproved(reg, 'pkg.ask', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/ask.js', 'PreToolUse'), root));
    await registerApproved(reg, 'pkg.deny', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/deny.js', 'PreToolUse'), root));

    const summary = await reg.run('PreToolUse', toolPayload('Bash'));
    expect(summary.perHook).toHaveLength(2);
    expect(ran(askMarker) && ran(denyMarker)).toBe(true);
    expect(summary.merged.blocked).toBe(true);
    expect(summary.merged.permissionDecision).toBe('deny');
    expect(summary.merged.reason).toContain('not allowed');

    const askOnly = await newEnv();
    await registerApproved(askOnly.reg, 'pkg.ask', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/ask.js', 'PreToolUse'), root));
    const asked = await askOnly.reg.run('PreToolUse', toolPayload('Bash'));
    expect(asked.merged).toMatchObject({ blocked: false, permissionDecision: 'ask' });
  });

  it('keeps running already active hooks when another approved hook is added later', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('additive');
    const userMarker = path.join(root, 'user');
    const laterMarker = path.join(root, 'later');
    await writeScript(path.join(root, 'user.js'), userMarker);
    await writeScript(path.join(root, 'later.js'), laterMarker);
    await registerApproved(reg, 'pkg.user', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/user.js', 'PostToolUse'), root));
    await reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(userMarker)).toBe(true);

    await registerApproved(reg, 'pkg.later', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/later.js', 'PostToolUse'), root));
    const summary = await reg.run('PostToolUse', toolPayload('Write'));
    expect(summary.perHook).toHaveLength(2);
    expect(ran(userMarker) && ran(laterMarker)).toBe(true);
  });


  it('never lets a hook grant permission', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    await writeScript(
      path.join(root, 'allow.js'),
      path.join(root, 'm'),
      answer('PreToolUse', { permissionDecision: 'allow' })
    );
    await registerApproved(reg, 'pkg.allow', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/allow.js', 'PreToolUse'), root));
    const summary = await reg.run('PreToolUse', toolPayload('Bash'));
    expect(summary.merged.permissionDecision).toBeUndefined();
    expect(summary.merged.blocked).toBe(false);
    expect(summary.warnings.join('\n')).toContain('cannot grant permission');
  });

  it('a failing hook only produces a warning and does not block the others', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const goodMarker = path.join(root, 'good');
    await writeScript(path.join(root, 'bad.js'), path.join(root, 'bad'), '', 3);
    await writeScript(path.join(root, 'good.js'), goodMarker, answer('PostToolUse', { additionalContext: 'lint ok' }));
    await registerApproved(reg, 'pkg.bad', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/bad.js'), root));
    await registerApproved(reg, 'pkg.good', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/good.js'), root));
    const summary = await reg.run('PostToolUse', toolPayload('Write'));
    expect(summary.perHook).toHaveLength(2);
    expect(summary.merged.blocked).toBe(false);
    expect(summary.merged.additionalContext).toBe('lint ok');
    expect(summary.warnings.some((warning) => warning.includes('code 3'))).toBe(true);
  });

  it('a hook that cannot start (script deleted after approval) fails open', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    const script = path.join(root, 'a.js');
    await writeScript(script, path.join(root, 'm'));
    await registerApproved(reg, 'pkg.a', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root));
    await rm(script);
    const summary = await reg.run('PostToolUse', toolPayload('Write'));
    expect(summary.merged.blocked).toBe(false);
    expect(summary.perHook[0].errorCode).toBe('approval-stale');
  });

  it('keeps the audit free of stdin and output, and records pluginId and hookId only', async () => {
    const { reg, auditFile } = await newEnv();
    const root = await freshDir('plug');
    await writeScript(
      path.join(root, 'a.js'),
      path.join(root, 'm'),
      answer('PostToolUse', { additionalContext: 'SECRET-CONTEXT' })
    );
    const id = await registerApproved(reg, 'pkg.audit', pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root));
    await reg.run('PostToolUse', { ...toolPayload('Write'), prompt: 'SECRET-PROMPT' });
    await reg.flush();
    const text = await readFile(auditFile, 'utf8');
    expect(text).not.toContain('SECRET-PROMPT');
    expect(text).not.toContain('SECRET-CONTEXT');
    expect(text).not.toContain(root);
    const [record] = await reg.readAudit(1);
    expect(record).toMatchObject({
      hookId: id,
      pluginId: 'pkg.audit',
      source: 'package',
      exitCode: 0,
      decision: 'none',
    });
  });
});

describe('HookRegistry: renderer-facing data and lifecycle', { timeout: 60_000 }, () => {
  it('lists sanitized views: no absolute paths and no hash', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    await writeScript(path.join(root, 'a.js'), path.join(root, 'm'));
    await registerApproved(reg, 'pkg.a', pkg(handlerOf(`${root}/a.js`.replace(/\\/g, '/')), root));
    const { ws } = { ws: await realpath(await freshDir('ws')) };
    await mkdir(path.join(ws, '.claude'), { recursive: true });
    await writeFile(
      path.join(ws, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `${ws}/x.js`, args: [] }] }] } }),
      'utf8'
    );
    const loaded = await reg.loadWorkspaceHooks(ws);
    const text = JSON.stringify([...(await reg.listHooks()), ...loaded.hooks]);
    expect(text).not.toContain(root.replace(/\\/g, '\\\\'));
    expect(text).not.toContain(root.replace(/\\/g, '/'));
    expect(text).not.toContain(ws.replace(/\\/g, '/'));
    expect(text).not.toContain('sha256-');
    expect(text).toContain('${CLAUDE_PLUGIN_ROOT}/a.js');
  });

  it('describeHook shows event, matcher, command, args, script file and the unrestricted-network note', async () => {
    const { reg } = await newEnv();
    const root = await freshDir('plug');
    await writeScript(path.join(root, 'scripts', 'fmt.js'), path.join(root, 'm'));
    const handler = { ...handlerOf('${CLAUDE_PLUGIN_ROOT}/scripts/fmt.js', 'PostToolUse', 'Write'), args: ['--fix'] };
    const [view] = await reg.registerPackageHooks('pkg.a', [pkg(handler, root)]);
    const description = await reg.describeHook(view.id);
    const lines = description?.lines ?? [];
    expect(lines).toContainEqual({ key: 'event', value: 'PostToolUse' });
    expect(lines).toContainEqual({ key: 'matcher', value: 'Write' });
    expect(lines).toContainEqual({ key: 'command', value: '${CLAUDE_PLUGIN_ROOT}/scripts/fmt.js' });
    expect(lines).toContainEqual({ key: 'args', value: '--fix' });
    expect(lines).toContainEqual({ key: 'file', value: 'scripts/fmt.js' });
    expect(lines).toContainEqual({ key: 'network', value: 'unrestricted' });
    expect(description?.hash).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(JSON.stringify(lines)).not.toContain(root.replace(/\\/g, '/'));
  });

  it('keeps an approval across restarts, and unregister removes the hooks from running', async () => {
    const dir = await freshDir('env');
    const first = await makeRegistry(dir);
    const root = await freshDir('plug');
    const marker = path.join(root, 'm');
    await writeScript(path.join(root, 'a.js'), marker);
    const input = pkg(handlerOf('${CLAUDE_PLUGIN_ROOT}/a.js'), root);
    await registerApproved(first.reg, 'pkg.a', input);

    const second = await makeRegistry(dir);
    const [view] = await second.reg.registerPackageHooks('pkg.a', [input]);
    expect(view.status).toBe('ready');
    await second.reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(true);
    await rm(marker);

    await second.reg.unregisterPackageHooks('pkg.a');
    await second.reg.run('PostToolUse', toolPayload('Write'));
    expect(ran(marker)).toBe(false);

    await second.reg.registerPackageHooks('pkg.a', [input]);
    await second.reg.unregisterPackageHooks('pkg.a', { forgetApprovals: true });
    const [again] = await second.reg.registerPackageHooks('pkg.a', [input]);
    expect(again.status).toBe('needs-approval');
  });

  it('validates user hooks strictly and persists them', async () => {
    const dir = await freshDir('env');
    const { reg } = await makeRegistry(dir);
    expect(await reg.addUserHook({ event: 'Stop', command: '', timeoutSec: 5 })).toMatchObject({
      ok: false,
      code: 'HOOK_INVALID',
    });
    expect(await reg.addUserHook({ event: 'Nope', command: 'x', timeoutSec: 5 })).toMatchObject({ ok: false });
    expect(await reg.addUserHook({ event: 'Stop', command: 'x', timeoutSec: 5, extra: 1 })).toMatchObject({
      ok: false,
    });
    const added = await reg.addUserHook({ event: 'Stop', command: 'echo hi', timeoutSec: 5 });
    expect(added).toMatchObject({ ok: true, hook: { source: 'user', form: 'shell', status: 'needs-approval' } });

    const restarted = await makeRegistry(dir);
    const listed = await restarted.reg.listHooks();
    expect(listed).toHaveLength(1);
    expect(await restarted.reg.removeUserHook(listed[0].id)).toBe(true);
    expect(await restarted.reg.listHooks()).toHaveLength(0);
  });
});
