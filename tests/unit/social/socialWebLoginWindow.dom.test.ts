import { describe, expect, it, vi } from 'vitest';
import type { SocialAccount } from '@/common/types/social';
import { launchElectronLoginWindow } from '@/process/services/social/socialBridge';

type NavigationEvent = { preventDefault: () => void };
type NavigationHandler = (event: NavigationEvent, target: string) => void;
type WindowStub = {
  on: (name: string, handler: () => void) => void;
  isDestroyed: () => boolean;
  destroy: () => void;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  webContents: {
    handlers: Map<string, NavigationHandler>;
    popupHandler: (() => { action: string }) | null;
  };
};

const mockState = vi.hoisted(() => ({
  windows: [] as unknown[],
  partitions: new Map<
    string,
    {
      flushStorageData: ReturnType<typeof vi.fn>;
      requestHandler: ((sender: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null;
    }
  >(),
}));

vi.mock('electron', () => {
  class StubWindow {
    private closed = false;
    private callbacks = new Map<string, () => void>();
    show = vi.fn();
    focus = vi.fn();
    webContents = {
      handlers: new Map<string, NavigationHandler>(),
      popupHandler: null as (() => { action: string }) | null,
      on: (name: string, handler: NavigationHandler) => {
        this.webContents.handlers.set(name, handler);
      },
      setWindowOpenHandler: (handler: () => { action: string }) => {
        this.webContents.popupHandler = handler;
      },
    };
    constructor(readonly options: unknown) {
      mockState.windows.push(this);
    }
    on(name: string, handler: () => void): void {
      this.callbacks.set(name, handler);
    }
    async loadURL(_url: string): Promise<void> {}
    isDestroyed(): boolean {
      return this.closed;
    }
    destroy(): void {
      this.closed = true;
      this.callbacks.get('closed')?.();
    }
  }
  return {
    BrowserWindow: StubWindow,
    session: {
      fromPartition: (partitionKey: string) => {
        let entry = mockState.partitions.get(partitionKey);
        if (!entry) {
          entry = { flushStorageData: vi.fn(async () => {}), requestHandler: null };
          mockState.partitions.set(partitionKey, entry);
        }
        return {
          ...entry,
          setPermissionRequestHandler: (
            callback: (sender: unknown, permission: string, done: (allowed: boolean) => void) => void
          ) => {
            entry.requestHandler = callback;
          },
        };
      },
    },
  };
});

const createAccount = (id: string): SocialAccount => ({
  id,
  accountId: id,
  platform: 'facebook',
  username: '',
  displayName: 'Facebook session',
  partitionKey: `persist:social_facebook_${id}`,
  avatarUrl: '',
  status: 'expired',
  connectedAt: 1,
  lastSyncedAt: 0,
  permissions: { canSyncFeed: false, canSyncReels: false, canReadMessages: false, canSendMessages: false },
});

describe('Social BrowserWindow session boundary wiring', () => {
  it('intercepts redirects, blocks popups/device permission and focuses an existing isolated window', async () => {
    const account = createAccount('login-boundary-test');
    const startCount = mockState.windows.length;
    await launchElectronLoginWindow(account);
    expect(mockState.windows).toHaveLength(startCount + 1);
    const window = mockState.windows.at(-1) as WindowStub;
    const navigation = window.webContents.handlers.get('will-navigate');
    const redirect = window.webContents.handlers.get('will-redirect');
    expect(navigation).toBeTypeOf('function');
    expect(redirect).toBeTypeOf('function');

    const malicious = { preventDefault: vi.fn() };
    navigation?.(malicious, 'file:///C:/Users/secrets.txt');
    expect(malicious.preventDefault).toHaveBeenCalledOnce();
    const phishing = { preventDefault: vi.fn() };
    redirect?.(phishing, 'https://facebook.com.evil.example/login');
    expect(phishing.preventDefault).toHaveBeenCalledOnce();
    const valid = { preventDefault: vi.fn() };
    navigation?.(valid, 'https://accountscenter.facebook.com/');
    expect(valid.preventDefault).not.toHaveBeenCalled();
    expect(window.webContents.popupHandler?.()).toEqual({ action: 'deny' });

    const partition = mockState.partitions.get(account.partitionKey);
    const decisions: boolean[] = [];
    partition?.requestHandler?.({}, 'media', (allowed) => {
      decisions.push(allowed);
    });
    expect(decisions).toEqual([false]);

    await launchElectronLoginWindow(account);
    expect(mockState.windows).toHaveLength(startCount + 1);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    window.destroy();
    expect(partition?.flushStorageData).toHaveBeenCalledOnce();
  });
});
