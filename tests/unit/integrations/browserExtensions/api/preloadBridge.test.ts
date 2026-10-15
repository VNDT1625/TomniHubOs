import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { SHIM_CALL_CHANNEL, SHIM_NAMESPACES } from '@process/integrations/browserExtensions/api/contract';
import {
  applyStaticRulesetsInWorld,
  createCall,
  dispatchEventInWorld,
  installShimInWorld,
  readWorkerOriginInWorld,
} from '@process/integrations/browserExtensions/preload/bridge';

type Realm = Record<string | symbol, unknown>;

/**
 * Electron ships `func.toString()` to the page or worker, so each function must work from its source text alone.
 * Rebuilding it inside an empty realm (nothing but the globals a page has) proves it references nothing outside its body.
 */
const makeRealm = (seed: Realm = {}): Realm => vm.createContext({ console, ...seed }) as Realm;
const load = <T>(func: unknown, realm: Realm): T => vm.runInContext(`(${String(func)})`, realm) as T;

type Call = (method: string, args: unknown[]) => Promise<{ ok: boolean; value?: unknown; message?: string }>;
type Listenable = {
  addListener: (listener: unknown) => void;
  removeListener: (listener: unknown) => void;
  hasListener: (listener: unknown) => boolean;
  hasListeners: () => boolean;
};
type PermissionsApi = Record<'contains' | 'getAll' | 'request' | 'remove', (...args: unknown[]) => Promise<unknown>> &
  Record<'onAdded' | 'onRemoved', Listenable>;

const install = (call: Call, seed: Realm = {}) => {
  const global = makeRealm(seed);
  load<(c: Call, n: unknown) => void>(installShimInWorld, global)(call, SHIM_NAMESPACES);
  const chromeObject = global.chrome as Record<string, unknown>;
  return { global, chromeObject, permissions: chromeObject.permissions as PermissionsApi };
};

const existingContains = () => 'native';
const native = () => 'native';
const throwingListener = () => {
  throw new Error('listener bug');
};

