/* oxlint-disable no-await-in-loop -- each call is awaited in order so the next one sees its effect */

import { describe, expect, it } from 'vitest';
import { ID_A, ID_B, call, manifestOf, pageOf, shimWith, workerOf } from './shimFixture';
import { eventsOf, fakeTabs, makeTab } from './portsFixture';

// A sees only https://*.example.com; B holds the `tabs` permission; C has no host permission and no `tabs`.
const ID_C = 'cccccccccccccccccccccccccccccccc';

const setup = () => {
  const tabs = fakeTabs([
    makeTab(1, 'https://a.example.com/home', { active: true }),
    makeTab(2, 'https://bank.test/account'),
    makeTab(3, 'https://b.example.com/x'),
  ]);
  const shim = shimWith(
    {
      [ID_A]: manifestOf({ permissions: ['storage'], host_permissions: ['https://*.example.com/*'] }),
      [ID_B]: manifestOf({ permissions: ['tabs'], host_permissions: [] }),
      [ID_C]: manifestOf({ permissions: ['storage'], host_permissions: [] }),
    },
    { ports: { tabs: tabs.port } }
  );
  return { shim, tabs, events: eventsOf(shim) };
};

const idsOf = (result: unknown) => ((result as { value: { id: number }[] }).value ?? []).map((tab) => tab.id);

describe('chrome.tabs identity and visibility', () => {
  it('shows each extension only the tabs its own host permissions cover, from the sender origin', async () => {
    const { shim } = setup();
    expect(idsOf(await call(shim, workerOf(ID_A), 'tabs.query', {}))).toEqual([1, 3]);
    expect(idsOf(await call(shim, pageOf(ID_A), 'tabs.query', {}))).toEqual([1, 3]);
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', {}))).toEqual([1, 2, 3]);
    expect(idsOf(await call(shim, workerOf(ID_C), 'tabs.query', {}))).toEqual([]);
  });

  it('answers a tab it cannot see exactly as a tab that does not exist, for get, update and remove', async () => {
    const { shim, tabs } = setup();
    const hidden = await call(shim, workerOf(ID_A), 'tabs.get', 2);
    const missing = await call(shim, workerOf(ID_A), 'tabs.get', 999);
    expect(hidden).toMatchObject({ ok: false, code: 'REJECTED' });
    expect((hidden as { message: string }).message.replace('2', 'N')).toBe(
      (missing as { message: string }).message.replace('999', 'N')
    );
    expect(await call(shim, workerOf(ID_A), 'tabs.update', 2, { url: 'https://example.com/' })).toMatchObject({
      ok: false,
      code: 'REJECTED',
    });
    expect(await call(shim, workerOf(ID_A), 'tabs.remove', 2)).toMatchObject({ ok: false, code: 'REJECTED' });
    expect(await call(shim, workerOf(ID_C), 'tabs.remove', 1)).toMatchObject({ ok: false, code: 'REJECTED' });
    expect(tabs.calls).toEqual([]);
  });

  it('does not take an extension id or a window from the arguments', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'tabs.query', { extensionId: ID_B })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
    expect(await call(shim, workerOf(ID_A), 'tabs.get', '1')).toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(await call(shim, workerOf(ID_A), 'tabs.get', -1)).toMatchObject({ code: 'INVALID_ARGUMENTS' });
  });

  it('refuses a caller that is not a loaded extension', async () => {
    const { shim } = setup();
    const other = 'dddddddddddddddddddddddddddddddd';
    expect(await call(shim, workerOf(other), 'tabs.query', {})).toMatchObject({ code: 'INVALID_CALLER' });
  });

  it('reports a tab with its address and title only because the tab is visible', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'tabs.get', 1)).toMatchObject({
      ok: true,
      value: {
        id: 1,
        url: 'https://a.example.com/home',
        title: 'Title 1',
        windowId: 1,
        active: true,
        status: 'complete',
      },
    });
  });

  it('lets an extension see a tab that shows its own page', async () => {
    const { shim, tabs } = setup();
    tabs.setTabs([
      makeTab(5, `chrome-extension://${ID_C}/options.html`),
      makeTab(6, `chrome-extension://${ID_A}/o.html`),
    ]);
    expect(idsOf(await call(shim, workerOf(ID_C), 'tabs.query', {}))).toEqual([5]);
  });

  it('uses a host permission the person granted later', async () => {
    const tabs = fakeTabs([makeTab(1, 'https://optional.test/p')]);
    const shim = shimWith({ [ID_A]: manifestOf() }, { ports: { tabs: tabs.port }, prompt: { ask: async () => true } });
    expect(idsOf(await call(shim, workerOf(ID_A), 'tabs.query', {}))).toEqual([]);
    await call(shim, workerOf(ID_A), 'permissions.request', { origins: ['https://optional.test/*'] });
    expect(idsOf(await call(shim, workerOf(ID_A), 'tabs.query', {}))).toEqual([1]);
  });
});

