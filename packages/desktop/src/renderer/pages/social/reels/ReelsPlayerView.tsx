/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { useReelsQueue } from '../hooks/useReelsQueue';
import { ReelActionSidebar } from './ReelActionSidebar';
import { ReelCommentsDrawer } from './ReelCommentsDrawer';
import styles from './Reels.module.css';
import { openSocialPermalink } from '../openSocialPermalink';

export interface ReelsPlayerViewProps {
  selectedAccountId?: string | null;
  refreshKey?: number;
}

export const ReelsPlayerView: React.FC<ReelsPlayerViewProps> = ({ selectedAccountId, refreshKey }) => {
  const { t } = useTranslation();
  const [failedVideos, setFailedVideos] = useState<Set<string>>(new Set());
  const markVideoFailed = (id: string) =>
    setFailedVideos((current) => (current.has(id) ? current : new Set(current).add(id)));
  const {
    reels,
    activeIndex,
    setActiveIndex,
    isPlaying,
    isMuted,
    loading,
    error,
    togglePlay,
    toggleMute,
    nextReel,
    prevReel,
  } = useReelsQueue({
    selectedAccountId,
    refreshKey,
  });

  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Never steal arrow/space keys from editable content or buttons.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLButtonElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable || e.target.closest('[contenteditable="true"], [role="textbox"]') !== null))
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        nextReel();
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        prevReel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleMute, nextReel, prevReel]);

  // Hidden routes/windows must not continue playing audio in the background.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        videoRefs.current.forEach((video) => video?.pause());
      } else if (isPlaying) {
        const active = videoRefs.current[activeIndex];
        if (active) void active.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [activeIndex, isPlaying]);

  useEffect(() => {
    const refs = videoRefs;
    return () => {
      refs.current.forEach((video) => {
        if (!video) return;
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
      refs.current = [];
    };
  }, []);

  // Handle play/pause on active video
  useEffect(() => {
    videoRefs.current.forEach((videoEl, idx) => {
      if (!videoEl) return;
      if (idx === activeIndex) {
        videoEl.muted = isMuted;
        if (isPlaying && document.visibilityState === 'visible') {
          void videoEl.play().catch(() => {});
        } else {
          videoEl.pause();
        }
      } else {
        videoEl.pause();
        videoEl.currentTime = 0;
      }
    });
  }, [activeIndex, isPlaying, isMuted]);

  // Handle scroll snap detection
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const height = el.clientHeight;
    if (height > 0) {
      const newIndex = Math.round(el.scrollTop / height);
      if (newIndex !== activeIndex && newIndex >= 0 && newIndex < reels.length) {
        setActiveIndex(newIndex);
      }
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTo({ top: activeIndex * container.clientHeight, behavior: 'smooth' });
    }
  }, [activeIndex]);

  const currentReel = reels[activeIndex] || null;

  return (
    <div className={styles.container}>
      <div className={styles.feedSnap} ref={containerRef} onScroll={handleScroll}>
        {reels.map((reel, index) => {
          const isActive = index === activeIndex;
          const authorInitial = reel.author.name.trim().charAt(0).toUpperCase() || 'U';

          return (
            <section key={reel.id} className={styles.reelSection}>
              {Math.abs(index - activeIndex) <= 1 ? (
                <div className={styles.videoWrapper} onClick={togglePlay}>
                  <video
                    ref={(el) => {
                      videoRefs.current[index] = el;
                    }}
                    src={reel.videoStreamUrl}
                    poster={reel.thumbnailUrl}
                    className={styles.videoElement}
                    onError={() => markVideoFailed(reel.id)}
                    loop
                    playsInline
                    muted={isMuted}
                  />

                  {isActive && (failedVideos.has(reel.id) || !reel.videoStreamUrl) && (
                    <div className={styles.videoError} role='alert' onClick={(event) => event.stopPropagation()}>
                      <p>{t('guid.hubHome.socialWeb.reelPlaybackError')}</p>
                      <button type='button' onClick={nextReel}>
                        {t('guid.hubHome.socialWeb.reelSkip')}
                      </button>
                      <button type='button' onClick={() => openSocialPermalink(reel.permalink)}>
                        {t('guid.hubHome.socialWeb.reelOpenOriginal')}
                      </button>
                    </div>
                  )}

                  {/* Show play/pause indicator if paused on active reel */}
                  {isActive && !isPlaying && (
                    <div className={styles.centerIndicator}>
                      <Play size={32} />
                    </div>
                  )}

                  {/* Video Info Overlay */}
                  <div className={styles.videoOverlay}>
                    <div className={styles.authorRow}>
                      <div className={styles.authorAvatar}>
                        {reel.author.avatarUrl ? (
                          <img
                            src={reel.author.avatarUrl}
                            alt={reel.author.name}
                            style={{ width: '100%', height: '100%' }}
                          />
                        ) : (
                          authorInitial
                        )}
                      </div>
                      <div className={styles.authorInfo}>
                        <span className={styles.authorName}>{reel.author.name}</span>
                        <span className={styles.authorHandle}>@{reel.author.handle}</span>
                      </div>
                    </div>

                    <p className={styles.caption}>{reel.caption}</p>
                    <span className={styles.platformPill}>{reel.platform}</span>
                  </div>

                  {/* Sidebar on the right inside video wrapper */}
                  {isActive && (
                    <ReelActionSidebar
                      reel={reel}
                      isMuted={isMuted}
                      onLike={() => openSocialPermalink(reel.permalink)}
                      onToggleComments={() => setIsCommentsOpen((prev) => !prev)}
                      onToggleMute={toggleMute}
                    />
                  )}
                </div>
              ) : (
                <div className={styles.videoWrapper} aria-hidden='true' />
              )}
            </section>
          );
        })}

        {error && (
          <div className={styles.emptyState} role='alert'>
            {error}
          </div>
        )}
        {reels.length === 0 && !loading && !error && (
          <div className={styles.emptyState}>
            <span>Chưa có video ngắn nào trong hàng đợi.</span>
            <span>Bấm vào tab Reels hai lần để làm mới.</span>
          </div>
        )}
      </div>

      {/* Slide-out comments drawer */}
      {currentReel && (
        <ReelCommentsDrawer
          isOpen={isCommentsOpen}
          permalink={currentReel.permalink}
          onClose={() => setIsCommentsOpen(false)}
        />
      )}
    </div>
  );
};

export default ReelsPlayerView;
