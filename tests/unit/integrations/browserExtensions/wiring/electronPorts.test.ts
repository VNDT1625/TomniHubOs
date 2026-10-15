import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createExtensionShim } from '@process/integrations/browserExtensions/api/shim';
import { createShimPorts } from '@process/integrations/browserExtensions/wiring/electronPorts';
import { createProfileCookiesPort } from '@process/integrations/browserExtensions/wiring/profileCookiesPort';
import {
  emitBrowserTabLifecycle,
  subscribeBrowserTabLifecycle,
} from '@process/integrations/browserExtensions/wiring/tabLifecycle';
import { ID_A, call, manifestOf, workerOf } from '../api/shimFixture';
import { FakeContents, fakeViewManager } from './wiringFixture';

const fakeJar = () => {
  const emitter = new EventEmitter();
  const jar = {
    cookies: {
      get: vi.fn(async () => [
        {
          name: 'sid',
          value: 'v',
          domain: 'a.example.com',
          hostOnly: true,
          path: '/',
          secure: true,
          sameSite: 'weird',
        },
        { name: 'exp', value: 'v', domain: '.example.com', expirationDate: 99, sameSite: 'strict', httpOnly: true },
      ]),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      on: (event: 'changed', listener: (...args: never[]) => void) =>
        emitter.on(event, listener as (...args: unknown[]) => void),
      removeListener: (event: 'changed', listener: (...args: never[]) => void) =>
        emitter.removeListener(event, listener as (...args: unknown[]) => void),
    },
  };
  return { jar, emitter };
};

describe('profile cookies port', () => {
  it('refuses to be built over the default session', () => {
    const { jar } = fakeJar();
    expect(() => createProfileCookiesPort(jar, jar)).toThrow(/never the default session/);
    expect(() => createProfileCookiesPort(jar, {})).not.toThrow();
  });

  it('maps Electron cookies, with unknown same-site values made unspecified', async () => {
    const { jar } = fakeJar();
    const port = createProfileCookiesPort(jar, {});
    expect(await port.get({ url: 'https://a.example.com/' })).toEqual([
      {
        name: 'sid',
        value: 'v',
        domain: 'a.example.com',
        hostOnly: true,
        path: '/',
        secure: true,
        httpOnly: false,
        session: true,
        sameSite: 'unspecified',
      },
      {
        name: 'exp',
        value: 'v',
        domain: '.example.com',
        hostOnly: false,
        path: '/',
        secure: false,
        httpOnly: true,
        session: false,
        sameSite: 'strict',
        expirationDate: 99,
      },
    ]);
    expect(jar.cookies.get).toHaveBeenCalledWith({ url: 'https://a.example.com/' });
  });

  it('forwards changes and stops on unsubscribe', () => {
    const { jar, emitter } = fakeJar();
    const port = createProfileCookiesPort(jar, {});
    const seen: unknown[] = [];
    const stop = port.subscribe((change) => seen.push(change));
    emitter.emit('changed', {}, { name: 'sid', value: 'v', domain: 'a.example.com' }, 'explicit', true);
    stop();
    emitter.emit('changed', {}, { name: 'sid', value: 'v', domain: 'a.example.com' }, 'explicit', false);
    expect(seen).toMatchObject([{ cause: 'explicit', removed: true, cookie: { name: 'sid' } }]);
    expect(emitter.listenerCount('changed')).toBe(0);
  });
});

describe('tab lifecycle notifications', () => {
  it('reaches every listener, survives one that throws, and stops after unsubscribe', () => {
    const seen: string[] = [];
    const stopBad = subscribeBrowserTabLifecycle(() => {
      throw new Error('bad listener');
    });
    const stop = subscribeBrowserTabLifecycle((event) => seen.push(`${event.type}:${event.id}`));
    emitBrowserTabLifecycle({ type: 'created', id: 'a' });
    stop();
    stopBad();
    emitBrowserTabLifecycle({ type: 'shown', id: 'b' });
    expect(seen).toEqual(['created:a']);
  });
});

