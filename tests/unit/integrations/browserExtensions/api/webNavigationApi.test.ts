import { describe, expect, it } from 'vitest';
import type {
  NavigationEvent,
  WebNavigationPort,
} from '@process/integrations/browserExtensions/api/groups/browser/webNavigation';
import { ID_A, ID_B, call, manifestOf, shimWith, workerOf } from './shimFixture';
import { eventsOf, fakeTabs, makeTab } from './portsFixture';

const ID_C = 'cccccccccccccccccccccccccccccccc';

const fakeNavigation = () => {
  const listeners = new Set<(event: NavigationEvent) => void>();
  const port: WebNavigationPort = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    port,
    emit: (event: NavigationEvent) => {
      for (const listener of Array.from(listeners)) listener(event);
    },
  };
};

const setup = () => {
  const tabs = fakeTabs([makeTab(1, 'https://a.example.com/page'), makeTab(2, 'https://bank.test/')]);
  const navigation = fakeNavigation();
  const shim = shimWith(
    {
      // A: webNavigation and example.com. B: webNavigation but no host. C: example.com but no webNavigation.
      [ID_A]: manifestOf({ permissions: ['webNavigation'] }),
      [ID_B]: manifestOf({ permissions: ['webNavigation'], host_permissions: [] }),
      [ID_C]: manifestOf(),
    },
    { ports: { tabs: tabs.port, webNavigation: navigation.port } }
  );
  return { shim, navigation, events: eventsOf(shim) };
};

describe('chrome.webNavigation events', () => {
  it('sends the four main-frame phases to an extension with the permission and the host', () => {
    const { navigation, events } = setup();
    const url = 'https://a.example.com/page';
    navigation.emit({ phase: 'before', tabId: 1, url, timeStamp: 1 });
    navigation.emit({ phase: 'committed', tabId: 1, url, timeStamp: 2, transitionType: 'typed' });
    navigation.emit({ phase: 'dom', tabId: 1, url, timeStamp: 3 });
    navigation.emit({ phase: 'completed', tabId: 1, url, timeStamp: 4 });
    const forA = events.filter((event) => event.extensionId === ID_A && event.name.startsWith('webNavigation.'));
    expect(forA.map((event) => event.name)).toEqual([
      'webNavigation.onBeforeNavigate',
      'webNavigation.onCommitted',
      'webNavigation.onDOMContentLoaded',
      'webNavigation.onCompleted',
    ]);
    expect(forA[1]?.payload).toEqual({
      tabId: 1,
      url,
      frameId: 0,
      parentFrameId: -1,
      processId: 0,
      timeStamp: 2,
      transitionType: 'typed',
      transitionQualifiers: [],
    });
  });

  it('never tells an extension about an address it has no host permission for', () => {
    const { navigation, events } = setup();
    navigation.emit({ phase: 'completed', tabId: 2, url: 'https://bank.test/', timeStamp: 1 });
    navigation.emit({ phase: 'before', tabId: 1, url: 'https://a.example.com/page', timeStamp: 2 });
    expect(events.filter((event) => event.extensionId === ID_B)).toEqual([]);
    expect(events.filter((event) => event.extensionId === ID_C)).toEqual([]);
    expect(events.some((event) => event.name === 'webNavigation.onCompleted')).toBe(false);
  });
});

describe('chrome.webNavigation.getFrame and getAllFrames', () => {
  it('describes the main frame of a tab the extension may read, and nothing else', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'webNavigation.getFrame', { tabId: 1, frameId: 0 })).toEqual({
      ok: true,
      value: {
        url: 'https://a.example.com/page',
        frameId: 0,
        parentFrameId: -1,
        errorOccurred: false,
        processId: 0,
      },
    });
    expect(await call(shim, workerOf(ID_A), 'webNavigation.getFrame', { tabId: 1, frameId: 3 })).toEqual({
      ok: true,
      value: null,
    });
    expect(await call(shim, workerOf(ID_A), 'webNavigation.getFrame', { tabId: 2, frameId: 0 })).toEqual({
      ok: true,
      value: null,
    });
    expect(await call(shim, workerOf(ID_A), 'webNavigation.getAllFrames', { tabId: 2 })).toEqual({
      ok: true,
      value: null,
    });
    expect(await call(shim, workerOf(ID_A), 'webNavigation.getAllFrames', { tabId: 1 })).toMatchObject({
      ok: true,
      value: [{ frameId: 0 }],
    });
  });

  it('needs the webNavigation permission, and the tabs to be wired', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_C), 'webNavigation.getFrame', { tabId: 1, frameId: 0 })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    const bare = shimWith({ [ID_A]: manifestOf({ permissions: ['webNavigation'] }) });
    expect(await call(bare, workerOf(ID_A), 'webNavigation.getFrame', { tabId: 1, frameId: 0 })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED',
    });
  });
});
