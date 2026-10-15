import { describe, expect, it, vi } from 'vitest';
import { createSocialBridgeService } from '@/process/services/social/socialBridge';
import { initSocialDb } from '@/process/services/social/socialDb';
import { SocialSessionVault } from '@/process/services/social/sessionVault';
import type { IPlatformAdapter } from '@/process/services/social/adapters/types';
import type { UnifiedMessage } from '@/common/types/social';

const permissions = {
  canSyncFeed: false,
  canSyncReels: false,
  canReadMessages: true,
  canSendMessages: true,
};

describe('Social per-thread send concurrency admission', () => {
  it('does not send twice while provider receipt is pending; releases lock after success', async () => {
    const db = initSocialDb(':memory:');
    let complete!: (message: UnifiedMessage) => void;
    const receipt: UnifiedMessage = {
      id: 'receipt-1',
      conversationId: 'thread-1',
      senderId: 'self',
      isFromMe: true,
      content: 'Hi!',
      sentAt: 42,
      status: 'sent',
    };
    const sendMessage = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<UnifiedMessage>((resolve) => {
            complete = resolve;
          })
      )
      .mockResolvedValueOnce({ ...receipt, id: 'receipt-2' });
    const adapter: IPlatformAdapter = {
      platform: 'facebook',
      fetchFeed: vi.fn(async () => []),
      fetchReels: vi.fn(async () => []),
      fetchConversations: vi.fn(async () => []),
      fetchMessages: vi.fn(async () => []),
      sendMessage,
    };
    const service = createSocialBridgeService(db, new SocialSessionVault(), () => adapter);
    const account = await service.addAccount({ platform: 'facebook', username: 'sender', permissions });
    db.saveAccount({ ...account, status: 'connected' });
    db.saveConversations([
      {
        id: 'thread-1',
        threadId: 'provider-thread-1',
        platform: 'facebook',
        accountId: account.id,
        participant: { name: 'Friend', handle: 'friend', avatarUrl: '' },
        lastMessageSnippet: '',
        lastMessageAt: 10,
        unreadCount: 0,
      },
    ]);
    const first = service.sendMessage({ conversationId: 'thread-1', content: 'Hi!' });
    await expect(service.sendMessage({ conversationId: 'thread-1', content: 'Hi!' })).rejects.toThrow(
      'SOCIAL_MESSAGE_SEND_IN_PROGRESS'
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    complete(receipt);
    await expect(first).resolves.toEqual(receipt);
    expect(await service.getThread({ conversationId: 'thread-1' })).toHaveLength(1);
    await expect(service.sendMessage({ conversationId: 'thread-1', content: 'Hi again' })).resolves.toMatchObject({
      id: 'receipt-2',
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    db.close();
  });

  it('releases the thread lock after a rejected send so the user can retry deliberately', async () => {
    const db = initSocialDb(':memory:');
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('TRANSPORT_DOWN')).mockResolvedValueOnce({
      id: 'success',
      conversationId: 'thread-2',
      senderId: 'me',
      isFromMe: true,
      content: 'Again',
      sentAt: 60,
      status: 'sent',
    });
    const adapter: IPlatformAdapter = {
      platform: 'facebook',
      fetchFeed: vi.fn(async () => []),
      fetchReels: vi.fn(async () => []),
      fetchConversations: vi.fn(async () => []),
      fetchMessages: vi.fn(async () => []),
      sendMessage,
    };
    const service = createSocialBridgeService(db, new SocialSessionVault(), () => adapter);
    const account = await service.addAccount({ platform: 'facebook', username: 'sender', permissions });
    db.saveAccount({ ...account, status: 'connected' });
    db.saveConversations([
      {
        id: 'thread-2',
        threadId: 'provider-thread-2',
        platform: 'facebook',
        accountId: account.id,
        participant: { name: 'Friend', handle: 'friend', avatarUrl: '' },
        lastMessageSnippet: '',
        lastMessageAt: 10,
        unreadCount: 0,
      },
    ]);
    await expect(service.sendMessage({ conversationId: 'thread-2', content: 'Again' })).rejects.toThrow(
      'TRANSPORT_DOWN'
    );
    await expect(service.sendMessage({ conversationId: 'thread-2', content: 'Again' })).resolves.toMatchObject({
      id: 'success',
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    db.close();
  });
});
