import { describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_DNR_PLAN_METHOD,
  SHIM_CALL_CHANNEL,
  SHIM_EVENT_CHANNEL,
  SHIM_HELLO_CHANNEL,
  SHIM_NAMESPACES,
} from '@process/integrations/browserExtensions/api/contract';
import { bootFrame } from '@process/integrations/browserExtensions/preload/bootFrame';
import { bootWorker } from '@process/integrations/browserExtensions/preload/bootWorker';
import {
  applyStaticRulesetsInWorld,
  dispatchEventInWorld,
  installShimInWorld,
  readWorkerOriginInWorld,
} from '@process/integrations/browserExtensions/preload/bridge';

describe('bootFrame', () => {
  const setup = (protocol: string, options: { hello?: unknown } = { hello: true }) => {
    const hello = options.hello;
    const sendSync = vi.fn((_channel: string): unknown => hello);
    const invoke = vi.fn(async (): Promise<unknown> => ({ ok: true, value: null }));
    const executeInMainWorld = vi.fn((_script: { func: unknown; args: unknown[] }): unknown => undefined);
    const installed = bootFrame({ protocol, ipcRenderer: { sendSync, invoke }, contextBridge: { executeInMainWorld } });
    return { installed, sendSync, invoke, executeInMainWorld };
  };

  it.each(['https:', 'http:', 'file:', 'about:', 'data:', 'blob:'])(
    'leaves at once on a %s page: no message, no function, no channel',
    (protocol) => {
      const { installed, sendSync, invoke, executeInMainWorld } = setup(protocol);
      expect(installed).toBe(false);
      expect(sendSync).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(executeInMainWorld).not.toHaveBeenCalled();
    }
  );

  it('asks Main once on an extension page and installs the shim only after a yes', () => {
    const { installed, sendSync, executeInMainWorld } = setup('chrome-extension:');
    expect(installed).toBe(true);
    expect(sendSync).toHaveBeenCalledTimes(1);
    expect(sendSync).toHaveBeenCalledWith(SHIM_HELLO_CHANNEL);
    expect(executeInMainWorld).toHaveBeenCalledTimes(1);
    const script = executeInMainWorld.mock.calls[0]?.[0];
    expect(script?.func).toBe(installShimInWorld);
    expect(script?.args[1]).toBe(SHIM_NAMESPACES);
    expect(typeof script?.args[0]).toBe('function');
  });

  it.each([false, 'true', 1, undefined, null])('installs nothing when Main answers %j', (answer) => {
    const { installed, executeInMainWorld } = setup('chrome-extension:', { hello: answer });
    expect(installed).toBe(false);
    expect(executeInMainWorld).not.toHaveBeenCalled();
  });

  it('installs nothing when the synchronous message fails or the main world is unreachable', () => {
    const failing = bootFrame({
      protocol: 'chrome-extension:',
      ipcRenderer: {
        sendSync: () => {
          throw new Error('closed');
        },
        invoke: async () => undefined,
      },
      contextBridge: { executeInMainWorld: vi.fn() },
    });
    expect(failing).toBe(false);
    const unreachable = bootFrame({
      protocol: 'chrome-extension:',
      ipcRenderer: { sendSync: () => true, invoke: async () => undefined },
      contextBridge: {
        executeInMainWorld: () => {
          throw new Error('no main world');
        },
      },
    });
    expect(unreachable).toBe(false);
  });

  it('gives the page a call function that only reaches the shim channel with a method and arguments', async () => {
    const { executeInMainWorld, invoke } = setup('chrome-extension:');
    const call = executeInMainWorld.mock.calls[0]?.[0].args[0] as (method: string, args: unknown[]) => Promise<unknown>;
    await call('permissions.getAll', []);
    expect(invoke).toHaveBeenCalledWith(SHIM_CALL_CHANNEL, { method: 'permissions.getAll', args: [] });
  });
});

