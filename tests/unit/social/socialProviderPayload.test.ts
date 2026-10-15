import { describe, expect, it, vi } from 'vitest';
import {
  validProviderBatch, validProviderConversation, validProviderMessage,
  validProviderPost, validProviderReel,
} from '@/process/services/social/adapters/providerPayload';
import { createSocialBridgeService } from '@/process/services/social/socialBridge';
import { initSocialDb } from '@/process/services/social/socialDb';
import { SocialSessionVault } from '@/process/services/social/sessionVault';
import type { IPlatformAdapter } from '@/process/services/social/adapters/types';
import type { UnifiedPost } from '@/common/types/social';

const validPost = {
  id: 'post', platform: 'reddit', accountId: 'owner', originPostId: 'post',
  author: { name: 'Person', handle: 'person', avatarUrl: '', verified: false, profileUrl: '' },
  content: 'Example post', media: [], createdAt: 10, fetchedAt: 11, isViewed: false,
  stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
  userState: { hasLiked: false, hasSaved: false }, permalink: 'https://www.reddit.com/r/test',
};
const validReel = {
  id: 'reel', platform: 'youtube', accountId: 'owner', originVideoId: 'reel',
  author: { name: 'Person', handle: 'person', avatarUrl: '' }, caption: 'Video',
  videoStreamUrl: 'https://youtube.com/video', thumbnailUrl: '',
  durationMs: 12000, createdAt: 10, fetchedAt: 11, isViewed: false,
  stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
  userState: { hasLiked: false }, permalink: 'https://youtube.com/shorts/x',
};

describe('Social provider nested schema and bounded transport', () => {
  it('validates nested Feed media and rejects non-public / non-HTTPS addresses', () => {
    expect(validProviderPost(validPost)).toBe(true);
    expect(validProviderPost({ ...validPost, stats: { ...validPost.stats, likesCount: NaN } })).toBe(false);
    expect(validProviderPost({ ...validPost, author: { name: null } })).toBe(false);
    expect(validProviderPost({ ...validPost, createdAt: Number.POSITIVE_INFINITY })).toBe(false);
    expect(validProviderPost({ ...validPost, content: 'a'.repeat(16001) })).toBe(false);
    expect(validProviderPost({ ...validPost, media: [{ type: 'image', url: 'file:///etc/passwd' }] })).toBe(false);
    expect(validProviderPost({ ...validPost, media: [{ type: 'image', url: 'https://127.0.0.1/private' }] })).toBe(false);
    expect(validProviderPost({ ...validPost, media: [{ type: 'image', url: 'https://10.1.1.1/private' }] })).toBe(false);
    expect(validProviderPost({ ...validPost, media: Array.from({ length: 9 }, () => ({ type: 'image', url: 'https://cdn.example.com/image' })) })).toBe(false);
    expect(validProviderBatch(Array.from({ length: 101 }, () => validPost), validProviderPost, 100)).toBe(false);
  });

  it('validates Reels, conversations and messages before storage', () => {
    expect(validProviderReel(validReel)).toBe(true);
    expect(validProviderReel({ ...validReel, videoStreamUrl: 'javascript:alert(1)' })).toBe(false);
    expect(validProviderReel({ ...validReel, durationMs: -10 })).toBe(false);
    const convo = {
      id: 'convo', platform: 'facebook', accountId: 'owner', threadId: 'thread',
      participant: { name: 'Friend', handle: 'friend', avatarUrl: '' },
      lastMessageSnippet: '', lastMessageAt: 10, unreadCount: 0,
    };
    expect(validProviderConversation(convo)).toBe(true);
    expect(validProviderConversation({ ...convo, unreadCount: -1 })).toBe(false);
    const msg = { id: 'm1', conversationId: 'convo', senderId: 'friend', isFromMe: false, content: 'Hi', sentAt: 10, status: 'delivered' };
    expect(validProviderMessage(msg)).toBe(true);
    expect(validProviderMessage({ ...msg, sentAt: Infinity })).toBe(false);
    expect(validProviderMessage({ ...msg, mediaUrls: ['http://private.example.com/image'] })).toBe(false);
    expect(validProviderMessage({ ...msg, mediaUrls: Array.from({ length: 9 }, () => 'https://cdn.example.com/image') })).toBe(false);
  });

  it('rejects a malformed provider post before persisting any part of its batch', async () => {
    const db = initSocialDb(':memory:');
    const adapter: IPlatformAdapter = {
      platform: 'reddit',
      fetchFeed: vi.fn(async () => [{ ...validPost, stats: { ...validPost.stats, likesCount: NaN } }] as unknown as UnifiedPost[]),
      fetchReels: vi.fn(async () => []),
      fetchConversations: vi.fn(async () => []),
      fetchMessages: vi.fn(async () => []),
      sendMessage: vi.fn(async () => { throw new Error('NOT_IMPLEMENTED'); }),
    };
    const service = createSocialBridgeService(db, new SocialSessionVault(), () => adapter);
    const account = await service.addAccount({ platform: 'reddit', username: 'owner', permissions: {
      canSyncFeed: true, canSyncReels: false, canReadMessages: false, canSendMessages: false,
    } });
    db.saveAccount({ ...account, status: 'connected' });
    await expect(service.refreshFeed({ accountId: account.id })).rejects.toThrow('SOCIAL_INVALID_PROVIDER_FEED');
    expect(db.getUnseenPosts()).toHaveLength(0);
    db.close();
  });
});
