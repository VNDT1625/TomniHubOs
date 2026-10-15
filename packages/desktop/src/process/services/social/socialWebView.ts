/**
 * Social Web-only viewer: paints a first-party website in a Main-owned Chromium view,
 * using the existing account's isolated persistent partition. It NEVER reads the DOM,
 * cookies, requests, or tokens and is not a Graph API connector.
 */
import type { BrowserWindow, WebContentsView } from 'electron';
import type { SocialAccount } from '@/common/types/social';

export type SocialWebSection = 'feed' | 'reels' | 'messages';
export type SocialWebBounds = { x: number; y: number; width: number; height: number };
type WebViewFactory = (partition: string) => Promise<WebContentsView>;

export const SOCIAL_WEB_URLS: Record<SocialWebSection, string> = {
  feed: 'https://www.facebook.com/',
  reels: 'https://www.facebook.com/reels/',
  messages: 'https://www.facebook.com/messages/',
};

export function validateSocialWebBounds(value: unknown): SocialWebBounds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SOCIAL_WEB_BOUNDS_INVALID');
  const rect = value as Record<string, unknown>;
  if (
    Object.keys(rect).some((key) => !['x', 'y', 'width', 'height'].includes(key)) ||
    !['x', 'y', 'width', 'height'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key])) ||
    Number(rect.x) < 0 ||
    Number(rect.y) < 0 ||
    Number(rect.width) < 1 ||
    Number(rect.height) < 1 ||
    Number(rect.x) > 10000 ||
    Number(rect.y) > 10000 ||
    Number(rect.width) > 10000 ||
    Number(rect.height) > 10000
  )
    throw new Error('SOCIAL_WEB_BOUNDS_INVALID');
  return {
    x: Math.round(Number(rect.x)),
    y: Math.round(Number(rect.y)),
    width: Math.round(Number(rect.width)),
    height: Math.round(Number(rect.height)),
  };
}

export function socialWebNavigationAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      (host === 'facebook.com' ||
        host.endsWith('.facebook.com') ||
        host === 'meta.com' ||
        host.endsWith('.meta.com') ||
        host === 'messenger.com' ||
        host.endsWith('.messenger.com') ||
        host === 'instagram.com' ||
        host.endsWith('.instagram.com'))
    );
  } catch {
    return false;
  }
}

const makeView: WebViewFactory = async (partition) => {
  const { WebContentsView: NativeView, session } = await import('electron');
  session.fromPartition(partition).setPermissionRequestHandler((_sender, _permission, done) => done(false));
  return new NativeView({
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
};

export class SocialWebViewController {
  private current: {
    accountId: string;
    partition: string;
    section: SocialWebSection;
    view: WebContentsView;
    window: BrowserWindow;
    suspend: () => void;
    resume: () => void;
  } | null = null;
  private generation = 0;
  private pending: { accountId: string; partition: string } | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null | undefined,
    private readonly createView: WebViewFactory = makeView
  ) {}

  async show(account: SocialAccount, section: SocialWebSection, rawBounds: unknown): Promise<void> {
    if (account.platform !== 'facebook') throw new Error('SOCIAL_WEB_PLATFORM_UNAVAILABLE');
    if (!Object.hasOwn(SOCIAL_WEB_URLS, section)) throw new Error('SOCIAL_WEB_SECTION_INVALID');
    const bounds = validateSocialWebBounds(rawBounds);
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('SOCIAL_WEB_WINDOW_UNAVAILABLE');
    const [width, height] = window.getContentSize();
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('SOCIAL_WEB_WINDOW_UNAVAILABLE');
    const clipped = {
      x: Math.min(bounds.x, Math.max(0, width - 1)),
      y: Math.min(bounds.y, Math.max(0, height - 1)),
      width: Math.min(bounds.width, Math.max(0, width - bounds.x)),
      height: Math.min(bounds.height, Math.max(0, height - bounds.y)),
    };
    if (clipped.width < 1 || clipped.height < 1) throw new Error('SOCIAL_WEB_BOUNDS_INVALID');

    const existing = this.current;
    if (
      existing &&
      existing.accountId === account.id &&
      existing.partition === account.partitionKey &&
      existing.window === window &&
      !existing.view.webContents.isDestroyed()
    ) {
      existing.view.setBounds(clipped);
      if (existing.section !== section) {
        existing.section = section;
        await existing.view.webContents.loadURL(SOCIAL_WEB_URLS[section]);
      }
      return;
    }

    this.hide();
    const epoch = this.generation;
    this.pending = { accountId: account.id, partition: account.partitionKey };
    let view: WebContentsView;
    try {
      view = await this.createView(account.partitionKey);
    } catch (error) {
      if (epoch === this.generation) this.pending = null;
      throw error;
    }
    if (epoch === this.generation) this.pending = null;
    if (epoch !== this.generation || window.isDestroyed()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
      return;
    }
    view.webContents.on('will-navigate', (event, url) => {
      if (!socialWebNavigationAllowed(url)) event.preventDefault();
    });
    view.webContents.on('will-redirect', (event, url) => {
      if (!socialWebNavigationAllowed(url)) event.preventDefault();
    });
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.setBounds(clipped);
    window.contentView.addChildView(view);
    const suspend = () => {
      if (!view.webContents.isDestroyed()) view.webContents.setAudioMuted(true);
    };
    const resume = () => {
      if (!view.webContents.isDestroyed()) view.webContents.setAudioMuted(false);
    };
    window.on('minimize', suspend);
    window.on('hide', suspend);
    window.on('restore', resume);
    window.on('show', resume);
    this.current = { accountId: account.id, partition: account.partitionKey, section, view, window, suspend, resume };
    try {
      await view.webContents.loadURL(SOCIAL_WEB_URLS[section]);
    } catch (error) {
      if (epoch === this.generation) this.hide();
      throw error;
    }
  }

  hide(): void {
    this.generation += 1;
    this.pending = null;
    const current = this.current;
    this.current = null;
    if (!current) return;
    current.window.removeListener('minimize', current.suspend);
    current.window.removeListener('hide', current.suspend);
    current.window.removeListener('restore', current.resume);
    current.window.removeListener('show', current.resume);
    try {
      current.window.contentView.removeChildView(current.view);
    } catch {
      /* parent already disposed */
    }
    if (!current.view.webContents.isDestroyed()) current.view.webContents.close();
  }

  reloadAccount(accountId: string): void {
    if (this.current?.accountId !== accountId) throw new Error('SOCIAL_WEB_NOT_ACTIVE');
    this.current.view.webContents.reload();
  }

  hideAccount(accountId: string): void {
    if (this.current?.accountId === accountId || this.pending?.accountId === accountId) this.hide();
  }

  removePartition(partition: string): void {
    if (this.current?.partition === partition || this.pending?.partition === partition) this.hide();
  }
}
