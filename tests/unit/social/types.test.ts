import { describe, it, expect } from 'vitest';
import { socialChannels } from '@/common/types/social/socialChannels';
import type {
  SocialAccount,
  UnifiedPost,
  UnifiedReel,
} from '@/common/types/social';

describe('Social Hub Type Contracts & IPC Channels', () => {
  it('should define all necessary IPC channel names', () => {
    expect(socialChannels.LIST_ACCOUNTS).toBe('social:account:list');
    expect(socialChannels.ADD_ACCOUNT).toBe('social:account:add');
    expect(socialChannels.REMOVE_ACCOUNT).toBe('social:account:remove');
    expect(socialChannels.UPDATE_PERMISSIONS).toBe('social:account:updatePermissions');
    expect(socialChannels.GET_FEED_QUEUE).toBe('social:feed:getQueue');
    expect(socialChannels.REFRESH_FEED).toBe('social:feed:refresh');
    expect(socialChannels.MARK_POST_VIEWED).toBe('social:feed:markViewed');
    expect(socialChannels.GET_REELS_QUEUE).toBe('social:reels:getQueue');
    expect(socialChannels.MARK_REEL_VIEWED).toBe('social:reels:markViewed');
    expect(socialChannels.GET_CONVERSATIONS).toBe('social:messages:getConversations');
    expect(socialChannels.GET_THREAD).toBe('social:messages:getThread');
    expect(socialChannels.SEND_MESSAGE).toBe('social:messages:send');
    expect(socialChannels.GET_STORAGE_STATS).toBe('social:storage:getStats');
    expect(socialChannels.CLEAR_CACHE).toBe('social:storage:clearCache');
  });

  it('should support valid SocialAccount shape', () => {
    const account: SocialAccount = {
      id: 'acc-1',
      platform: 'x',
      accountId: '123456',
      username: 'dev_account',
      displayName: 'Dev Account',
      avatarUrl: 'https://example.com/avatar.jpg',
      partitionKey: 'persist:social_x_123456',
      status: 'connected',
      permissions: {
        canSyncFeed: true,
        canSyncReels: false,
        canReadMessages: true,
        canSendMessages: true,
      },
      connectedAt: 1700000000000,
      lastSyncedAt: 1700000005000,
    };
    expect(account.partitionKey).toContain('persist:social_x_');
  });

  it('should support valid UnifiedPost shape with isViewed tracking', () => {
    const post: UnifiedPost = {
      id: 'x:acc-1:post-100',
      platform: 'x',
      accountId: 'acc-1',
      originPostId: 'post-100',
      author: {
        name: 'Alice',
        handle: 'alice',
        avatarUrl: 'https://example.com/a.jpg',
        verified: true,
        profileUrl: 'https://x.com/alice',
      },
      content: 'Hello world from Tomni Social Hub',
      media: [],
      createdAt: 1700000000000,
      fetchedAt: 1700000005000,
      isViewed: false,
      stats: {
        likesCount: 10,
        commentsCount: 2,
        sharesCount: 1,
      },
      userState: {
        hasLiked: false,
        hasSaved: false,
      },
      permalink: 'https://x.com/alice/status/100',
    };
    expect(post.isViewed).toBe(false);
  });

  it('should support valid UnifiedReel shape', () => {
    const reel: UnifiedReel = {
      id: 'tiktok:acc-2:video-200',
      platform: 'tiktok',
      accountId: 'acc-2',
      originVideoId: 'video-200',
      author: {
        name: 'Creator',
        handle: 'creator',
        avatarUrl: 'https://example.com/c.jpg',
      },
      caption: 'Amazing short video',
      videoStreamUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      durationMs: 15000,
      createdAt: 1700000000000,
      fetchedAt: 1700000005000,
      isViewed: false,
      stats: {
        likesCount: 100,
        commentsCount: 20,
        sharesCount: 5,
      },
      userState: {
        hasLiked: false,
      },
      permalink: 'https://tiktok.com/@creator/video/200',
    };
    expect(reel.durationMs).toBe(15000);
  });
});