describe('installShimInWorld', () => {
  it('creates chrome when it does not exist yet, as in a page at preload time', () => {
    const { global, permissions } = install(async () => ({ ok: true }));
    expect(typeof global.chrome).toBe('object');
    for (const method of ['contains', 'getAll', 'request', 'remove'] as const)
      expect(typeof permissions[method]).toBe('function');
    for (const event of ['onAdded', 'onRemoved'] as const) {
      expect(Object.keys(permissions[event]).toSorted()).toEqual([
        'addListener',
        'hasListener',
        'hasListeners',
        'removeListener',
      ]);
    }
  });

  it('keeps everything chrome already has and only fills the gaps', () => {
    const existingEvent = { addListener: () => 'native-event' };
    const runtime = { id: 'abc' };
    const { chromeObject, permissions } = install(async () => ({ ok: true }), {
      chrome: { runtime, permissions: { contains: existingContains, onAdded: existingEvent } },
    });
    expect(chromeObject.runtime).toBe(runtime);
    expect(permissions.contains).toBe(existingContains);
    expect(permissions.onAdded).toBe(existingEvent);
    expect(typeof permissions.request).toBe('function');
    expect(typeof permissions.onRemoved.addListener).toBe('function');
  });

  it('sends the member name and the arguments, and resolves with the value', async () => {
    const call = vi.fn<Call>(async () => ({ ok: true, value: true }));
    const { permissions } = install(call);
    await expect(permissions.contains({ permissions: ['cookies'] })).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith('permissions.contains', [{ permissions: ['cookies'] }]);
  });

  it('rejects with the message of a failed call', async () => {
    const { permissions } = install(async () => ({ ok: false, message: 'You cannot remove required permissions.' }));
    await expect(permissions.remove({ permissions: ['storage'] })).rejects.toThrow(
      'You cannot remove required permissions.'
    );
  });

  it('rejects when the call itself throws, for example on arguments that cannot be cloned', async () => {
    const { permissions } = install(() => {
      throw new Error('could not be cloned');
    });
    await expect(permissions.contains({})).rejects.toThrow('could not be cloned');
  });

  it('supports the callback style and sets lastError only during the callback of a failure', async () => {
    const runtime: Record<string, unknown> = {};
    const outcomes: unknown[] = [];
    const ok = install(async () => ({ ok: true, value: ['v'] }), { chrome: { runtime } });
    const returned = ok.permissions.getAll((value: unknown) => outcomes.push(['ok', value, runtime.lastError]));
    expect(returned).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const failing = install(async () => ({ ok: false, message: 'nope' }), { chrome: { runtime } });
    failing.permissions.request({ permissions: ['x'] }, (value: unknown) =>
      outcomes.push(['fail', value, (runtime.lastError as { message: string } | undefined)?.message])
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcomes).toEqual([
      ['ok', ['v'], undefined],
      ['fail', undefined, 'nope'],
    ]);
    expect(runtime.lastError).toBeUndefined();
  });

  it('does not send the callback to Main', async () => {
    const call = vi.fn<Call>(async () => ({ ok: true, value: true }));
    const { permissions } = install(call);
    permissions.contains({ permissions: ['a'] }, () => undefined);
    expect(call).toHaveBeenCalledWith('permissions.contains', [{ permissions: ['a'] }]);
  });

  it('delivers dispatched events to listeners, in isolation from listeners that throw', () => {
    const { global, permissions } = install(async () => ({ ok: true }));
    const received: unknown[] = [];
    const second = (payload: unknown) => received.push(payload);
    permissions.onAdded.addListener(throwingListener);
    permissions.onAdded.addListener(second);
    permissions.onAdded.addListener('not a function');
    expect(permissions.onAdded.hasListener(second)).toBe(true);
    expect(permissions.onAdded.hasListeners()).toBe(true);

    const dispatch = load<(name: string, payload: unknown) => void>(dispatchEventInWorld, global);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dispatch('permissions.onAdded', { permissions: ['cookies'] });
    errors.mockRestore();
    expect(received).toEqual([{ permissions: ['cookies'] }]);

    permissions.onAdded.removeListener(second);
    dispatch('permissions.onAdded', { permissions: ['again'] });
    dispatch('permissions.onRemoved', {});
    dispatch('unknown.event', {});
    expect(received).toHaveLength(1);
    expect(permissions.onAdded.hasListener(second)).toBe(false);
  });

  it('is harmless when dispatch runs before anything was installed', () => {
    const fn = load<(name: string, payload: unknown) => void>(dispatchEventInWorld, makeRealm());
    expect(() => fn('permissions.onAdded', {})).not.toThrow();
  });

  it('replaces a member of a namespace only when the spec says so', () => {
    const nativeEvent = { addListener: () => 'native-event' };
    const namespaces = [
      { path: 'tabs', methods: ['get', 'query'], events: ['onUpdated', 'onCreated'], replace: ['get', 'onUpdated'] },
    ];
    const global = makeRealm({
      chrome: { tabs: { get: native, query: native, onUpdated: nativeEvent, onCreated: nativeEvent } },
    });
    load<(c: Call, n: unknown) => void>(installShimInWorld, global)(async () => ({ ok: true }), namespaces);
    const tabs = (global.chrome as Record<string, Record<string, unknown>>).tabs as Record<string, unknown>;
    expect(tabs.get).not.toBe(native);
    expect(tabs.query).toBe(native);
    expect(tabs.onUpdated).not.toBe(nativeEvent);
    expect(tabs.onCreated).toBe(nativeEvent);
  });

  it('calls listeners with every argument of a multi-argument event', () => {
    const world = makeRealm();
    load<(c: Call, n: unknown) => void>(installShimInWorld, world)(
      async () => ({ ok: true }),
      [{ path: 'tabs', methods: [], events: ['onUpdated'] }]
    );
    const received: unknown[][] = [];
    (
      (world.chrome as Record<string, Record<string, Listenable>>).tabs as Record<string, Listenable>
    ).onUpdated?.addListener((...values: unknown[]) => received.push(values));
    const dispatch = load<(name: string, payload: unknown, args?: unknown) => void>(dispatchEventInWorld, world);
    dispatch('tabs.onUpdated', 5, [5, { status: 'complete' }, { id: 5 }]);
    dispatch('tabs.onUpdated', { single: true });
    expect(received).toEqual([[5, { status: 'complete' }, { id: 5 }], [{ single: true }]]);
  });

  it('describes exactly the namespaces the router serves', () => {
    expect(SHIM_NAMESPACES.map((namespace) => namespace.path)).toEqual([
      'permissions',
      'tabs',
      'contextMenus',
      'action',
      'cookies',
      'windows',
      'notifications',
      'webNavigation',
      'downloads',
      'storage.sync',
      'commands',
    ]);
  });

  it('installs a dotted namespace inside the object that exists, replacing only what it lists', async () => {
    const storage = { local: { get: () => 'local' }, sync: { get: () => 'broken', QUOTA_BYTES: 102400 } };
    const global = makeRealm({ chrome: { storage } });
    const call = vi.fn(async (method: string) => ({ ok: true, value: method }));
    load<(c: Call, n: unknown) => void>(installShimInWorld, global)(call, [
      { path: 'storage.sync', methods: ['get'], events: [], replace: ['get'] },
    ]);
    const sync = storage.sync as unknown as { get: (...args: unknown[]) => Promise<unknown>; QUOTA_BYTES: number };
    expect(await sync.get({})).toBe('storage.sync.get');
    expect(call).toHaveBeenCalledWith('storage.sync.get', [{}]);
    expect(sync.QUOTA_BYTES).toBe(102400);
    expect((storage.local.get as () => string)()).toBe('local');
  });
});

