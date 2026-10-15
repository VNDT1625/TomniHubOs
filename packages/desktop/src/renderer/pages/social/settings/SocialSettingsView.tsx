/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { AccountCard } from './AccountCard';

import { StorageManager } from './StorageManager';
import type { SocialAccount, SocialPlatform, SocialPermissions, SocialStorageStats } from '@/common/types/social';
import { social as socialApi } from '@/common/adapter/ipcBridge';
import styles from './Settings.module.css';

const SUPPORTED_PLATFORMS: Array<{ id: SocialPlatform; label: string }> = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X / Twitter' },
  { id: 'threads', label: 'Threads' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube Shorts' },
];

export interface SocialSettingsViewProps {
  accounts?: SocialAccount[];
  onAccountsChanged?: () => void;
  onSelectTab?: (tab: unknown) => void;
}

export const SocialSettingsView: React.FC<SocialSettingsViewProps> = ({
  accounts: externalAccounts,
  onAccountsChanged,
  onSelectTab,
}) => {
  const { t } = useTranslation();
  const [internalAccounts, setInternalAccounts] = useState<SocialAccount[]>([]);
  const accounts = externalAccounts ?? internalAccounts;

  useEffect(() => {
    if (externalAccounts) {
      setInternalAccounts(externalAccounts);
    }
  }, [externalAccounts]);

  const [stats, setStats] = useState<SocialStorageStats>({
    cacheSizeBytes: 0,
    cachedPostsCount: 0,
    cachedReelsCount: 0,
    cachedMediaFilesCount: 0,
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<SocialPlatform | null>(null);

  const loadData = useCallback(async () => {
    try {
      if (typeof socialApi?.listAccounts?.invoke === 'function') {
        const accs = await socialApi.listAccounts.invoke();
        setInternalAccounts(accs || []);
        onAccountsChanged?.();
      }
      if (typeof socialApi?.getStorageStats?.invoke === 'function') {
        const st = await socialApi.getStorageStats.invoke();
        if (st) setStats(st);
      }
    } catch {
      setActionError('Không thể tải dữ liệu Social từ ứng dụng.');
    }
  }, [onAccountsChanged]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTogglePermission = async (accountId: string, key: keyof SocialPermissions, value: boolean) => {
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) return;

    setActionError(null);
    const newPermissions = { ...acc.permissions, [key]: value };

    setInternalAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, permissions: newPermissions } : a)));

    try {
      if (typeof socialApi?.updatePermissions?.invoke === 'function') {
        await socialApi.updatePermissions.invoke({
          accountId,
          permissions: newPermissions,
        });
        onAccountsChanged?.();
      }
    } catch {
      setActionError('Không lưu được thay đổi quyền cho tài khoản này.');
      void loadData();
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    if (!window.confirm('Ngắt liên kết và xóa cookie, dữ liệu Social của tài khoản này?')) return;
    setActionError(null);
    try {
      if (typeof socialApi?.removeAccount?.invoke === 'function') {
        await socialApi.removeAccount.invoke({ accountId });
        await loadData();
      }
    } catch {
      setActionError('Không thể xóa tài khoản hoặc dữ liệu phiên đăng nhập.');
    }
  };

  const handleOpenLogin = async (accountId: string) => {
    try {
      if (typeof socialApi?.openLoginWindow?.invoke === 'function') {
        await socialApi.openLoginWindow.invoke({ accountId });
      }
    } catch (err) {
      console.error('[SocialSettings] Failed to open login window:', err);
      setActionError('Không mở được cửa sổ đăng nhập cô lập.');
    }
  };

  const handleConnectAccount = async (platform: SocialPlatform) => {
    if (connectingPlatform) return;
    setConnectingPlatform(platform);
    setActionError(null);
    try {
      if (typeof socialApi?.connectAccount?.invoke !== 'function') {
        throw new Error('SOCIAL_LOGIN_UNAVAILABLE');
      }
      // The Main process creates an isolated, persistent Web partition and opens the real provider site.
      // Neither website cookies nor OAuth tokens ever pass through this renderer.
      await socialApi.connectAccount.invoke({ platform });
      await loadData();
      if (platform === 'facebook') onSelectTab?.('web');
    } catch (err) {
      console.error('[SocialSettings] Failed to start Web session:', err);
      setActionError(t('guid.hubHome.socialWeb.connectError'));
    } finally {
      setConnectingPlatform(null);
    }
  };

  const handleClearCache = async () => {
    // Clear removes all cached posts and reels, including unseen items. Ask before destroying that queue.
    if (!window.confirm(t('guid.hubHome.socialWeb.cacheClearConfirm'))) return;
    setActionError(null);
    try {
      if (typeof socialApi?.clearCache?.invoke === 'function') {
        await socialApi.clearCache.invoke();
        await loadData();
      }
    } catch {
      setActionError('Không thể xóa bộ nhớ đệm Social.');
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.contentWrapper}>
        {actionError && (
          <div className={styles.card} role='alert'>
            {actionError}
          </div>
        )}
        {/* Accounts Management Section */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <header className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionTitle}>Tài khoản đã thêm ({accounts.length})</span>
              <div className={styles.sectionDesc}>{t('guid.hubHome.socialWeb.sessionHint')}</div>
            </div>
          </header>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {accounts.map((acc) => (
              <AccountCard
                key={acc.id}
                account={acc}
                onTogglePermission={handleTogglePermission}
                onRemove={handleRemoveAccount}
                onOpenLogin={handleOpenLogin}
              />
            ))}

            {accounts.length === 0 && (
              <div
                className={styles.card}
                style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-tertiary, #64748b)' }}
              >
                {t('guid.hubHome.socialWeb.empty')}
              </div>
            )}
          </div>

          {/* Add account row */}
          <div
            className={styles.card}
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary, #0a0b0d)' }}>
              {t('guid.hubHome.socialWeb.addTitle')}
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SUPPORTED_PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type='button'
                  className={styles.outlineButton}
                  onClick={() => void handleConnectAccount(p.id)}
                  disabled={connectingPlatform !== null}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Plus size={13} />
                  {connectingPlatform === p.id ? t('guid.hubHome.socialWeb.opening', { platform: p.label }) : p.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Storage Management Section */}
        <section>
          <StorageManager stats={stats} onClearCache={handleClearCache} />
        </section>
      </div>
    </div>
  );
};

export default SocialSettingsView;
