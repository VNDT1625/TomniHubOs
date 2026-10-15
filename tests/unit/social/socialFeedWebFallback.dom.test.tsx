import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SocialAccount } from '@/common/types/social';
import { UnifiedFeedView } from '@/renderer/pages/social/feed/UnifiedFeedView';
import { social } from '@/common/adapter/ipcBridge';

vi.mock('@/common/adapter/ipcBridge', () => ({
  social: { openLoginWindow: { invoke: vi.fn() } },
}));

vi.mock('@/renderer/pages/social/hooks/useSocialFeed', () => ({
  useSocialFeed: () => ({
    posts: [],
    loading: false,
    hasMore: false,
    fetchNextBatch: vi.fn(),
    markViewed: vi.fn(),
    error: null,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'guid.hubHome.socialWeb.feedUnavailable': 'Web login does not import posts; use the saved Web session.',
      'guid.hubHome.socialWeb.feedOpenFailed': 'Unable to open saved Web session.',
      'guid.hubHome.socialWeb.reopen': 'Reopen Web session',
      'guid.hubHome.socialWeb.empty': 'No Social Web sessions yet.',
      'guid.hubHome.shell.nav.settings': 'Settings',
    })[key as 'guid.hubHome.socialWeb.feedUnavailable' | 'guid.hubHome.socialWeb.feedOpenFailed' | 'guid.hubHome.socialWeb.reopen' | 'guid.hubHome.socialWeb.empty' | 'guid.hubHome.shell.nav.settings'] ?? key,
  }),
}));

const facebook: SocialAccount = {
  id: 'facebook-web-1',
  platform: 'facebook',
  accountId: 'facebook-web-1',
  username: '',
  displayName: 'FACEBOOK Web 1',
  avatarUrl: '',
  partitionKey: 'persist:social_facebook_web-1',
  status: 'expired',
  permissions: { canSyncFeed: false, canSyncReels: false, canReadMessages: false, canSendMessages: false },
  connectedAt: 1,
  lastSyncedAt: 0,
};

describe('Social Feed Web-only account fallback', () => {
  it('states why the feed has no data and reopens the matching stored Web session', async () => {
    vi.mocked(social.openLoginWindow.invoke).mockReset().mockResolvedValue({ success: true });
    render(<UnifiedFeedView selectedAccountId={facebook.id} accounts={[facebook]} />);
    expect(screen.getByText('Web login does not import posts; use the saved Web session.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Web session: FACEBOOK Web 1' }));
    await waitFor(() =>
      expect(social.openLoginWindow.invoke).toHaveBeenCalledWith({ accountId: facebook.id })
    );
  });

  it('does not mistake an unknown account for a verified API connection and surfaces opener errors', async () => {
    vi.mocked(social.openLoginWindow.invoke).mockReset().mockRejectedValue(new Error('WINDOW_UNAVAILABLE'));
    render(<UnifiedFeedView accounts={[facebook]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Web session: FACEBOOK Web 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to open saved Web session.');
  });

  it('offers a route to Settings when there are no Social profiles', () => {
    const openSettings = vi.fn();
    render(<UnifiedFeedView accounts={[]} onOpenSettings={openSettings} />);
    expect(screen.getByText('No Social Web sessions yet.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(openSettings).toHaveBeenCalledOnce();
  });
});