describe('chrome.tabs query', () => {
  it('filters by active, url pattern, title and window', async () => {
    const { shim } = setup();
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', { active: true }))).toEqual([1]);
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', { url: 'https://*.example.com/*' }))).toEqual([1, 3]);
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', { url: ['https://bank.test/*'] }))).toEqual([2]);
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', { title: 'Title *' }))).toEqual([1, 2, 3]);
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', { title: '*3' }))).toEqual([3]);
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', { currentWindow: true, windowId: 1 }))).toEqual([
      1, 2, 3,
    ]);
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', { windowId: 9 }))).toEqual([]);
    expect(idsOf(await call(shim, workerOf(ID_B), 'tabs.query', { pinned: true }))).toEqual([]);
  });

  it('refuses a malformed pattern and an unknown property', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_B), 'tabs.query', { url: 'not a pattern' })).toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    expect(await call(shim, workerOf(ID_B), 'tabs.query', { evil: true })).toMatchObject({ code: 'INVALID_ARGUMENTS' });
  });
});

describe('chrome.tabs create, update, remove', () => {
  it('creates a tab on a web address and hides what the extension cannot see', async () => {
    const { shim, tabs } = setup();
    const seen = await call(shim, workerOf(ID_A), 'tabs.create', { url: 'https://a.example.com/new', active: false });
    expect(seen).toMatchObject({ ok: true, value: { url: 'https://a.example.com/new', active: false } });
    const blind = (await call(shim, workerOf(ID_C), 'tabs.create', { url: 'https://other.test/' })) as {
      value: Record<string, unknown>;
    };
    expect(blind.value.id).toBeTypeOf('number');
    expect('url' in blind.value).toBe(false);
    expect(tabs.calls).toEqual(['create:https://a.example.com/new:false', 'create:https://other.test/:true']);
  });

  it('refuses addresses that are not the web, a blank page or its own page', async () => {
    const { shim, tabs } = setup();
    for (const url of [
      'javascript:alert(1)',
      'file:///C:/secret.txt',
      'data:text/html,hi',
      'chrome://settings',
      'about:srcdoc',
      `chrome-extension://${ID_B}/popup.html`,
      'https://user:pass@a.example.com/',
      'nonsense',
    ]) {
      expect(await call(shim, workerOf(ID_A), 'tabs.create', { url }), url).toMatchObject({
        ok: false,
        code: 'REJECTED',
      });
    }
    expect(
      await call(shim, workerOf(ID_A), 'tabs.create', { url: `chrome-extension://${ID_A}/options.html` })
    ).toMatchObject({
      ok: true,
    });
    expect(await call(shim, workerOf(ID_A), 'tabs.create', { url: 'about:blank' })).toMatchObject({ ok: true });
    expect(tabs.calls).toHaveLength(2);
  });

  it('refuses pinned tabs and other windows', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'tabs.create', { pinned: true })).toMatchObject({ code: 'UNSUPPORTED' });
    expect(await call(shim, workerOf(ID_A), 'tabs.create', { windowId: 5 })).toMatchObject({ code: 'REJECTED' });
    expect(await call(shim, workerOf(ID_A), 'tabs.create', { windowId: -2 })).toMatchObject({ ok: true });
  });

  it('limits how fast one extension opens tabs, and how many tabs exist', async () => {
    const tabs = fakeTabs([]);
    let clock = 0;
    const shim = shimWith({ [ID_A]: manifestOf() }, { ports: { tabs: tabs.port } });
    // The shim fixture uses the real clock; fill the window quickly instead of faking time.
    const results = [];
    for (let index = 0; index < 22; index += 1) {
      results.push(await call(shim, workerOf(ID_A), 'tabs.create', { url: 'about:blank' }));
    }
    clock += 1;
    expect(results.filter((result) => result.ok)).toHaveLength(20);
    expect(results.at(-1)).toMatchObject({ ok: false, code: 'BUSY' });
    // The other extension has its own allowance.
    const second = shimWith({ [ID_A]: manifestOf(), [ID_B]: manifestOf() }, { ports: { tabs: fakeTabs([]).port } });
    expect(await call(second, workerOf(ID_B), 'tabs.create', {})).toMatchObject({ ok: true });
    expect(clock).toBe(1);
  });

  it('updates a visible tab: navigate, mute, activate, or the active tab when no id is given', async () => {
    const { shim, tabs } = setup();
    const done = await call(shim, workerOf(ID_A), 'tabs.update', 3, {
      url: 'https://c.example.com/',
      muted: true,
      active: true,
    });
    expect(done).toMatchObject({ ok: true, value: { id: 3 } });
    expect(tabs.calls).toEqual(['navigate:3:https://c.example.com/', 'mute:3:true', 'activate:3']);
    expect(await call(shim, workerOf(ID_A), 'tabs.update', { muted: false })).toMatchObject({ value: { id: 1 } });
    expect(tabs.calls.at(-1)).toBe('mute:1:false');
    expect(await call(shim, workerOf(ID_A), 'tabs.update', 1, { url: 'javascript:alert(1)' })).toMatchObject({
      code: 'REJECTED',
    });
    expect(await call(shim, workerOf(ID_A), 'tabs.update', 1, { pinned: true })).toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    // An extension that sees no active tab has nothing to update.
    expect(await call(shim, workerOf(ID_C), 'tabs.update', { muted: true })).toMatchObject({ code: 'REJECTED' });
  });

  it('removes visible tabs only, and nothing at all when one id is refused', async () => {
    const { shim, tabs } = setup();
    expect(await call(shim, workerOf(ID_A), 'tabs.remove', [1, 2])).toMatchObject({ ok: false, code: 'REJECTED' });
    expect(tabs.calls).toEqual([]);
    expect(await call(shim, workerOf(ID_A), 'tabs.remove', [1, 3, 3])).toEqual({ ok: true, value: null });
    expect(tabs.calls).toEqual(['remove:1', 'remove:3']);
    expect(await call(shim, workerOf(ID_A), 'tabs.remove', [])).toMatchObject({ code: 'INVALID_ARGUMENTS' });
  });
});

