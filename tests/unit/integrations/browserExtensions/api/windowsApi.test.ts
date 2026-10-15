/* oxlint-disable no-await-in-loop -- each call is awaited in order so the next one sees its effect */

import { describe, expect, it } from 'vitest';
import type { WindowsPort } from '@process/integrations/browserExtensions/api/groups/browser/windows';
import { ID_A, ID_B, call, manifestOf, shimWith, workerOf } from './shimFixture';
import { eventsOf, fakeTabs, makeTab } from './portsFixture';

const ID_C = 'cccccccccccccccccccccccccccccccc';

/** A window double: focus can be reported, and the calls the API makes are recorded. */
const fakeWindow = () => {
  let focused = true;
  const listeners = new Set<(value: boolean) => void>();
  const calls: string[] = [];
  const port: WindowsPort = {
    isFocused: () => focused,
    bounds: () => ({ left: 10, top: 20, width: 1200, height: 800 }),
    focus: () => {
      calls.push('focus');
      focused = true;
    },
    subscribeFocus: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    port,
    calls,
    report: (value: boolean) => {
      focused = value;
      for (const listener of Array.from(listeners)) listener(value);
    },
  };
};

const setup = () => {
  const tabs = fakeTabs([makeTab(1, 'https://a.example.com/', { active: true }), makeTab(2, 'https://bank.test/')]);
  const browserWindow = fakeWindow();
  const shim = shimWith(
    {
      // A sees only the example.com tab. B holds `tabs`, so it sees both.
      [ID_A]: manifestOf(),
      [ID_B]: manifestOf({ permissions: ['tabs'] }),
    },
    { ports: { windows: browserWindow.port, tabs: tabs.port } }
  );
  return { shim, tabs, browserWindow, events: eventsOf(shim) };
};

const windowShape = {
  id: 1,
  focused: true,
  incognito: false,
  alwaysOnTop: false,
  state: 'normal',
  type: 'normal',
  left: 10,
  top: 20,
  width: 1200,
  height: 800,
};

describe('chrome.windows describes the one Browser window', () => {
  it('answers every getter for every extension, without a permission', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'windows.getCurrent')).toEqual({ ok: true, value: windowShape });
    expect(await call(shim, workerOf(ID_B), 'windows.getLastFocused', {})).toEqual({ ok: true, value: windowShape });
    expect(await call(shim, workerOf(ID_A), 'windows.getAll')).toEqual({ ok: true, value: [windowShape] });
    expect(await call(shim, workerOf(ID_A), 'windows.get', -2)).toEqual({ ok: true, value: windowShape });
  });

  it('lists only the tabs an extension may see when asked to populate', async () => {
    const { shim } = setup();
    const forA = (await call(shim, workerOf(ID_A), 'windows.getCurrent', { populate: true })) as {
      value: { tabs: { url: string }[] };
    };
    expect(forA.value.tabs.map((tab) => tab.url)).toEqual(['https://a.example.com/']);
    const forB = (await call(shim, workerOf(ID_B), 'windows.getCurrent', { populate: true })) as {
      value: { tabs: unknown[] };
    };
    expect(forB.value.tabs).toHaveLength(2);
  });

  it('answers only for window ids 1 and -2, and filters by window type', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'windows.get', 7)).toMatchObject({
      ok: false,
      code: 'REJECTED',
      message: 'No window with id: 7.',
    });
    expect(await call(shim, workerOf(ID_A), 'windows.getAll', { windowTypes: ['popup'] })).toEqual({
      ok: true,
      value: [],
    });
    expect(await call(shim, workerOf(ID_A), 'windows.getAll', { windowTypes: ['normal'] })).toMatchObject({
      ok: true,
      value: [{ id: 1 }],
    });
  });

  it('opens tabs for web addresses only, and refuses the options that would change the window', async () => {
    const { shim, tabs } = setup();
    expect(await call(shim, workerOf(ID_A), 'windows.create', { url: 'https://c.example.com/' })).toMatchObject({
      ok: true,
      value: { id: 1 },
    });
    expect(tabs.calls).toContain('create:https://c.example.com/:true');
    expect(await call(shim, workerOf(ID_A), 'windows.create', { url: 'javascript:alert(1)' })).toMatchObject({
      ok: false,
      code: 'REJECTED',
    });
    expect(await call(shim, workerOf(ID_A), 'windows.create', { type: 'popup' })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED',
    });
    expect(await call(shim, workerOf(ID_A), 'windows.create', { incognito: true })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED',
    });
    expect(await call(shim, workerOf(ID_A), 'windows.create', { left: 4 })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });

  it('opens several tabs without focus when asked, and limits how fast windows open', async () => {
    const { shim, tabs } = setup();
    await call(shim, workerOf(ID_A), 'windows.create', {
      url: ['https://c.example.com/', 'https://d.example.com/'],
      focused: false,
    });
    expect(tabs.calls).toEqual(
      expect.arrayContaining(['create:https://c.example.com/:false', 'create:https://d.example.com/:false'])
    );
    let last: unknown;
    for (let index = 0; index < 25; index += 1) last = await call(shim, workerOf(ID_B), 'windows.create', {});
    expect(last).toMatchObject({ ok: false, code: 'BUSY' });
  });

  it('focuses the window on update, refuses other changes, and never closes the Browser window', async () => {
    const { shim, browserWindow } = setup();
    expect(await call(shim, workerOf(ID_A), 'windows.update', 1, { focused: true })).toMatchObject({
      ok: true,
      value: { id: 1 },
    });
    expect(browserWindow.calls).toEqual(['focus']);
    expect(await call(shim, workerOf(ID_A), 'windows.update', 1, { left: 5 })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
    expect(await call(shim, workerOf(ID_A), 'windows.remove', 1)).toMatchObject({
      ok: false,
      code: 'REJECTED',
      message: 'The Browser window cannot be closed by an extension.',
    });
  });

  it('reports focus changes to every extension', () => {
    const { browserWindow, events } = setup();
    browserWindow.report(false);
    browserWindow.report(true);
    const focus = events.filter((event) => event.name === 'windows.onFocusChanged');
    expect(focus.map((event) => event.payload)).toEqual([-1, -1, 1, 1]);
    expect(focus.map((event) => event.extensionId).toSorted()).toEqual([ID_A, ID_A, ID_B, ID_B].toSorted());
  });

  it('answers UNSUPPORTED when the window or the tabs are not wired', async () => {
    const shim = shimWith({ [ID_C]: manifestOf() });
    expect(await call(shim, workerOf(ID_C), 'windows.getCurrent')).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(await call(shim, workerOf(ID_C), 'windows.create', {})).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
  });
});
