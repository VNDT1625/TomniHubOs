/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import type { SocialStorageStats } from '@/common/types/social';
import styles from './Settings.module.css';

export interface StorageManagerProps {
  stats: SocialStorageStats;
  onClearCache: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0.00 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

export const StorageManager: React.FC<StorageManagerProps> = ({
  stats,
  onClearCache,
}) => {
  const { t } = useTranslation();
  return (
    <div className={styles.card}>
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.sectionTitle}>Quản lý Lưu trữ & Bộ nhớ Cache</span>
          <div className={styles.sectionDesc}>
                        {t('guid.hubHome.socialWeb.cacheDescription')}
          </div>
        </div>
      </header>

      <div className={styles.statsGrid}>
        <div className={styles.statBox}>
          <span className={styles.statValue}>{formatBytes(stats.cacheSizeBytes)}</span>
          <span className={styles.statLabel}>{t('guid.hubHome.socialWeb.cacheMetadataSize')}</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statValue}>{stats.cachedPostsCount}</span>
          <span className={styles.statLabel}>Bài viết trong cache</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statValue}>{stats.cachedReelsCount}</span>
          <span className={styles.statLabel}>Reels / Shorts</span>
        </div>
      </div>

      <footer className={styles.accountActions}>
        <button
          type="button"
          className={styles.outlineButton}
          onClick={onClearCache}
          aria-label={t('guid.hubHome.socialWeb.cacheClear')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Trash2 size={15} />
                    {t('guid.hubHome.socialWeb.cacheClear')}
        </button>
      </footer>
    </div>
  );
};
