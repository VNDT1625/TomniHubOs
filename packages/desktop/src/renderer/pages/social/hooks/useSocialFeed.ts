/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SocialPlatform, UnifiedPost } from '@/common/types/social';
import { social as socialApi } from '@/common/adapter/ipcBridge';

export type UseSocialFeedOptions = {
  selectedAccountId?: string | null;
  selectedPlatform?: 'all' | SocialPlatform;
  refreshKey?: number;
};

const PAGE_SIZE = 20;

export function useSocialFeed({ selectedAccountId, selectedPlatform = 'all', refreshKey = 0 }: UseSocialFeedOptions) {
  const [posts, setPosts] = useState<UnifiedPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());
  const markedIds = useRef(new Set<string>());
  const requestVersion = useRef(0);
  const offset = useRef(0);
  const fetching = useRef(false);
  const lastScope = useRef<string | null>(null);

  const fetchPosts = useCallback(
    async (reset = false) => {
      if (fetching.current && !reset) return;
      const beforeReset = reset ? { offset: offset.current, seen: seenIds.current, marked: markedIds.current } : null;
      if (reset) {
        requestVersion.current += 1;
        offset.current = 0;
        seenIds.current = new Set();
        markedIds.current = new Set();
        // Preserve visible cached posts until the replacement page succeeds.
        // Account/platform switches clear previous data in the scoped effect below.
      }
      const version = requestVersion.current;
      fetching.current = true;
      setLoading(true);
      try {
        const batch = await socialApi.getFeedQueue.invoke({
          accountId: selectedAccountId || undefined,
          platform:
            selectedPlatform === 'all' ? undefined : (selectedPlatform as 'facebook' | 'x' | 'reddit' | 'threads'),
          limit: PAGE_SIZE,
          offset: offset.current,
        });
        if (version !== requestVersion.current) return;
        const entries = batch ?? [];
        offset.current += entries.length;
        setHasMore(entries.length === PAGE_SIZE);
        const unique = entries.filter((post) => {
          if (seenIds.current.has(post.id)) return false;
          seenIds.current.add(post.id);
          return true;
        });
        setPosts((previous) => (reset ? unique : [...previous, ...unique]));
        setError(null);
      } catch {
        if (version === requestVersion.current) {
          if (beforeReset) {
            offset.current = beforeReset.offset;
            seenIds.current = beforeReset.seen;
            markedIds.current = beforeReset.marked;
          }
          setError('Không thể đọc bộ nhớ đệm Social. Hãy kiểm tra dịch vụ Social và thử lại.');
        }
      } finally {
        if (version === requestVersion.current) {
          setLoading(false);
          fetching.current = false;
        }
      }
    },
    [selectedAccountId, selectedPlatform]
  );

  useEffect(() => {
    // Changing account must hide the previous account's cached data immediately,
    // even when the network refresh is still pending.
    const scope = `${selectedAccountId ?? 'all'}|${selectedPlatform}`;
    const scopeChanged = lastScope.current !== scope;
    lastScope.current = scope;
    requestVersion.current += 1;
    fetching.current = false;
    if (scopeChanged) {
      offset.current = 0;
      seenIds.current.clear();
      markedIds.current.clear();
      setPosts([]);
      setHasMore(true);
    }
    setError(null);
    let cancelled = false;
    const load = async () => {
      let syncFailed = false;
      if (refreshKey > 0) {
        try {
          await socialApi.refreshFeed.invoke({ accountId: selectedAccountId || undefined });
        } catch {
          syncFailed = true;
        }
      }
      if (!cancelled) {
        await fetchPosts(true);
        if (!cancelled && syncFailed)
          setError('Chưa thể đồng bộ bài mới: phiên đăng nhập hoặc connector mạng xã hội chưa sẵn sàng.');
      }
    };
    void load();
    return () => {
      cancelled = true;
      requestVersion.current += 1;
    };
  }, [selectedAccountId, refreshKey, fetchPosts]);

  const markViewed = useCallback(async (postId: string) => {
    if (markedIds.current.has(postId)) return;
    markedIds.current.add(postId);
    const version = requestVersion.current;
    try {
      await socialApi.markPostViewed.invoke({ postId });
      if (version !== requestVersion.current) return;
      setPosts((previous) => previous.map((post) => (post.id === postId ? { ...post, isViewed: true } : post)));
      // The server pages only unseen records; a viewed item no longer occupies
      // an offset in the next page. Only adjust the same account's queue once.
      offset.current = Math.max(0, offset.current - 1);
    } catch {
      markedIds.current.delete(postId);
      if (version === requestVersion.current) setError('Không thể lưu trạng thái đã xem của bài viết.');
    }
  }, []);

  return {
    posts,
    loading,
    error,
    hasMore,
    fetchNextBatch: () => fetchPosts(false),
    refresh: () => fetchPosts(true),
    markViewed,
  };
}
