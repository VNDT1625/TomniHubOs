import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContentsView } from 'electron';
import type { SocialAccount } from '@/common/types/social';
import {
  SocialWebViewController,
  validateSocialWebBounds,
  socialWebNavigationAllowed,
} from '@/process/services/social/socialWebView';

const permissions = {
  canSyncFeed: false,
  canSyncReels: false,
  canReadMessages: false,
  canSendMessages: false,
};
const account = (id: string): SocialAccount => ({
  id,
  accountId: id,
  platform: 'facebook',
  username: '',
  displayName: id,
  partitionKey: `persist:social_facebook_${id}`,
  status: 'expired',
  avatarUrl: '',
  connectedAt: 1,
  lastSyncedAt: 0,
  permissions,
});
const rectangle = { x: 20, y: 50, width: 600, height: 400 };
function setup() {
  const created: Array<{
    partition: string;
    bounds: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    audioMuted: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    nav: Map<string, (event: { preventDefault: () => void }, url: string) => void>;
    popup: (() => { action: string }) | null;
    destroyed: boolean;
  }> = [];
  const addChildView = vi.fn();
  const removeChildView = vi.fn();
  const getContentSize = vi.fn(() => [960, 720] as [number, number]);
  const listeners = new Map<string, Set<() => void>>();
  const window = {
    isDestroyed: () => false,
    getContentSize,
    on: (name: string, callback: () => void) => {
      const handlers = listeners.get(name) ?? new Set();
      handlers.add(callback);
      listeners.set(name, handlers);
    },
    removeListener: (name: string, callback: () => void) => {
      listeners.get(name)?.delete(callback);
    },
    contentView: { addChildView, removeChildView },
  } as unknown as BrowserWindow;
  const createView = vi.fn(async (partition: string) => {
    const item = {
      partition,
      bounds: vi.fn(),
      loadURL: vi.fn(async (_url: string) => {}),
      reload: vi.fn(),
      audioMuted: vi.fn(),
      close: vi.fn(() => {
        item.destroyed = true;
      }),
      destroyed: false,
      nav: new Map<string, (event: { preventDefault: () => void }, url: string) => void>(),
      popup: null as (() => { action: string }) | null,
    };
    created.push(item);
    return {
      setBounds: item.bounds,
      webContents: {
        isDestroyed: () => item.destroyed,
        close: item.close,
        loadURL: item.loadURL,
        reload: item.reload,
        setAudioMuted: item.audioMuted,
        on: (name: string, callback: (event: { preventDefault: () => void }, url: string) => void) => {
          item.nav.set(name, callback);
        },
        setWindowOpenHandler: (callback: () => { action: string }) => {
          item.popup = callback;
        },
      },
    } as unknown as WebContentsView;
  });
  const controller = new SocialWebViewController(() => window, createView);
  const emitWindow = (event: string) => listeners.get(event)?.forEach((handler) => handler());
  return { controller, created, createView, addChildView, removeChildView, getContentSize, emitWindow };
}

