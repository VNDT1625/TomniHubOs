import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostCard } from '@/renderer/pages/social/feed/PostCard';
import type { UnifiedPost } from '@/common/types/social';

const post: UnifiedPost = {
  id: 'post-1',
  accountId: 'account-1',
  platform: 'facebook',
  originPostId: '1',
  author: { name: 'Writer', handle: 'writer', avatarUrl: '', verified: false, profileUrl: '' },
  content: 'A cached post',
  media: [],
  createdAt: 100,
  fetchedAt: 200,
  isViewed: false,
  stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
  userState: { hasLiked: false, hasSaved: false },
  permalink: 'https://facebook.com/posts/1',
};

let notify!: IntersectionObserverCallback;
const disconnect = vi.fn();
const emit = (ratio: number) => {
  act(() =>
    notify(
      [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
};
const time = (ms: number) => {
  act(() => vi.advanceTimersByTime(ms));
};

describe('Social Feed mark viewed: 60% for two visible seconds', () => {
  beforeEach(() => {
    disconnect.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      }
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marks viewed only after two continuous seconds at 60% visible', () => {
    const markViewed = vi.fn();
    render(<PostCard post={post} onMarkViewed={markViewed} />);
    emit(0.59);
    time(3000);
    expect(markViewed).not.toHaveBeenCalled();
    emit(0.6);
    time(1999);
    expect(markViewed).not.toHaveBeenCalled();
    time(1);
    expect(markViewed).toHaveBeenCalledOnce();
    expect(markViewed).toHaveBeenCalledWith('post-1');
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('resets on scroll-out, hidden tabs and starts again when the document becomes visible', () => {
    const markViewed = vi.fn();
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    render(<PostCard post={post} onMarkViewed={markViewed} />);
    emit(0.9);
    time(1200);
    emit(0.1);
    time(3000);
    expect(markViewed).not.toHaveBeenCalled();
    emit(0.9);
    time(500);
    visibility = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    time(3000);
    expect(markViewed).not.toHaveBeenCalled();

    visibility = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    time(2000);
    expect(markViewed).toHaveBeenCalledOnce();
  });

  it('cancels the timer on component unmount instead of marking an unseen post', () => {
    const markViewed = vi.fn();
    const mounted = render(<PostCard post={post} onMarkViewed={markViewed} />);
    emit(1);
    time(1000);
    mounted.unmount();
    time(3000);
    expect(markViewed).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it('never marks an already-viewed post', () => {
    const markViewed = vi.fn();
    render(<PostCard post={{ ...post, isViewed: true }} onMarkViewed={markViewed} />);
    expect(markViewed).not.toHaveBeenCalled();
  });
});
