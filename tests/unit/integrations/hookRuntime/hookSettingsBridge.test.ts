/* oxlint-disable no-await-in-loop -- each request in a scenario must finish before the next */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOOK_SETTINGS_CHANNELS } from '@/common/integrations/hooks/hookSettings';
import { getHookCoverage } from '@process/integrations/hookRuntime/hookDispatcher';
import { registerHookSettingsBridge } from '@process/integrations/hookRuntime/hookBridge';
import { createHookRegistry } from '@process/integrations/hooks/hookRegistry';
import { createHookLimiter } from '@process/integrations/hooks/hookRunner';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tomny-hook-bridge-')));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const GOOD = { sender: 'main' };
const BAD = { sender: 'other' };
const WRONG_HASH = `sha256-${'a'.repeat(64)}`;
type Handler = (event: unknown, raw: unknown) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
type Row = { id: string; status: string; active: boolean; command: string; args?: string[] };
type Channel = keyof typeof HOOK_SETTINGS_CHANNELS;

const setup = async (options: { confirm?: boolean; registry?: 'none' } = {}) => {
  const dir = await temp();
  const script = path.join(dir, 'hooks', 'guard.js');
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(script, 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));', 'utf8');
  const registry = createHookRegistry({
    storeFilePath: path.join(dir, 'state', 'user-hooks.json'),
    auditFilePath: path.join(dir, 'state', 'audit.jsonl'),
    limiter: createHookLimiter(),
  });
  await registry.initialize();

  const handlers = new Map<string, Handler>();
  const removed: string[] = [];
  const confirmApprove = vi.fn(async () => options.confirm ?? true);
  const audit = vi.fn(async () => undefined);
  const dispose = registerHookSettingsBridge({
    ipcMain: {
      handle: (channel: string, handler: unknown) => {
        handlers.set(channel, handler as Handler);
      },
      removeHandler: (channel: string) => {
        removed.push(channel);
      },
    },
    verifySender: (event) => (event as unknown as { sender: string }).sender === 'main',
    getRegistry: async () => (options.registry === 'none' ? undefined : registry),
    coverageOf: getHookCoverage,
    confirmApprove,
    audit,
  });
  const call = (channel: Channel, raw: unknown, event: unknown = GOOD) => {
    const handler = handlers.get(HOOK_SETTINGS_CHANNELS[channel]);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, raw);
  };
  const create = async () => {
    const created = await call('createUser', {
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'node',
      args: [script],
      timeoutSec: 5,
    });
    expect(created.ok).toBe(true);
    return created.data as Row;
  };
  const describe_ = async (hookId: string) =>
    (await call('describe', { hookId })).data as { approvalHash: string; lines: { key: string; value: string }[] };
  return { call, handlers, removed, dispose, confirmApprove, audit, registry, script, create, describe_ };
};

