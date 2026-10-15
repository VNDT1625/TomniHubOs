import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SocialAccount } from '@/common/types/social';
import { SocialWebView } from '@/renderer/pages/social/web/SocialWebView';

const calls = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  social: {
    showWeb: { invoke: calls.show },
    hideWeb: { invoke: calls.hide },
    reloadWeb: { invoke: calls.reload },
  },
}));
const translate = (key: string): string =>
  ({
    'guid.hubHome.socialWeb.browserNoAccount': 'Connect Facebook first',
    'guid.hubHome.socialWeb.browserHint': 'Direct website',
    'guid.hubHome.socialWeb.browserFeed': 'Feed',
    'guid.hubHome.socialWeb.browserMessages': 'Messages',
    'guid.hubHome.socialWeb.browserReload': 'Reload',
    'guid.hubHome.socialWeb.browserLoading': 'Opening website',
    'guid.hubHome.socialWeb.browserTitle': 'Facebook Web content',
    'guid.hubHome.socialWeb.browserError': 'Web view unavailable',
    'guid.hubHome.shell.nav.settings': 'Settings',
  })[key as 'guid.hubHome.socialWeb.browserNoAccount'] ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));
const permissions = {
  canSyncFeed: false,
  canSyncReels: false,
  canReadMessages: false,
  canSendMessages: false,
};
const makeAccount = (id: string, platform: SocialAccount['platform'] = 'facebook'): SocialAccount => ({
  id,
  accountId: id,
  platform,
  username: '',
  displayName: `Web ${id}`,
  partitionKey: `persist:social_${platform}_${id}`,
  status: 'expired',
  avatarUrl: '',
  connectedAt: 1,
  lastSyncedAt: 0,
  permissions,
});

describe('Social live website tab', () => {
  beforeEach(() => {
    calls.show.mockReset().mockResolvedValue(undefined);
    calls.hide.mockReset().mockResolvedValue(undefined);
    calls.reload.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 60,
      width: 800,
      height: 450,
      x: 20,
      y: 60,
      right: 820,
      bottom: 510,
      toJSON: () => undefined,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('offers account settings rather than presenting a fake imported Feed', () => {
    const openSettings = vi.fn();
    render(<SocialWebView accounts={[]} selectedAccountId={null} onOpenSettings={openSettings} />);
    expect(screen.getByText('Connect Facebook first')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(openSettings).toHaveBeenCalledOnce();
    expect(calls.show).not.toHaveBeenCalled();
  });

  it('shows the persisted account by ID, navigates sections and hides when leaving', async () => {
    const a = makeAccount('account-a');
    const b = makeAccount('account-b');
    const { unmount, rerender } = render(
      <SocialWebView accounts={[a, b]} selectedAccountId={a.id} onOpenSettings={vi.fn()} />
    );
    await waitFor(() =>
      expect(calls.show).toHaveBeenCalledWith({
        accountId: a.id,
        section: 'feed',
        bounds: { x: 20, y: 60, width: 800, height: 450 },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    await waitFor(() =>
      expect(calls.show).toHaveBeenCalledWith({
        accountId: a.id,
        section: 'messages',
        bounds: { x: 20, y: 60, width: 800, height: 450 },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(calls.reload).toHaveBeenCalledWith({ accountId: a.id }));
    rerender(<SocialWebView accounts={[a, b]} selectedAccountId={b.id} onOpenSettings={vi.fn()} />);
    await waitFor(() => expect(calls.hide).toHaveBeenCalledWith({ accountId: a.id }));
    await waitFor(() => expect(calls.show).toHaveBeenCalledWith(expect.objectContaining({ accountId: b.id })));
    unmount();
    await waitFor(() => expect(calls.hide).toHaveBeenCalledWith({ accountId: b.id }));
  });

  it('surfaces Main errors instead of silently rendering an empty white page', async () => {
    calls.show.mockRejectedValue(new Error('SOCIAL_WEB_WINDOW_UNAVAILABLE'));
    render(<SocialWebView accounts={[makeAccount('broken')]} selectedAccountId='broken' onOpenSettings={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.getByText('Web view unavailable')).toBeDefined();
  });
});
