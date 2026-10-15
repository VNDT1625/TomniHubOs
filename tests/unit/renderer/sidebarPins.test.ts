import { describe, expect, it } from 'vitest';
import {
    DEFAULT_APP_PINS,
  DEFAULT_NAV_PINS,
  getDefaultAppBaseRoute,
  MIN_SIDEBAR_PINS,
  normalizeSidebarPins,
  orderSidebarEntries,
  reorderSidebarEntries,
  toggleSidebarPin,
} from '@/renderer/pages/guid/HubHome/sidebarPins';

describe('Hub sidebar user ordering and app pins', () => {
  const allNav = [...DEFAULT_NAV_PINS, 'realtime', 'social', 'library', 'notifications'];
    it('opens built-in Browser and IDE directly while other default apps require their signed packages', () => {
    expect(getDefaultAppBaseRoute('com.tomni.browser')).toBe('/browser');
    expect(getDefaultAppBaseRoute('com.tomni.ide')).toBe('/ide');
    expect(getDefaultAppBaseRoute('com.tomni.document-studio')).toBeUndefined();
  });
  it('puts the five default functions first but keeps all other functions scrollable', () => {
    expect(reorderSidebarEntries(allNav, null)).toEqual(allNav);
    expect(reorderSidebarEntries(allNav, ['store', 'home'])).toEqual([
      'store', 'home', 'artifacts', 'schedule', 'company', 'realtime', 'social', 'library', 'notifications',
    ]);
  });
  it('drag and drop changes position, never removes a function', () => {
    const next = reorderSidebarEntries(allNav, 'store', 'artifacts');
    expect(next).toEqual(['home', 'store', 'artifacts', 'schedule', 'company', 'realtime', 'social', 'library', 'notifications']);
    expect(new Set(next)).toEqual(new Set(allNav));
    expect(reorderSidebarEntries(next, 'unknown', 'home')).toEqual(next);
  });
  it('does not permit fewer than three pinned apps', () => {
    const apps = [...DEFAULT_APP_PINS];
    const first = toggleSidebarPin(apps, apps[0]!, apps);
    const second = toggleSidebarPin(first, first[0]!, apps);
    expect(second).toHaveLength(MIN_SIDEBAR_PINS);
    expect(toggleSidebarPin(second, second[0]!, apps)).toEqual(second);
  });
  it('drops stale pin keys and keeps default ordering', () => {
    expect(normalizeSidebarPins(['fake', DEFAULT_APP_PINS[4], DEFAULT_APP_PINS[0]], DEFAULT_APP_PINS, DEFAULT_APP_PINS)).toEqual([
      DEFAULT_APP_PINS[4], DEFAULT_APP_PINS[0], DEFAULT_APP_PINS[1],
    ]);
    const ordered = orderSidebarEntries([{ id: 'third' }, { id: 'first' }, { id: 'second' }], ['second', 'first']);
    expect(ordered.map((entry) => entry.id)).toEqual(['second', 'first', 'third']);
  });
});
