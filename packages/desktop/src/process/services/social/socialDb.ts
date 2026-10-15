/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SocialAccount,
  SocialPermissions,
  UnifiedPost,
  UnifiedReel,
  UnifiedConversation,
  UnifiedMessage,
  SocialStorageStats,
} from '@/common/types/social';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';
import { BetterSqlite3Driver } from '@/process/services/database/drivers/BetterSqlite3Driver';
import { SqliteSocialStore } from './socialSqliteStore';

export type SocialStoreMode = 'memory' | 'sqlite';

export interface SocialDbInstance {
  saveAccount(account: SocialAccount): void;
  getAccounts(): SocialAccount[];
  removeAccount(accountId: string): void;
  updateAccountPermissions(accountId: string, permissions: SocialPermissions): void;

  savePosts(posts: UnifiedPost[]): void;
  getUnseenPosts(
    accountId?: string,
    limit?: number,
    offset?: number,
    allowedAccountIds?: readonly string[]
  ): UnifiedPost[];
  getPostOwner(postId: string): string | undefined;
  markPostViewed(postId: string): void;

  saveReels(reels: UnifiedReel[]): void;
  getUnseenReels(
    accountId?: string,
    limit?: number,
    offset?: number,
    allowedAccountIds?: readonly string[]
  ): UnifiedReel[];
  getReelOwner(reelId: string): string | undefined;
  markReelViewed(reelId: string): void;

  saveConversations(conversations: UnifiedConversation[]): void;
  getConversations(accountId?: string): UnifiedConversation[];

  saveMessages(messages: UnifiedMessage[]): void;
  getMessages(conversationId: string): UnifiedMessage[];

  getStorageStats(): SocialStorageStats;
  deleteViewedPostsOlderThan(thresholdMs: number): number;
  deleteViewedReelsOlderThan(thresholdMs: number): number;
  clearAllCache(): { clearedPosts: number; clearedReels: number };
  close(): void;

  /** True only when backed by a persistent SQLite file. */
  readonly mode: SocialStoreMode;
  /** Set when a requested durable store could not be opened safely. */
  readonly unavailableReason?: string;
}

/**
 * In-memory fallback driver store when BetterSqlite3 native binary is unavailable
 * or when `:memory:` is requested.
 */
class InMemorySocialStore implements SocialDbInstance {
  readonly mode: SocialStoreMode = 'memory';
  private accounts = new Map<string, SocialAccount>();
  private posts = new Map<string, UnifiedPost>();
  private reels = new Map<string, UnifiedReel>();
  private conversations = new Map<string, UnifiedConversation>();
  private messages: UnifiedMessage[] = [];

  saveAccount(account: SocialAccount): void {
    this.accounts.set(account.id, { ...account });
  }

  getAccounts(): SocialAccount[] {
    return Array.from(this.accounts.values()).toSorted((a, b) => b.connectedAt - a.connectedAt);
  }

  removeAccount(accountId: string): void {
    this.accounts.delete(accountId);
    for (const [id, post] of this.posts) if (post.accountId === accountId) this.posts.delete(id);
    for (const [id, reel] of this.reels) if (reel.accountId === accountId) this.reels.delete(id);
    const threads = new Set(
      Array.from(this.conversations.values())
        .filter((c) => c.accountId === accountId)
        .map((c) => c.id)
    );
    for (const id of threads) this.conversations.delete(id);
    this.messages = this.messages.filter((m) => !threads.has(m.conversationId));
  }

  updateAccountPermissions(accountId: string, permissions: SocialPermissions): void {
    const existing = this.accounts.get(accountId);
    if (existing) {
      existing.permissions = { ...permissions };
    }
  }

  savePosts(posts: UnifiedPost[]): void {
    for (const post of posts) {
      const existing = this.posts.get(post.id);
      if (existing && existing.accountId !== post.accountId) continue;
      this.posts.set(post.id, { ...post, isViewed: Boolean(post.isViewed || existing?.isViewed) });
    }
  }

