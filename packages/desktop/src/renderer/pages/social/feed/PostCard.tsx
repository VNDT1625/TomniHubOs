/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { Heart, MessageSquare, ExternalLink } from 'lucide-react';
import type { UnifiedPost } from '@/common/types/social';
import styles from './Feed.module.css';
import { openSocialPermalink } from '../openSocialPermalink';

export interface PostCardProps {
  post: UnifiedPost;
  onLike?: (postId: string) => void;
  onComment?: (postId: string) => void;
  onMarkViewed?: (postId: string) => void;
}

export const PostCard: React.FC<PostCardProps> = ({ post, onLike, onComment, onMarkViewed }) => {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (post.isViewed || !onMarkViewed) return;

    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let visibleRatio = 0;
    const clearViewTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    let observer: IntersectionObserver;
    const startViewTimer = () => {
      if (visibleRatio < 0.6 || document.visibilityState !== 'visible' || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (visibleRatio < 0.6 || document.visibilityState !== 'visible' || !el.isConnected) return;
        onMarkViewed(post.id);
        observer.disconnect();
      }, 2000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') clearViewTimer();
      else startViewTimer();
    };
    observer = new IntersectionObserver(
      ([entry]) => {
        visibleRatio = entry.isIntersecting ? entry.intersectionRatio : 0;
        if (visibleRatio >= 0.6) startViewTimer();
        else clearViewTimer();
      },
      { threshold: [0, 0.6, 1] }
    );

    observer.observe(el);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearViewTimer();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [post.id, post.isViewed, onMarkViewed]);

  const authorInitial = post.author.name.trim().charAt(0).toUpperCase() || 'U';

  const timeString = new Date(post.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <article className={styles.card} ref={cardRef}>
      <header className={styles.cardHeader}>
        <div className={styles.authorSection}>
          <div className={styles.avatar}>
            {post.author.avatarUrl ? (
              <img src={post.author.avatarUrl} alt={post.author.name} style={{ width: '100%', height: '100%' }} />
            ) : (
              authorInitial
            )}
          </div>
          <div className={styles.authorMeta}>
            <div className={styles.authorNameRow}>
              <span className={styles.authorName}>{post.author.name}</span>
              <span className={styles.authorHandle}>@{post.author.handle}</span>
            </div>
            <span className={styles.postTime}>{timeString}</span>
          </div>
        </div>

        <span className={styles.platformBadge}>{post.platform}</span>
      </header>

      <div className={styles.cardBody}>
        <p style={{ margin: 0 }}>{post.content}</p>
      </div>

      {post.media && post.media.length > 0 && (
        <div className={styles.mediaContainer}>
          {post.media[0].type === 'image' && (
            <img src={post.media[0].url} alt='Ảnh đính kèm' className={styles.mediaImage} loading='lazy' />
          )}
        </div>
      )}

      <footer className={styles.cardFooter}>
        <div className={styles.statsRow}>
          <span>{post.stats.likesCount} lượt thích</span>
          <span>{post.stats.commentsCount} bình luận</span>
        </div>

        <div className={styles.actionsRow}>
          <button
            type='button'
            className={`${styles.actionButton} ${post.userState.hasLiked ? styles.actionButtonActive : ''}`}
            onClick={() => onLike?.(post.id)}
            disabled={!onLike}
            aria-label='Thích'
          >
            <Heart size={16} fill={post.userState.hasLiked ? 'currentColor' : 'none'} />
            <span>Thích</span>
          </button>

          <button
            type='button'
            className={styles.actionButton}
            onClick={() => onComment?.(post.id)}
            disabled={!onComment}
            aria-label='Bình luận'
          >
            <MessageSquare size={16} />
            <span>Bình luận</span>
          </button>

          <button
            type='button'
            className={styles.actionButton}
            onClick={() => {
              if (post.permalink && typeof window !== 'undefined') {
                openSocialPermalink(post.permalink);
              }
            }}
            aria-label='Mở link gốc'
          >
            <ExternalLink size={16} />
            <span>Mở gốc</span>
          </button>
        </div>
      </footer>
    </article>
  );
};
