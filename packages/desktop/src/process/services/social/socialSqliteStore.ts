/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SocialAccount,
  SocialPermissions,
  SocialStorageStats,
  UnifiedConversation,
  UnifiedMessage,
  UnifiedPost,
  UnifiedReel,
} from '@/common/types/social';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';
import type { SocialDbInstance } from './socialDb';

type PayloadRow = { payload: string };
type CountRow = { count: number };
type SizeRow = { bytes: number | null };

const parsePayload = <T>(row: unknown): T => {
  if (!row || typeof (row as PayloadRow).payload !== 'string') {
    throw new Error('SOCIAL_CACHE_PAYLOAD_INVALID');
  }
  try {
    const parsed: unknown = JSON.parse((row as PayloadRow).payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('SOCIAL_CACHE_PAYLOAD_INVALID');
    }
    return parsed as T;
  } catch {
    throw new Error('SOCIAL_CACHE_PAYLOAD_INVALID');
  }
};
const page = (value: number | undefined, fallback: number, max: number): number =>
  value === undefined || !Number.isSafeInteger(value) ? fallback : Math.min(Math.max(0, value), max);

/**
 * Durable Social metadata cache. Authentication cookies remain in Electron
 * partitions, never in this database or the renderer payload.
 */
export class SqliteSocialStore implements SocialDbInstance {
  readonly mode = 'sqlite' as const;

