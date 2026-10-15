import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SHIM_CALL_CHANNEL,
  SHIM_EVENT_CHANNEL,
  SHIM_HELLO_CHANNEL,
} from '@process/integrations/browserExtensions/api/contract';
import {
  findPreloadDirectory,
  installElectronShim,
  type ShimFrameEvent,
  type ShimIpcMainPort,
  type ShimSessionPort,
  type ShimWorkerPort,
} from '@process/integrations/browserExtensions/api/electronShim';
import { ID_A, ID_B, manifestOf, shimWith } from './shimFixture';

const PRELOAD_DIR = path.resolve('/app/out/preload');
type WorkerListener = (event: { serviceWorker: { scope: string } }, ...args: unknown[]) => unknown;

class FakeWorker implements ShimWorkerPort {
  readonly handlers = new Map<string, WorkerListener>();
  readonly sent: { channel: string; args: unknown[] }[] = [];
  destroyed = false;
  sendError: Error | undefined;
  readonly ipc = {
    handle: (channel: string, listener: WorkerListener): void => {
      if (this.handlers.has(channel)) throw new Error('Attempted to register a second handler');
      this.handlers.set(channel, listener);
    },
  };

  constructor(readonly scope: string) {}

  send(channel: string, ...args: unknown[]): void {
    if (this.sendError) throw this.sendError;
    this.sent.push({ channel, args });
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

const frameEventOf = (from: unknown, url: string | null): ShimFrameEvent => ({
  sender: { session: from },
  senderFrame: url === null ? null : { url },
});

const world = async (options: { files?: boolean } = {}) => {
  const preloads: { type: string; filePath: string; id: string; handlerWasReady: boolean }[] = [];
  const workers = new Map<number, FakeWorker>();
  let statusListener: ((details: { versionId: number; runningStatus: string }) => void) | undefined;
  const invokeHandlers = new Map<string, (event: ShimFrameEvent, ...args: unknown[]) => unknown>();
  const onHandlers = new Map<string, (event: ShimFrameEvent & { returnValue: unknown }, ...args: unknown[]) => void>();

  const ipcMain: ShimIpcMainPort = {
    handle: (channel, listener) => void invokeHandlers.set(channel, listener),
    removeHandler: (channel) => void invokeHandlers.delete(channel),
    on: (channel, listener) => void onHandlers.set(channel, listener),
    removeListener: (channel) => void onHandlers.delete(channel),
  };
  const session: ShimSessionPort = {
    registerPreloadScript: (script) => {
      preloads.push({
        ...script,
        handlerWasReady: invokeHandlers.has(SHIM_CALL_CHANNEL) && statusListener !== undefined,
      });
      return script.id;
    },
    serviceWorkers: {
      on: (_event, listener) => void (statusListener = listener),
      off: () => void (statusListener = undefined),
      getWorkerFromVersionID: (versionId) => workers.get(versionId),
    },
  };
  const profile = session;
  const shim = shimWith({ [ID_A]: manifestOf({ permissions: ['declarativeNetRequest'] }), [ID_B]: manifestOf() });
  const log = vi.fn();
  const handle = await installElectronShim({
    shim,
    session,
    ipcMain,
    preloadDirectory: PRELOAD_DIR,
    fileExists: async () => options.files !== false,
    log,
  });
  const status = (versionId: number, runningStatus: string) => statusListener?.({ versionId, runningStatus });
  const addWorker = (versionId: number, scope: string) => {
    const worker = new FakeWorker(scope);
    workers.set(versionId, worker);
    return worker;
  };
  const frameEvent = (url: string | null, from: unknown = profile): ShimFrameEvent => frameEventOf(from, url);
  return { shim, handle, preloads, workers, status, addWorker, invokeHandlers, onHandlers, frameEvent, profile, log };
};

const extScope = (id: string) => `chrome-extension://${id}/`;
const envelope = { method: 'permissions.getAll', args: [] };

describe('installElectronShim', () => {
  it('registers the frame and service-worker bundles by absolute path, after the handlers exist', async () => {
    const { preloads } = await world();
    expect(preloads.map(({ type, filePath, id }) => ({ type, filePath, id }))).toEqual([
      { type: 'frame', filePath: path.join(PRELOAD_DIR, 'extensionFrame.js'), id: 'tomny-ext-frame-shim' },
      { type: 'service-worker', filePath: path.join(PRELOAD_DIR, 'extensionWorker.js'), id: 'tomny-ext-worker-shim' },
    ]);
    expect(preloads.every((entry) => path.isAbsolute(entry.filePath) && entry.handlerWasReady)).toBe(true);
  });

  it('refuses a relative preload folder and missing bundles, registering nothing', async () => {
    const shim = shimWith({});
    const ipcMain: ShimIpcMainPort = { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
    const registerPreloadScript = vi.fn();
    const session = {
      registerPreloadScript,
      serviceWorkers: { on: vi.fn(), getWorkerFromVersionID: vi.fn() },
    } as unknown as ShimSessionPort;
    await expect(
      installElectronShim({ shim, session, ipcMain, preloadDirectory: 'out/preload', fileExists: async () => true })
    ).rejects.toThrow(/absolute/);
    await expect(
      installElectronShim({ shim, session, ipcMain, preloadDirectory: PRELOAD_DIR, fileExists: async () => false })
    ).rejects.toThrow(/missing/);
    expect(registerPreloadScript).not.toHaveBeenCalled();
    expect(ipcMain.handle).not.toHaveBeenCalled();
  });

  describe('service workers', () => {
    it('attaches the handler synchronously at starting, for a loaded extension only', async () => {
      const { status, addWorker, handle } = await world();
      const loaded = addWorker(1, extScope(ID_A));
      status(1, 'starting');
      expect(loaded.handlers.has(SHIM_CALL_CHANNEL)).toBe(true);
      expect(handle.attachedVersions()).toEqual([1]);

      const website = addWorker(2, 'https://example.com/');
      status(2, 'starting');
      const unknown = addWorker(3, extScope('c'.repeat(32)));
      status(3, 'starting');
      const badScope = addWorker(4, `${extScope(ID_A)}sub/`);
      status(4, 'starting');
      expect([website, unknown, badScope].some((worker) => worker.handlers.size > 0)).toBe(false);
      expect(handle.attachedVersions()).toEqual([1]);
    });

    it('ignores statuses other than starting and a worker the session does not know', async () => {
      const { status, addWorker, handle } = await world();
      const worker = addWorker(1, extScope(ID_A));
      status(1, 'running');
      status(1, 'stopping');
      status(99, 'starting');
      expect(worker.handlers.size).toBe(0);
      expect(handle.attachedVersions()).toEqual([]);
    });

    it('answers calls with the identity of event.serviceWorker.scope', async () => {
      const { status, addWorker } = await world();
      const worker = addWorker(1, extScope(ID_A));
      status(1, 'starting');
      const handler = worker.handlers.get(SHIM_CALL_CHANNEL);
      expect(await handler?.({ serviceWorker: { scope: extScope(ID_A) } }, envelope)).toEqual({
        ok: true,
        value: { permissions: ['declarativeNetRequest'], origins: ['https://*.example.com/*'] },
      });
      // Even on a worker the shim attached to, a scope that is not an extension's is refused.
      expect(await handler?.({ serviceWorker: { scope: 'https://example.com/' } }, envelope)).toMatchObject({
        ok: false,
        code: 'INVALID_CALLER',
      });
    });

    it('survives the same worker object starting again', async () => {
      const { status, addWorker, handle } = await world();
      addWorker(1, extScope(ID_A));
      status(1, 'starting');
      status(1, 'stopped');
      expect(handle.attachedVersions()).toEqual([]);
      status(1, 'starting');
      expect(handle.attachedVersions()).toEqual([1]);
    });

    it('sends events to the workers of that extension only, and only known event names', async () => {
      const { status, addWorker, shim, log } = await world();
      const a = addWorker(1, extScope(ID_A));
      const b = addWorker(2, extScope(ID_B));
      status(1, 'starting');
      status(2, 'starting');

      shim.events.emit({
        extensionId: ID_A,
        name: 'permissions.onAdded',
        payload: { permissions: ['x'], origins: [] },
      });
      shim.events.emit({ extensionId: ID_A, name: 'bogus.onCreated', payload: {} });
      shim.events.emit({
        extensionId: ID_A,
        name: 'tabs.onUpdated',
        payload: 5,
        args: [5, { status: 'loading' }],
      });
      expect(a.sent.at(-1)).toEqual({
        channel: SHIM_EVENT_CHANNEL,
        args: [{ name: 'tabs.onUpdated', payload: 5, args: [5, { status: 'loading' }] }],
      });
      a.sent.pop();
      expect(a.sent).toEqual([
        {
          channel: SHIM_EVENT_CHANNEL,
          args: [{ name: 'permissions.onAdded', payload: { permissions: ['x'], origins: [] } }],
        },
      ]);
      expect(b.sent).toEqual([]);

      a.destroyed = true;
      shim.events.emit({ extensionId: ID_A, name: 'permissions.onRemoved', payload: {} });
      expect(a.sent).toHaveLength(1);

      a.destroyed = false;
      b.sendError = new Error('port closed');
      shim.events.emit({ extensionId: ID_B, name: 'permissions.onRemoved', payload: {} });
      expect(log).toHaveBeenCalled();
    });
  });

  describe('frames', () => {
    it('answers a call from a page of a loaded extension in the profile session', async () => {
      const { invokeHandlers, frameEvent } = await world();
      const handler = invokeHandlers.get(SHIM_CALL_CHANNEL);
      expect(await handler?.(frameEvent(`chrome-extension://${ID_B}/popup.html`), envelope)).toMatchObject({
        ok: true,
      });
    });

    it('refuses a call from another session, a missing frame and a web page', async () => {
      const { invokeHandlers, frameEvent } = await world();
      const handler = invokeHandlers.get(SHIM_CALL_CHANNEL);
      const popup = `chrome-extension://${ID_B}/popup.html`;
      expect(await handler?.(frameEvent(popup, { name: 'hub window session' }), envelope)).toMatchObject({
        ok: false,
        code: 'INVALID_CALLER',
      });
      expect(await handler?.(frameEvent(null), envelope)).toMatchObject({ ok: false, code: 'INVALID_CALLER' });
      expect(await handler?.(frameEvent('https://example.com/'), envelope)).toMatchObject({
        ok: false,
        code: 'INVALID_CALLER',
      });
      expect(await handler?.(frameEvent(`chrome-extension://${'c'.repeat(32)}/popup.html`), envelope)).toMatchObject({
        ok: false,
        code: 'INVALID_CALLER',
      });
    });

    it('answers the hello message true only for a loaded extension page of the profile session', async () => {
      const { onHandlers, frameEvent } = await world();
      const hello = onHandlers.get(SHIM_HELLO_CHANNEL);
      const ask = (event: ShimFrameEvent) => {
        const withReturn = { ...event, returnValue: 'unset' as unknown };
        hello?.(withReturn);
        return withReturn.returnValue;
      };
      expect(ask(frameEvent(`chrome-extension://${ID_A}/popup.html`))).toBe(true);
      expect(ask(frameEvent('https://example.com/'))).toBe(false);
      expect(ask(frameEvent(null))).toBe(false);
      expect(ask(frameEvent(`chrome-extension://${ID_A}/popup.html`, { name: 'default session' }))).toBe(false);
      expect(ask(frameEvent(`chrome-extension://${'c'.repeat(32)}/popup.html`))).toBe(false);
    });

    it('always sets the hello answer, even when reading the sender throws', async () => {
      const { onHandlers } = await world();
      const hello = onHandlers.get(SHIM_HELLO_CHANNEL);
      const hostile = {
        get sender(): never {
          throw new Error('boom');
        },
        senderFrame: null,
        returnValue: 'unset' as unknown,
      } as unknown as ShimFrameEvent & { returnValue: unknown };
      hello?.(hostile);
      expect(hostile.returnValue).toBe(false);
    });

    it('stops answering an extension that was detached', async () => {
      const { invokeHandlers, frameEvent, shim } = await world();
      shim.port.detach(ID_B);
      const handler = invokeHandlers.get(SHIM_CALL_CHANNEL);
      expect(await handler?.(frameEvent(`chrome-extension://${ID_B}/popup.html`), envelope)).toMatchObject({
        ok: false,
        code: 'INVALID_CALLER',
      });
    });
  });

  it('dispose removes the handlers and the status listener', async () => {
    const { handle, invokeHandlers, onHandlers, status, addWorker } = await world();
    handle.dispose();
    expect(invokeHandlers.size).toBe(0);
    expect(onHandlers.size).toBe(0);
    const worker = addWorker(1, extScope(ID_A));
    status(1, 'starting');
    expect(worker.handlers.size).toBe(0);
  });
});

describe('findPreloadDirectory', () => {
  it('returns the first candidate that has both bundles', async () => {
    const present = new Set([
      path.join('/b', 'extensionFrame.js'),
      path.join('/b', 'extensionWorker.js'),
      path.join('/a', 'extensionFrame.js'),
    ]);
    const found = await findPreloadDirectory(['/a', '/b', '/c'], async (file) => present.has(file));
    expect(found).toBe('/b');
  });

  it('returns undefined when no candidate has both', async () => {
    expect(await findPreloadDirectory(['/a'], async () => false)).toBeUndefined();
  });
});
