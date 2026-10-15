import { describe, expect, it, vi } from 'vitest';
import { createExtensionShim } from '@process/integrations/browserExtensions/api/shim';
import { createBrowserTabsAdapter } from '@process/integrations/browserExtensions/wiring/browserTabsPort';
import {
  createContextMenusPort,
  requestFromParams,
  type MenuTemplateItem,
} from '@process/integrations/browserExtensions/wiring/contextMenusPort';
import { ID_A, ID_B, call, manifestOf, workerOf } from '../api/shimFixture';
import { FakeContents, PROFILE, fakeViewManager } from './wiringFixture';

const MENUS = manifestOf({ permissions: ['contextMenus'] });

const setup = () => {
  const view = fakeViewManager();
  const contents = new FakeContents(11, PROFILE, 'https://a.example.com/');
  view.add('t1', contents);
  const tabs = createBrowserTabsAdapter({
    viewManager: view.manager,
    profileSession: PROFILE,
    subscribeLifecycle: view.subscribe,
    log: () => undefined,
  });
  const popups: MenuTemplateItem[][] = [];
  const log = vi.fn();
  const port = createContextMenusPort({
    watch: tabs.watch,
    popup: (_contents, template) => popups.push(template),
    tab: (id) => tabs.port.list().find((tab) => tab.id === id),
    log,
  });
  const shim = createExtensionShim({
    ports: { tabs: tabs.port, contextMenus: port },
    log: () => undefined,
    audit: () => undefined,
  });
  for (const id of [ID_A, ID_B])
    shim.port.attach({ extensionId: id, packageId: 'p', connectionId: `c-${id[0]}`, manifest: MENUS });
  const events: { extensionId: string; name: string; args?: readonly unknown[] }[] = [];
  shim.events.subscribe((event) => events.push(event));
  const rightClick = (params: Record<string, unknown> = {}) =>
    contents.emit('context-menu', {}, { pageURL: 'https://a.example.com/page', ...params });
  return { shim, contents, popups, events, rightClick, log };
};

describe('requestFromParams', () => {
  it('reads what was clicked from the params, with page as the fallback', () => {
    expect(requestFromParams(5, { pageURL: 'https://a.test/' })).toEqual({
      tabId: 5,
      pageUrl: 'https://a.test/',
      editable: false,
      contexts: ['page'],
    });
    expect(
      requestFromParams(5, {
        pageURL: 'https://a.test/',
        linkURL: 'https://l.test/',
        mediaType: 'image',
        srcURL: 'https://i.test/x.png',
        selectionText: 'hi',
        isEditable: true,
      })
    ).toMatchObject({
      contexts: ['link', 'image', 'selection', 'editable'],
      mediaType: 'image',
      linkUrl: 'https://l.test/',
      srcUrl: 'https://i.test/x.png',
      selectionText: 'hi',
      editable: true,
    });
  });

  it('gives nothing for a click without a page address, and ignores odd values', () => {
    expect(requestFromParams(5, {})).toBeUndefined();
    expect(
      requestFromParams(5, { pageURL: 'https://a.test/', mediaType: 'plugin', linkURL: 3 as never })
    ).toMatchObject({
      contexts: ['page'],
    });
  });
});

describe('context menu port', () => {
  it('shows nothing, and leaves the tab alone, when no extension has an item', () => {
    const { rightClick, popups } = setup();
    rightClick();
    expect(popups).toEqual([]);
  });

  it('shows an extension item and reports the choice to that extension only', async () => {
    const { shim, rightClick, popups, events } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'go', title: 'Go' });
    rightClick();
    expect(popups).toHaveLength(1);
    expect(popups[0]).toMatchObject([{ label: 'Go', type: 'normal', enabled: true }]);
    popups[0]?.[0]?.click?.();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ extensionId: ID_A, name: 'contextMenus.onClicked' });
    expect(events[0]?.args).toMatchObject([{ menuItemId: 'go', pageUrl: 'https://a.example.com/page' }, { id: 11 }]);
  });

  it('groups several items under the extension name and separates extensions', async () => {
    const { shim, rightClick, popups } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'one', title: 'One' });
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'two', title: 'Two' });
    await call(shim, workerOf(ID_B), 'contextMenus.create', { id: 'solo', title: 'Solo' });
    rightClick();
    const [template] = popups;
    expect(template?.map((item) => item.type)).toEqual(['submenu', 'separator', 'normal']);
    expect(template?.[0]?.label).toBe('Fixture');
    expect(template?.[0]?.submenu?.map((item) => item.label)).toEqual(['One', 'Two']);
  });

  it('cleans labels from the manifest and the page selection', async () => {
    const { shim, rightClick, popups } = setup();
    const long = 'x'.repeat(200);
    await call(shim, workerOf(ID_A), 'contextMenus.create', {
      id: 'a',
      title: `Look\u0000 up ‮"%s" ${long}`,
      contexts: ['selection'],
    });
    rightClick({ selectionText: 'cats' });
    const label = popups[0]?.[0]?.label ?? '';
    expect(label.startsWith('Look up "cats"')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(120);
    expect([...label].some((char) => char.charCodeAt(0) < 32 || char === '‮')).toBe(false);
  });

  it('builds checkbox and nested items', async () => {
    const { shim, rightClick, popups } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'root', title: 'Root' });
    await call(shim, workerOf(ID_A), 'contextMenus.create', {
      id: 'box',
      parentId: 'root',
      title: 'Box',
      type: 'checkbox',
      checked: true,
    });
    rightClick();
    expect(popups[0]?.[0]).toMatchObject({
      type: 'submenu',
      label: 'Root',
      submenu: [{ type: 'checkbox', label: 'Box', checked: true }],
    });
  });

  it('logs a failing popup instead of throwing into the page', async () => {
    const view = fakeViewManager();
    const contents = new FakeContents(11, PROFILE, 'https://a.example.com/');
    view.add('t1', contents);
    const tabs = createBrowserTabsAdapter({
      viewManager: view.manager,
      profileSession: PROFILE,
      subscribeLifecycle: view.subscribe,
      log: () => undefined,
    });
    const log = vi.fn();
    const port = createContextMenusPort({
      watch: tabs.watch,
      popup: () => {
        throw new Error('no window');
      },
      tab: () => undefined,
      log,
    });
    const shim = createExtensionShim({ ports: { contextMenus: port }, log: () => undefined, audit: () => undefined });
    shim.port.attach({ extensionId: ID_A, packageId: 'p', connectionId: 'c', manifest: MENUS });
    await call(shim, workerOf(ID_A), 'contextMenus.create', { title: 'x' });
    expect(() => contents.emit('context-menu', {}, { pageURL: 'https://a.example.com/' })).not.toThrow();
    expect(log).toHaveBeenCalled();
  });

  it('stops observing tabs when the shim is disposed', () => {
    const { shim, contents } = setup();
    expect(contents.listenerCount('context-menu')).toBe(1);
    shim.dispose();
    expect(contents.listenerCount('context-menu')).toBe(0);
  });
});
