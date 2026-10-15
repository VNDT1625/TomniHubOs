import { describe, expect, it } from 'vitest';
import { createSocialBridgeService } from '@/process/services/social/socialBridge';
import { initSocialDb } from '@/process/services/social/socialDb';
import { SocialSessionVault } from '@/process/services/social/sessionVault';
import type { UnifiedConversation, UnifiedMessage } from '@/common/types/social';

const permissions = {
  canSyncFeed: true,
  canSyncReels: true,
  canReadMessages: true,
  canSendMessages: true,
};

describe('Social bounded IPC responses and bulk admission', () => {
  it('refuses excessive cross-account sync instead of silently skipping accounts', async () => {
    const db = initSocialDb(':memory:');
    const service = createSocialBridgeService(db, new SocialSessionVault());
    const accounts = [];
    for (let index = 0; index < 9; index++) {
      // oxlint-disable-next-line no-await-in-loop -- Test creates isolated accounts in order.
      const account = await service.addAccount({ platform: 'facebook', username: `user-${index}`, permissions });
      db.saveAccount({ ...account, status: 'connected' });
      accounts.push(account);
    }
    await expect(service.refreshFeed()).rejects.toThrow('SOCIAL_SYNC_ACCOUNT_LIMIT_REACHED');
    await expect(service.refreshReels()).rejects.toThrow('SOCIAL_SYNC_ACCOUNT_LIMIT_REACHED');
    await expect(service.refreshConversations()).rejects.toThrow('SOCIAL_SYNC_ACCOUNT_LIMIT_REACHED');
    // Individual sync remains allowed and correctly reports the missing production connector.
    await expect(service.refreshFeed({ accountId: accounts[0].id })).rejects.toThrow('SOCIAL_CONNECTOR_UNAVAILABLE');
    db.close();
  });

  it('caps account creation at 32 and does not create a partial 33rd account', async () => {
    const db = initSocialDb(':memory:');
    const service = createSocialBridgeService(db, new SocialSessionVault());
    for (let index = 0; index < 32; index++) {
      // oxlint-disable-next-line no-await-in-loop -- Intentional bounded sequential account creation.
      await service.addAccount({ platform: 'reddit', username: `owner-${index}` });
    }
    await expect(service.addAccount({ platform: 'reddit', username: 'another' })).rejects.toThrow(
      'SOCIAL_ACCOUNT_LIMIT_REACHED'
    );
    expect(await service.listAccounts()).toHaveLength(32);
    db.close();
  });

  it('returns only 200 newest readable conversations and most recent messages', async () => {
    const db = initSocialDb(':memory:');
    const service = createSocialBridgeService(db, new SocialSessionVault());
    const account = await service.addAccount({ platform: 'facebook', username: 'inbox', permissions });
    const conversations: UnifiedConversation[] = Array.from({ length: 220 }, (_, index) => ({
      id: `conversation-${index}`,
      accountId: account.id,
      platform: 'facebook',
      threadId: `thread-${index}`,
      participant: { name: 'Someone', handle: 'someone', avatarUrl: '' },
      lastMessageSnippet: 'Message',
      lastMessageAt: index,
      unreadCount: 0,
    }));
    const messages: UnifiedMessage[] = Array.from({ length: 250 }, (_, index) => ({
      id: `message-${index}`,
      conversationId: conversations[0].id,
      senderId: 'peer',
      isFromMe: false,
      content: `Message ${index}`,
      sentAt: index,
      status: 'read',
    }));
    db.saveConversations(conversations);
    db.saveMessages(messages);
    const inbox = await service.getConversations({});
    expect(inbox).toHaveLength(200);
    expect(inbox[0].id).toBe('conversation-219');
    expect(inbox.at(-1)?.id).toBe('conversation-20');
    const thread = await service.getThread({ conversationId: conversations[0].id });
    expect(thread).toHaveLength(200);
    expect(thread[0].id).toBe('message-50');
    expect(thread.at(-1)?.id).toBe('message-249');
    db.close();
  });
});
