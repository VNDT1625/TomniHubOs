/* oxlint-disable no-await-in-loop -- each request in a scenario must finish before the next */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { PACKAGE_CONNECTIONS_CHANNELS } from '@/common/types/platform/packageConnections';
import { createConnectionRegistry } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { defineConnectionHost } from '@process/integrations/connections/core/types';
import { registerPackageConnectionsBridge } from '@process/integrations/connections/ipc/connectionBridge';
import { setPackageEnabled } from '@process/integrations/connections/wiring/packageSwitch';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-conn-bridge-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PACKAGE_ID = 'com.community.sample';
const GOOD = { sender: 'main' };
const BAD = { sender: 'other' };
type HookFacts = { id: string; command: string; args?: string[] };
type Handler = (event: unknown, raw: unknown) => Promise<{ ok: boolean; error?: string; data?: unknown }>;

const setup = async (options: { confirm?: boolean } = {}) => {
  const dir = await temp();
  await mkdir(path.join(dir, 'source', 'hooks'), { recursive: true });
  await mkdir(path.join(dir, 'source', 'skills', 'a'), { recursive: true });
  await writeFile(path.join(dir, 'source', 'hooks', 'run.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'source', 'skills', 'a', 'SKILL.md'), '# a');
  const adapter = parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: [
      { kind: 'hook', id: 'h', event: 'PostToolUse', command: 'node', args: ['source/hooks/run.js'] },
      { kind: 'skill', path: 'source/skills/a' },
    ],
  });
  const enabled: string[] = [];
  const hooks = defineConnectionHost({
    kind: 'hook',
    check: async () => ({ ok: true }),
    describe: async (_ctx, connection) => {
      const hook = connection as unknown as HookFacts;
      return {
        kind: 'hook',
        title: hook.id,
        lines: [{ label: 'Lệnh', value: `${hook.command} ${(hook.args ?? []).join(' ')}` }],
        files: ['source/hooks/run.js'],
      };
    },
    enable: async (_ctx, connection) => {
      const hook = connection as unknown as HookFacts;
      enabled.push(hook.id);
      return { installed: [hook.id] };
    },
    disable: async () => undefined,
  });
  const skills = defineConnectionHost({
    kind: 'skill',
    check: async () => ({ ok: true }),
    describe: async () => ({
      kind: 'skill',
      title: 'a',
      lines: [{ label: 'Skill', value: 'a' }],
      files: ['source/skills/a/SKILL.md'],
    }),
    enable: async () => {
      enabled.push('skill:a');
      return { installed: ['a'] };
    },
    disable: async () => undefined,
  });
  const store = createJsonConnectionStateStore(path.join(dir, '..', `${path.basename(dir)}-state.json`));
  await store.initialize();
  const registry = createConnectionRegistry({
    store,
    hosts: [hooks, skills],
    loadPackage: async (id) =>
      id === PACKAGE_ID
        ? { packageId: PACKAGE_ID, packageVersion: '1.0.0', packageDirectory: dir, adapter }
        : undefined,
    listInstalledPackageIds: async () => [PACKAGE_ID],
  });
  await registry.syncPackage(PACKAGE_ID);

  const handlers = new Map<string, Handler>();
  const removed: string[] = [];
  const confirmEnable = vi.fn(async () => options.confirm ?? true);
  const audit = vi.fn(async () => undefined);
  const rulesStub = {
    list: vi.fn(async () => [
      { packageId: PACKAGE_ID, connectionId: 'rules:team', title: 'Team rules', format: 'md', workspaces: ['C:/work'] },
    ]),
    attach: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
  };
  const servicesStub = {
    list: vi.fn(() => []),
    start: vi.fn(async () => ({})),
    stop: vi.fn(async () => undefined),
  };
  const packageConfirm = vi.fn(async () => ({ approved: options.confirm ?? true, autoStart: false }));
  const dispose = registerPackageConnectionsBridge({
    ipcMain: {
      handle: (channel: string, handler: unknown) => {
        handlers.set(channel, handler as Handler);
      },
      removeHandler: (channel: string) => {
        removed.push(channel);
      },
    },
    verifySender: (event) => (event as unknown as { sender: string }).sender === 'main',
    registry,
    confirmEnable,
    audit,
    rules: rulesStub as never,
    services: servicesStub as never,
    setPackageEnabled: (_event, packageId, turnOn) =>
      setPackageEnabled({ registry, confirm: packageConfirm }, packageId, turnOn),
  });
  const call = (channel: keyof typeof PACKAGE_CONNECTIONS_CHANNELS, raw: unknown, event: unknown = GOOD) => {
    const handler = handlers.get(PACKAGE_CONNECTIONS_CHANNELS[channel]);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, raw);
  };
  return {
    call,
    handlers,
    removed,
    dispose,
    enabled,
    confirmEnable,
    audit,
    registry,
    rulesStub,
    servicesStub,
    packageConfirm,
  };
};

