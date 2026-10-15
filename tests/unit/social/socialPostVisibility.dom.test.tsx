import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostCard } from '@/renderer/pages/social/feed/PostCard';
import type { UnifiedPost } from '@/common/types/social';

const post: UnifiedPost = {
  id: 'post-1', platform: 'reddit', accountId: 'account-1', originPostId: 'p1',
  author: { name: 'Author', handle: 'writer', avatarUrl: '', verified: false, profileUrl: '' },
  content: 'Post visibility lifecycle test', media: [],
  createdAt: 1000, fetchedAt: 2000, isViewed: false,
  stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
  userState: { hasLiked: false, hasSaved: false }, permalink: 'https://reddit.com/r/test',
};

let observed: ((entries: IntersectionObserverEntry[]) => void) | undefined;
let visibility: DocumentVisibilityState = 'visible';

describe('Social Feed visible-time viewed tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    observed = undefined;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { observed = (entries) => callback(entries, this as never); }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function ratio(value: number) {
    act(() => {
      observed?.([{ isIntersecting: value > 0, intersectionRatio: value } as IntersectionObserverEntry]);
    });
  }

  it('marks after a continuous 60% / two-second dwell, not before', () => {
    const onMarkViewed = vi.fn();
    render(<PostCard post={post} onMarkViewed={onMarkViewed} />);
    ratio(0.59);
    act(() => vi.advanceTimersByTime(2500));
    expect(onMarkViewed).not.toHaveBeenCalled();
    ratio(0.6);
    act(() => vi.advanceTimersByTime(1999));
    expect(onMarkViewed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onMarkViewed).toHaveBeenCalledOnce();
    expect(onMarkViewed).toHaveBeenCalledWith(post.id);
  });

  it('cancels on tab hide, partial visibility and unmount without a delayed viewed write', () => {
    const onMarkViewed = vi.fn();
    const { unmount } = render(<PostCard post={post} onMarkViewed={onMarkViewed} />);
    ratio(1);
    act(() => vi.advanceTimersByTime(1500));
    visibility = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(3000));
    expect(onMarkViewed).not.toHaveBeenCalled();
    visibility = 'visible';
    ratio(1);
    act(() => vi.advanceTimersByTime(1000));
    ratio(0.3);
    act(() => vi.advanceTimersByTime(3000));
    expect(onMarkViewed).not.toHaveBeenCalled();
    ratio(1);
    unmount();
    act(() => vi.advanceTimersByTime(3000));
    expect(onMarkViewed).not.toHaveBeenCalled();
    expect(screen.queryByText(post.content)).toBeNull();
  });
});