describe('chrome.tabs events', () => {
  it('sends onUpdated with several arguments to the extensions that can see the tab', async () => {
    const { tabs, events } = setup();
    const tab = makeTab(3, 'https://b.example.com/x', { loading: true });
    tabs.emit({ type: 'updated', tab, changes: { status: 'loading', url: tab.url } });
    expect(events.map((event) => event.extensionId).toSorted()).toEqual([ID_A, ID_B].toSorted());
    const forA = events.find((event) => event.extensionId === ID_A);
    expect(forA?.name).toBe('tabs.onUpdated');
    expect(forA?.args).toMatchObject([
      3,
      { status: 'loading', url: 'https://b.example.com/x' },
      { id: 3, status: 'loading' },
    ]);
    expect(events.some((event) => event.extensionId === ID_C)).toBe(false);
  });

  it('tells an extension that a tab it cannot see changed nothing', () => {
    const { tabs, events } = setup();
    tabs.emit({ type: 'updated', tab: makeTab(2, 'https://bank.test/account'), changes: { title: 'Balance' } });
    expect(events.map((event) => event.extensionId)).toEqual([ID_B]);
  });

  it('sends onCreated and onActivated by visibility, and onRemoved only to extensions that knew the tab', async () => {
    const { shim, tabs, events } = setup();
    tabs.emit({ type: 'created', tab: makeTab(8, 'https://a.example.com/n') });
    expect(
      events
        .filter((event) => event.name === 'tabs.onCreated')
        .map((event) => event.extensionId)
        .toSorted()
    ).toEqual([ID_A, ID_B].toSorted());
    tabs.emit({ type: 'activated', tabId: 2, windowId: 1 });
    expect(events.filter((event) => event.name === 'tabs.onActivated').map((event) => event.extensionId)).toEqual([
      ID_B,
    ]);

    // A learned about tab 1 by querying; C never did.
    await call(shim, workerOf(ID_A), 'tabs.query', {});
    events.length = 0;
    tabs.emit({ type: 'removed', tabId: 1, windowId: 1 });
    expect(events.map((event) => [event.extensionId, event.name, event.args])).toEqual([
      [ID_A, 'tabs.onRemoved', [1, { windowId: 1, isWindowClosing: false }]],
    ]);
  });

  it('stops listening to the port on dispose', () => {
    const { shim, tabs } = setup();
    expect(tabs.listenerCount()).toBeGreaterThan(0);
    shim.dispose();
    expect(tabs.listenerCount()).toBe(0);
  });
});

describe('chrome.tabs without the Browser', () => {
  it('answers UNSUPPORTED instead of pretending', async () => {
    const shim = shimWith({ [ID_A]: manifestOf() });
    expect(await call(shim, workerOf(ID_A), 'tabs.query', {})).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(await call(shim, workerOf(ID_A), 'tabs.create', {})).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
  });
});
