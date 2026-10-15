import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialAccount } from '@/common/types/social';
import { SocialHubPage } from '@/renderer/pages/social';

const api = vi.hoisted(() => ({ listAccounts: vi.fn() }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  social: { listAccounts: { invoke: api.listAccounts } },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'guid.hubHome.socialWeb.accountsError': 'Cannot read accounts',
      'guid.hubHome.socialWeb.accountsRetry': 'Retry loading accounts',
      'guid.hubHome.socialWeb.accountsLoading': 'Loading Social accounts',
    })[key as 'guid.hubHome.socialWeb.accountsError' | 'guid.hubHome.socialWeb.accountsRetry' | 'guid.hubHome.socialWeb.accountsLoading'] ?? key,
  }),
}));
vi.mock('@/renderer/pages/social/SocialHubHeader', () => ({
  SocialHubHeader: ({ accounts }: { accounts: SocialAccount[] }) => (
    <div data-testid='social-header-account-count'>{accounts.length}</div>
  ),
}));
vi.mock('@/renderer/pages/social/web/SocialWebView', () => ({
  default: () => <div>Facebook Web ready</div>,
}));
vi.mock('@/renderer/pages/social/feed/UnifiedFeedView', () => ({
  default: () => <div>Feed ready</div>,
}));
vi.mock('@/renderer/pages/social/reels/ReelsPlayerView', () => ({
  default: () => <div>Reels ready</div>,
}));
vi.mock('@/renderer/pages/social/messages/UnifiedMessengerView', () => ({
  default: () => <div>Messages ready</div>,
}));
vi.mock('@/renderer/pages/social/settings/SocialSettingsView', () => ({
  default: () => <div>Settings ready</div>,
}));

describe('Social Hub account bootstrap state', () => {
  beforeEach(() => { api.listAccounts.mockReset(); });

  it('shows loading without the false empty state, then displays the feed', async () => {
    let resolve!: (value: SocialAccount[]) => void;
    api.listAccounts.mockReturnValue(new Promise<SocialAccount[]>((done) => { resolve = done; }));
    render(<SocialHubPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Social accounts');
    expect(screen.queryByText('Feed ready')).toBeNull();
    await act(async () => { resolve([]); });
    await screen.findByText('Feed ready');
    expect(screen.queryByRole('status')).toBeNull();
  });

    it('opens the live Facebook Web surface by default for an unverified Web-only account', async () => {
    const facebook: SocialAccount = {
      id: 'fb-web', accountId: 'fb-web', platform: 'facebook', username: '',
      displayName: 'Facebook Web profile', partitionKey: 'persist:social_facebook_fb-web',
      avatarUrl: '', status: 'expired', connectedAt: 1, lastSyncedAt: 0,
      permissions: { canSyncFeed: false, canSyncReels: false, canReadMessages: false, canSendMessages: false },
    };
    api.listAccounts.mockResolvedValue([facebook]);
    render(<SocialHubPage />);
    expect(await screen.findByText('Facebook Web ready')).toBeDefined();
    expect(screen.getByTestId('social-header-account-count')).toHaveTextContent('1');
    expect(screen.queryByText('Feed ready')).toBeNull();
  });

  it('shows a retryable failure rather than claiming there are zero accounts', async () => {
    api.listAccounts.mockRejectedValueOnce(new Error('STORAGE_OFFLINE')).mockResolvedValueOnce([]);
    render(<SocialHubPage />);
    await screen.findByRole('alert');
    expect(screen.getByText('Cannot read accounts')).toBeDefined();
    expect(screen.queryByText('Feed ready')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading accounts' }));
    await waitFor(() => expect(api.listAccounts).toHaveBeenCalledTimes(2));
    await screen.findByText('Feed ready');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
