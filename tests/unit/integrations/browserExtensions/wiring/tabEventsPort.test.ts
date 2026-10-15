import { describe, expect, it, vi } from 'vitest';
import type { NavigationEvent } from '@process/integrations/browserExtensions/api/groups/browser/webNavigation';
import { createTabEventsPorts, pressOf } from '@process/integrations/browserExtensions/wiring/tabEventsPort';
import type { WatchedTab } from '@process/integrations/browserExtensions/wiring/browserTabsPort';
import { FakeContents, PROFILE } from './wiringFixture';

const setup = () => {
  const contents = new FakeContents(11, PROFILE, 'https://a.example.com/');
  const ports = createTabEventsPorts({
    watch: (attach) => {
      attach({ tabId: 11, contents: contents.asContents() } as WatchedTab);
      return () => undefined;
    },
    now: () => 42,
    log: () => undefined,
  });
  return { contents, ports };
};

describe('tab events for the extension APIs', () => {
  it('reads a key press in accelerator terms, and ignores anything but a key going down', () => {
    expect(pressOf({ type: 'keyDown', key: 'ArrowUp', alt: true })).toEqual({
      key: 'Up',
      ctrl: false,
      alt: true,
      shift: false,
      meta: false,
    });
    expect(pressOf({ type: 'keyDown', key: ' ' })?.key).toBe('Space');
    expect(pressOf({ type: 'keyDown', key: 'y', control: true, shift: true })?.key).toBe('Y');
    expect(pressOf({ type: 'keyUp', key: 'Y' })).toBeUndefined();
  });

  it('reports the main-frame navigation phases, and skips subframes', () => {
    const { contents, ports } = setup();
    const seen: NavigationEvent[] = [];
    ports.webNavigation.subscribe((event) => seen.push(event));
    contents.emit('did-start-navigation', {}, 'https://a.example.com/b', false, true);
    contents.emit('did-start-navigation', {}, 'https://ads.test/frame', false, false);
    contents.emit('did-frame-navigate', {}, 'https://a.example.com/b', 200, 'OK', true);
    contents.emit('dom-ready');
    contents.emit('did-finish-load');
    expect(seen.map((event) => [event.phase, event.url, event.timeStamp])).toEqual([
      ['before', 'https://a.example.com/b', 42],
      ['committed', 'https://a.example.com/b', 42],
      ['dom', 'https://a.example.com/', 42],
      ['completed', 'https://a.example.com/', 42],
    ]);
    expect(seen[1]?.transitionType).toBe('other');
  });

  it('consumes a key press that matches a command, and lets the others reach the page', () => {
    const { contents, ports } = setup();
    ports.commands.subscribeKeys((press) => press.key === 'Y' && press.ctrl && press.shift);
    const consumed = vi.fn();
    contents.emit(
      'before-input-event',
      { preventDefault: consumed },
      { type: 'keyDown', key: 'Y', control: true, shift: true }
    );
    expect(consumed).toHaveBeenCalledTimes(1);
    const passed = vi.fn();
    contents.emit('before-input-event', { preventDefault: passed }, { type: 'keyDown', key: 'y', control: true });
    contents.emit(
      'before-input-event',
      { preventDefault: passed },
      { type: 'keyUp', key: 'Y', control: true, shift: true }
    );
    expect(passed).not.toHaveBeenCalled();
  });

  it('stops reporting once disposed', () => {
    const { contents, ports } = setup();
    const seen: NavigationEvent[] = [];
    ports.webNavigation.subscribe((event) => seen.push(event));
    ports.dispose();
    contents.emit('dom-ready');
    expect(seen).toEqual([]);
  });
});
