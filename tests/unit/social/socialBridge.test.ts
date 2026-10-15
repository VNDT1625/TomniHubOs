import { describe, expect, it, vi } from 'vitest';
import { initSocialDb } from '@/process/services/social/socialDb';
import { createSocialBridgeService } from '@/process/services/social/socialBridge';
import { SocialSessionVault } from '@/process/services/social/sessionVault';
import type { SocialAccount, UnifiedConversation, UnifiedMessage, UnifiedPost } from '@/common/types/social';
import type { IPlatformAdapter } from '@/process/services/social/adapters/types';

describe('Social IPC service permission and connection boundaries', () => {
  it('starts a Web session without a username and keeps each reusable partition isolated', async () => {
    const db = initSocialDb(':memory:');
    const login = vi.fn(async (_account: SocialAccount) => {});
    const service = createSocialBridgeService(db, new SocialSessionVault(), undefined, login);
    const first = await service.connectAccount({ platform: 'facebook' });
    expect(first.username).toBe('');
    expect(first.accountId).toBe(first.id);
    expect(first.status).toBe('expired');
    expect(first.permissions).toEqual({
      canSyncFeed: false,
      canSyncReels: false,
      canReadMessages: false,
      canSendMessages: false,
    });
    expect(first.partitionKey).toMatch(/^persist:social_facebook_/);
    expect(login).toHaveBeenCalledWith(first);
    expect((await service.listAccounts())[0].partitionKey).toBe(first.partitionKey);
    await service.openLoginWindow({ accountId: first.id });
    expect(login).toHaveBeenLastCalledWith(first);

    const second = await service.connectAccount({ platform: 'facebook' });
    expect(second.id).not.toBe(first.id);
    expect(second.partitionKey).not.toBe(first.partitionKey);
    expect((await service.listAccounts())).toHaveLength(2);
        expect(await service.refreshFeed({ accountId: first.id })).toEqual({ count: 0 });
    await service.updatePermissions({
      accountId: first.id,
      permissions: { canSyncFeed: true, canSyncReels: false, canReadMessages: false, canSendMessages: false },
    });
    await expect(service.refreshFeed({ accountId: first.id })).rejects.toThrow('SOCIAL_SESSION_UNVERIFIED');
    db.close();
  });

  it('rolls back a provisional Web account and clears its partition on login launch failure', async () => {
    const db = initSocialDb(':memory:');
    const clear = vi.fn(async (_partition: string) => {});
    const login = vi.fn(async (_account: SocialAccount) => {
      throw new Error('LOGIN_WINDOW_FAILED');
    });
    const service = createSocialBridgeService(db, new SocialSessionVault(), undefined, login, clear);
    await expect(service.connectAccount({ platform: 'facebook' })).rejects.toThrow('LOGIN_WINDOW_FAILED');
    expect(await service.listAccounts()).toEqual([]);
    expect(clear).toHaveBeenCalledWith(expect.stringMatching(/^persist:social_facebook_/));
    await expect(service.connectAccount({ platform: 'unsupported' })).rejects.toThrow('SOCIAL_PLATFORM_UNSUPPORTED');
    db.close();
  });


  it('refreshes reels, inbox and threads through a verified adapter without cross-account writes', async () => {
    const db = initSocialDb(':memory:');
    const vault = new SocialSessionVault();
    const reel = {
      id: 'facebook:owner:reel-1',
      platform: 'facebook' as const,
      accountId: 'owner',
      originVideoId: 'reel-1',
      author: { name: 'Creator', handle: 'creator', avatarUrl: '' },
      caption: 'Clip',
      videoStreamUrl: 'https://facebook.com/video',
      thumbnailUrl: '',
      durationMs: 10000,
      createdAt: 120,
      fetchedAt: 125,
      isViewed: false,
      stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
      userState: { hasLiked: false },
      permalink: 'https://facebook.com/reels/1',
    };
    const conversation: UnifiedConversation = {
      id: 'facebook:owner:thread',
      platform: 'facebook',
      accountId: 'owner',
      threadId: 'thread',
      participant: { name: 'Friend', handle: 'friend', avatarUrl: '' },
      lastMessageSnippet: 'Hello',
      lastMessageAt: 125,
      unreadCount: 1,
    };
    const message: UnifiedMessage = {
      id: 'facebook:message',
      conversationId: conversation.id,
      senderId: 'friend',
      isFromMe: false,
      content: 'Hello',
      sentAt: 125,
      status: 'delivered',
    };
    const adapter: IPlatformAdapter = {
      platform: 'facebook',
      fetchFeed: vi.fn(async () => []),
      fetchReels: vi.fn(async () => [reel]),
      fetchConversations: vi.fn(async () => [conversation]),
      fetchMessages: vi.fn(async () => [message]),
      sendMessage: vi.fn(async () => message),
    };
    const service = createSocialBridgeService(db, vault, () => adapter);
    const account = await service.addAccount({
      platform: 'facebook', username: 'creator',
      permissions: { canSyncFeed: true, canSyncReels: true, canReadMessages: true, canSendMessages: true },
    });
    db.saveAccount({ ...account, status: 'connected' });
    reel.accountId = account.id;
    conversation.accountId = account.id;
    expect(await service.refreshReels({ accountId: account.id })).toEqual({ count: 1 });
    expect(await service.refreshConversations({ accountId: account.id })).toEqual({ count: 1 });
    expect(await service.refreshThread({ conversationId: conversation.id })).toEqual({ count: 1 });
    expect(await service.getReelsQueue({ accountId: account.id })).toHaveLength(1);
    expect((await service.getThread({ conversationId: conversation.id }))[0].content).toBe('Hello');
    expect(adapter.fetchMessages).toHaveBeenCalledWith(
      expect.objectContaining({ id: account.id }),
      conversation.threadId
    );
    // Invalid provider identity is rejected before SQLite can cache it.
    reel.accountId = 'foreign';
    await expect(service.refreshReels({ accountId: account.id })).rejects.toThrow('SOCIAL_INVALID_PROVIDER_REELS');
    expect(await service.getReelsQueue({ accountId: account.id })).toHaveLength(1);
    message.conversationId = 'foreign';
    await expect(service.refreshThread({ conversationId: conversation.id })).rejects.toThrow(
      'SOCIAL_INVALID_PROVIDER_MESSAGES'
    );
    await service.updatePermissions({
      accountId: account.id,
      permissions: { canSyncFeed: true, canSyncReels: true, canReadMessages: false, canSendMessages: false },
    });
    await expect(service.refreshThread({ conversationId: conversation.id })).rejects.toThrow(
      'SOCIAL_READ_MESSAGES_NOT_PERMITTED'
    );
    db.close();
  });

  it('does not infer a real connection from a username or login window', async () => {
    const db = initSocialDb(':memory:');
    const login = vi.fn(async (_account: SocialAccount) => {});
    const service = createSocialBridgeService(db, new SocialSessionVault(), undefined, login);
    const account = await service.addAccount({ platform: 'reddit', username: '@alice' });
    expect(account.status).toBe('expired');
    expect(account.lastSyncedAt).toBe(0);
    expect(account.partitionKey).toContain('persist:social_reddit_');
        expect(account.permissions.canSyncFeed).toBe(false);
    expect(await service.refreshFeed({ accountId: account.id })).toEqual({ count: 0 });
    await service.updatePermissions({
      accountId: account.id,
      permissions: { canSyncFeed: true, canSyncReels: false, canReadMessages: false, canSendMessages: false },
    });
    await expect(service.refreshFeed({ accountId: account.id })).rejects.toThrow('SOCIAL_SESSION_UNVERIFIED');
    await service.openLoginWindow({ accountId: account.id });
    expect(login).toHaveBeenCalledOnce();
    expect((await service.listAccounts())[0].status).toBe('expired');
    await expect(service.addAccount({ platform: 'reddit', username: 'alice' })).rejects.toThrow(
      'SOCIAL_ACCOUNT_ALREADY_EXISTS'
    );
    db.close();
  });

  it('restricts cached feeds and messages by per-account capability and clears its partition', async () => {
    const db = initSocialDb(':memory:');
    const clearSession = vi.fn(async (_partition: string) => {});
    const post: UnifiedPost = {
      id: 'post-1',
      platform: 'x',
      accountId: '',
      originPostId: 'one',
      author: { name: 'One', handle: 'one', avatarUrl: '', verified: false, profileUrl: '' },
      content: 'Hello',
      media: [],
      createdAt: 100,
      fetchedAt: 100,
      isViewed: false,
      stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
      userState: { hasLiked: false, hasSaved: false },
      permalink: 'https://x.com/one/status/1',
    };
    const sent: UnifiedMessage = {
      id: 'sent-1',
      conversationId: '',
      senderId: 'me',
      isFromMe: true,
      content: 'Reply',
      sentAt: 101,
      status: 'sent',
    };
    const adapter: IPlatformAdapter = {
      platform: 'x',
      fetchFeed: vi.fn(async () => [post]),
      fetchReels: vi.fn(async () => []),
      fetchConversations: vi.fn(async () => []),
      fetchMessages: vi.fn(async () => []),
      sendMessage: vi.fn(async () => sent),
    };
    const service = createSocialBridgeService(db, new SocialSessionVault(), () => adapter, undefined, clearSession);
    const account = await service.addAccount({
      platform: 'x', username: 'bob',
      permissions: { canSyncFeed: true, canSyncReels: true, canReadMessages: true, canSendMessages: true },
    });
    const active = { ...account, status: 'connected' as const };
    db.saveAccount(active);
    post.accountId = account.id;
    const conversation: UnifiedConversation = {
      id: 'conversation-1',
      platform: 'x',
      accountId: account.id,
      threadId: 'one',
      participant: { name: 'One', handle: 'one', avatarUrl: '' },
      lastMessageSnippet: 'Hi',
      lastMessageAt: 101,
      unreadCount: 1,
    };
    db.saveConversations([conversation]);
    sent.conversationId = conversation.id;
    await service.refreshFeed();
    expect(await service.getFeedQueue({})).toHaveLength(1);
    expect(await service.getConversations()).toHaveLength(1);
    const restricted = { canSyncFeed: false, canSyncReels: false, canReadMessages: false, canSendMessages: false };
    await service.updatePermissions({ accountId: account.id, permissions: restricted });
    expect(await service.getFeedQueue({})).toHaveLength(0);
    expect(await service.getConversations()).toHaveLength(0);
    await expect(service.getThread({ conversationId: conversation.id })).rejects.toThrow(
      'SOCIAL_READ_MESSAGES_NOT_PERMITTED'
    );
    await expect(service.sendMessage({ conversationId: conversation.id, content: 'Hi' })).rejects.toThrow(
      'SOCIAL_SEND_MESSAGES_NOT_PERMITTED'
    );
    await service.updatePermissions({
      accountId: account.id,
      permissions: { ...restricted, canReadMessages: true, canSendMessages: true },
    });
    expect((await service.sendMessage({ conversationId: conversation.id, content: 'Reply' })).id).toBe(sent.id);
    expect(db.getMessages(conversation.id)).toHaveLength(1);
    sent.isFromMe = false;
    await expect(
      service.sendMessage({ conversationId: conversation.id, content: 'Not an outgoing receipt' })
    ).rejects.toThrow('SOCIAL_INVALID_SEND_RECEIPT');
    expect(db.getMessages(conversation.id)).toHaveLength(1);
    await service.removeAccount({ accountId: account.id });
    expect(clearSession).toHaveBeenCalledWith(account.partitionKey);
    expect(db.getConversations()).toHaveLength(0);
    expect(db.getMessages(conversation.id)).toHaveLength(0);
    db.close();
  });
});
