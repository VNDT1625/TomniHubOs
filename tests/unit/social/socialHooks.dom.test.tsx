import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocialFeed } from '@/renderer/pages/social/hooks/useSocialFeed';
import { useReelsQueue } from '@/renderer/pages/social/hooks/useReelsQueue';
import type { UnifiedPost, UnifiedReel } from '@/common/types/social';

const api = vi.hoisted(() => ({
  getFeedQueue: vi.fn(),
  refreshFeed: vi.fn(),
  markPostViewed: vi.fn(),
  getReelsQueue: vi.fn(),
  refreshReels: vi.fn(),
  markReelViewed: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  social: {
    getFeedQueue: { invoke: api.getFeedQueue },
    refreshFeed: { invoke: api.refreshFeed },
    markPostViewed: { invoke: api.markPostViewed },
    getReelsQueue: { invoke: api.getReelsQueue },
    refreshReels: { invoke: api.refreshReels },
    markReelViewed: { invoke: api.markReelViewed },
  },
}));

const postFor = (accountId: string): UnifiedPost => ({
  id: `post-${accountId}`,
  accountId,
  platform: 'reddit',
  originPostId: accountId,
  author: { name: 'Author', handle: 'author', avatarUrl: '', verified: false, profileUrl: '' },
  content: `Feed ${accountId}`,
  media: [],
  createdAt: 10,
  fetchedAt: 20,
  isViewed: false,
  stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
  userState: { hasLiked: false, hasSaved: false },
  permalink: 'https://reddit.com/r/test',
});

const reelFor = (accountId: string): UnifiedReel => ({
  id: `reel-${accountId}`,
  platform: 'youtube',
  accountId,
  originVideoId: accountId,
  author: { name: 'Creator', handle: 'creator', avatarUrl: '' },
  caption: `Reel ${accountId}`,
  videoStreamUrl: '',
  thumbnailUrl: '',
  durationMs: 10000,
  createdAt: 10,
  fetchedAt: 20,
  isViewed: false,
  stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
  userState: { hasLiked: false },
  permalink: 'https://youtube.com/shorts/1',
});

function FeedHarness({ accountId, refreshKey }: { accountId: string; refreshKey?: number }) {
  const { posts, markViewed, error } = useSocialFeed({ selectedAccountId: accountId, refreshKey });
  return (
    <main>
      {error && <div role='alert'>{error}</div>}
      {posts.map((post) => (
        <button
          key={post.id}
          onClick={() => {
            void markViewed(post.id);
            void markViewed(post.id);
          }}
        >
          {post.content}
        </button>
      ))}
    </main>
  );
}

function ReelsHarness({ accountId, refreshKey }: { accountId: string; refreshKey?: number }) {
  const { reels, loading } = useReelsQueue({ selectedAccountId: accountId, refreshKey });
  return <main>{loading && reels.length === 0 ? 'Đang tải' : reels.map((reel) => reel.caption).join(', ')}</main>;
}