const HOOK_KEY = 'hook:h';

describe('package connections IPC', () => {
  it('sets the start-again choice of a code-running connection, and refuses data kinds, unknown keys and bad payloads', async () => {
    const t = await setup();
    expect(
      await t.call('setAutoStart', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY, autoStart: true })
    ).toMatchObject({ ok: true, data: { key: HOOK_KEY, enabled: false, autoStart: true } });
    expect(
      await t.call('setAutoStart', { packageId: PACKAGE_ID, connectionKey: 'skill:source/skills/a', autoStart: true })
    ).toEqual({ ok: false, error: 'UNSUPPORTED' });
    expect(
      await t.call('setAutoStart', { packageId: PACKAGE_ID, connectionKey: 'hook:nope', autoStart: true })
    ).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(await t.call('setAutoStart', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY, autoStart: 'yes' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(
      await t.call('setAutoStart', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY, autoStart: true, path: '/etc' })
    ).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    expect(t.enabled).toEqual([]);
    expect(t.audit).toHaveBeenCalledWith({
      subjectId: PACKAGE_ID,
      operation: 'connection-auto-start',
      status: 'completed',
    });
  });
  it('turns the whole package on with one confirmation and off again, refusing a bad payload and a foreign sender', async () => {
    const t = await setup();
    const on = await t.call('setPackageEnabled', { packageId: PACKAGE_ID, enabled: true });
    expect(on).toEqual({
      ok: true,
      data: {
        enabled: [
          { key: 'skill:source/skills/a', kind: 'skill', autoStart: false },
          { key: HOOK_KEY, kind: 'hook', autoStart: false },
        ],
        stayedOff: [],
      },
    });
    expect(t.packageConfirm).toHaveBeenCalledTimes(1);
    expect(t.enabled).toEqual(['skill:a', 'h']);

    const off = await t.call('setPackageEnabled', { packageId: PACKAGE_ID, enabled: false });
    expect(off).toMatchObject({ ok: true, data: { enabled: [] } });
    const stayed = (off as { data: { stayedOff: { key: string }[] } }).data.stayedOff.map((item) => item.key);
    expect(stayed.toSorted()).toEqual([HOOK_KEY, 'skill:source/skills/a'].toSorted());
    expect(t.audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'package-enable', status: 'completed' }));
    expect(t.audit).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'package-disable', status: 'completed' })
    );

    expect(await t.call('setPackageEnabled', { packageId: PACKAGE_ID, enabled: 'yes' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    const withHash = { packageId: PACKAGE_ID, enabled: true, approvalHash: `sha256-${'a'.repeat(64)}` };
    expect(await t.call('setPackageEnabled', withHash)).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    expect(await t.call('setPackageEnabled', { packageId: PACKAGE_ID, enabled: true }, BAD)).toEqual({
      ok: false,
      error: 'DENIED',
    });
  });

  it('registers every channel and removes them on dispose', async () => {
    const t = await setup();
    expect([...t.handlers.keys()].toSorted()).toEqual(Object.values(PACKAGE_CONNECTIONS_CHANNELS).toSorted());
    t.dispose();
    expect(t.removed.toSorted()).toEqual(Object.values(PACKAGE_CONNECTIONS_CHANNELS).toSorted());
    expect((await t.call('list', { packageId: PACKAGE_ID })).error).toBe('DENIED');
  });

  it('rejects a sender that is not the main frame on every channel', async () => {
    const t = await setup();
    for (const channel of Object.keys(PACKAGE_CONNECTIONS_CHANNELS) as (keyof typeof PACKAGE_CONNECTIONS_CHANNELS)[]) {
      const result = await t.call(
        channel,
        { packageId: PACKAGE_ID, connectionKey: HOOK_KEY, approvalHash: `sha256-${'0'.repeat(64)}` },
        BAD
      );
      expect(result).toEqual({ ok: false, error: 'DENIED' });
    }
    expect(t.enabled).toEqual([]);
    expect(t.confirmEnable).not.toHaveBeenCalled();
  });

  it('lists display data only: no command, path, hash or secret', async () => {
    const t = await setup();
    const result = await t.call('list', { packageId: PACKAGE_ID });
    expect(result.ok).toBe(true);
    const views = result.data as Record<string, unknown>[];
    expect(views.map((view) => view.key).toSorted()).toEqual([HOOK_KEY, 'skill:source/skills/a']);
    expect(views.find((view) => view.key === HOOK_KEY)).toMatchObject({
      kind: 'hook',
      runsCode: true,
      enabled: false,
      status: 'off',
    });
    expect(views.find((view) => view.kind === 'skill')).toMatchObject({ runsCode: false });
    const text = JSON.stringify(views);
    expect(text).not.toContain('run.js');
    expect(text).not.toContain('approvalHash');
  });

  it('refuses a request that carries a path or any unknown field', async () => {
    const t = await setup();
    const hash = `sha256-${'a'.repeat(64)}`;
    const attempts: [keyof typeof PACKAGE_CONNECTIONS_CHANNELS, unknown][] = [
      ['list', { packageId: PACKAGE_ID, path: 'C:/Users/x/pkg' }],
      ['list', { packageId: PACKAGE_ID, packageDirectory: '/tmp/x' }],
      ['describe', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY, sourceDirectory: 'C:/x' }],
      ['enable', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY, approvalHash: hash, artifactPath: 'C:/x.tomny' }],
      ['disable', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY, path: '../x' }],
      ['list', { packageId: '../../etc' }],
      ['list', { packageId: 'C:\\evil' }],
      ['describe', { packageId: PACKAGE_ID, connectionKey: 'hook:\u0000x' }],
      ['list', 'com.community.sample'],
      ['list', null],
    ];
    for (const [channel, raw] of attempts) {
      expect(await t.call(channel, raw)).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    }
    expect(t.enabled).toEqual([]);
  });

  it('reports unknown packages and connections with stable codes', async () => {
    const t = await setup();
    expect(await t.call('list', { packageId: 'com.community.missing' })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await t.call('describe', { packageId: PACKAGE_ID, connectionKey: 'hook:nope' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  it('refuses enable with a wrong approvalHash before any dialog or host call', async () => {
    const t = await setup();
    const result = await t.call('enable', {
      packageId: PACKAGE_ID,
      connectionKey: HOOK_KEY,
      approvalHash: `sha256-${'f'.repeat(64)}`,
    });
    expect(result).toEqual({ ok: false, error: 'APPROVAL_REQUIRED' });
    expect(t.confirmEnable).not.toHaveBeenCalled();
    expect(t.enabled).toEqual([]);
    // A malformed hash never gets that far.
    expect(
      await t.call('enable', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY, approvalHash: 'not-a-hash' })
    ).toEqual({ ok: false, error: 'INVALID_REQUEST' });
  });

  it('describes, asks for a native confirmation, then turns a code-running connection on; disable turns it off', async () => {
    const t = await setup();
    const described = await t.call('describe', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY });
    expect(described.ok).toBe(true);
    const approval = described.data as { approvalHash: string; lines: { label: string; value: string }[] };
    expect(approval.approvalHash).toMatch(/^sha256-[a-f0-9]{64}$/u);
    expect(approval.lines[0]?.value).toContain('source/hooks/run.js');

    const enabled = await t.call('enable', {
      packageId: PACKAGE_ID,
      connectionKey: HOOK_KEY,
      approvalHash: approval.approvalHash,
    });
    expect(enabled).toMatchObject({ ok: true, data: { key: HOOK_KEY, enabled: true, status: 'on' } });
    expect(t.confirmEnable).toHaveBeenCalledTimes(1);
    expect(t.confirmEnable).toHaveBeenCalledWith(
      GOOD,
      expect.objectContaining({ packageId: PACKAGE_ID, subject: expect.objectContaining({ kind: 'hook' }) })
    );
    expect(t.enabled).toEqual(['h']);
    expect((await t.call('list', { packageId: PACKAGE_ID })).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: HOOK_KEY, enabled: true })])
    );

    const disabled = await t.call('disable', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY });
    expect(disabled).toMatchObject({ ok: true, data: { key: HOOK_KEY, enabled: false, status: 'off' } });
    expect(t.audit).toHaveBeenCalledWith({
      subjectId: PACKAGE_ID,
      operation: 'connection-enable',
      status: 'completed',
    });
    // Receipts never carry a hash, a command or a path.
    expect(JSON.stringify(t.audit.mock.calls)).not.toMatch(/sha256|run\.js/u);
  });

  it('does not turn a code-running connection on when the person cancels the native dialog', async () => {
    const t = await setup({ confirm: false });
    const { data } = await t.call('describe', { packageId: PACKAGE_ID, connectionKey: HOOK_KEY });
    const result = await t.call('enable', {
      packageId: PACKAGE_ID,
      connectionKey: HOOK_KEY,
      approvalHash: (data as { approvalHash: string }).approvalHash,
    });
    expect(result).toEqual({ ok: false, error: 'CANCELLED' });
    expect(t.enabled).toEqual([]);
  });

  it('turns a data connection on without a native dialog, but still needs the right hash', async () => {
    const t = await setup();
    const key = 'skill:source/skills/a';
    const { data } = await t.call('describe', { packageId: PACKAGE_ID, connectionKey: key });
    const result = await t.call('enable', {
      packageId: PACKAGE_ID,
      connectionKey: key,
      approvalHash: (data as { approvalHash: string }).approvalHash,
    });
    expect(result).toMatchObject({ ok: true, data: { enabled: true } });
    expect(t.confirmEnable).not.toHaveBeenCalled();
    expect(
      await t.call('enable', { packageId: PACKAGE_ID, connectionKey: key, approvalHash: `sha256-${'1'.repeat(64)}` })
    ).toEqual({ ok: false, error: 'APPROVAL_REQUIRED' });
  });

  it('lists and attaches rules through the registry-checked service, refusing extra fields and control characters', async () => {
    const t = await setup();
    const listed = await t.call('rulesList', {});
    expect(listed).toEqual({
      ok: true,
      data: [
        {
          packageId: PACKAGE_ID,
          connectionId: 'rules:team',
          title: 'Team rules',
          format: 'md',
          workspaces: ['C:/work'],
        },
      ],
    });
    const attach = { packageId: PACKAGE_ID, connectionId: 'rules:team', workspace: 'C:/work' };
    expect(await t.call('rulesAttach', attach)).toEqual({ ok: true, data: null });
    expect(t.rulesStub.attach).toHaveBeenCalledWith(attach);
    expect(await t.call('rulesAttach', { ...attach, path: 'C:/elsewhere' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await t.call('rulesDetach', { ...attach, workspace: 'C:/a\u0000b' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(t.rulesStub.attach).toHaveBeenCalledTimes(1);
  });

  it('maps rules errors by their stable code and never passes raw messages through', async () => {
    const t = await setup();
    t.rulesStub.attach.mockRejectedValueOnce(
      Object.assign(new Error('C:/secret'), { name: 'RulesError', code: 'NOT_ENABLED' })
    );
    expect(
      await t.call('rulesAttach', { packageId: PACKAGE_ID, connectionId: 'rules:team', workspace: 'C:/work' })
    ).toEqual({ ok: false, error: 'NOT_ENABLED' });
  });

  it('starts and stops services with an audit receipt, and maps a failed start to SERVICE_FAILED', async () => {
    const t = await setup();
    const ref = { packageId: PACKAGE_ID, connectionId: 'service:db' };
    expect(await t.call('servicesStart', ref)).toEqual({ ok: true, data: [] });
    expect(t.servicesStub.start).toHaveBeenCalledWith(ref);
    expect(t.audit).toHaveBeenLastCalledWith({
      subjectId: PACKAGE_ID,
      operation: 'service-start',
      status: 'completed',
    });
    t.servicesStub.start.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { name: 'PackageServiceError', code: 'X' })
    );
    expect(await t.call('servicesStart', ref)).toEqual({ ok: false, error: 'SERVICE_FAILED' });
    expect(t.audit).toHaveBeenLastCalledWith({ subjectId: PACKAGE_ID, operation: 'service-start', status: 'failed' });
    expect(await t.call('servicesStop', ref)).toEqual({ ok: true, data: [] });
    expect(await t.call('servicesStop', { ...ref, extra: 1 })).toEqual({ ok: false, error: 'INVALID_REQUEST' });
  });
});
