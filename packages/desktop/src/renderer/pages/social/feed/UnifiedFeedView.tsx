/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedFilterPills } from './FeedFilterPills';
import { PostCard } from './PostCard';
import { useSocialFeed } from '../hooks/useSocialFeed';
import type { SocialAccount, SocialPlatform } from '@/common/types/social';
import { social as socialApi } from '@/common/adapter/ipcBridge';
import styles from './Feed.module.css';
import { openSocialPermalink } from '../openSocialPermalink';

export interface UnifiedFeedViewProps {
  selectedAccountId?: string | null;
    refreshKey?: number;
  accounts?: SocialAccount[];
  onOpenSettings?: () => void;
}

export const UnifiedFeedView: React.FC<UnifiedFeedViewProps> = ({ selectedAccountId, refreshKey, accounts = [], onOpenSettings }) => {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<'all' | SocialPlatform>('all');
  const [webOpenError, setWebOpenError] = useState(false);
  const visibleAccounts = accounts.filter(
    (account) =>
      (!selectedAccountId || account.id === selectedAccountId) &&
      (platform === 'all' || account.platform === platform)
  );
  const webOnly = visibleAccounts.length > 0 && visibleAccounts.every((account) => account.status !== 'connected');
  const openWebSession = async (accountId: string) => {
    setWebOpenError(false);
    try {
      await socialApi.openLoginWindow.invoke({ accountId });
    } catch {
      setWebOpenError(true);
    }
  };

  const { posts, loading, hasMore, fetchNextBatch, markViewed, error } = useSocialFeed({
    selectedAccountId,
    selectedPlatform: platform,
    refreshKey,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingTriggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = loadingTriggerRef.current;
    if (!node || !hasMore || loading || posts.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fetchNextBatch();
      },
      { root: scrollRef.current, rootMargin: '0px 0px 700px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, posts.length, fetchNextBatch]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [refreshKey]);

  return (
    <div className={styles.feedContainer} ref={scrollRef}>
      <div className={styles.feedContent}>
        <FeedFilterPills selectedPlatform={platform} onSelectPlatform={setPlatform} />

        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onLike={() => openSocialPermalink(post.permalink)}
            onComment={() => openSocialPermalink(post.permalink)}
            onMarkViewed={markViewed}
          />
        ))}

        {error && (
          <div className={styles.emptyNotice} role='alert'>
            {error}
          </div>
        )}

                {posts.length === 0 && !loading && !error && (
          <div className={styles.emptyNotice} role='status'>
            <p>
              {webOnly
                ? t('guid.hubHome.socialWeb.feedUnavailable')
                : visibleAccounts.length === 0
                  ? t('guid.hubHome.socialWeb.empty')
                  : t('guid.hubHome.socialWeb.feedEmpty')}
            </p>
            {visibleAccounts.slice(0, 8).map((account) => (
              <button
                key={account.id}
                type='button'
                className={styles.pillButton}
                onClick={() => void openWebSession(account.id)}
              >
                {t('guid.hubHome.socialWeb.reopen')}: {account.displayName}
              </button>
            ))}
            {visibleAccounts.length === 0 && onOpenSettings && (
              <button type='button' className={styles.pillButton} onClick={onOpenSettings}>
                {t('guid.hubHome.shell.nav.settings')}
              </button>
            )}
            {webOpenError && <p role='alert'>{t('guid.hubHome.socialWeb.feedOpenFailed')}</p>}
          </div>
        )}

        {hasMore && posts.length > 0 && (
          <div ref={loadingTriggerRef} style={{ textAlign: 'center', padding: '16px' }}>
            <button
              type='button'
              className={styles.pillButton}
              onClick={fetchNextBatch}
              disabled={loading}
              style={{ margin: '0 auto' }}
            >
              {loading ? 'Đang tải thêm...' : 'Tải thêm bài viết'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UnifiedFeedView;