describe('Social account switching and queued network races', () => {
  beforeEach(() => {
    api.getFeedQueue.mockReset();
    api.refreshFeed.mockReset();
    api.markPostViewed.mockReset().mockResolvedValue({ success: true });
    api.getReelsQueue.mockReset();
    api.refreshReels.mockReset().mockResolvedValue({ count: 0 });
    api.markReelViewed.mockReset().mockResolvedValue({ success: true });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("hides another account's feed immediately and never writes an obsolete result", async () => {
    let resolveB!: (value: UnifiedPost[]) => void;
    api.getFeedQueue.mockImplementation(({ accountId }: { accountId: string }) =>
      accountId === 'a'
        ? Promise.resolve([postFor('a')])
        : new Promise<UnifiedPost[]>((resolve) => {
            resolveB = resolve;
          })
    );
    const { rerender } = render(<FeedHarness accountId='a' />);
    await screen.findByText('Feed a');
    rerender(<FeedHarness accountId='b' />);
    expect(screen.queryByText('Feed a')).toBeNull();
    await act(async () => {
      resolveB([postFor('b')]);
    });
    await screen.findByText('Feed b');
    expect(screen.queryByText('Feed a')).toBeNull();
  });

  it('does not apply a late old-account response after a switch', async () => {
    let resolveA!: (value: UnifiedPost[]) => void;
    api.getFeedQueue.mockImplementation(({ accountId }: { accountId: string }) =>
      accountId === 'a'
        ? new Promise<UnifiedPost[]>((resolve) => {
            resolveA = resolve;
          })
        : Promise.resolve([postFor('b')])
    );
    const { rerender } = render(<FeedHarness accountId='a' />);
    await waitFor(() => expect(api.getFeedQueue).toHaveBeenCalledTimes(1));
    rerender(<FeedHarness accountId='b' />);
    await screen.findByText('Feed b');
    await act(async () => {
      resolveA([postFor('a')]);
    });
    expect(screen.queryByText('Feed a')).toBeNull();
  });

  it('keeps cached posts during refresh and replaces them only when the new page loads', async () => {
    let resolveNext!: (posts: UnifiedPost[]) => void;
    api.getFeedQueue.mockResolvedValueOnce([postFor('a')]).mockImplementationOnce(
      () =>
        new Promise<UnifiedPost[]>((resolve) => {
          resolveNext = resolve;
        })
    );
    api.refreshFeed.mockResolvedValue({ count: 0 });
    const { rerender } = render(<FeedHarness accountId='a' />);
    await screen.findByText('Feed a');
    rerender(<FeedHarness accountId='a' refreshKey={1} />);
    await waitFor(() => expect(api.getFeedQueue).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Feed a')).toBeDefined();
    await act(async () => resolveNext([{ ...postFor('a'), id: 'post-new', content: 'Feed refreshed' }]));
    await screen.findByText('Feed refreshed');
    expect(screen.queryByText('Feed a')).toBeNull();
  });

  it('keeps cached posts when the connector fails or reading the refreshed cache fails', async () => {
    api.getFeedQueue.mockResolvedValueOnce([postFor('a')]).mockRejectedValueOnce(new Error('CACHE_DOWN'));
    api.refreshFeed.mockRejectedValueOnce(new Error('SOCIAL_CONNECTOR_UNAVAILABLE'));
    const { rerender } = render(<FeedHarness accountId='a' />);
    await screen.findByText('Feed a');
    rerender(<FeedHarness accountId='a' refreshKey={1} />);
    await screen.findByRole('alert');
    expect(screen.getByText('Feed a')).toBeDefined();
  });

  it('marks an item seen only once even if multiple view callbacks race', async () => {
    api.getFeedQueue.mockResolvedValue([postFor('a')]);
    render(<FeedHarness accountId='a' />);
    const button = await screen.findByText('Feed a');
    await act(async () => {
      button.click();
    });
    expect(api.markPostViewed).toHaveBeenCalledTimes(1);
  });

  it('never counts hidden Reels as viewed and starts the timer on visibility restore', async () => {
    let visible: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
    api.getReelsQueue.mockResolvedValue([reelFor('a')]);
    render(<ReelsHarness accountId='a' />);
    await screen.findByText('Reel a');
    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(5000));
    expect(api.markReelViewed).not.toHaveBeenCalled();
    visible = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(2999));
    expect(api.markReelViewed).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(api.markReelViewed).toHaveBeenCalledOnce();
    expect(api.markReelViewed).toHaveBeenCalledWith({ reelId: 'reel-a' });
  });

  it('keeps cached Reels if a same-account refresh fails', async () => {
    api.getReelsQueue.mockResolvedValueOnce([reelFor('a')]).mockRejectedValueOnce(new Error('CACHE_OFFLINE'));
    api.refreshReels.mockRejectedValueOnce(new Error('SOCIAL_CONNECTOR_UNAVAILABLE'));
    const { rerender } = render(<ReelsHarness accountId='a' />);
    await screen.findByText('Reel a');
    rerender(<ReelsHarness accountId='a' refreshKey={1} />);
    await waitFor(() => expect(api.getReelsQueue).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Reel a')).toBeDefined();
  });

  it('refreshes reels through the adapter and isolates the selected account', async () => {
    let resolveB!: (value: UnifiedReel[]) => void;
    api.getReelsQueue.mockImplementation(({ accountId }: { accountId: string }) =>
      accountId === 'a'
        ? Promise.resolve([reelFor('a')])
        : new Promise<UnifiedReel[]>((resolve) => {
            resolveB = resolve;
          })
    );
    const { rerender } = render(<ReelsHarness accountId='a' />);
    await screen.findByText('Reel a');
    rerender(<ReelsHarness accountId='b' refreshKey={1} />);
    expect(screen.queryByText('Reel a')).toBeNull();
    await waitFor(() => expect(api.refreshReels).toHaveBeenCalledWith({ accountId: 'b' }));
    await waitFor(() => expect(api.getReelsQueue).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveB([reelFor('b')]);
    });
    await screen.findByText('Reel b');
  });
});
