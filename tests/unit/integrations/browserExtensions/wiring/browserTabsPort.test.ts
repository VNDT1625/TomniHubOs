import { describe, expect, it } from 'vitest';
import type { TabsPortEvent } from '@process/integrations/browserExtensions/api/groups/browser/tabs';
import { createBrowserTabsAdapter } from '@process/integrations/browserExtensions/wiring/browserTabsPort';
import { FakeContents, OTHER, PROFILE, fakeViewManager } from './wiringFixture';

const setup = () => {
  const view = fakeViewManager();
  const first = new FakeContents(11, PROFILE, 'https://a.example.com/');
  const second = new FakeContents(12, PROFILE, 'https://b.example.com/');
  const embed = new FakeContents(13, OTHER, 'http://127.0.0.1:3000/');
  const research = new FakeContents(14, PROFILE, 'https://research.test/');
  view.add('t1', first);
  view.add('t2', second, { visible: false });
  view.add('embed', embed);
  view.add('research', research, { background: true, visible: false });
  const adapter = createBrowserTabsAdapter({
    viewManager: view.manager,
    profileSession: PROFILE,
    subscribeLifecycle: view.subscribe,
    log: () => undefined,
  });
  const events: TabsPortEvent[] = [];
  adapter.port.subscribe((event) => events.push(event));
  return { view, adapter, events, first, second, embed, research };
};

describe('Browser tabs port', () => {
  it('lists only user tabs of the Browser profile, with webContents ids', () => {
    const { adapter } = setup();
    expect(adapter.port.list().map((tab) => [tab.id, tab.url, tab.windowId, tab.index, tab.active])).toEqual([
      [11, 'https://a.example.com/', 1, 0, true],
      [12, 'https://b.example.com/', 1, 1, false],
    ]);
  });

  it('never touches a web-embed tab or a research tab, whatever the id', async () => {
    const { adapter, view, embed } = setup();
    await adapter.port.navigate(13, 'https://x.test/');
    await adapter.port.navigate(14, 'https://x.test/');
    adapter.port.remove(13);
    adapter.port.remove(14);
    adapter.port.activate(13);
    adapter.port.setMuted(13, true);
    expect(view.calls).toEqual([]);
    expect(embed.muted).toBe(false);
  });

  it('routes navigate, activate, mute and remove to the right tab', async () => {
    const { adapter, view, second } = setup();
    await adapter.port.navigate(12, 'https://c.example.com/');
    adapter.port.activate(12);
    adapter.port.setMuted(12, true);
    adapter.port.remove(12);
    expect(view.calls).toEqual(['load:t2:https://c.example.com/', 'show:t2', 'destroy:t2']);
    expect(second.muted).toBe(true);
    expect(adapter.port.list().find((tab) => tab.id === 12)?.active).toBe(true);
  });

  it('creates user tabs, not research tabs, and shows an active one', async () => {
    const { adapter, view } = setup();
    const tab = await adapter.port.create({ url: 'https://n.example.com/', active: true });
    expect(view.created).toEqual([{ url: 'https://n.example.com/', visible: true, background: false }]);
    expect(tab).toMatchObject({ id: 501, url: 'https://n.example.com/', active: true });
    const quiet = await adapter.port.create({ active: false });
    expect(view.created[1]).toEqual({ visible: false, background: false });
    expect(quiet.active).toBe(false);
    expect(adapter.port.list().map((candidate) => candidate.id)).toContain(502);
  });

  it('announces created, activated and removed tabs from the manager lifecycle', () => {
    const { adapter, view, events } = setup();
    const added = new FakeContents(21, PROFILE, 'https://z.example.com/');
    view.add('t3', added);
    view.announce({ type: 'created', id: 't3' });
    view.announce({ type: 'shown', id: 't3' });
    expect(events.map((event) => event.type)).toEqual(['created', 'activated']);
    expect(adapter.port.list().find((tab) => tab.id === 21)?.active).toBe(true);
    view.remove('t3');
    view.announce({ type: 'destroyed', id: 't3' });
    expect(events.at(-1)).toEqual({ type: 'removed', tabId: 21, windowId: 1 });
    expect(added.total()).toBe(0);
    // A tab of another session is ignored by every event.
    view.add('e2', new FakeContents(22, OTHER, 'http://x.test/'));
    view.announce({ type: 'created', id: 'e2' });
    view.announce({ type: 'shown', id: 'e2' });
    view.announce({ type: 'destroyed', id: 'e2' });
    expect(events).toHaveLength(3);
  });

  it('turns page events into update events', () => {
    const { first, events } = setup();
    first.loading = true;
    first.emit('did-start-loading');
    first.url = 'https://a.example.com/next';
    first.emit('did-navigate', {}, first.url);
    first.emit('did-navigate-in-page', {}, 'https://a.example.com/next#x');
    first.title = 'Next';
    first.emit('page-title-updated', {}, 'Next');
    first.emit('page-favicon-updated', {}, ['https://a.example.com/icon.png']);
    first.emit('page-favicon-updated', {}, []);
    first.audible = true;
    first.emit('audio-state-changed', { audible: true });
    first.loading = false;
    first.emit('did-stop-loading');
    const changes = events.flatMap((event) => (event.type === 'updated' ? [event.changes] : []));
    expect(changes).toEqual([
      { status: 'loading' },
      { url: 'https://a.example.com/next' },
      { url: 'https://a.example.com/next#x' },
      { title: 'Next' },
      { favIconUrl: 'https://a.example.com/icon.png' },
      { audible: true },
      { status: 'complete' },
    ]);
    const last = events.at(-1);
    expect(last?.type === 'updated' && last.tab).toMatchObject({
      id: 11,
      favIconUrl: 'https://a.example.com/icon.png',
      title: 'Next',
      loading: false,
    });
  });

  it('watches current and future user tabs and runs the cleanup when a tab goes', () => {
    const { adapter, view, first } = setup();
    const attached: number[] = [];
    const cleaned: number[] = [];
    const stop = adapter.watch((tab) => {
      attached.push(tab.tabId);
      return () => cleaned.push(tab.tabId);
    });
    expect(attached).toEqual([11, 12]);
    view.add('t3', new FakeContents(31, PROFILE, 'https://q.example.com/'));
    view.announce({ type: 'created', id: 't3' });
    expect(attached).toEqual([11, 12, 31]);
    view.remove('t1');
    view.announce({ type: 'destroyed', id: 't1' });
    expect(cleaned).toEqual([11]);
    expect(first.total()).toBe(0);
    stop();
    view.add('t4', new FakeContents(41, PROFILE, 'https://r.example.com/'));
    view.announce({ type: 'created', id: 't4' });
    expect(attached).not.toContain(41);
  });

  it('survives a listener or a watcher that throws', () => {
    const { adapter, view, first } = setup();
    adapter.port.subscribe(() => {
      throw new Error('listener bug');
    });
    adapter.watch(() => {
      throw new Error('watcher bug');
    });
    expect(() => first.emit('did-stop-loading')).not.toThrow();
    view.add('t3', new FakeContents(31, PROFILE, 'https://q.example.com/'));
    expect(() => view.announce({ type: 'created', id: 't3' })).not.toThrow();
  });

  it('releases everything on dispose', () => {
    const { adapter, view, first, second } = setup();
    adapter.dispose();
    expect(view.listenerCount()).toBe(0);
    expect(first.total() + second.total()).toBe(0);
  });
});
