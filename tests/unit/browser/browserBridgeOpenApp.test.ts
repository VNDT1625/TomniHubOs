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

import { WEB_EMBED_OPEN_APP_CHANNEL, WebEmbedError } from '@/common/integrations/webEmbed/webEmbed';
import { BROWSER_PROFILE_PARTITION } from '@process/integrations/browserExtensions/profile';
import { disposeBrowserBridge, registerBrowserBridge } from '@process/browser/browserBridge';
import type { IBrowserViewManager } from '@process/browser/browserViewManager';

afterEach(() => {
  disposeBrowserBridge();
  handlers.clear();
});

const REQUEST = { packageId: 'com.community.medisign', connectionId: 'medisign' };

/** A view manager double with only what the app opener touches; everything else would throw if it were called. */
const makeViewManager = () => {
  const created: Array<Record<string, unknown>> = [];
  const loaded: Array<[string, string]> = [];
  const contents = {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    loadURL: vi.fn(async () => undefined),
  };
  const viewManager = {
    createTab: (options: Record<string, unknown> = {}) => {
      created.push(options);
      return `tab-${created.length}`;
    },
    destroyTab: vi.fn(),
    loadURL: async (id: string, url: string) => {
      loaded.push([id, url]);
    },
    listTabs: () => created.map((_entry, index) => ({ id: `tab-${index + 1}` })),
    getWebContents: () => contents,
  };
  return { viewManager: viewManager as unknown as IBrowserViewManager, created, loaded, contents };
};

const register = (launch: () => Promise<unknown>) => {
  const fixture = makeViewManager();
  const apps = vi.fn(async () => ({ launch: launch as never }));
  registerBrowserBridge({ viewManager: fixture.viewManager, webEmbedApps: apps });
  const handler = handlers.get(WEB_EMBED_OPEN_APP_CHANNEL);
  if (handler === undefined) throw new Error('open-app handler was not registered');
  return { ...fixture, handler, apps };
};

const launched = {
  title: 'MediSign',
  url: 'http://127.0.0.1:4102/app',
  allowedOrigins: ['http://127.0.0.1:4102'],
};

describe('browser bridge: open an app by id (T5.3)', () => {
  it('registers the open-app channel', () => {
    register(async () => launched);
    expect(WEB_EMBED_OPEN_APP_CHANNEL).toBe('browser.open-app');
    expect(handlers.has('browser.open-app')).toBe(true);
  });

  it('opens a guarded tab in the Browser profile session and returns only the tab id', async () => {
    const { handler, created, loaded, contents } = register(async () => launched);
    expect(await handler(REQUEST)).toEqual({ ok: true, tabId: 'tab-1' });
    expect(created).toEqual([{ partition: BROWSER_PROFILE_PARTITION, visible: false, background: false }]);
    expect(loaded).toEqual([['tab-1', 'http://127.0.0.1:4102/app']]);
    // The tab was guarded before it loaded anything.
    expect(contents.on.mock.calls.map(([event]) => event)).toEqual(['will-navigate', 'will-redirect']);
    expect(contents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
  });

  it('refuses a request that tries to pick the partition or the address, without resolving the app', async () => {
    const launch = vi.fn(async () => launched);
    const { handler, created, apps } = register(launch);
    expect(await handler({ ...REQUEST, partition: 'persist:evil' })).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    expect(await handler({ ...REQUEST, url: 'https://evil.example.com' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await handler(undefined)).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    expect(apps).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('answers with a stable code when the app is not enabled, and creates no tab', async () => {
    const { handler, created } = register(async () => {
      throw new WebEmbedError('NOT_ENABLED');
    });
    expect(await handler(REQUEST)).toEqual({ ok: false, error: 'NOT_ENABLED' });
    expect(created).toEqual([]);
  });

  it('fails closed once the Browser package is no longer active', async () => {
    const { handler } = register(async () => launched);
    disposeBrowserBridge();
    // Depending on the bridge layer the refusal arrives as a rejection or as an error object; either way it is a refusal.
    const outcome: unknown = await Promise.resolve()
      .then(() => handler(REQUEST))
      .then(
        (value) => value,
        (error: unknown) => error
      );
    expect(JSON.stringify(outcome, ['message'])).toContain('BROWSER_PACKAGE_INACTIVE');
    expect(outcome).not.toMatchObject({ ok: true });
  });
});
