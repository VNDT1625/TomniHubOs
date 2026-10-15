/* oxlint-disable no-await-in-loop -- each call is awaited in order so the next one sees its effect */

import { describe, expect, it } from 'vitest';
import type { ActionChange } from '@process/integrations/browserExtensions/api/groups/ui/action';
import { ID_A, ID_B, call, manifestOf, pageOf, shimWith, workerOf } from './shimFixture';
import { eventsOf, fakeTabs, makeTab } from './portsFixture';

const setup = () => {
  const tabs = fakeTabs([makeTab(1, 'https://a.example.com/'), makeTab(2, 'https://b.example.com/')]);
  const shim = shimWith(
    { [ID_A]: manifestOf({ name: 'Alpha' }), [ID_B]: manifestOf({ name: 'Beta' }) },
    {
      ports: { tabs: tabs.port },
    }
  );
  const changes: ActionChange[] = [];
  shim.action.subscribe((change) => changes.push(change));
  return { shim, tabs, changes, events: eventsOf(shim) };
};

describe('chrome.action state', () => {
  it('starts from the extension name and no badge', () => {
    const { shim } = setup();
    expect(shim.action.get(ID_A)).toEqual({
      extensionId: ID_A,
      title: 'Alpha',
      popup: '',
      badgeText: '',
      badgeBackgroundColor: [0, 0, 0, 0],
      icon: {},
    });
    expect(shim.action.get('dddddddddddddddddddddddddddddddd')).toBeUndefined();
  });

  it('keeps title, popup and badge per calling extension, from the sender origin', async () => {
    const { shim, changes } = setup();
    expect(await call(shim, workerOf(ID_A), 'action.setTitle', { title: 'Hello' })).toEqual({ ok: true, value: null });
    await call(shim, pageOf(ID_A), 'action.setBadgeText', { text: '12' });
    await call(shim, workerOf(ID_A), 'action.setPopup', { popup: 'ui/popup.html' });
    await call(shim, workerOf(ID_A), 'action.setBadgeBackgroundColor', { color: '#ff8000' });
    expect(shim.action.get(ID_A)).toMatchObject({
      title: 'Hello',
      badgeText: '12',
      popup: `chrome-extension://${ID_A}/ui/popup.html`,
      badgeBackgroundColor: [255, 128, 0, 255],
    });
    expect(shim.action.get(ID_B)).toMatchObject({ title: 'Beta', badgeText: '', popup: '' });
    expect(changes.map((change) => change.type)).toEqual(['state', 'state', 'state', 'state']);
    expect(await call(shim, workerOf(ID_A), 'action.getTitle', {})).toEqual({ ok: true, value: 'Hello' });
    expect(await call(shim, workerOf(ID_B), 'action.getBadgeText', {})).toEqual({ ok: true, value: '' });
    expect(await call(shim, workerOf(ID_A), 'action.getBadgeBackgroundColor', {})).toEqual({
      ok: true,
      value: [255, 128, 0, 255],
    });
    expect(await call(shim, workerOf(ID_A), 'action.getPopup', {})).toEqual({
      ok: true,
      value: `chrome-extension://${ID_A}/ui/popup.html`,
    });
  });

  it('does not accept an extension id or a color it cannot read', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'action.setTitle', { title: 'x', extensionId: ID_B })).toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    for (const color of ['red', '#12', [256, 0, 0], [1, 2], 'rgb(1,2,3)']) {
      expect(
        await call(shim, workerOf(ID_A), 'action.setBadgeBackgroundColor', { color }),
        String(color)
      ).toMatchObject({
        code: 'INVALID_ARGUMENTS',
      });
    }
    expect(await call(shim, workerOf(ID_A), 'action.setBadgeBackgroundColor', { color: [1, 2, 3] })).toMatchObject({
      ok: true,
    });
    expect(shim.action.get(ID_A)?.badgeBackgroundColor).toEqual([1, 2, 3, 255]);
    expect(await call(shim, workerOf(ID_A), 'action.setBadgeBackgroundColor', { color: '#abc8' })).toMatchObject({
      ok: true,
    });
    expect(shim.action.get(ID_A)?.badgeBackgroundColor).toEqual([170, 187, 204, 136]);
  });

  it('keeps a popup inside its own extension', async () => {
    const { shim } = setup();
    for (const popup of [
      'https://evil.test/p.html',
      '//evil.test/p.html',
      '/abs.html',
      '../other/p.html',
      'a/../../p.html',
      'javascript:alert(1)',
      'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/p.html',
      'a\\b.html',
    ]) {
      expect(await call(shim, workerOf(ID_A), 'action.setPopup', { popup }), popup).toMatchObject({
        ok: false,
        code: 'INVALID_ARGUMENTS',
      });
    }
    expect(await call(shim, workerOf(ID_A), 'action.setPopup', { popup: '' })).toMatchObject({ ok: true });
    expect(shim.action.get(ID_A)?.popup).toBe('');
  });

  it('overrides per tab, falls back to the extension value, and forgets a tab that is closed', async () => {
    const { shim, tabs, changes } = setup();
    await call(shim, workerOf(ID_A), 'action.setBadgeText', { text: 'all' });
    await call(shim, workerOf(ID_A), 'action.setBadgeText', { text: 'one', tabId: 1 });
    expect(shim.action.get(ID_A, 1)?.badgeText).toBe('one');
    expect(shim.action.get(ID_A, 2)?.badgeText).toBe('all');
    expect(shim.action.get(ID_B, 1)?.badgeText).toBe('');
    expect(changes.at(-1)).toMatchObject({ type: 'state', tabId: 1 });
    expect(await call(shim, workerOf(ID_A), 'action.getBadgeText', { tabId: 1 })).toEqual({ ok: true, value: 'one' });
    expect(await call(shim, workerOf(ID_A), 'action.setBadgeText', { text: 'x', tabId: 99 })).toMatchObject({
      code: 'REJECTED',
    });
    tabs.emit({ type: 'removed', tabId: 1, windowId: 1 });
    expect(shim.action.get(ID_A, 1)?.badgeText).toBe('all');
  });

  it('asks the toolbar to open the popup, and says so when there is no toolbar', async () => {
    const shim = shimWith({ [ID_A]: manifestOf() });
    expect(await call(shim, workerOf(ID_A), 'action.openPopup')).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    const requests: ActionChange[] = [];
    shim.action.subscribe((change) => requests.push(change));
    expect(await call(shim, workerOf(ID_A), 'action.openPopup', { windowId: 1 })).toEqual({ ok: true, value: null });
    expect(requests).toEqual([{ type: 'open-popup', extensionId: ID_A, windowId: 1 }]);
  });

  it('delivers a click to that extension only, with the tab', () => {
    const { shim, events } = setup();
    shim.action.click(ID_A, 2);
    shim.action.click('dddddddddddddddddddddddddddddddd', 2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ extensionId: ID_A, name: 'action.onClicked' });
    expect(events[0]?.args).toMatchObject([{ id: 2, url: 'https://b.example.com/' }]);
  });

  it('survives a listener that throws', async () => {
    const { shim } = setup();
    shim.action.subscribe(() => {
      throw new Error('toolbar bug');
    });
    expect(await call(shim, workerOf(ID_A), 'action.setTitle', { title: 'x' })).toMatchObject({ ok: true });
  });

  it('works without the Browser tab port', async () => {
    const shim = shimWith({ [ID_A]: manifestOf() });
    expect(await call(shim, workerOf(ID_A), 'action.setBadgeText', { text: '1', tabId: 5 })).toMatchObject({
      ok: true,
    });
    expect(shim.action.get(ID_A, 5)?.badgeText).toBe('1');
  });
});

