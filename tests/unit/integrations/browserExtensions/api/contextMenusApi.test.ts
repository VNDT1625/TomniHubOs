/* oxlint-disable no-await-in-loop -- each call is awaited in order so the next one sees its effect */

import { describe, expect, it } from 'vitest';
import { ID_A, ID_B, call, manifestOf, pageOf, shimWith, workerOf } from './shimFixture';
import { eventsOf, fakeMenus, makeTab, pageRequest } from './portsFixture';

const withMenus = manifestOf({ permissions: ['contextMenus'] });

const setup = () => {
  const menus = fakeMenus([makeTab(7, 'https://a.example.com/page')]);
  const shim = shimWith(
    { [ID_A]: withMenus, [ID_B]: withMenus, cccccccccccccccccccccccccccccccc: manifestOf() },
    {
      ports: { contextMenus: menus.port },
    }
  );
  return { shim, menus, events: eventsOf(shim) };
};

const titles = (menus: ReturnType<typeof setup>['menus'], request = pageRequest()) =>
  menus
    .host()
    .sectionsFor(request)
    .map((section) => [section.extensionId, section.items.map((item) => item.title)]);

describe('chrome.contextMenus', () => {
  it('needs the contextMenus permission', async () => {
    const { shim } = setup();
    const noMenus = 'cccccccccccccccccccccccccccccccc';
    expect(await call(shim, workerOf(noMenus), 'contextMenus.create', { title: 'x' })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    expect(await call(shim, workerOf(noMenus), 'contextMenus.removeAll')).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('creates items for the calling extension only, whichever way the id is spelled', async () => {
    const { shim, menus } = setup();
    expect(await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'one', title: 'Alpha' })).toEqual({
      ok: true,
      value: 'one',
    });
    expect(await call(shim, pageOf(ID_B), 'contextMenus.create', { id: 'one', title: 'Beta' })).toEqual({
      ok: true,
      value: 'one',
    });
    expect(titles(menus)).toEqual([
      [ID_A, ['Alpha']],
      [ID_B, ['Beta']],
    ]);
    expect(await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'one', title: 'Again' })).toMatchObject({
      ok: false,
      code: 'REJECTED',
    });
  });

  it('cannot update or remove the items of another extension', async () => {
    const { shim, menus } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'mine', title: 'Alpha' });
    expect(await call(shim, workerOf(ID_B), 'contextMenus.update', 'mine', { title: 'Hacked' })).toMatchObject({
      ok: false,
      code: 'REJECTED',
    });
    expect(await call(shim, workerOf(ID_B), 'contextMenus.remove', 'mine')).toMatchObject({ code: 'REJECTED' });
    await call(shim, workerOf(ID_B), 'contextMenus.removeAll');
    expect(titles(menus)).toEqual([[ID_A, ['Alpha']]]);
  });

  it('refuses unknown properties such as onclick, and a missing title', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'contextMenus.create', { title: 'x', onclick: 'f' })).toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    expect(
      await call(shim, workerOf(ID_A), 'contextMenus.create', { contexts: ['launcher'], title: 'x' })
    ).toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    expect(await call(shim, workerOf(ID_A), 'contextMenus.create', { type: 'normal' })).toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    expect(await call(shim, workerOf(ID_A), 'contextMenus.create', { type: 'separator' })).toMatchObject({ ok: true });
    expect(
      await call(shim, workerOf(ID_A), 'contextMenus.create', { title: 'x', documentUrlPatterns: ['junk'] })
    ).toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
  });

  it('shows an item only where its contexts, document patterns and target patterns match', async () => {
    const { shim, menus } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'p', title: 'Page' });
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'l', title: 'Link', contexts: ['link'] });
    await call(shim, workerOf(ID_A), 'contextMenus.create', {
      id: 'o',
      title: 'Only other',
      contexts: ['all'],
      documentUrlPatterns: ['https://other.test/*'],
    });
    await call(shim, workerOf(ID_A), 'contextMenus.create', {
      id: 't',
      title: 'Target',
      contexts: ['link'],
      targetUrlPatterns: ['https://t.test/*'],
    });
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'h', title: 'Hidden', visible: false });
    expect(titles(menus)).toEqual([[ID_A, ['Page']]]);
    expect(titles(menus, pageRequest({ contexts: ['link'], linkUrl: 'https://x.test/' }))).toEqual([[ID_A, ['Link']]]);
    expect(titles(menus, pageRequest({ contexts: ['link'], linkUrl: 'https://t.test/a' }))).toEqual([
      [ID_A, ['Link', 'Target']],
    ]);
  });

  it('nests children under their parent, removes them with it, and replaces %s with the selection', async () => {
    const { shim, menus } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', {
      id: 'root',
      title: 'Search "%s"',
      contexts: ['selection'],
    });
    await call(shim, workerOf(ID_A), 'contextMenus.create', {
      id: 'kid',
      parentId: 'root',
      title: 'Kid',
      contexts: ['selection'],
    });
    expect(await call(shim, workerOf(ID_A), 'contextMenus.create', { parentId: 'nope', title: 'x' })).toMatchObject({
      code: 'REJECTED',
    });
    const request = pageRequest({ contexts: ['selection'], selectionText: 'cats' });
    const [section] = menus.host().sectionsFor(request);
    expect(section?.items[0]).toMatchObject({ title: 'Search "cats"', children: [{ title: 'Kid' }] });
    await call(shim, workerOf(ID_A), 'contextMenus.remove', 'root');
    expect(menus.host().sectionsFor(request)).toEqual([]);
  });

  it('refuses a parent cycle', async () => {
    const { shim } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'a', title: 'A' });
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'b', parentId: 'a', title: 'B' });
    expect(await call(shim, workerOf(ID_A), 'contextMenus.update', 'a', { parentId: 'b' })).toMatchObject({
      code: 'REJECTED',
    });
    expect(await call(shim, workerOf(ID_A), 'contextMenus.update', 'a', { parentId: 'a' })).toMatchObject({
      code: 'REJECTED',
    });
  });

  it('bounds the number of items per extension, not across extensions', async () => {
    const { shim } = setup();
    for (let index = 0; index < 100; index += 1) {
      await call(shim, workerOf(ID_A), 'contextMenus.create', { id: `i${index}`, title: 'x' });
    }
    expect(await call(shim, workerOf(ID_A), 'contextMenus.create', { title: 'x' })).toMatchObject({ code: 'REJECTED' });
    expect(await call(shim, workerOf(ID_B), 'contextMenus.create', { title: 'x' })).toMatchObject({ ok: true });
  });

  it('sends onClicked to the extension that owns the item, with the tab, and toggles a checkbox', async () => {
    const { shim, menus, events } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'box', title: 'Box', type: 'checkbox' });
    await call(shim, workerOf(ID_B), 'contextMenus.create', { id: 'box', title: 'Box', type: 'checkbox' });
    menus.host().select(ID_A, 'box', pageRequest({ linkUrl: 'https://x.test/' }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ extensionId: ID_A, name: 'contextMenus.onClicked' });
    expect(events[0]?.args).toMatchObject([
      {
        menuItemId: 'box',
        pageUrl: 'https://a.example.com/page',
        linkUrl: 'https://x.test/',
        checked: true,
        wasChecked: false,
      },
      { id: 7, url: 'https://a.example.com/page' },
    ]);
    menus.host().select(ID_A, 'box', pageRequest());
    expect(events[1]?.args?.[0]).toMatchObject({ checked: false, wasChecked: true });
    // B's checkbox was never touched.
    expect(
      menus
        .host()
        .sectionsFor(pageRequest())
        .find((section) => section.extensionId === ID_B)?.items[0]?.checked
    ).toBe(false);
  });

  it('keeps one radio on in a run, ignores disabled items, separators and unknown ids', async () => {
    const { shim, menus, events } = setup();
    for (const id of ['r1', 'r2']) {
      await call(shim, workerOf(ID_A), 'contextMenus.create', { id, title: id, type: 'radio', checked: id === 'r1' });
    }
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'off', title: 'Off', enabled: false });
    await call(shim, workerOf(ID_A), 'contextMenus.create', { id: 'sep', type: 'separator' });
    menus.host().select(ID_A, 'r2', pageRequest());
    const radios = menus
      .host()
      .sectionsFor(pageRequest())[0]
      ?.items.filter((item) => item.type === 'radio');
    expect(radios?.map((item) => item.checked)).toEqual([false, true]);
    for (const id of ['off', 'sep', 'missing']) menus.host().select(ID_A, id, pageRequest());
    menus.host().select(ID_B, 'r1', pageRequest());
    expect(events).toHaveLength(1);
  });

  it('shows nothing for an extension that was unloaded, and stops asking after dispose', async () => {
    const { shim, menus } = setup();
    await call(shim, workerOf(ID_A), 'contextMenus.create', { title: 'x' });
    shim.port.detach(ID_A);
    expect(menus.host().sectionsFor(pageRequest())).toEqual([]);
    shim.dispose();
    expect(() => menus.host()).not.toThrow();
    expect(menus.registered()).toBe(1);
  });

  it('answers UNSUPPORTED without the Browser', async () => {
    const shim = shimWith({ [ID_A]: withMenus });
    expect(await call(shim, workerOf(ID_A), 'contextMenus.create', { title: 'x' })).toMatchObject({
      code: 'UNSUPPORTED',
    });
  });
});