describe('createShimPorts', () => {
  it('builds the tabs, context menu and cookie ports, and wires them into a working shim', async () => {
    const view = fakeViewManager();
    const profile = fakeJar().jar;
    view.add('t1', new FakeContents(11, profile, 'https://a.example.com/'));
    const built = createShimPorts({
      profileSession: profile,
      defaultSession: {},
      viewManager: view.manager,
      popup: () => undefined,
      subscribeLifecycle: view.subscribe,
      log: () => undefined,
    });
    expect(Object.keys(built.ports).toSorted()).toEqual([
      'commands',
      'contextMenus',
      'cookies',
      'tabs',
      'webNavigation',
    ]);
    const shim = createExtensionShim({ ports: built.ports, log: () => undefined, audit: () => undefined });
    shim.port.attach({
      extensionId: ID_A,
      packageId: 'p',
      connectionId: 'c',
      manifest: manifestOf({ permissions: ['cookies'], host_permissions: ['https://*.example.com/*'] }),
    });
    expect(await call(shim, workerOf(ID_A), 'tabs.query', {})).toMatchObject({ ok: true, value: [{ id: 11 }] });
    expect(
      await call(shim, workerOf(ID_A), 'cookies.get', { url: 'https://a.example.com/', name: 'sid' })
    ).toMatchObject({
      ok: true,
      value: { name: 'sid' },
    });
    built.dispose();
    expect(view.listenerCount()).toBe(0);
  });

  it('leaves out the cookies port when the profile is the default session, and keeps the others', () => {
    const view = fakeViewManager();
    const shared = fakeJar().jar;
    const log = vi.fn();
    const built = createShimPorts({
      profileSession: shared,
      defaultSession: shared,
      viewManager: view.manager,
      popup: () => undefined,
      subscribeLifecycle: view.subscribe,
      log,
    });
    expect(Object.keys(built.ports).toSorted()).toEqual(['commands', 'contextMenus', 'tabs', 'webNavigation']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cookies port could not be built'), expect.any(Error));
  });

  it('wires the Hub window, notifications, sync storage and downloads when their services are given', () => {
    const view = fakeViewManager();
    const profile = { ...fakeJar().jar, on: () => undefined, removeListener: () => undefined };
    const built = createShimPorts({
      profileSession: profile,
      defaultSession: {},
      viewManager: view.manager,
      popup: () => undefined,
      subscribeLifecycle: view.subscribe,
      getWindow: () => undefined,
      notifications: {
        create: () => ({ on: () => undefined, show: () => undefined, close: () => undefined }),
        supported: () => true,
      },
      syncStorageDirectory: path.join(os.tmpdir(), 'tomny-wiring-sync'),
      log: () => undefined,
    });
    expect(Object.keys(built.ports).toSorted()).toEqual([
      'commands',
      'contextMenus',
      'cookies',
      'downloads',
      'notifications',
      'syncStorage',
      'tabs',
      'webNavigation',
      'windows',
    ]);
    built.dispose();
  });

  it('keeps the other ports when the tabs port cannot be built', async () => {
    const log = vi.fn();
    const jar = fakeJar().jar;
    const built = createShimPorts({
      profileSession: jar,
      defaultSession: {},
      viewManager: {
        ...fakeViewManager().manager,
        listTabs: () => {
          throw new Error('manager gone');
        },
      },
      popup: () => undefined,
      subscribeLifecycle: () => () => undefined,
      log,
    });
    expect(Object.keys(built.ports)).toEqual(['cookies']);
    const shim = createExtensionShim({ ports: built.ports, log: () => undefined, audit: () => undefined });
    shim.port.attach({ extensionId: ID_A, packageId: 'p', connectionId: 'c', manifest: manifestOf() });
    expect(await call(shim, workerOf(ID_A), 'tabs.query', {})).toMatchObject({ code: 'UNSUPPORTED' });
  });
});
