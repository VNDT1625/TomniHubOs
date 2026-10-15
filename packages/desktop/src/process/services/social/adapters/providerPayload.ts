/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import type { UnifiedConversation, UnifiedMessage, UnifiedPost, UnifiedReel } from '@/common/types/social';

type ObjectMap = Record<string, unknown>;
const record = (value: unknown): value is ObjectMap => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const optionalShort = (value: unknown, max = 160): boolean => value === undefined || short(value, max);
const boundedText = (value: unknown, max = 16000): value is string =>
  typeof value === 'string' && value.length <= max;
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000;
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const httpsUrl = (value: unknown, optional = false): boolean => {
  if (optional && value === '') return true;
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    const uri = new URL(value);
        return uri.protocol === 'https:' && uri.hostname.includes('.') && !uri.username && !uri.password &&
      !/^([0-9]+[.]){3}[0-9]+$/.test(uri.hostname) && !uri.hostname.startsWith('[') &&
      !uri.hostname.endsWith('.local') && !uri.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
};

const author = (value: unknown, withVerified = false): boolean =>
  record(value) && short(value.name) && boundedText(value.handle, 160) &&
  httpsUrl(value.avatarUrl, true) && (!withVerified || (bool(value.verified) && httpsUrl(value.profileUrl, true)));

const stats = (value: unknown): boolean => record(value) &&
  count(value.likesCount) && count(value.commentsCount) && count(value.sharesCount);

const mediaItem = (value: unknown): boolean =>
  record(value) && ['image', 'video', 'gif'].includes(String(value.type)) &&
  httpsUrl(value.url) && (value.thumbnailUrl === undefined || httpsUrl(value.thumbnailUrl, true)) &&
  (value.aspectRatio === undefined ||
    (typeof value.aspectRatio === 'number' && Number.isFinite(value.aspectRatio) &&
      value.aspectRatio > 0 && value.aspectRatio < 100));

export function validProviderPost(value: unknown): value is UnifiedPost {
  if (!record(value)) return false;
  return short(value.id) && short(value.accountId) && short(value.originPostId) &&
    ['x', 'facebook', 'threads', 'reddit'].includes(String(value.platform)) &&
    author(value.author, true) && boundedText(value.content) &&
    Array.isArray(value.media) && value.media.length <= 8 && value.media.every(mediaItem) &&
    time(value.createdAt) && time(value.fetchedAt) && bool(value.isViewed) &&
    stats(value.stats) && record(value.userState) && bool(value.userState.hasLiked) &&
    bool(value.userState.hasSaved) && httpsUrl(value.permalink);
}

export function validProviderReel(value: unknown): value is UnifiedReel {
  if (!record(value)) return false;
  return short(value.id) && short(value.accountId) && short(value.originVideoId) &&
    ['facebook', 'tiktok', 'youtube'].includes(String(value.platform)) && author(value.author) &&
    boundedText(value.caption) && httpsUrl(value.videoStreamUrl) &&
    httpsUrl(value.thumbnailUrl, true) && count(value.durationMs) &&
    optionalShort(value.musicTitle, 200) && time(value.createdAt) && time(value.fetchedAt) &&
    bool(value.isViewed) && stats(value.stats) && record(value.userState) &&
    bool(value.userState.hasLiked) && httpsUrl(value.permalink);
}

export function validProviderConversation(value: unknown): value is UnifiedConversation {
  if (!record(value)) return false;
  return short(value.id) && short(value.accountId) && short(value.threadId) &&
    ['facebook', 'x', 'reddit'].includes(String(value.platform)) && author(value.participant) &&
    boundedText(value.lastMessageSnippet, 4096) &&
    time(value.lastMessageAt) && count(value.unreadCount);
}

export function validProviderMessage(value: unknown): value is UnifiedMessage {
  if (!record(value)) return false;
  return short(value.id) && short(value.conversationId) && short(value.senderId) &&
    bool(value.isFromMe) && boundedText(value.content) &&
    time(value.sentAt) && ['sent', 'delivered', 'read', 'failed'].includes(String(value.status)) &&
    (value.mediaUrls === undefined ||
      (Array.isArray(value.mediaUrls) && value.mediaUrls.length <= 8 && value.mediaUrls.every((url) => httpsUrl(url))));
}

export function validProviderBatch<T>(
  value: unknown, validate: (item: unknown) => item is T, maxItems: number
): value is T[] {
  return Array.isArray(value) && value.length <= maxItems && value.every(validate);
}