describe('Social embedded Chromium view boundary', () => {
  it('rejects invalid geometry and untrusted website URLs', () => {
    for (const input of [
      null,
      [],
      {},
      { ...rectangle, height: 0 },
      { ...rectangle, width: Infinity },
      { ...rectangle, x: -1 },
      { ...rectangle, partition: 'persist:evil' },
    ]) {
      expect(() => validateSocialWebBounds(input)).toThrow('SOCIAL_WEB_BOUNDS_INVALID');
    }
    expect(validateSocialWebBounds({ x: 20.1, y: 50.2, width: 600.4, height: 400.5 })).toEqual({
      x: 20,
      y: 50,
      width: 600,
      height: 401,
    });
    expect(socialWebNavigationAllowed('https://www.facebook.com/reels/')).toBe(true);
    for (const url of [
      'http://facebook.com',
      'file:///etc/passwd',
      'https://facebook.com.phishing.test',
      'https://localhost/',
      'javascript:alert(1)',
      'https://admin@facebook.com/',
    ]) {
      expect(socialWebNavigationAllowed(url)).toBe(false);
    }
  });

  it('uses one isolated partition, switches Facebook sections, hides on tab exit and rejects other providers', async () => {
    const { controller, created, addChildView, removeChildView } = setup();
    const first = account('a');
    await controller.show(first, 'feed', rectangle);
    expect(created[0].partition).toBe(first.partitionKey);
    expect(created[0].loadURL).toHaveBeenCalledWith('https://www.facebook.com/');
    expect(addChildView).toHaveBeenCalledTimes(1);
    expect(created[0].bounds).toHaveBeenCalledWith(rectangle);
    await controller.show(first, 'reels', rectangle);
    expect(created).toHaveLength(1);
    expect(created[0].loadURL).toHaveBeenLastCalledWith('https://www.facebook.com/reels/');
    controller.reloadAccount(first.id);
    expect(created[0].reload).toHaveBeenCalledOnce();
    controller.hideAccount('other');
    expect(removeChildView).not.toHaveBeenCalled();
    await controller.show(account('b'), 'messages', rectangle);
    expect(created).toHaveLength(2);
    expect(created[1].partition).toBe(account('b').partitionKey);
    expect(created[0].close).toHaveBeenCalledOnce();
    expect(removeChildView).toHaveBeenCalledOnce();
    expect(created[1].loadURL).toHaveBeenCalledWith('https://www.facebook.com/messages/');
    controller.removePartition(account('b').partitionKey);
    expect(created[1].close).toHaveBeenCalledOnce();
    expect(() => controller.reloadAccount('b')).toThrow('SOCIAL_WEB_NOT_ACTIVE');
    await expect(controller.show({ ...first, platform: 'reddit' }, 'feed', rectangle)).rejects.toThrow(
      'SOCIAL_WEB_PLATFORM_UNAVAILABLE'
    );
    await expect(controller.show(first, 'exploit' as never, rectangle)).rejects.toThrow('SOCIAL_WEB_SECTION_INVALID');
  });

  it('mutes the live website while the host window is hidden and detaches handlers on exit', async () => {
    const { controller, created, emitWindow } = setup();
    const first = account('audio');
    await controller.show(first, 'reels', rectangle);
    emitWindow('minimize');
    emitWindow('hide');
    expect(created[0].audioMuted).toHaveBeenCalledWith(true);
    emitWindow('restore');
    expect(created[0].audioMuted).toHaveBeenLastCalledWith(false);
    const before = created[0].audioMuted.mock.calls.length;
    controller.hideAccount(first.id);
    emitWindow('minimize');
    expect(created[0].audioMuted).toHaveBeenCalledTimes(before);
  });

  it('cancels an in-flight view if the tab closes before Chromium creation resolves', async () => {
    const { controller, createView, addChildView } = setup();
    let resolveView!: (view: WebContentsView) => void;
    const close = vi.fn();
    createView.mockImplementationOnce(
      () =>
        new Promise<WebContentsView>((resolve) => {
          resolveView = resolve;
        })
    );
    const first = account('cancelled');
    const pending = controller.show(first, 'feed', rectangle);
    controller.hideAccount(first.id);
    resolveView({
      setBounds: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        close,
        loadURL: vi.fn(async () => {}),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    } as unknown as WebContentsView);
    await pending;
    expect(close).toHaveBeenCalledOnce();
    expect(addChildView).not.toHaveBeenCalled();
    expect(() => controller.reloadAccount(first.id)).toThrow('SOCIAL_WEB_NOT_ACTIVE');
  });

  it('blocks navigation/popups, clips bounds and disposes the view if load fails', async () => {
    const { controller, created } = setup();
    await controller.show(account('one'), 'feed', { x: 800, y: 600, width: 500, height: 500 });
    expect(created[0].bounds).toHaveBeenCalledWith({ x: 800, y: 600, width: 160, height: 120 });
    const forbidden = { preventDefault: vi.fn() };
    created[0].nav.get('will-navigate')?.(forbidden, 'https://evil.example/');
    expect(forbidden.preventDefault).toHaveBeenCalledOnce();
    expect(created[0].popup?.()).toEqual({ action: 'deny' });
    controller.hide();

    const deferred = setup();
    let rejectLoad!: (err: Error) => void;
    deferred.createView.mockImplementationOnce(async () => {
      const view = await (async () => {
        const instance = setup();
        await instance.controller.show(account('tmp'), 'feed', rectangle);
        return instance;
      })();
      const createdItem = view.created[0];
      return {
        setBounds: createdItem.bounds,
        webContents: {
          isDestroyed: () => createdItem.destroyed,
          close: createdItem.close,
          loadURL: () =>
            new Promise<void>((_, reject) => {
              rejectLoad = reject;
            }),
          on: vi.fn(),
          setWindowOpenHandler: vi.fn(),
        },
      } as unknown as WebContentsView;
    });
    const pending = deferred.controller.show(account('failed'), 'feed', rectangle);
    // async factory resolution may take a microtask
    await vi.waitFor(() => expect(rejectLoad).toBeTypeOf('function'));
    rejectLoad(new Error('NETWORK_DOWN'));
    await expect(pending).rejects.toThrow('NETWORK_DOWN');
    expect(() => deferred.controller.reloadAccount('failed')).toThrow('SOCIAL_WEB_NOT_ACTIVE');
  });
});
