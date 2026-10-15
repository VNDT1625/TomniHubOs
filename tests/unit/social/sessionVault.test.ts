import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SocialSessionVault } from '@/process/services/social/sessionVault';
import { initSocialDb, type SocialDbInstance } from '@/process/services/social/socialDb';
import { createSocialBridgeService } from '@/process/services/social/socialBridge';

describe('Multi-Partition Session Vault & Social Bridge Service (Real Execution)', () => {
  let db: SocialDbInstance;
  let vault: SocialSessionVault;

  beforeEach(() => {
    db = initSocialDb(':memory:');
    vault = new SocialSessionVault();
  });

  it('should generate isolated partition keys for different accounts on the same platform', () => {
    const key1 = vault.getPartitionKey('x', 'user_alpha');
    const key2 = vault.getPartitionKey('x', 'user_beta');
    expect(key1).toBe('persist:social_x_user_alpha');
    expect(key2).toBe('persist:social_x_user_beta');
    expect(key1).not.toBe(key2);
  });

    it('creates unverified isolated Web profiles without requiring a provider username', async () => {
    const bridge = createSocialBridgeService(db, vault);
    const first = await bridge.addAccount({ platform: 'x', username: '' });
    const second = await bridge.addAccount({ platform: 'x', username: '   ' });
    expect(first.username).toBe('');
    expect(second.username).toBe('');
    expect(first.partitionKey).not.toBe(second.partitionKey);
    expect(first.status).toBe('expired');
    expect(first.permissions).toEqual({
      canSyncFeed: false, canSyncReels: false, canReadMessages: false, canSendMessages: false,
    });
  });

  it('should reject unsupported platform', async () => {
    const bridge = createSocialBridgeService(db, vault);
    await expect(
      bridge.addAccount({
        platform: 'unknown_platform',
        username: 'testuser',
      })
    ).rejects.toThrow('SOCIAL_PLATFORM_UNSUPPORTED');
  });

  it('should add real account with isolated partition and zero fake posts', async () => {
    const openLoginMock = vi.fn().mockResolvedValue(undefined);
    const bridge = createSocialBridgeService(db, vault, undefined, openLoginMock);

    const account = await bridge.addAccount({
      platform: 'facebook',
      username: '@myrealfb',
      displayName: 'My Real Profile',
      permissions: { canSyncFeed: true, canSyncReels: true, canReadMessages: true, canSendMessages: true },
    });

    expect(account.username).toBe('myrealfb');
    expect(account.displayName).toBe('My Real Profile');
    expect(account.partitionKey).toBe(`persist:social_facebook_${account.id}`);

    // Verify ZERO synthetic mock data seeded
    const feed = await bridge.getFeedQueue({});
    expect(feed).toHaveLength(0);

    const reels = await bridge.getReelsQueue({});
    expect(reels).toHaveLength(0);

    const convs = await bridge.getConversations({});
    expect(convs).toHaveLength(0);

    // An unverified login must not claim a successful provider refresh.
    await expect(bridge.refreshFeed()).rejects.toThrow('SOCIAL_SESSION_UNVERIFIED');

    // Test openLoginWindow invocation
    const loginResult = await bridge.openLoginWindow({ accountId: account.id });
    expect(loginResult.success).toBe(true);
    expect(openLoginMock).toHaveBeenCalledWith(account);
  });

  it('should process real posts and reels correctly when ingested', async () => {
    const bridge = createSocialBridgeService(db, vault);
    const account = await bridge.addAccount({
            platform: 'x',
      username: 'real_x_user',
      permissions: { canSyncFeed: true, canSyncReels: false, canReadMessages: false, canSendMessages: false },
    });

    const realPost = {
      id: 'post_1001',
      platform: 'x' as const,
      accountId: account.id,
      authorName: 'Tech News',
      authorHandle: '@technews',
      authorAvatar: '',
      content: 'Real breaking technology update.',
      media: [],
      timestamp: Date.now(),
      likesCount: 150,
      commentsCount: 20,
      sharesCount: 10,
      isViewed: false,
    };

    db.savePosts([realPost]);

    const queueBefore = await bridge.getFeedQueue({});
    expect(queueBefore).toHaveLength(1);
    expect(queueBefore[0].id).toBe('post_1001');

    await bridge.markPostViewed({ postId: 'post_1001' });

    const queueAfter = await bridge.getFeedQueue({});
    expect(queueAfter).toHaveLength(0);
  });
});