describe('bootWorker', () => {
  type Script = { func: unknown; args: unknown[] };
  const setup = (
    options: {
      origin?: unknown;
      plan?: unknown;
      applyResult?: unknown;
      applyThrows?: boolean;
      installThrows?: boolean;
    } = {}
  ) => {
    const listeners: ((event: unknown, message: unknown) => void)[] = [];
    const scripts: Script[] = [];
    const invoke = vi.fn(
      async (_channel: string, _message: unknown): Promise<unknown> =>
        options.plan ?? { ok: true, value: { enableRulesetIds: ['ads'] } }
    );
    const on = vi.fn(
      (_channel: string, listener: (event: unknown, message: unknown) => void) => void listeners.push(listener)
    );
    const executeInMainWorld = vi.fn((script: Script): unknown => {
      scripts.push(script);
      if (script.func === readWorkerOriginInWorld)
        return 'origin' in options ? options.origin : `chrome-extension://${'a'.repeat(32)}`;
      if (script.func === installShimInWorld && options.installThrows) throw new Error('no main world');
      if (script.func === applyStaticRulesetsInWorld) {
        if (options.applyThrows) throw new Error('boom');
        return Promise.resolve(options.applyResult ?? 'enabled');
      }
      return undefined;
    });
    const run = () => bootWorker({ ipcRenderer: { invoke, on }, contextBridge: { executeInMainWorld } });
    return { run, listeners, scripts, invoke, on, executeInMainWorld };
  };

  it.each([['https://example.com'], ['//'], [''], [42], [undefined]])(
    'skips a worker whose origin is %j: nothing installed, no channel, no message',
    async (origin) => {
      const { run, invoke, on, scripts } = setup({ origin });
      expect(await run()).toBe('skipped');
      expect(invoke).not.toHaveBeenCalled();
      expect(on).not.toHaveBeenCalled();
      expect(scripts.map((script) => script.func)).toEqual([readWorkerOriginInWorld]);
    }
  );

  it('installs the shim, asks Main for the plan and enables the rulesets of that plan', async () => {
    const { run, invoke, scripts, on } = setup();
    expect(await run()).toBe('installed+rulesets:enabled');
    expect(scripts.map((script) => script.func)).toEqual([
      readWorkerOriginInWorld,
      installShimInWorld,
      applyStaticRulesetsInWorld,
    ]);
    expect(scripts[1]?.args[1]).toBe(SHIM_NAMESPACES);
    expect(scripts[2]?.args).toEqual([['ads']]);
    expect(invoke).toHaveBeenCalledWith(SHIM_CALL_CHANNEL, { method: INTERNAL_DNR_PLAN_METHOD, args: [] });
    expect(on).toHaveBeenCalledWith(SHIM_EVENT_CHANNEL, expect.any(Function));
  });

  it('passes on exactly the rulesets Main named, not anything else', async () => {
    const { run, scripts } = setup({ plan: { ok: true, value: { enableRulesetIds: ['x', 'y'], other: 'ignored' } } });
    await run();
    expect(scripts.at(-1)?.args).toEqual([['x', 'y']]);
  });

  it('keeps the shim but enables nothing when Main refuses the plan or sends nonsense', async () => {
    const runs = [
      { ok: false, code: 'PERMISSION_DENIED', message: 'no' },
      { ok: true, value: null },
      { ok: true, value: { enableRulesetIds: 'ads' } },
      { ok: true, value: { enableRulesetIds: ['ads', 3] } },
    ].map((plan) => setup({ plan }));
    const outcomes = await Promise.all(runs.map((run) => run.run()));
    expect(outcomes).toEqual(['installed', 'installed', 'installed', 'installed']);
    for (const { scripts } of runs) {
      expect(scripts.map((script) => script.func)).not.toContain(applyStaticRulesetsInWorld);
    }
  });

  it('survives a main world that rejects the enabling step', async () => {
    expect(await setup({ applyThrows: true }).run()).toBe('installed+rulesets:error');
  });

  it('skips when the shim cannot be installed in the worker', async () => {
    const { run, on, invoke } = setup({ installThrows: true });
    expect(await run()).toBe('skipped');
    expect(on).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('forwards only known event names, with their payload, to the main world', async () => {
    const { run, listeners, scripts } = setup();
    await run();
    const listener = listeners[0];
    const before = scripts.length;
    listener?.({}, { name: 'permissions.onAdded', payload: { permissions: ['cookies'], origins: [] } });
    expect(scripts.length).toBe(before + 1);
    expect(scripts.at(-1)).toEqual({
      func: dispatchEventInWorld,
      args: ['permissions.onAdded', { permissions: ['cookies'], origins: [] }],
    });
    for (const message of [
      null,
      'text',
      {},
      { name: 42 },
      { name: 'bogus.onCreated', payload: {} },
      { name: '__proto__' },
    ]) {
      listener?.({}, message);
    }
    expect(scripts.length).toBe(before + 1);
  });
});