describe('hook settings IPC', () => {
  it('registers exactly its channels and removes them on dispose', async () => {
    const t = await setup();
    expect([...t.handlers.keys()].toSorted()).toEqual(Object.values(HOOK_SETTINGS_CHANNELS).toSorted());
    t.dispose();
    expect(t.removed.toSorted()).toEqual(Object.values(HOOK_SETTINGS_CHANNELS).toSorted());
    expect(await t.call('list', {})).toEqual({ ok: false, error: 'DENIED' });
  });

  it('rejects a sender that is not the main frame on every channel and changes nothing', async () => {
    const t = await setup();
    const row = await t.create();
    const raw = { hookId: row.id, approvalHash: WRONG_HASH, enabled: true, disabled: true, source: 'user', limit: 5 };
    for (const channel of Object.keys(HOOK_SETTINGS_CHANNELS) as Channel[]) {
      expect(await t.call(channel, raw, BAD)).toEqual({ ok: false, error: 'DENIED' });
    }
    expect(t.confirmApprove).not.toHaveBeenCalled();
    const list = await t.call('list', {});
    expect((list.data as { switches: unknown }).switches).toEqual({
      disableAll: false,
      sources: { package: true, user: true, workspace: true },
    });
    expect((list.data as { hooks: Row[] }).hooks.map((hook) => hook.status)).toEqual(['needs-approval']);
  });

  it('refuses any request that carries a path or anything unknown', async () => {
    const t = await setup();
    const row = await t.create();
    const bad: [Channel, unknown][] = [
      ['list', { path: 'C:/Windows' }],
      ['list', { workspaceDir: 'C:/work' }],
      ['describe', { hookId: row.id, path: t.script }],
      ['describe', { hookId: t.script }],
      ['approve', { hookId: row.id, approvalHash: WRONG_HASH, scriptPath: t.script }],
      ['approve', { hookId: row.id, approvalHash: 'sha256-short' }],
      ['approve', { hookId: '../../etc/passwd', approvalHash: WRONG_HASH }],
      ['setEnabled', { hookId: row.id, enabled: 'yes' }],
      ['setDisableAll', { disabled: true, path: t.script }],
      ['setSourceEnabled', { source: 'C:/x', enabled: true }],
      ['removeUser', { hookId: row.id, path: t.script }],
      ['audit', { limit: 5000 }],
      ['audit', { file: 'C:/audit.jsonl' }],
      ['coverage', { protocol: 'acp' }],
      ['createUser', { event: 'PreToolUse', command: 'node', timeoutSec: 5, cwd: 'C:/x' }],
      ['createUser', { event: 'NotAnEvent', command: 'node', timeoutSec: 5 }],
      ['createUser', { event: 'PreToolUse', command: '', timeoutSec: 5 }],
      ['createUser', { event: 'PreToolUse', command: 'node', timeoutSec: 9999 }],
    ];
    for (const [channel, raw] of bad) {
      expect(await t.call(channel, raw), `${channel} ${JSON.stringify(raw)}`).toEqual({
        ok: false,
        error: 'INVALID_REQUEST',
      });
    }
    expect(t.confirmApprove).not.toHaveBeenCalled();
  });

  it('refuses a wrong approval hash before any dialog and approves only the hash Main computed', async () => {
    const t = await setup();
    const row = await t.create();
    expect(await t.call('approve', { hookId: row.id, approvalHash: WRONG_HASH })).toEqual({
      ok: false,
      error: 'HASH_MISMATCH',
    });
    expect(t.confirmApprove).not.toHaveBeenCalled();
    expect(((await t.call('list', {})).data as { hooks: Row[] }).hooks[0]?.status).toBe('needs-approval');

    const { approvalHash } = await t.describe_(row.id);
    const approved = await t.call('approve', { hookId: row.id, approvalHash });
    expect(approved.ok).toBe(true);
    expect((approved.data as Row).status).toBe('ready');
    expect(t.confirmApprove).toHaveBeenCalledTimes(1);
  });

  it('refuses a hash that was shown before the script changed', async () => {
    const t = await setup();
    const row = await t.create();
    const { approvalHash } = await t.describe_(row.id);
    await writeFile(t.script, 'process.exit(1); // changed after the person read it', 'utf8');
    expect(await t.call('approve', { hookId: row.id, approvalHash })).toEqual({ ok: false, error: 'HASH_MISMATCH' });
    expect(t.confirmApprove).not.toHaveBeenCalled();
    // Reading it again gives the new hash, and that one is accepted.
    const again = await t.describe_(row.id);
    expect(again.approvalHash).not.toBe(approvalHash);
    expect((await t.call('approve', { hookId: row.id, approvalHash: again.approvalHash })).ok).toBe(true);
  });

  it('does not approve when the native dialog is declined, and does not grant anything on its own', async () => {
    const t = await setup({ confirm: false });
    const row = await t.create();
    const { approvalHash } = await t.describe_(row.id);
    expect(await t.call('approve', { hookId: row.id, approvalHash })).toEqual({ ok: false, error: 'CANCELLED' });
    expect(((await t.call('list', {})).data as { hooks: Row[] }).hooks[0]?.status).toBe('needs-approval');
    // Turning it on without an approval is refused as well.
    expect(await t.call('setEnabled', { hookId: row.id, enabled: true })).toEqual({
      ok: false,
      error: 'APPROVAL_REQUIRED',
    });
  });

  it('shows the exact command and the describe lines without a path in the hook id or hash', async () => {
    const t = await setup();
    const row = await t.create();
    expect(row.command).toBe('node');
    expect(row.id).toMatch(/^[a-f0-9]{64}$/u);
    const description = await t.describe_(row.id);
    expect(description.approvalHash).toMatch(/^sha256-[a-f0-9]{64}$/u);
    const keys = description.lines.map((line) => line.key);
    expect(keys).toEqual(
      expect.arrayContaining(['source', 'event', 'matcher', 'form', 'command', 'timeout', 'network'])
    );
    expect(description.lines.find((line) => line.key === 'network')?.value).toBe('unrestricted');
  });

  it('disables and re-enables an approved hook, and the switches decide whether it is active', async () => {
    const t = await setup();
    const row = await t.create();
    const { approvalHash } = await t.describe_(row.id);
    await t.call('approve', { hookId: row.id, approvalHash });

    const off = await t.call('setEnabled', { hookId: row.id, enabled: false });
    expect((off.data as Row).status).toBe('disabled');
    const on = await t.call('setEnabled', { hookId: row.id, enabled: true });
    expect((on.data as Row).status).toBe('ready');
    expect((on.data as Row).active).toBe(true);

    const all = await t.call('setDisableAll', { disabled: true });
    expect(all).toEqual({
      ok: true,
      data: { disableAll: true, sources: { package: true, user: true, workspace: true } },
    });
    expect((((await t.call('list', {})).data as { hooks: Row[] }).hooks[0] as Row).active).toBe(false);
    await t.call('setDisableAll', { disabled: false });

    const source = await t.call('setSourceEnabled', { source: 'user', enabled: false });
    expect((source.data as { sources: Record<string, boolean> }).sources.user).toBe(false);
    expect((((await t.call('list', {})).data as { hooks: Row[] }).hooks[0] as Row).active).toBe(false);
    // The registry itself enforces it on the next call (no restart needed).
    const summary = await t.registry.run(
      'PreToolUse',
      { tool_name: 'Bash' },
      { resolveInterpreter: () => process.execPath }
    );
    expect(summary.perHook).toEqual([]);
  });

  it('removes only user hooks', async () => {
    const t = await setup();
    const row = await t.create();
    expect(await t.call('removeUser', { hookId: row.id })).toEqual({ ok: true, data: { removed: true } });
    expect(await t.call('removeUser', { hookId: row.id })).toEqual({ ok: false, error: 'NOT_FOUND' });

    const [pkg] = await t.registry.registerPackageHooks('com.x.pkg', [
      {
        pluginRoot: path.dirname(t.script),
        handler: {
          event: 'PreToolUse',
          command: 'node',
          args: [t.script],
          timeoutSec: 5,
          form: 'exec',
          unsupported: false,
        },
      },
    ]);
    expect(await t.call('removeUser', { hookId: pkg?.id })).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('returns audit lines with lengths and codes only', async () => {
    const t = await setup();
    const row = await t.create();
    const { approvalHash } = await t.describe_(row.id);
    await t.call('approve', { hookId: row.id, approvalHash });
    await t.registry.run('PreToolUse', { tool_name: 'Bash' }, { resolveInterpreter: () => process.execPath });
    await t.registry.flush();
    const lines = (await t.call('audit', { limit: 10 })).data as Record<string, unknown>[];
    expect(lines.length).toBeGreaterThan(0);
    const allowedKeys = new Set([
      'ts',
      'event',
      'hookId',
      'source',
      'pluginId',
      'durationMs',
      'exitCode',
      'timedOut',
      'decision',
      'stdoutLength',
      'stderrLength',
      'errorCode',
    ]);
    for (const line of lines) {
      for (const key of Object.keys(line)) expect(allowedKeys.has(key), key).toBe(true);
    }
    expect(JSON.stringify(lines)).not.toContain(path.dirname(t.script));
  });

  it('states the coverage honestly: native blocks, ACP only in ask mode, Codex never', async () => {
    const t = await setup();
    const result = await t.call('coverage', {});
    const rows = Object.fromEntries(
      (result.data as { agent: string; preToolUse: string }[]).map((row) => [row.agent, row.preToolUse])
    );
    expect(rows).toMatchObject({
      tomny: 'all-tools',
      acpAsk: 'permission-requests-only',
      acpAuto: 'none',
      codex: 'none',
    });
  });

  it('answers UNAVAILABLE when the registry cannot load', async () => {
    const none = await setup({ registry: 'none' });
    expect(await none.call('list', {})).toEqual({ ok: false, error: 'UNAVAILABLE' });
    expect(await none.call('coverage', {})).toEqual({ ok: false, error: 'UNAVAILABLE' });
  });

  it('writes receipts that carry no command, path or hash', async () => {
    const t = await setup();
    const row = await t.create();
    const { approvalHash } = await t.describe_(row.id);
    await t.call('approve', { hookId: row.id, approvalHash });
    const records = t.audit.mock.calls.map((args) => (args as unknown[])[0] as Record<string, unknown>);
    expect(records.map((record) => record.operation)).toEqual(['hook-create-user', 'hook-approve']);
    for (const record of records) {
      expect(Object.keys(record).toSorted()).toEqual(['operation', 'status', 'subjectId']);
      expect(JSON.stringify(record)).not.toContain('sha256-');
    }
  });
});
