import { describe, expect, it, vi } from 'vitest';
import { createSocialBridgeService } from '@/process/services/social/socialBridge';
import { initSocialDb } from '@/process/services/social/socialDb';
import { SocialSessionVault } from '@/process/services/social/sessionVault';
import type { SocialAccount, UnifiedPost, UnifiedReel } from '@/common/types/social';
import type { IPlatformAdapter } from '@/process/services/social/adapters/types';

const permissions = {
  canSyncFeed: true,
  canSyncReels: true,
  canReadMessages: true,
  canSendMessages: true,
};

const postFor = (account: SocialAccount, id: string, createdAt = 10): UnifiedPost => ({
  id, platform: account.platform as 'x' | 'reddit', accountId: account.id, originPostId: id,
  author: { name: 'Writer', handle: 'writer', avatarUrl: '', verified: false, profileUrl: '' },
  content: 'Cached content', media: [], createdAt, fetchedAt: createdAt, isViewed: false,
  stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
  userState: { hasLiked: false, hasSaved: false }, permalink: 'https://reddit.com/r/test',
});

function adapterWith(feed: IPlatformAdapter['fetchFeed']): IPlatformAdapter {
  return {
    platform: 'reddit',
    fetchFeed: feed,
    fetchReels: vi.fn(async () => []),
    fetchConversations: vi.fn(async () => []),
    fetchMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async () => { throw new Error('UNSUPPORTED'); }),
  };
}

describe('Social plan acceptance: authorization and pagination', () => {
  it('filters by platform before pagination and refuses unauthorized markViewed in memory', async () => {
    const db = initSocialDb(':memory:');
    const service = createSocialBridgeService(db, new SocialSessionVault());
    const x = await service.addAccount({ platform: 'x', username: 'x', permissions });
    const reddit = await service.addAccount({ platform: 'reddit', username: 'r', permissions });
    const posts = Array.from({ length: 21 }, (_, i) => postFor(x, `x-${i}`, i + 200));
    posts.push(postFor(reddit, 'reddit-oldest', 1));
    db.savePosts(posts);
    const redditQueue = await service.getFeedQueue({ platform: 'reddit', limit: 20 });
    expect(redditQueue.map((item) => item.id)).toEqual(['reddit-oldest']);
    expect(await service.getFeedQueue({ platform: 'x', limit: 20 })).toHaveLength(20);

    await service.updatePermissions({
      accountId: reddit.id,
      permissions: { ...permissions, canSyncFeed: false },
    });
    await expect(service.markPostViewed({ postId: 'reddit-oldest' })).rejects.toThrow('SOCIAL_FEED_NOT_PERMITTED');
    expect(db.getUnseenPosts(reddit.id)).toHaveLength(1);
    await expect(service.markPostViewed({ postId: 'unknown' })).rejects.toThrow('SOCIAL_POST_NOT_FOUND');
    await expect(service.getFeedQueue({ platform: 'tiktok' })).rejects.toThrow('SOCIAL_FEED_PLATFORM_UNSUPPORTED');
    db.close();
  });

  it('does not persist a late provider response after permission revocation', async () => {
    const db = initSocialDb(':memory:');
    let resolve!: (value: UnifiedPost[]) => void;
    const adapter = adapterWith(() => new Promise<UnifiedPost[]>((done) => { resolve = done; }));
    const service = createSocialBridgeService(db, new SocialSessionVault(), () => adapter);
    const account = await service.addAccount({ platform: 'reddit', username: 'writer', permissions });
    db.saveAccount({ ...account, status: 'connected' });
    const pending = service.refreshFeed({ accountId: account.id });
    await service.updatePermissions({
      accountId: account.id,
      permissions: { ...permissions, canSyncFeed: false },
    });
    resolve([postFor(account, 'late-1')]);
    await expect(pending).rejects.toThrow('SOCIAL_ACCOUNT_CHANGED_DURING_SYNC');
    expect(db.getUnseenPosts()).toHaveLength(0);
    db.close();
  });

  it('does not resurrect an unlinked account when a provider request completes', async () => {
    const db = initSocialDb(':memory:');
    let resolve!: (value: UnifiedPost[]) => void;
    const adapter = adapterWith(() => new Promise<UnifiedPost[]>((done) => { resolve = done; }));
    const service = createSocialBridgeService(db, new SocialSessionVault(), () => adapter);
    const account = await service.addAccount({ platform: 'reddit', username: 'writer', permissions });
    db.saveAccount({ ...account, status: 'connected' });
    const pending = service.refreshFeed({ accountId: account.id });
    await service.removeAccount({ accountId: account.id });
    resolve([postFor(account, 'orphan-1')]);
    await expect(pending).rejects.toThrow('SOCIAL_ACCOUNT_CHANGED_DURING_SYNC');
    expect(db.getUnseenPosts()).toEqual([]);
    expect(await service.listAccounts()).toEqual([]);
    db.close();
  });

  it('denies marking another account reel as viewed after permission is revoked', async () => {
    const db = initSocialDb(':memory:');
    const service = createSocialBridgeService(db, new SocialSessionVault());
    const account = await service.addAccount({ platform: 'facebook', username: 'owner', permissions });
    const reel: UnifiedReel = {
      id: 'foreign-reel', platform: 'facebook', accountId: account.id, originVideoId: 'r1',
      author: { name: 'Author', handle: 'author', avatarUrl: '' }, caption: 'A reel',
      videoStreamUrl: 'https://facebook.com/video', thumbnailUrl: '', durationMs: 3000,
      createdAt: 1, fetchedAt: 1, isViewed: false,
      stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 }, userState: { hasLiked: false },
      permalink: 'https://facebook.com/reels/1',
    };
    db.saveReels([reel]);
    await service.updatePermissions({ accountId: account.id, permissions: { ...permissions, canSyncReels: false } });
    await expect(service.markReelViewed({ reelId: reel.id })).rejects.toThrow('SOCIAL_REELS_NOT_PERMITTED');
    expect(db.getUnseenReels()).toHaveLength(1);
    await expect(service.markReelViewed({ reelId: 'missing' })).rejects.toThrow('SOCIAL_REEL_NOT_FOUND');
    db.close();
  });
});
