import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PostCard } from '@/renderer/pages/social/feed/PostCard';
import { FeedFilterPills } from '@/renderer/pages/social/feed/FeedFilterPills';
import type { UnifiedPost } from '@/common/types/social';

describe('Unified Feed Components', () => {
  const mockPost: UnifiedPost = {
    id: 'x:acc-1:post-1',
    platform: 'x',
    accountId: 'acc-1',
    originPostId: 'p-1',
    author: {
      name: 'John Doe',
      handle: 'johndoe',
      avatarUrl: '',
      verified: true,
      profileUrl: 'https://x.com/johndoe',
    },
    content: 'Testing TomniHubOS Social Hub feed card in black & white',
    media: [
      {
        type: 'image',
        url: 'https://example.com/test.jpg',
        aspectRatio: 1.5,
      },
    ],
    createdAt: Date.now() - 60000,
    fetchedAt: Date.now(),
    isViewed: false,
    stats: {
      likesCount: 42,
      commentsCount: 5,
      sharesCount: 2,
    },
    userState: {
      hasLiked: false,
      hasSaved: false,
    },
    permalink: 'https://x.com/johndoe/status/1',
  };

  it('renders PostCard with author info, content, stats and action buttons', () => {
    const onLike = vi.fn();
    render(<PostCard post={mockPost} onLike={onLike} onMarkViewed={vi.fn()} />);

    expect(screen.getByText('John Doe')).toBeDefined();
    expect(screen.getByText('@johndoe')).toBeDefined();
    expect(screen.getByText('Testing TomniHubOS Social Hub feed card in black & white')).toBeDefined();
    expect(screen.getByText(/42 lượt thích/)).toBeDefined();
    expect(screen.getByText(/5 bình luận/)).toBeDefined();

    const likeBtn = screen.getByRole('button', { name: /thích/i });
    fireEvent.click(likeBtn);
    expect(onLike).toHaveBeenCalledWith(mockPost.id);
  });

  it('renders FeedFilterPills and fires onSelectPlatform', () => {
    const onSelect = vi.fn();
    render(<FeedFilterPills selectedPlatform="all" onSelectPlatform={onSelect} />);

    expect(screen.getByText('Tất cả')).toBeDefined();
    expect(screen.getByText('Facebook')).toBeDefined();
    expect(screen.getByText('X / Twitter')).toBeDefined();

    const fbPill = screen.getByText('Facebook');
    fireEvent.click(fbPill);
    expect(onSelect).toHaveBeenCalledWith('facebook');
  });
});
