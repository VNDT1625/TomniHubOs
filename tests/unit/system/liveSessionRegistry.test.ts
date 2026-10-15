import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveSessionsSnapshot } from '@/common/liveSessions/model';
import { LiveSessionRegistry } from '@/process/system/liveSessions/liveSessionRegistry';

const tab = (id: string, title = id) => ({ id, title, status: 'idle' });

describe('LiveSessionRegistry', () => {
  let clock = 1_000;
  let registry: LiveSessionRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000;
    registry = new LiveSessionRegistry({ now: () => clock, throttleMs: 200 });
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
  });

  it('stores a report and lists it in the snapshot', () => {
    expect(registry.report('browser', [tab('a'), tab('b')])).toBe(true);
    const { apps } = registry.snapshot();
    expect(apps).toHaveLength(1);
    expect(apps[0].appId).toBe('browser');
    expect(apps[0].sessions.map((session) => session.id)).toEqual(['a', 'b']);
  });

  it('overwrites the whole list on the next report', () => {
    registry.report('browser', [tab('a'), tab('b')]);
    registry.report('browser', [tab('c')]);
    expect(registry.snapshot().apps[0].sessions.map((session) => session.id)).toEqual(['c']);
  });

  it('removes the app when it reports an empty list', () => {
    registry.report('browser', [tab('a')]);
    expect(registry.report('browser', [])).toBe(true);
    expect(registry.snapshot().apps).toEqual([]);
  });

  it('ignores an invalid payload and keeps the previous list without throwing', () => {
    registry.report('browser', [tab('a')]);
    expect(registry.report('browser', 'nope')).toBe(false);
    expect(registry.report('', [tab('x')])).toBe(false);
    expect(registry.report('x'.repeat(201), [tab('x')])).toBe(false);
    expect(registry.snapshot().apps.map((app) => app.appId)).toEqual(['browser']);
    expect(registry.snapshot().apps[0].sessions).toHaveLength(1);
  });

  it('keeps the previous list when a non-empty report holds nothing readable', () => {
    registry.report('browser', [tab('a')]);
    expect(registry.report('browser', [{ id: 'a', title: 'x', status: 'IDLE' }])).toBe(false);
    expect(registry.report('browser', [null, 5])).toBe(false);
    expect(registry.snapshot().apps[0].sessions.map((session) => session.id)).toEqual(['a']);
  });

  it('clears an app and ignores clearing an unknown one', () => {
    registry.report('browser', [tab('a')]);
    registry.clear('unknown');
    registry.clear('browser');
    expect(registry.snapshot().apps).toEqual([]);
  });

  it('orders apps by most recent update', () => {
    registry.report('older', [tab('a')]);
    clock = 2_000;
    registry.report('newer', [tab('b')]);
    expect(registry.snapshot().apps.map((app) => app.appId)).toEqual(['newer', 'older']);
  });

  it('notifies listeners once per throttle window and stops after unsubscribe', () => {
    const seen: LiveSessionsSnapshot[] = [];
    const unsubscribe = registry.subscribe((snapshot) => seen.push(snapshot));
    registry.report('a', [tab('1')]);
    registry.report('b', [tab('2')]);
    expect(seen).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].apps).toHaveLength(2);
    unsubscribe();
    registry.report('c', [tab('3')]);
    vi.advanceTimersByTime(400);
    expect(seen).toHaveLength(1);
  });

  describe('actions', () => {
    const appOf = (id: string) => registry.snapshot().apps.find((app) => app.appId === id);

    it('stores normalized actions and omits the key when there are none', () => {
      registry.report('a', [tab('1')], { create: true, close: true, junk: 1 });
      expect(appOf('a')?.actions).toEqual({ create: true, close: true });
      registry.report('b', [tab('1')]);
      expect(appOf('b')).not.toHaveProperty('actions');
      registry.report('c', [tab('1')], { create: 'yes' });
      expect(appOf('c')).not.toHaveProperty('actions');
    });

    it('replaces actions with each valid report', () => {
      registry.report('a', [tab('1')], { create: true });
      registry.report('a', [tab('1')]);
      expect(appOf('a')).not.toHaveProperty('actions');
    });

    it('keeps actions untouched when a report is rejected', () => {
      registry.report('a', [tab('1')], { close: true });
      expect(registry.report('a', 'nope', { create: true })).toBe(false);
      expect(appOf('a')?.actions).toEqual({ close: true });
    });

    it('clear removes actions too', () => {
      registry.report('a', [tab('1')], { close: true });
      registry.clear('a');
      expect(appOf('a')).toBeUndefined();
      registry.report('a', [tab('1')]);
      expect(appOf('a')).not.toHaveProperty('actions');
    });
  });

  it('does not notify when a rejected report changed nothing', () => {
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.report('a', 'nope');
    vi.advanceTimersByTime(400);
    expect(listener).not.toHaveBeenCalled();
  });
});
