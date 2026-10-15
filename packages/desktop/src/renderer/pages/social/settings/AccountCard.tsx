/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SocialAccount, SocialPermissions } from '@/common/types/social';
import styles from './Settings.module.css';

export interface AccountCardProps {
  account: SocialAccount;
  onTogglePermission: (accountId: string, key: keyof SocialPermissions, value: boolean) => void;
  onRemove: (accountId: string) => void;
  onOpenLogin?: (accountId: string) => void;
}

export const AccountCard: React.FC<AccountCardProps> = ({ account, onTogglePermission, onRemove, onOpenLogin }) => {
  const { t } = useTranslation();
  const authorInitial = account.displayName.trim().charAt(0).toUpperCase() || 'U';

  return (
    <div className={styles.card}>
      <header className={styles.accountHeader}>
        <div className={styles.accountInfo}>
          <div className={styles.avatar}>
            {account.avatarUrl ? (
              <img src={account.avatarUrl} alt={account.displayName} style={{ width: '100%', height: '100%' }} />
            ) : (
              authorInitial
            )}
          </div>
          <div className={styles.accountMeta}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className={styles.displayName}>{account.displayName}</span>
              <span className={styles.platformBadge}>{account.platform.toUpperCase()}</span>
            </div>
                        <span className={styles.username}>
              {account.username ? `@${account.username}` : t('guid.hubHome.socialWeb.webOnly')}
            </span>
            <span className={styles.username} role='status'>
                            {account.status === 'connected' ? t('guid.hubHome.socialWeb.apiVerified') : t('guid.hubHome.socialWeb.apiUnverified')}
            </span>
          </div>
        </div>
      </header>

      <div className={styles.permissionsSection}>
        <div className={styles.permissionToggleRow}>
          <label className={styles.toggleLabel}>
            <input
              type='checkbox'
              checked={account.permissions.canSyncFeed}
              onChange={(e) => onTogglePermission(account.id, 'canSyncFeed', e.target.checked)}
            />
            <span>Đồng bộ bảng tin</span>
          </label>
        </div>
        <span className={styles.toggleDesc}>Cho phép đọc bài viết từ tài khoản này.</span>
        <div className={styles.permissionToggleRow}>
          <label className={styles.toggleLabel}>
            <input
              type='checkbox'
              checked={account.permissions.canSyncReels}
              onChange={(e) => onTogglePermission(account.id, 'canSyncReels', e.target.checked)}
            />
            <span>Đồng bộ Reels</span>
          </label>
        </div>

        <div className={styles.permissionToggleRow} style={{ marginTop: 6 }}>
          <label className={styles.toggleLabel}>
            <input
              type='checkbox'
              checked={account.permissions.canReadMessages}
              onChange={(e) => onTogglePermission(account.id, 'canReadMessages', e.target.checked)}
            />
            <span>Tin nhắn & Hộp thư</span>
          </label>
        </div>
        <span className={styles.toggleDesc}>Cho phép đọc hội thoại của tài khoản này.</span>
        <div className={styles.permissionToggleRow}>
          <label className={styles.toggleLabel}>
            <input
              type='checkbox'
              checked={account.permissions.canSendMessages}
              onChange={(e) => onTogglePermission(account.id, 'canSendMessages', e.target.checked)}
            />
            <span>Gửi tin nhắn</span>
          </label>
        </div>
      </div>

      <footer className={styles.accountActions} style={{ gap: 8 }}>
        {onOpenLogin && (
          <button
            type='button'
            className={styles.outlineButton}
            onClick={() => onOpenLogin(account.id)}
                          title={t('guid.hubHome.socialWeb.reopenHint')}
          >
                                    {t('guid.hubHome.socialWeb.reopen')}
          </button>
        )}
        <button
          type='button'
          className={styles.outlineButton}
          onClick={() => onRemove(account.id)}
          aria-label='Đăng xuất'
        >
          Đăng xuất
        </button>
      </footer>
    </div>
  );
};
