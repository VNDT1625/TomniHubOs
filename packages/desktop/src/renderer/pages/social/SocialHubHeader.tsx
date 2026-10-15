/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Newspaper, Clapperboard, MessageSquare, Settings, RefreshCw, Globe2 } from 'lucide-react';
import type { SocialAccount } from '@/common/types/social';
import styles from './SocialHub.module.css';

export type SocialTabId = 'feed' | 'reels' | 'messages' | 'web' | 'settings';

export interface SocialHubHeaderProps {
  activeTab: SocialTabId;
  onTabChange: (tab: SocialTabId) => void;
  onRefresh: () => void;
  accounts: SocialAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string | null) => void;
  unreadCount?: number;
}

export const SocialHubHeader: React.FC<SocialHubHeaderProps> = ({
  activeTab,
  onTabChange,
  onRefresh,
  accounts,
  selectedAccountId,
  onSelectAccount,
  unreadCount = 0,
}) => {
  const { t } = useTranslation();
  return (
    <header className={styles.header}>
      <nav className={styles.tabGroup} aria-label='Social Navigation'>
        <button
          type='button'
          className={`${styles.tabButton} ${activeTab === 'feed' ? styles.tabButtonActive : ''}`}
          onClick={() => onTabChange('feed')}
          onDoubleClick={() => onRefresh()}
          title='Nhấp đúp để làm mới bảng tin'
        >
          <Newspaper size={17} strokeWidth={2} />
          <span>Bảng tin</span>
        </button>

        <button
          type='button'
          className={`${styles.tabButton} ${activeTab === 'reels' ? styles.tabButtonActive : ''}`}
          onClick={() => onTabChange('reels')}
          onDoubleClick={() => onRefresh()}
          title='Nhấp đúp để tải video Reels mới'
        >
          <Clapperboard size={17} strokeWidth={2} />
          <span>Reels</span>
        </button>

        <button
          type='button'
          className={`${styles.tabButton} ${activeTab === 'messages' ? styles.tabButtonActive : ''}`}
          onClick={() => onTabChange('messages')}
        >
          <MessageSquare size={17} strokeWidth={2} />
          <span>Tin nhắn</span>
          {unreadCount > 0 && (
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '10px',
                backgroundColor: 'var(--text-primary, #000)',
                color: 'var(--bg-1, #fff)',
                fontWeight: 600,
                marginLeft: '4px',
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>

        <button
          type='button'
          className={`${styles.tabButton} ${activeTab === 'web' ? styles.tabButtonActive : ''}`}
          onClick={() => onTabChange('web')}
                    title={t('guid.hubHome.socialWeb.browserHint')}
        >
          <Globe2 size={17} strokeWidth={2} />
                    <span>{t('guid.hubHome.socialWeb.browserNav')}</span>
        </button>
        <button
          type='button'
          className={`${styles.tabButton} ${activeTab === 'settings' ? styles.tabButtonActive : ''}`}
          onClick={() => onTabChange('settings')}
        >
          <Settings size={17} strokeWidth={2} />
          <span>Cài đặt</span>
        </button>
      </nav>

      <div className={styles.headerActions}>
        <select
          className={styles.accountSelect}
          value={selectedAccountId || ''}
          onChange={(e) => onSelectAccount(e.target.value || null)}
          aria-label='Lọc theo tài khoản'
        >
          <option value=''>Tất cả tài khoản ({accounts.length})</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.platform.toUpperCase()}: {acc.username ? `@${acc.username}` : acc.displayName}
            </option>
          ))}
        </select>

        <button type='button' className={styles.refreshButton} onClick={onRefresh} title='Làm mới nội dung (↻)'>
          <RefreshCw size={15} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
};