describe('chrome.action.setIcon', () => {
  it('keeps icon URLs per size, resolved inside the extension, and per tab when asked', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'action.setIcon', { path: 'icons/a.png' })).toEqual({
      ok: true,
      value: null,
    });
    expect(shim.action.get(ID_A)?.icon).toEqual({ default: `chrome-extension://${ID_A}/icons/a.png` });
    await call(shim, workerOf(ID_A), 'action.setIcon', { path: { 16: 'icons/16.png', 32: 'icons/32.png' }, tabId: 1 });
    expect(shim.action.get(ID_A, 1)?.icon).toEqual({
      16: `chrome-extension://${ID_A}/icons/16.png`,
      32: `chrome-extension://${ID_A}/icons/32.png`,
    });
    expect(shim.action.get(ID_A)?.icon).toEqual({ default: `chrome-extension://${ID_A}/icons/a.png` });
  });

  it('refuses paths outside the extension, image data, and a call with no path', async () => {
    const { shim } = setup();
    for (const path of ['../x.png', '/x.png', 'https://evil.test/x.png']) {
      expect(await call(shim, workerOf(ID_A), 'action.setIcon', { path }), path).toMatchObject({
        ok: false,
        code: 'INVALID_ARGUMENTS',
      });
    }
    expect(await call(shim, workerOf(ID_A), 'action.setIcon', { imageData: {} })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED',
    });
    expect(await call(shim, workerOf(ID_A), 'action.setIcon', {})).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });
});
