import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReelActionSidebar } from '@/renderer/pages/social/reels/ReelActionSidebar';
import { ReelCommentsDrawer } from '@/renderer/pages/social/reels/ReelCommentsDrawer';
import type { UnifiedReel } from '@/common/types/social';

describe('Reels Player Components', () => {
  const mockReel: UnifiedReel = {
    id: 'tiktok:acc-1:reel-1',
    platform: 'tiktok',
    accountId: 'acc-1',
    originVideoId: 'r-1',
    author: {
      name: 'Creator Name',
      handle: 'creator',
      avatarUrl: '',
    },
    caption: 'Short coding trick with TomniHubOS',
    videoStreamUrl: 'https://example.com/video.mp4',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    durationMs: 15000,
    createdAt: Date.now() - 3600000,
    fetchedAt: Date.now(),
    isViewed: false,
    stats: {
      likesCount: 1500,
      commentsCount: 88,
      sharesCount: 20,
    },
    userState: {
      hasLiked: false,
    },
    permalink: 'https://www.tiktok.com/@creator/video/1',
  };

  it('renders ReelActionSidebar with stats and action buttons', () => {
    const onLike = vi.fn();
    const onToggleComments = vi.fn();
    const onToggleMute = vi.fn();

    render(
      <ReelActionSidebar
        reel={mockReel}
        isMuted={true}
        onLike={onLike}
        onToggleComments={onToggleComments}
        onToggleMute={onToggleMute}
      />
    );

    expect(screen.getByText('1.5k')).toBeDefined();
    expect(screen.getByText('88')).toBeDefined();

    const likeBtn = screen.getByRole('button', { name: /thích/i });
    fireEvent.click(likeBtn);
    expect(onLike).toHaveBeenCalledWith(mockReel.id);

    const commentsBtn = screen.getByRole('button', { name: /bình luận/i });
    fireEvent.click(commentsBtn);
    expect(onToggleComments).toHaveBeenCalled();

    const muteBtn = screen.getByRole('button', { name: /âm thanh/i });
    fireEvent.click(muteBtn);
    expect(onToggleMute).toHaveBeenCalled();
  });

  it('renders ReelCommentsDrawer when open and allows closing', () => {
    const onClose = vi.fn();

    render(<ReelCommentsDrawer isOpen={true} permalink={mockReel.permalink} onClose={onClose} />);

    expect(screen.getByText('Bình luận')).toBeDefined();
    const closeBtn = screen.getByRole('button', { name: /đóng/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
