import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountCard } from '@/renderer/pages/social/settings/AccountCard';
import { PermissionModal } from '@/renderer/pages/social/settings/PermissionModal';
import { StorageManager } from '@/renderer/pages/social/settings/StorageManager';
import { SocialSettingsView } from '@/renderer/pages/social/settings/SocialSettingsView';
import { social as socialApi } from '@/common/adapter/ipcBridge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'guid.hubHome.socialWeb.webOnly': 'Separate Web session (account not identified)',
            'guid.hubHome.socialWeb.apiUnverified': 'API access not verified',
            'guid.hubHome.socialWeb.reopen': 'Reopen Web session',
      'guid.hubHome.socialWeb.cacheClear': 'Clear cached Feed/Reels',
      'guid.hubHome.socialWeb.cacheClearConfirm': 'Clear all cached posts, including unseen?',
      'guid.hubHome.socialWeb.cacheMetadataSize': 'Cached metadata size',
        })[key as 'guid.hubHome.socialWeb.webOnly' | 'guid.hubHome.socialWeb.apiUnverified' | 'guid.hubHome.socialWeb.reopen' | 'guid.hubHome.socialWeb.cacheClear' | 'guid.hubHome.socialWeb.cacheClearConfirm' | 'guid.hubHome.socialWeb.cacheMetadataSize'] ?? key,
  }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  social: {
    listAccounts: { invoke: vi.fn() },
    getStorageStats: { invoke: vi.fn() },
    connectAccount: { invoke: vi.fn() },
    openLoginWindow: { invoke: vi.fn() },
    updatePermissions: { invoke: vi.fn() },
        removeAccount: { invoke: vi.fn() },
    clearCache: { invoke: vi.fn() },
  },
}));
import type { SocialAccount, SocialStorageStats } from '@/common/types/social';

describe('Social Settings Components', () => {
  const mockAccount: SocialAccount = {
    id: 'acc-1',
    platform: 'x',
    accountId: 'acc-1',
    displayName: 'Dev Account',
    username: 'dev_user',
    avatarUrl: '',
    partitionKey: 'persist:social_x_acc-1',
    status: 'connected',
    connectedAt: Date.now() - 500000,
    lastSyncedAt: Date.now() - 500000,
    permissions: {
      canSyncFeed: true,
      canSyncReels: true,
      canReadMessages: true,
      canSendMessages: true,
    },
  };

  const mockStats: SocialStorageStats = {
    cacheSizeBytes: 10485760, // 10 MB
    cachedPostsCount: 150,
    cachedReelsCount: 40,
    cachedMediaFilesCount: 10,
  };

  it('renders AccountCard with account info and permission toggles', () => {
    const onTogglePermission = vi.fn();
    const onRemove = vi.fn();

    render(
      <AccountCard
        account={mockAccount}
        onTogglePermission={onTogglePermission}
        onRemove={onRemove}
      />
    );

    expect(screen.getByText('Dev Account')).toBeDefined();
    expect(screen.getByText('@dev_user')).toBeDefined();
    expect(screen.getByText('X')).toBeDefined();

    const feedCheckbox = screen.getByLabelText(/Đồng bộ bảng tin/i);
    expect((feedCheckbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(feedCheckbox);
    expect(onTogglePermission).toHaveBeenCalledWith('acc-1', 'canSyncFeed', false);

    const removeBtn = screen.getByRole('button', { name: /đăng xuất/i });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('acc-1');
  });

  it('renders PermissionModal and handles consent confirmation', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <PermissionModal
        isOpen={true}
        platform="facebook"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(/Ủy quyền truy cập/i)).toBeDefined();
    expect(screen.getByText(/Đồng bộ Bảng tin & Reels/i)).toBeDefined();

    const usernameInput = screen.getByLabelText(/Username \/ Handle/i);
    fireEvent.change(usernameInput, { target: { value: 'real_user' } });

    const confirmBtn = screen.getByRole('button', { name: /tiếp tục đăng nhập/i });
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'real_user',
        permissions: expect.objectContaining({
          canSyncFeed: true,
          canReadMessages: true,
        }),
      })
    );
  });

    it('opens an isolated Web session from Settings without requesting a username', async () => {
    const list = vi.mocked(socialApi.listAccounts.invoke);
    list.mockResolvedValue([]);
    vi.mocked(socialApi.getStorageStats.invoke).mockResolvedValue(mockStats);
    vi.mocked(socialApi.connectAccount.invoke).mockImplementation(async () => {
      list.mockResolvedValue([{ ...mockAccount, id: 'facebook-1', platform: 'facebook', username: '', displayName: 'FACEBOOK Web 1', status: 'expired' }]);
      return { ...mockAccount, id: 'facebook-1', platform: 'facebook', username: '', displayName: 'FACEBOOK Web 1', status: 'expired' };
    });
    render(<SocialSettingsView />);
    expect(screen.queryByLabelText(/Username \/ Handle/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Facebook' }));
    await waitFor(() => expect(socialApi.connectAccount.invoke).toHaveBeenCalledWith({ platform: 'facebook' }));
    expect(socialApi.openLoginWindow.invoke).not.toHaveBeenCalled();
    await screen.findByText('FACEBOOK Web 1');
        expect(screen.getByText(/Separate Web session|Phiên Web riêng/)).toBeDefined();
        expect(screen.getByText(/API access not verified|Chưa xác minh quyền API/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Web session' }));
    await waitFor(() => expect(socialApi.openLoginWindow.invoke).toHaveBeenCalledWith({ accountId: 'facebook-1' }));
  });

    it('requires confirmation before destructive Social cache clearing', async () => {
    vi.mocked(socialApi.listAccounts.invoke).mockResolvedValue([]);
    vi.mocked(socialApi.getStorageStats.invoke).mockResolvedValue(mockStats);
    vi.mocked(socialApi.clearCache.invoke).mockReset().mockResolvedValue({ freedBytes: 0 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { unmount } = render(<SocialSettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear cached Feed/Reels' }));
    expect(confirm).toHaveBeenCalledWith('Clear all cached posts, including unseen?');
    expect(socialApi.clearCache.invoke).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear cached Feed/Reels' }));
    await waitFor(() => expect(socialApi.clearCache.invoke).toHaveBeenCalledOnce());
    unmount();
    confirm.mockRestore();
  });

  it('renders StorageManager and triggers onClearCache', () => {
    const onClear = vi.fn();

    render(
      <StorageManager
        stats={mockStats}
        onClearCache={onClear}
      />
    );

    expect(screen.getByText('10.00 MB')).toBeDefined();
    expect(screen.getByText('150')).toBeDefined(); // posts
    expect(screen.getByText('40')).toBeDefined(); // reels

        const clearBtn = screen.getByRole('button', { name: /Clear cached Feed\/Reels/i });
    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalled();
  });
});