  getUnseenPosts(
    accountId?: string,
    limit: number = 50,
    offset: number = 0,
    allowedAccountIds?: readonly string[]
  ): UnifiedPost[] {
    const allowed = allowedAccountIds === undefined ? null : new Set(allowedAccountIds);
    let list = Array.from(this.posts.values()).filter(
      (p) => !p.isViewed && (allowed === null || allowed.has(p.accountId))
    );
    if (accountId) {
      list = list.filter((p) => p.accountId === accountId);
    }
    list = list.toSorted((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return list.slice(offset, offset + limit);
  }

  getPostOwner(postId: string): string | undefined {
    return this.posts.get(postId)?.accountId;
  }

  markPostViewed(postId: string): void {
    const p = this.posts.get(postId);
    if (p) {
      p.isViewed = true;
    }
  }

  saveReels(reels: UnifiedReel[]): void {
    for (const reel of reels) {
      const existing = this.reels.get(reel.id);
      if (existing && existing.accountId !== reel.accountId) continue;
      this.reels.set(reel.id, { ...reel, isViewed: Boolean(reel.isViewed || existing?.isViewed) });
    }
  }

  getUnseenReels(
    accountId?: string,
    limit: number = 30,
    offset: number = 0,
    allowedAccountIds?: readonly string[]
  ): UnifiedReel[] {
    const allowed = allowedAccountIds === undefined ? null : new Set(allowedAccountIds);
    let list = Array.from(this.reels.values()).filter(
      (r) => !r.isViewed && (allowed === null || allowed.has(r.accountId))
    );
    if (accountId) {
      list = list.filter((r) => r.accountId === accountId);
    }
    list = list.toSorted((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return list.slice(offset, offset + limit);
  }

  getReelOwner(reelId: string): string | undefined {
    return this.reels.get(reelId)?.accountId;
  }

  markReelViewed(reelId: string): void {
    const r = this.reels.get(reelId);
    if (r) {
      r.isViewed = true;
    }
  }

  saveConversations(conversations: UnifiedConversation[]): void {
    for (const c of conversations) {
      const existing = this.conversations.get(c.id);
      if (existing && existing.accountId !== c.accountId) continue;
      this.conversations.set(c.id, { ...c });
    }
  }

  getConversations(accountId?: string): UnifiedConversation[] {
    let list = Array.from(this.conversations.values());
    if (accountId) {
      list = list.filter((c) => c.accountId === accountId);
    }
    return list.toSorted((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  saveMessages(messages: UnifiedMessage[]): void {
    for (const m of messages) {
      const existingIndex = this.messages.findIndex((entry) => entry.id === m.id);
      if (existingIndex >= 0 && this.messages[existingIndex].conversationId !== m.conversationId) continue;
      if (existingIndex >= 0) this.messages[existingIndex] = { ...m };
      else this.messages.push({ ...m });
    }
  }

  getMessages(conversationId: string): UnifiedMessage[] {
    return this.messages.filter((m) => m.conversationId === conversationId).toSorted((a, b) => a.sentAt - b.sentAt);
  }

  getStorageStats(): SocialStorageStats {
    const postsCount = this.posts.size;
    const reelsCount = this.reels.size;
    return {
      cacheSizeBytes: (postsCount + reelsCount) * 4096,
      cachedPostsCount: postsCount,
      cachedReelsCount: reelsCount,
      cachedMediaFilesCount: 0,
    };
  }

  deleteViewedPostsOlderThan(thresholdMs: number): number {
    let count = 0;
    for (const [id, post] of this.posts.entries()) {
      if (post.isViewed && post.fetchedAt < thresholdMs) {
        this.posts.delete(id);
        count++;
      }
    }
    return count;
  }

  deleteViewedReelsOlderThan(thresholdMs: number): number {
    let count = 0;
    for (const [id, reel] of this.reels.entries()) {
      if (reel.isViewed && reel.fetchedAt < thresholdMs) {
        this.reels.delete(id);
        count++;
      }
    }
    return count;
  }

  clearAllCache(): { clearedPosts: number; clearedReels: number } {
    const postsCount = this.posts.size;
    const reelsCount = this.reels.size;
    this.posts.clear();
    this.reels.clear();
    return { clearedPosts: postsCount, clearedReels: reelsCount };
  }

  close(): void {
    this.posts.clear();
    this.reels.clear();
    this.accounts.clear();
    this.conversations.clear();
    this.messages = [];
  }
}

/** An explicit persistent path must never silently degrade to volatile memory. */
export function initSocialDb(dbPath: string = ':memory:', driver?: ISqliteDriver): SocialDbInstance {
  if (driver) return new SqliteSocialStore(driver, dbPath);
  if (dbPath === ':memory:') return new InMemorySocialStore();
  const native = new BetterSqlite3Driver(dbPath);
  try {
    return new SqliteSocialStore(native, dbPath);
  } catch (error) {
    native.close();
    throw error;
  }
}