  constructor(
    private readonly driver: ISqliteDriver,
    dbPath: string = ':memory:'
  ) {
    const row = driver.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    const version = row?.user_version;
    if (!Number.isSafeInteger(version) || version === undefined || version < 0 || version > 1) {
      throw new Error('SOCIAL_DB_VERSION_UNSUPPORTED');
    }
    if (version === 1) return;

    // A legacy unversioned DB may contain valuable accounts and unread data.
    // SQLite VACUUM INTO produces a consistent backup without copying a live WAL file.
    if (dbPath !== ':memory:') {
      const existingTables = driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'social_%'")
        .all();
      if (existingTables.length) {
        const backupPath = `${dbPath}.pre-social-v1.bak`;
        const escaped = backupPath.replaceAll("'", "''");
        try {
          driver.exec(`VACUUM INTO '${escaped}'`);
        } catch {
          // Never upgrade a legacy database unless the safety backup succeeded.
          throw new Error('SOCIAL_DB_BACKUP_FAILED');
        }
      }
    }
    driver.transaction(() => {
      driver.exec(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id TEXT PRIMARY KEY, connected_at INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS social_posts (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL, viewed INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS social_posts_queue
        ON social_posts (viewed, account_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS social_reels (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL, viewed INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS social_reels_queue
        ON social_reels (viewed, account_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS social_conversations (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, last_message_at INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS social_messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sent_at INTEGER NOT NULL, payload TEXT NOT NULL
      );
            CREATE INDEX IF NOT EXISTS social_messages_thread
        ON social_messages (conversation_id, sent_at);
    `);
      driver.exec('PRAGMA user_version = 1');
    })();
  }

  saveAccount(account: SocialAccount): void {
    this.driver
      .prepare(`
      INSERT INTO social_accounts (id, connected_at, payload) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET connected_at = excluded.connected_at, payload = excluded.payload
    `)
      .run(account.id, account.connectedAt, JSON.stringify(account));
  }

  getAccounts(): SocialAccount[] {
    return this.driver
      .prepare('SELECT payload FROM social_accounts ORDER BY connected_at DESC')
      .all()
      .map((row) => parsePayload<SocialAccount>(row));
  }

  removeAccount(accountId: string): void {
    this.driver.transaction(() => {
      this.driver
        .prepare(
          'DELETE FROM social_messages WHERE conversation_id IN (SELECT id FROM social_conversations WHERE account_id = ?)'
        )
        .run(accountId);
      this.driver.prepare('DELETE FROM social_conversations WHERE account_id = ?').run(accountId);
      this.driver.prepare('DELETE FROM social_posts WHERE account_id = ?').run(accountId);
      this.driver.prepare('DELETE FROM social_reels WHERE account_id = ?').run(accountId);
      this.driver.prepare('DELETE FROM social_accounts WHERE id = ?').run(accountId);
    })();
  }

  updateAccountPermissions(accountId: string, permissions: SocialPermissions): void {
    const account = this.getAccounts().find((entry) => entry.id === accountId);
    if (account) this.saveAccount({ ...account, permissions: { ...permissions } });
  }

  savePosts(posts: UnifiedPost[]): void {
    const statement = this.driver.prepare(`
      INSERT INTO social_posts (id, account_id, created_at, fetched_at, viewed, payload)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fetched_at = excluded.fetched_at,
        viewed = MAX(social_posts.viewed, excluded.viewed),
        payload = excluded.payload
      WHERE social_posts.account_id = excluded.account_id
    `);
    this.driver.transaction(() => {
      for (const post of posts) {
        statement.run(
          post.id,
          post.accountId,
          post.createdAt,
          post.fetchedAt,
          Number(post.isViewed),
          JSON.stringify(post)
        );
      }
    })();
  }

  getUnseenPosts(
    accountId?: string,
    limit?: number,
    offset?: number,
    allowedAccountIds?: readonly string[]
  ): UnifiedPost[] {
    if (allowedAccountIds?.length === 0) return [];
    const filter = allowedAccountIds ? `AND account_id IN (${allowedAccountIds.map(() => '?').join(',')})` : '';
    const accountFilter = accountId ? 'AND account_id = ?' : '';
    const args: unknown[] = [...(accountId ? [accountId] : []), ...(allowedAccountIds ?? [])];
    return this.driver
      .prepare(`
      SELECT payload FROM social_posts WHERE viewed = 0 ${accountFilter} ${filter}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `)
      .all(...args, page(limit, 50, 100), page(offset, 0, 100000))
      .map((row) => parsePayload<UnifiedPost>(row));
  }

  getPostOwner(postId: string): string | undefined {
    return (
      this.driver.prepare('SELECT account_id FROM social_posts WHERE id = ?').get(postId) as
        | { account_id: string }
        | undefined
    )?.account_id;
  }

  markPostViewed(postId: string): void {
    this.driver.prepare('UPDATE social_posts SET viewed = 1 WHERE id = ?').run(postId);
  }

  saveReels(reels: UnifiedReel[]): void {
    const statement = this.driver.prepare(`
      INSERT INTO social_reels (id, account_id, created_at, fetched_at, viewed, payload)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fetched_at = excluded.fetched_at,
        viewed = MAX(social_reels.viewed, excluded.viewed),
        payload = excluded.payload
      WHERE social_reels.account_id = excluded.account_id
    `);
    this.driver.transaction(() => {
      for (const reel of reels) {
        statement.run(
          reel.id,
          reel.accountId,
          reel.createdAt,
          reel.fetchedAt,
          Number(reel.isViewed),
          JSON.stringify(reel)
        );
      }
    })();
  }

  getUnseenReels(
    accountId?: string,
    limit?: number,
    offset?: number,
    allowedAccountIds?: readonly string[]
  ): UnifiedReel[] {
    if (allowedAccountIds?.length === 0) return [];
    const filter = allowedAccountIds ? `AND account_id IN (${allowedAccountIds.map(() => '?').join(',')})` : '';
    const accountFilter = accountId ? 'AND account_id = ?' : '';
    const args: unknown[] = [...(accountId ? [accountId] : []), ...(allowedAccountIds ?? [])];
    return this.driver
      .prepare(`
      SELECT payload FROM social_reels WHERE viewed = 0 ${accountFilter} ${filter}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `)
      .all(...args, page(limit, 30, 100), page(offset, 0, 100000))
      .map((row) => parsePayload<UnifiedReel>(row));
  }

  getReelOwner(reelId: string): string | undefined {
    return (
      this.driver.prepare('SELECT account_id FROM social_reels WHERE id = ?').get(reelId) as
        | { account_id: string }
        | undefined
    )?.account_id;
  }

  markReelViewed(reelId: string): void {
    this.driver.prepare('UPDATE social_reels SET viewed = 1 WHERE id = ?').run(reelId);
  }

  saveConversations(conversations: UnifiedConversation[]): void {
    const statement = this.driver.prepare(`
      INSERT INTO social_conversations (id, account_id, last_message_at, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_message_at = excluded.last_message_at, payload = excluded.payload
      WHERE social_conversations.account_id = excluded.account_id
    `);
    this.driver.transaction(() => {
      for (const conversation of conversations) {
        statement.run(
          conversation.id,
          conversation.accountId,
          conversation.lastMessageAt,
          JSON.stringify(conversation)
        );
      }
    })();
  }

  getConversations(accountId?: string): UnifiedConversation[] {
    const where = accountId ? 'WHERE account_id = ?' : '';
    return this.driver
      .prepare(`
      SELECT payload FROM social_conversations ${where} ORDER BY last_message_at DESC
    `)
      .all(...(accountId ? [accountId] : []))
      .map((row) => parsePayload<UnifiedConversation>(row));
  }

  saveMessages(messages: UnifiedMessage[]): void {
    const statement = this.driver.prepare(`
      INSERT INTO social_messages (id, conversation_id, sent_at, payload) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET sent_at = excluded.sent_at, payload = excluded.payload
      WHERE social_messages.conversation_id = excluded.conversation_id
    `);
    this.driver.transaction(() => {
      for (const message of messages) {
        statement.run(message.id, message.conversationId, message.sentAt, JSON.stringify(message));
      }
    })();
  }

  getMessages(conversationId: string): UnifiedMessage[] {
    return this.driver
      .prepare(`
      SELECT payload FROM social_messages WHERE conversation_id = ? ORDER BY sent_at ASC
    `)
      .all(conversationId)
      .map((row) => parsePayload<UnifiedMessage>(row));
  }

  getStorageStats(): SocialStorageStats {
    const count = (table: 'social_posts' | 'social_reels'): number =>
      (this.driver.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow).count;
    const bytes = (table: 'social_posts' | 'social_reels'): number =>
      (
        this.driver
          .prepare(`SELECT COALESCE(SUM(LENGTH(CAST(payload AS BLOB))), 0) AS bytes FROM ${table}`)
          .get() as SizeRow
      ).bytes ?? 0;
    return {
      cacheSizeBytes: bytes('social_posts') + bytes('social_reels'),
      cachedPostsCount: count('social_posts'),
      cachedReelsCount: count('social_reels'),
      cachedMediaFilesCount: 0,
    };
  }

  deleteViewedPostsOlderThan(thresholdMs: number): number {
    return this.driver.prepare('DELETE FROM social_posts WHERE viewed = 1 AND fetched_at < ?').run(thresholdMs).changes;
  }

  deleteViewedReelsOlderThan(thresholdMs: number): number {
    return this.driver.prepare('DELETE FROM social_reels WHERE viewed = 1 AND fetched_at < ?').run(thresholdMs).changes;
  }

  clearAllCache(): { clearedPosts: number; clearedReels: number } {
    return this.driver.transaction(() => {
      const clearedPosts = this.driver.prepare('DELETE FROM social_posts').run().changes;
      const clearedReels = this.driver.prepare('DELETE FROM social_reels').run().changes;
      return { clearedPosts, clearedReels };
    })();
  }

  close(): void {
    this.driver.close();
  }
}
