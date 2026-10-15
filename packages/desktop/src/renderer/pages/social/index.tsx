/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SocialHubHeader, type SocialTabId } from './SocialHubHeader';
import type { SocialAccount } from '@/common/types/social';
import { social as socialApi } from '@/common/adapter/ipcBridge';
import styles from './SocialHub.module.css';

// Lazy load tab components
const UnifiedFeedView = React.lazy(() => import('./feed/UnifiedFeedView'));
const ReelsPlayerView = React.lazy(() => import('./reels/ReelsPlayerView'));
const UnifiedMessengerView = React.lazy(() => import('./messages/UnifiedMessengerView'));
const SocialSettingsView = React.lazy(() => import('./settings/SocialSettingsView'));
const SocialWebView = React.lazy(() => import('./web/SocialWebView'));

export const SocialHubPage: React.FC = () => {
  const { t } = useTranslation();
  const accountRequestId = useRef(0);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState(false);
  const [activeTab, setActiveTab] = useState<SocialTabId>('feed');
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const loadAccounts = useCallback(async () => {
    const version = ++accountRequestId.current;
    setAccountsLoading(true);
    setAccountsError(false);
    try {
      if (typeof socialApi?.listAccounts?.invoke !== 'function') throw new Error('SOCIAL_ACCOUNT_SERVICE_UNAVAILABLE');
      const list = await socialApi.listAccounts.invoke();
      if (version !== accountRequestId.current) return;
      if (!Array.isArray(list)) throw new Error('SOCIAL_ACCOUNT_RESPONSE_INVALID');
      setAccounts(list);
      setActiveTab((current) =>
        current === 'feed' && list.some((item) => item.platform === 'facebook' && item.status !== 'connected')
          ? 'web'
          : current
      );
      setSelectedAccountId((current) => (current && !list.some((item) => item.id === current) ? null : current));
    } catch {
      if (version === accountRequestId.current) setAccountsError(true);
    } finally {
      if (version === accountRequestId.current) setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    return () => {
      accountRequestId.current += 1;
    };
  }, [loadAccounts]);

  const handleRefresh = useCallback(() => {
    setRefreshTick((value) => value + 1);
  }, []);

  return (
    <div className={styles.container}>
      <SocialHubHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={handleRefresh}
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelectAccount={setSelectedAccountId}
      />

      <main className={styles.contentArea}>
        {accountsError && (
          <div role='alert'>
            {t('guid.hubHome.socialWeb.accountsError')}
            <button type='button' onClick={() => void loadAccounts()}>
              {t('guid.hubHome.socialWeb.accountsRetry')}
            </button>
          </div>
        )}
        {accountsLoading && accounts.length === 0 && (
          <div role='status'>{t('guid.hubHome.socialWeb.accountsLoading')}</div>
        )}
        {!accountsLoading && (!accountsError || accounts.length > 0) && (
          <React.Suspense
            fallback={<div style={{ padding: '24px', textAlign: 'center', opacity: 0.5 }}>Đang tải...</div>}
          >
            {activeTab === 'feed' && (
              <UnifiedFeedView
                selectedAccountId={selectedAccountId}
                refreshKey={refreshTick}
                accounts={accounts}
                onOpenSettings={() => setActiveTab('settings')}
              />
            )}
            {activeTab === 'reels' && (
              <ReelsPlayerView selectedAccountId={selectedAccountId} refreshKey={refreshTick} />
            )}
            {activeTab === 'messages' && (
              <UnifiedMessengerView selectedAccountId={selectedAccountId} refreshKey={refreshTick} />
            )}
            {activeTab === 'web' && (
              <SocialWebView
                accounts={accounts}
                selectedAccountId={selectedAccountId}
                refreshKey={refreshTick}
                onOpenSettings={() => setActiveTab('settings')}
              />
            )}
            {activeTab === 'settings' && (
              <SocialSettingsView accounts={accounts} onAccountsChanged={loadAccounts} onSelectTab={setActiveTab} />
            )}
          </React.Suspense>
        )}
      </main>
    </div>
  );
};

export default SocialHubPage;
