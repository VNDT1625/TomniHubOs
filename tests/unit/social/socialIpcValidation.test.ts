import { describe, expect, it } from 'vitest';
import { createSocialBridgeService } from '@/process/services/social/socialBridge';
import { initSocialDb } from '@/process/services/social/socialDb';
import { SocialSessionVault } from '@/process/services/social/sessionVault';

describe('Social IPC runtime payload admission', () => {
  it('rejects invalid account creation and unrequested fields before storage', async () => {
    const db = initSocialDb(':memory:');
    const service = createSocialBridgeService(db, new SocialSessionVault());
    await expect(service.addAccount(null as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.addAccount([] as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.addAccount({ platform: 'reddit', extra: true } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.addAccount({ platform: 'reddit', displayName: ['bad'] } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.addAccount({ platform: 'reddit', permissions: { canSyncFeed: 'yes' } } as never)).rejects.toThrow('SOCIAL_PERMISSIONS_INVALID');
    expect(await service.listAccounts()).toHaveLength(0);
    db.close();
  });

  it('denies invalid paging, identity and update-permission payloads', async () => {
    const db = initSocialDb(':memory:');
    const service = createSocialBridgeService(db, new SocialSessionVault());
    await expect(service.getFeedQueue(null as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.getFeedQueue({ limit: Number.NaN } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.getFeedQueue({ limit: 1000000 } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.getFeedQueue({ offset: -1 } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.getReelsQueue({ offset: 1.5 } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.getConversations({ accountId: {} } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.refreshFeed({ accountId: ['x'] } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.updatePermissions({ accountId: 'a', permissions: {
      canSyncFeed: true, canSyncReels: true, canReadMessages: true, canSendMessages: false, admin: true,
    } } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    db.close();
  });

  it('guards message send before invoking any adapter and preserves stable error contracts', async () => {
    const db = initSocialDb(':memory:');
    const service = createSocialBridgeService(db, new SocialSessionVault());
    await expect(service.sendMessage(null as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.sendMessage({ conversationId: 'a', content: 123 } as never)).rejects.toThrow('SOCIAL_MESSAGE_CONTENT_INVALID');
    await expect(service.sendMessage({ conversationId: 'a', content: 'hello', secret: 'x' } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.getThread({ conversationId: null } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.markPostViewed({ postId: [] } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    await expect(service.markReelViewed({ reelId: ' ' } as never)).rejects.toThrow('SOCIAL_INVALID_IPC_PAYLOAD');
    db.close();
  });
});
