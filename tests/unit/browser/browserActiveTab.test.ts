import { afterEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (request: unknown) => unknown>());

vi.mock('electron', () => ({ WebContentsView: vi.fn(), app: {}, session: {} }));
vi.mock('@office-ai/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@office-ai/platform')>();
  return {
    ...actual,
    bridge: {
      ...actual.bridge,
      buildProvider: (name: string) => ({
        provider: (handler: (request: unknown) => unknown) => {
          handlers.set(name, handler);
        },
        invoke: vi.fn(),
      }),
      buildEmitter: () => ({ emit: vi.fn(), on: vi.fn() }),
    },
  };
});

import {
  BROWSER_CHANNELS,
  activeBrowserTabUrl,
    disposeBrowserBridge,
  getBrowserServices,
  registerBrowserBridge,
} from '@process/browser/browserBridge';
import type { IBrowserViewManager } from '@process/browser/browserViewManager';

afterEach(() => {
  disposeBrowserBridge();
  handlers.clear();
});

/** A view manager double: three tabs, one of them in the background, all with a URL the tab itself reports. */
const setup = (tabs: Array<{ id: string; url: string; background?: boolean }>) => {
  const viewManager = {
    createTab: vi.fn(),
    destroyTab: vi.fn(),
    show: vi.fn(),
    listTabs: () => tabs.map((tab) => ({ ...tab, title: '', visible: true, bounds: {} })),
    getWebContents: () => undefined,
  };
  registerBrowserBridge({ viewManager: viewManager as unknown as IBrowserViewManager });
  const show = handlers.get(BROWSER_CHANNELS.show);
  if (show === undefined) throw new Error('show handler was not registered');
  return { show: (id: string) => show({ id }) };
};

describe('active browser tab for the extension strip', () => {
    it('does not create an embedded Browser service on a clean base', () => {
    disposeBrowserBridge();
    expect(() => getBrowserServices(() => null)).toThrow('BROWSER_PACKAGE_INACTIVE');
  });

  it('reads the URL of the tab the Browser last showed, from the tab itself', async () => {
    const { show } = setup([
      { id: 'tab-1', url: 'https://news.test/a' },
      { id: 'tab-2', url: 'https://shop.test/b' },
    ]);
    expect(activeBrowserTabUrl()).toBeUndefined();
    await show('tab-2');
    expect(activeBrowserTabUrl()).toBe('https://shop.test/b');
  });

    it('forgets foreground origin and refuses stale handlers after Browser package deactivation', async () => {
    const { show } = setup([{ id: 'tab-1', url: 'https://private.example/' }]);
    await show('tab-1');
    expect(activeBrowserTabUrl()).toBe('https://private.example/');
        disposeBrowserBridge();
    expect(() => getBrowserServices(() => null)).toThrow('BROWSER_PACKAGE_INACTIVE');
    expect(activeBrowserTabUrl()).toBeUndefined();
    expect(activeBrowserTabUrl('tab-1')).toBeUndefined();
        const stale: unknown = await Promise.resolve().then(() => show('tab-1')).catch((error: unknown) => error);
    expect(stale).toMatchObject({ message: 'BROWSER_PACKAGE_INACTIVE' });
  });

  it('gives nothing for a background tab, and for a tab the renderer names that is not live and foreground', async () => {
    const { show } = setup([
      { id: 'tab-1', url: 'https://news.test/a' },
      { id: 'hidden', url: 'https://bank.test/', background: true },
    ]);
    await show('tab-1');
    expect(activeBrowserTabUrl('hidden')).toBeUndefined();
    expect(activeBrowserTabUrl('no-such-tab')).toBeUndefined();
    expect(activeBrowserTabUrl('tab-1')).toBe('https://news.test/a');
  });
});
