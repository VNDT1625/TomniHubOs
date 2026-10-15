/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UnifiedReel } from '@/common/types/social';
import { social as socialApi } from '@/common/adapter/ipcBridge';

export type UseReelsQueueOptions = {
  selectedAccountId?: string | null;
  refreshKey?: number;
};

const PAGE_SIZE = 10;

export function useReelsQueue({ selectedAccountId, refreshKey = 0 }: UseReelsQueueOptions) {
  const [reels, setReels] = useState<UnifiedReel[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  );
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetching = useRef(false);
  const requestVersion = useRef(0);
  const nextOffset = useRef(0);
  const loaded = useRef(new Set<string>());
  const marked = useRef(new Set<string>());
  const activeReelRef = useRef<UnifiedReel | null>(null);
  const lastAccountId = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const check = () => setIsPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  const fetchReels = useCallback(
    async (reset = false) => {
      if (fetching.current && !reset) return;
      const beforeReset = reset ? { offset: nextOffset.current, loaded: loaded.current, marked: marked.current } : null;
      if (reset) {
        requestVersion.current += 1;
        nextOffset.current = 0;
        loaded.current = new Set();
        marked.current = new Set();
        // Keep the current cached reel playing until a replacement page succeeds.
        // Account changes clear this view in the scoped effect.
      }
      const version = requestVersion.current;
      fetching.current = true;
      setLoading(true);
      try {
        const batch = await socialApi.getReelsQueue.invoke({
          accountId: selectedAccountId || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset.current,
        });
        if (version !== requestVersion.current) return;
        const entries = batch ?? [];
        nextOffset.current += entries.length;
        setHasMore(entries.length === PAGE_SIZE);
        const unique = entries.filter((reel) => {
          if (loaded.current.has(reel.id)) return false;
          loaded.current.add(reel.id);
          return true;
        });
        setReels((previous) => (reset ? unique : [...previous, ...unique]));
        if (reset) setActiveIndex(0);
        setError(null);
      } catch {
        if (version === requestVersion.current) {
          if (beforeReset) {
            nextOffset.current = beforeReset.offset;
            loaded.current = beforeReset.loaded;
            marked.current = beforeReset.marked;
          }
          setError('Không thể tải hàng đợi Reels từ bộ nhớ đệm Social.');
        }
      } finally {
        if (version === requestVersion.current) {
          fetching.current = false;
          setLoading(false);
        }
      }
    },
    [selectedAccountId]
  );

  useEffect(() => {
    const account = selectedAccountId ?? 'all';
    const accountChanged = lastAccountId.current !== account;
    lastAccountId.current = account;
    requestVersion.current += 1;
    fetching.current = false;
    if (accountChanged) {
      nextOffset.current = 0;
      loaded.current.clear();
      marked.current.clear();
      activeReelRef.current = null;
      setReels([]);
      setActiveIndex(0);
      setHasMore(true);
    }
    setError(null);
    let cancelled = false;
    const load = async () => {
      let syncFailed = false;
      if (refreshKey > 0) {
        try {
          await socialApi.refreshReels.invoke({ accountId: selectedAccountId || undefined });
        } catch {
          syncFailed = true;
        }
      }
      if (!cancelled) {
        await fetchReels(true);
        if (!cancelled && syncFailed)
          setError('Không thể đồng bộ Reels mới: phiên đăng nhập hoặc connector chưa sẵn sàng.');
      }
    };
    void load();
    return () => {
      cancelled = true;
      requestVersion.current += 1;
    };
  }, [selectedAccountId, refreshKey, fetchReels]);

  useEffect(() => {
    if (reels.length > 0 && reels.length - activeIndex <= 4 && hasMore && !loading) {
      void fetchReels();
    }
  }, [reels.length, activeIndex, hasMore, loading, fetchReels]);

  const markViewed = useCallback(async (reel: UnifiedReel) => {
    if (reel.isViewed || marked.current.has(reel.id)) return;
    marked.current.add(reel.id);
    const version = requestVersion.current;
    try {
      await socialApi.markReelViewed.invoke({ reelId: reel.id });
      if (version !== requestVersion.current) return;
      setReels((previous) => previous.map((item) => (item.id === reel.id ? { ...item, isViewed: true } : item)));
      nextOffset.current = Math.max(0, nextOffset.current - 1);
    } catch {
      marked.current.delete(reel.id);
      if (version === requestVersion.current) setError('Không thể lưu trạng thái xem Reels.');
    }
  }, []);

  useEffect(() => {
    const current = reels[activeIndex] ?? null;
    const previous = activeReelRef.current;
    if (previous && previous.id !== current?.id) {
      void markViewed(previous);
    }
    activeReelRef.current = current;
    if (!current || current.isViewed || !isPlaying || !isPageVisible) return;

    const timer = setTimeout(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void markViewed(current);
    }, 3000);
    return () => clearTimeout(timer);
  }, [activeIndex, reels, isPlaying, isPageVisible, markViewed]);

  const togglePlay = useCallback(() => setIsPlaying((playing) => !playing), []);
  const toggleMute = useCallback(() => setIsMuted((muted) => !muted), []);
  const nextReel = useCallback(() => {
    setActiveIndex((index) => Math.min(index + 1, Math.max(0, reels.length - 1)));
    setIsPlaying(true);
  }, [reels.length]);
  const prevReel = useCallback(() => {
    setActiveIndex((index) => Math.max(index - 1, 0));
    setIsPlaying(true);
  }, []);

  return {
    reels,
    activeIndex,
    setActiveIndex,
    currentReel: reels[activeIndex] ?? null,
    isPlaying,
    isMuted,
    loading,
    error,
    hasMore,
    togglePlay,
    toggleMute,
    nextReel,
    prevReel,
    refresh: () => fetchReels(true),
  };
}
