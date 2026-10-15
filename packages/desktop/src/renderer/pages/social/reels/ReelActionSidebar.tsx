/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Heart, MessageSquare, Volume2, VolumeX, ExternalLink } from 'lucide-react';
import type { UnifiedReel } from '@/common/types/social';
import styles from './Reels.module.css';
import { openSocialPermalink } from '../openSocialPermalink';

export interface ReelActionSidebarProps {
  reel: UnifiedReel;
  isMuted: boolean;
  onLike: (reelId: string) => void;
  onToggleComments: () => void;
  onToggleMute: () => void;
}

function formatCount(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return num.toString();
}

export const ReelActionSidebar: React.FC<ReelActionSidebarProps> = ({
  reel,
  isMuted,
  onLike,
  onToggleComments,
  onToggleMute,
}) => {
  return (
    <aside className={styles.actionSidebar}>
      {/* Like Button */}
      <div className={styles.actionItem}>
        <button
          type='button'
          className={`${styles.actionButton} ${reel.userState.hasLiked ? styles.actionButtonActive : ''}`}
          onClick={() => onLike(reel.id)}
          title='Thích trên nền tảng gốc'
          aria-label='Thích'
        >
          <Heart size={20} fill={reel.userState.hasLiked ? 'currentColor' : 'none'} />
        </button>
        <span className={styles.actionLabel}>{formatCount(reel.stats.likesCount)}</span>
      </div>

      {/* Comments Button */}
      <div className={styles.actionItem}>
        <button type='button' className={styles.actionButton} onClick={onToggleComments} aria-label='Bình luận'>
          <MessageSquare size={20} />
        </button>
        <span className={styles.actionLabel}>{formatCount(reel.stats.commentsCount)}</span>
      </div>

      {/* Audio Mute/Unmute Button */}
      <div className={styles.actionItem}>
        <button type='button' className={styles.actionButton} onClick={onToggleMute} aria-label='Âm thanh'>
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <span className={styles.actionLabel}>{isMuted ? 'Tắt' : 'Bật'}</span>
      </div>

      {/* Open Permalink */}
      <div className={styles.actionItem}>
        <button
          type='button'
          className={styles.actionButton}
          onClick={() => {
            if (reel.permalink && typeof window !== 'undefined') {
              openSocialPermalink(reel.permalink);
            }
          }}
          aria-label='Mở link gốc'
        >
          <ExternalLink size={20} />
        </button>
        <span className={styles.actionLabel}>Gốc</span>
      </div>
    </aside>
  );
};
