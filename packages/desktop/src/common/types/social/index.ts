/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './socialChannels';

export type SocialPlatform = 'x' | 'facebook' | 'threads' | 'reddit' | 'tiktok' | 'youtube';

export interface SocialPermissions {
  canSyncFeed: boolean;
  canSyncReels: boolean;
  canReadMessages: boolean;
  canSendMessages: boolean;
}

export interface SocialAccount {
  id: string; // uuid
  platform: SocialPlatform;
  accountId: string; // platform-specific user ID
  username: string; // @handle
  displayName: string;
  avatarUrl: string;
  partitionKey: string; // 'persist:social_<platform>_<accountId>'
  status: 'connected' | 'expired' | 'error';
  permissions: SocialPermissions;
  connectedAt: number;
  lastSyncedAt: number;
}

export interface PostAuthor {
  name: string;
  handle: string;
  avatarUrl: string;
  verified: boolean;
  profileUrl: string;
}

export interface PostMediaItem {
  type: 'image' | 'video' | 'gif';
  url: string;
  thumbnailUrl?: string;
  aspectRatio?: number;
}

export interface PostStats {
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
}

export interface PostUserState {
  hasLiked: boolean;
  hasSaved: boolean;
}

export interface UnifiedPost {
  id: string; // 'platform:accountId:originPostId'
  platform: 'x' | 'facebook' | 'threads' | 'reddit';
  accountId: string;
  originPostId: string;
  author: PostAuthor;
  content: string;
  media: PostMediaItem[];
  createdAt: number;
  fetchedAt: number;
  isViewed: boolean;
  stats: PostStats;
  userState: PostUserState;
  permalink: string;
}

export interface ReelAuthor {
  name: string;
  handle: string;
  avatarUrl: string;
}

export interface UnifiedReel {
  id: string; // 'platform:accountId:originVideoId'
  platform: 'tiktok' | 'youtube' | 'facebook';
  accountId: string;
  originVideoId: string;
  author: ReelAuthor;
  caption: string;
  videoStreamUrl: string;
  thumbnailUrl: string;
  durationMs: number;
  musicTitle?: string;
  createdAt: number;
  fetchedAt: number;
  isViewed: boolean;
  stats: {
    likesCount: number;
    commentsCount: number;
    sharesCount: number;
  };
  userState: {
    hasLiked: boolean;
  };
  permalink: string;
}

export interface UnifiedConversation {
  id: string; // 'platform:accountId:threadId'
  platform: 'facebook' | 'x' | 'reddit';
  accountId: string;
  threadId: string;
  participant: {
    name: string;
    handle: string;
    avatarUrl: string;
  };
  lastMessageSnippet: string;
  lastMessageAt: number;
  unreadCount: number;
}

export interface UnifiedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  isFromMe: boolean;
  content: string;
  mediaUrls?: string[];
  sentAt: number;
  status: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface SocialStorageStats {
  cacheSizeBytes: number;
  cachedPostsCount: number;
  cachedReelsCount: number;
  cachedMediaFilesCount: number;
}