describe('readWorkerOriginInWorld', () => {
  it('reports the origin of the worker script', () => {
    const fn = load<() => string>(
      readWorkerOriginInWorld,
      makeRealm({ location: { protocol: 'chrome-extension:', hostname: 'a'.repeat(32) } })
    );
    expect(fn()).toBe(`chrome-extension://${'a'.repeat(32)}`);
  });

  it('reports an empty origin when there is no location', () => {
    expect(load<() => string>(readWorkerOriginInWorld, makeRealm())()).toBe('');
  });
});

describe('applyStaticRulesetsInWorld', () => {
  const quickTimers = {
    setTimeout: (callback: () => void) => {
      void Promise.resolve().then(callback);
      return 0;
    },
  };
  const apply = (realm: Realm) =>
    load<(ids: string[]) => Promise<string>>(applyStaticRulesetsInWorld, makeRealm({ ...quickTimers, ...realm }));

  it('enables the planned rulesets when none is on', async () => {
    const update = vi.fn(async () => undefined);
    const status = await apply({
      chrome: { declarativeNetRequest: { getEnabledRulesets: async () => [], updateEnabledRulesets: update } },
    })(['ads']);
    expect(status).toBe('enabled');
    expect(update).toHaveBeenCalledWith({ enableRulesetIds: ['ads'] });
  });

  it('leaves alone an extension that already has rulesets on', async () => {
    const update = vi.fn(async () => undefined);
    const status = await apply({
      chrome: { declarativeNetRequest: { getEnabledRulesets: async () => ['mine'], updateEnabledRulesets: update } },
    })(['ads']);
    expect(status).toBe('already-enabled');
    expect(update).not.toHaveBeenCalled();
  });

  it('does nothing for an empty plan', async () => {
    const update = vi.fn(async () => undefined);
    const status = await apply({
      chrome: { declarativeNetRequest: { getEnabledRulesets: async () => [], updateEnabledRulesets: update } },
    })([]);
    expect(status).toBe('nothing-to-enable');
    expect(update).not.toHaveBeenCalled();
  });

  it('waits for the API to appear and gives up quietly when it never does', async () => {
    const late: Realm = { chrome: {} };
    let polls = 0;
    const realm: Realm = {
      ...late,
      setTimeout: (callback: () => void) => {
        polls += 1;
        if (polls === 3) {
          (realm.chrome as Record<string, unknown>).declarativeNetRequest = {
            getEnabledRulesets: async () => [],
            updateEnabledRulesets: async () => undefined,
          };
        }
        void Promise.resolve().then(callback);
        return 0;
      },
    };
    expect(await apply(realm)(['ads'])).toBe('enabled');
    expect(await apply({ chrome: {} })(['ads'])).toBe('unavailable');
  });

  it('reports an error status instead of rejecting', async () => {
    const status = await apply({
      chrome: {
        declarativeNetRequest: {
          getEnabledRulesets: async () => [],
          updateEnabledRulesets: async () => {
            throw new Error('too many rules');
          },
        },
      },
    })(['ads']);
    expect(status).toBe('error: too many rules');
  });
});

describe('createCall', () => {
  it('invokes the call channel with only the method and the arguments', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: 1 }));
    const result = await createCall({ invoke })('permissions.getAll', []);
    expect(result).toEqual({ ok: true, value: 1 });
    expect(invoke).toHaveBeenCalledWith(SHIM_CALL_CHANNEL, { method: 'permissions.getAll', args: [] });
  });

  it('turns a failing channel or an odd reply into FAILED', async () => {
    const failing = await createCall({
      invoke: async () => {
        throw new Error('No handler registered');
      },
    })('permissions.getAll', []);
    expect(failing).toMatchObject({ ok: false, code: 'FAILED' });
    expect(await createCall({ invoke: async () => 'junk' })('permissions.getAll', [])).toMatchObject({
      ok: false,
      code: 'FAILED',
    });
    expect(await createCall({ invoke: async () => null })('permissions.getAll', [])).toMatchObject({
      ok: false,
      code: 'FAILED',
    });
  });
});
