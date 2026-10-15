import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';
import { initSocialDb, type SocialDbInstance } from '@/process/services/social/socialDb';
import { runAutoEviction, clearAllCache } from '@/process/services/social/cacheEviction';
import type {
  UnifiedPost,
  SocialAccount,
  UnifiedReel,
  UnifiedConversation,
  UnifiedMessage,
} from '@/common/types/social';

// node:sqlite keeps the persistence contract test independent of Electron's native-addon ABI.
const testSqliteDriver = (file: string): ISqliteDriver => {
  const database = new DatabaseSync(file);
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        get: (...args) => statement.get(...(args as string[])),
        all: (...args) => statement.all(...(args as string[])),
        run: (...args) => {
          const result = statement.run(...(args as string[]));
          return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
        },
      };
    },
    exec: (sql) => database.exec(sql),
    pragma: (sql) => database.prepare(`PRAGMA ${sql}`).get(),
    transaction:
      (fn) =>
      (...args) => {
        database.exec('BEGIN');
        try {
          const value = fn(...args);
          database.exec('COMMIT');
          return value;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    close: () => database.close(),
  };
};

describe('Social SQLite Database & Cache Eviction Engine', () => {
  let db: SocialDbInstance;

  beforeEach(() => {
    db = initSocialDb(':memory:');
  });

  it('persists accounts and unseen queues across reopen and removes only owned data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomny-social-test-'));
    const file = join(dir, 'social.sqlite');
    let store: SocialDbInstance | undefined;
    try {
      store = initSocialDb(file, testSqliteDriver(file));
      expect(store.mode).toBe('sqlite');
      const account: SocialAccount = {
        id: 'persist-a',
        platform: 'reddit',
        accountId: 'persist-a',
        username: 'alpha',
        displayName: 'Alpha',
        avatarUrl: '',
        partitionKey: 'persist:social_reddit_persist-a',
        status: 'expired',
        connectedAt: 100,
        lastSyncedAt: 0,
        permissions: { canSyncFeed: true, canSyncReels: false, canReadMessages: false, canSendMessages: false },
      };
      const post: UnifiedPost = {
        id: 'post-persist',
        platform: 'reddit',
        accountId: account.id,
        originPostId: '1',
        author: { name: 'Author', handle: 'author', avatarUrl: '', verified: false, profileUrl: '' },
        content: 'Persist across restart',
        media: [],
        createdAt: 300,
        fetchedAt: 300,
        isViewed: false,
        stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
        userState: { hasLiked: false, hasSaved: false },
        permalink: 'https://reddit.com/r/test',
      };
      store.saveAccount(account);
      store.savePosts([post]);
      store.close();
      store = initSocialDb(file, testSqliteDriver(file));
      expect(store.getAccounts()).toEqual([account]);
      expect(store.getUnseenPosts()).toEqual([post]);
      store.markPostViewed(post.id);
      store.savePosts([post]); // A refresh must not resurrect previously viewed items.
      expect(store.getUnseenPosts()).toHaveLength(0);
      expect(store.getStorageStats().cachedPostsCount).toBe(1);
      store.removeAccount(account.id);
      expect(store.getStorageStats().cachedPostsCount).toBe(0);
      expect(store.getAccounts()).toHaveLength(0);
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('filters authorized accounts before pagination in memory and SQLite and keeps viewed flags on resync', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomny-social-permissions-'));
    const filename = join(dir, 'permissions.sqlite');
    const sqlite = initSocialDb(filename, testSqliteDriver(filename));
    try {
      const base: UnifiedPost = {
        id: 'post-0',
        accountId: 'visible',
        platform: 'reddit',
        originPostId: '0',
        author: { name: 'Author', handle: 'author', avatarUrl: '', verified: false, profileUrl: '' },
        content: 'A real cached post',
        media: [],
        createdAt: 100,
        fetchedAt: 100,
        isViewed: false,
        stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
        userState: { hasLiked: false, hasSaved: false },
        permalink: 'https://reddit.com/r/test',
      };
      const posts = Array.from(
        { length: 35 },
        (_, index): UnifiedPost => ({
          ...base,
          id: `post-${index}`,
          accountId: index < 30 ? 'hidden' : 'visible',
          createdAt: 1000 - index,
        })
      );
      for (const store of [db, sqlite]) {
        store.savePosts(posts);
        expect(store.getUnseenPosts(undefined, 3, 0, ['visible']).map((post) => post.id)).toEqual([
          'post-30',
          'post-31',
          'post-32',
        ]);
        expect(store.getUnseenPosts(undefined, 3, 3, ['visible']).map((post) => post.id)).toEqual([
          'post-33',
          'post-34',
        ]);
        expect(store.getUnseenPosts(undefined, 3, 0, [])).toEqual([]);
        store.savePosts([{ ...posts[31], accountId: 'hidden', content: 'Wrong owner' }]);
        expect(store.getUnseenPosts(undefined, 5, 0, ['visible'])[1].content).toBe('A real cached post');
        const reel: UnifiedReel = {
          id: 'same-reel-id',
          platform: 'facebook',
          accountId: 'visible',
          originVideoId: 'one',
          author: { name: 'Creator', handle: 'creator', avatarUrl: '' },
          caption: 'Original',
          videoStreamUrl: '',
          thumbnailUrl: '',
          durationMs: 100,
          createdAt: 100,
          fetchedAt: 100,
          isViewed: false,
          stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
          userState: { hasLiked: false },
          permalink: 'https://facebook.com/reels/1',
        };
        store.saveReels([reel, { ...reel, accountId: 'hidden', caption: 'Forged' }]);
        expect(store.getUnseenReels(undefined, 10, 0, ['visible'])[0].caption).toBe('Original');
        const thread: UnifiedConversation = {
          id: 'same-conversation-id',
          platform: 'facebook',
          accountId: 'visible',
          threadId: 'one',
          participant: { name: 'Friend', handle: 'friend', avatarUrl: '' },
          lastMessageSnippet: 'Hi',
          lastMessageAt: 100,
          unreadCount: 0,
        };
        store.saveConversations([thread, { ...thread, accountId: 'hidden', lastMessageSnippet: 'Forged' }]);
        expect(store.getConversations('visible')[0].lastMessageSnippet).toBe('Hi');
        const msg: UnifiedMessage = {
          id: 'same-message-id',
          conversationId: thread.id,
          senderId: 'friend',
          isFromMe: false,
          content: 'Original',
          sentAt: 100,
          status: 'read',
        };
        store.saveMessages([msg, { ...msg, conversationId: 'foreign', content: 'Forged' }]);
        expect(store.getMessages(thread.id)[0].content).toBe('Original');
        store.markPostViewed('post-30');
        store.savePosts(posts);
        expect(store.getUnseenPosts(undefined, 5, 0, ['visible']).map((post) => post.id)).toEqual([
          'post-31',
          'post-32',
          'post-33',
          'post-34',
        ]);
      }
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should save and list accounts', () => {
    const acc: SocialAccount = {
      id: 'acc-1',
      platform: 'x',
      accountId: '123',
      username: 'dev',
      displayName: 'Dev',
      avatarUrl: '',
      partitionKey: 'persist:social_x_123',
      status: 'connected',
      permissions: { canSyncFeed: true, canSyncReels: true, canReadMessages: true, canSendMessages: true },
      connectedAt: Date.now(),
      lastSyncedAt: Date.now(),
    };
    db.saveAccount(acc);
    const accounts = db.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].username).toBe('dev');

    db.updateAccountPermissions('acc-1', {
      canSyncFeed: false,
      canSyncReels: false,
      canReadMessages: false,
      canSendMessages: false,
    });
    const updated = db.getAccounts();
    expect(updated[0].permissions.canSyncFeed).toBe(false);

    db.removeAccount('acc-1');
    expect(db.getAccounts()).toHaveLength(0);
  });

  it('should maintain unseen queue order and preserve unseen posts', () => {
    const posts: UnifiedPost[] = Array.from({ length: 10 }).map((_, i) => ({
      id: `post-${i}`,
      platform: 'x',
      accountId: 'acc-1',
      originPostId: `p-${i}`,
      author: { name: `Author ${i}`, handle: `a${i}`, avatarUrl: '', verified: false, profileUrl: '' },
      content: `Post content ${i}`,
      media: [],
      createdAt: 1000 + i * 10,
      fetchedAt: Date.now(),
      isViewed: false,
      stats: { likesCount: i, commentsCount: 0, sharesCount: 0 },
      userState: { hasLiked: false, hasSaved: false },
      permalink: `https://x.com/post/${i}`,
    }));

    db.savePosts(posts);

    // Initial 10 unseen
    let unseen = db.getUnseenPosts();
    expect(unseen).toHaveLength(10);
    // Reverse-chronological order
    expect(unseen[0].id).toBe('post-9');

    // Mark 5 viewed
    for (let i = 5; i < 10; i++) {
      db.markPostViewed(`post-${i}`);
    }

    // Remaining 5 unseen should be preserved
    unseen = db.getUnseenPosts();
    expect(unseen).toHaveLength(5);
    expect(unseen.map((p) => p.id)).toEqual(['post-4', 'post-3', 'post-2', 'post-1', 'post-0']);
  });

  it('should evict only viewed posts and reels after retention time', () => {
    const oldTimestamp = Date.now() - 50 * 3600 * 1000; // 50 hours ago (> 48h)
    const freshTimestamp = Date.now() - 1 * 3600 * 1000; // 1 hour ago

    const oldViewedPost: UnifiedPost = {
      id: 'post-old-viewed',
      platform: 'facebook',
      accountId: 'acc-1',
      originPostId: 'p-old',
      author: { name: 'Old', handle: 'old', avatarUrl: '', verified: false, profileUrl: '' },
      content: 'Old viewed post',
      media: [],
      createdAt: oldTimestamp,
      fetchedAt: oldTimestamp,
      isViewed: true,
      stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
      userState: { hasLiked: false, hasSaved: false },
      permalink: '',
    };

    const oldUnseenPost: UnifiedPost = {
      ...oldViewedPost,
      id: 'post-old-unseen',
      isViewed: false,
    };

    const freshViewedPost: UnifiedPost = {
      ...oldViewedPost,
      id: 'post-fresh-viewed',
      createdAt: freshTimestamp,
      fetchedAt: freshTimestamp,
      isViewed: true,
    };

    db.savePosts([oldViewedPost, oldUnseenPost, freshViewedPost]);

    const result = runAutoEviction(db, 48 * 3600 * 1000);
    expect(result.evictedPosts).toBe(1); // Only oldViewedPost is evicted!

    // The old UNSEEN post must NOT be evicted
    const unseen = db.getUnseenPosts();
    expect(unseen.some((p) => p.id === 'post-old-unseen')).toBe(true);

    // Clear all cache empties everything
    const clearResult = clearAllCache(db);
    expect(clearResult.clearedPosts).toBe(2);
    expect(db.getUnseenPosts()).toHaveLength(0);
  });
});
