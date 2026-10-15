/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Message page for the conversation read channel (2026-10-16). With content_mode 'compact', strings longer than
 * {@link COMPACT_STRING_MAX_CHARS} (tool output, long arguments) are cut server-side, and lists are capped, so a card
 * that polls the latest messages does not move megabytes per poll. Ids, types, order and timestamps are never changed.
 * The full text stays available through the single-message read. With known_revision equal to the conversation's
 * current revision, the page is returned as unchanged with no items.
 * Process boundary: Main-process module, no DOM APIs.
 */

import type { TMessage } from '@/common/chat/chatLib';

/** Longest string kept in a compact message. Longer text is cut and marked with its original length. */
export const COMPACT_STRING_MAX_CHARS = 4_000;
const COMPACT_ARRAY_MAX_ITEMS = 60;
const COMPACT_MAX_DEPTH = 8;
const MAX_PAGE_SIZE = 500;

/** The part of the repository a page read needs. */
export type MessagePageSource = Readonly<{
  pageMessages: (
    conversationId: string,
    start: number,
    size: number,
    descending: boolean,
    project?: (message: TMessage) => TMessage
  ) => Promise<{ items: TMessage[]; total: number }>;
  countMessages: (conversationId: string) => Promise<number>;
  messageRevision: (conversationId: string) => number;
}>;

export type MessagePageRequest = Readonly<{
  conversationId: string;
  page?: number;
  pageSize?: number;
  order?: string;
  contentMode?: 'compact' | 'full';
  knownRevision?: number;
}>;

export type MessagePageResult = Readonly<{
  items: TMessage[];
  total: number;
  has_more: boolean;
  revision: number;
  unchanged: boolean;
}>;

const compactValue = (value: unknown, depth: number): unknown => {
  if (typeof value === 'string') {
    if (value.length <= COMPACT_STRING_MAX_CHARS) return value;
    return `${value.slice(0, COMPACT_STRING_MAX_CHARS)} [truncated: ${value.length - COMPACT_STRING_MAX_CHARS} more characters]`;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= COMPACT_MAX_DEPTH) return '[omitted]';
  if (Array.isArray(value)) {
    return value.slice(0, COMPACT_ARRAY_MAX_ITEMS).map((item: unknown) => compactValue(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]: [string, unknown]) => [key, compactValue(item, depth + 1)])
  );
};

/** A fresh compact copy of one message. Builds new containers, so the stored message is never shared with the reply. */
export const compactMessage = (message: TMessage): TMessage => ({
  ...message,
  content: compactValue(message.content, 0),
}) as TMessage;

/** One page of a conversation, with the revision the page was read at. */
export const readMessagePage = async (
  source: MessagePageSource,
  request: MessagePageRequest
): Promise<MessagePageResult> => {
  const size = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(request.pageSize ?? 50)));
  const page = Math.max(1, Math.trunc(request.page ?? 1));
  const start = (page - 1) * size;
  const descending = (request.order ?? 'asc').toLowerCase() === 'desc';
  const revision = source.messageRevision(request.conversationId);
  const total = await source.countMessages(request.conversationId);
  const hasMore = start + size < total;
  if (request.knownRevision !== undefined && request.knownRevision === revision) {
    return { items: [], total, has_more: hasMore, revision, unchanged: true };
  }
  const project = request.contentMode === 'compact' ? compactMessage : undefined;
  const { items } = await source.pageMessages(request.conversationId, start, size, descending, project);
  return { items, total, has_more: hasMore, revision, unchanged: false };
};
