import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAction } from '@/renderer/components/layout/SuperSearch/engine/actions';
import { addEventListener, consumeRequestedBrowserUrl } from '@/renderer/utils/emitter';

const deps = (onBrowserRoute = false) => ({
  navigate: vi.fn(),
  restart: vi.fn(),
  onBrowserRoute,
});

afterEach(() => {
  consumeRequestedBrowserUrl();
});

describe('executeAction', () => {
  it('navigates to in-app routes', () => {
    const d = deps();
    executeAction({ kind: 'route', path: '/settings/display' }, d);
    expect(d.navigate).toHaveBeenCalledWith('/settings/display');
  });

  it('hands a URL to the Browser app and opens it from another page', () => {
    const d = deps(false);
    executeAction({ kind: 'url', url: 'https://www.facebook.com/' }, d);
    expect(d.navigate).toHaveBeenCalledWith('/browser');
    expect(consumeRequestedBrowserUrl()).toBe('https://www.facebook.com/');
  });

  it('tells the mounted Browser page directly instead of navigating', () => {
    const d = deps(true);
    const seen: string[] = [];
    const off = addEventListener('browser.openUrl', (url) => seen.push(url));
    executeAction({ kind: 'url', url: 'https://www.google.com/search?q=a' }, d);
    off();
    expect(d.navigate).not.toHaveBeenCalled();
    expect(seen).toEqual(['https://www.google.com/search?q=a']);
  });

  it('restarts the app only for the restart command', () => {
    const d = deps();
    executeAction({ kind: 'command', command: 'restart-app' }, d);
    expect(d.restart).toHaveBeenCalledTimes(1);
  });

  it('refuses unsafe actions even if a provider slipped one through', () => {
    const d = deps();
    executeAction({ kind: 'url', url: 'javascript:alert(1)' }, d);
    executeAction({ kind: 'route', path: '//evil.example' }, d);
    expect(d.navigate).not.toHaveBeenCalled();
    expect(consumeRequestedBrowserUrl()).toBeNull();
  });
});
