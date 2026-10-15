/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Conversation message page (2026-10-16). Paging order is checked against a naive sort, compact mode cuts long text
 * but keeps identity fields, and known_revision returns an unchanged reply until a message changes.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import { NativeConversationRepository } from '@process/services/database/nativeConversation/repository';
import {
  COMPACT_STRING_MAX_CHARS,
  compactMessage,
  readMessagePage,
} from '@process/services/database/conversationPage/messagePage';

const CONVERSATION = 'conversation-1';

const textMessage = (id: string, createdAt: number, text: string): TMessage =>
  ({
    id,
    msg_id: id,
    conversation_id: CONVERSATION,
    type: 'text',
    position: 'left',
    created_at: createdAt,
    content: { content: text },
  }) as never;

describe('conversation message page', () => {
  let directory = '';
  let repository: NativeConversationRepository;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-page-'));
    repository = new NativeConversationRepository(path.join(directory, 'conversations.json'));
    await repository.initialize();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('pages in the same order as a naive sort, in both directions, with ties kept stable', async () => {
    const stamps = [5, 1, 3, 3, 9, 2, 7, 7, 0, 4, 8, 6];
    for (const [index, stamp] of stamps.entries()) {
      await repository.saveMessage(textMessage(`m-${index}`, stamp, `text ${index}`));
    }
    const naive = stamps
      .map((stamp, index) => ({ id: `m-${index}`, stamp }))
      .toSorted((left, right) => left.stamp - right.stamp)
      .map((entry) => entry.id);
    expect(await repository.countMessages(CONVERSATION)).toBe(stamps.length);
    for (const [start, size] of [
      [0, 5],
      [3, 4],
      [10, 5],
      [20, 3],
    ] as const) {
      const asc = await repository.pageMessages(CONVERSATION, start, size, false);
      expect(asc.items.map((item) => item.id)).toEqual(naive.slice(start, start + size));
      const desc = await repository.pageMessages(CONVERSATION, start, size, true);
      const reversed = naive.toReversed();
      expect(desc.items.map((item) => item.id)).toEqual(reversed.slice(start, start + size));
      expect(desc.total).toBe(stamps.length);
    }
  });

  it('keeps identity fields and cuts only long strings in compact mode', () => {
    const long = 'x'.repeat(COMPACT_STRING_MAX_CHARS + 500);
    const message = {
      id: 'tool-1',
      msg_id: 'tool-1',
      conversation_id: CONVERSATION,
      type: 'tool_group',
      position: 'left',
      created_at: 42,
      content: [{ call_id: 'c1', name: 'tomny_read', result_display: long, input: { note: 'short' } }],
    } as unknown as TMessage;
    const compact = compactMessage(message);
    expect(compact.id).toBe('tool-1');
    expect(compact.created_at).toBe(42);
    const row = (compact.content as Array<{ result_display: string; input: { note: string } }>)[0];
    expect(row.result_display.startsWith('x'.repeat(COMPACT_STRING_MAX_CHARS))).toBe(true);
    expect(row.result_display).toContain('[truncated: 500 more characters]');
    expect(row.input.note).toBe('short');
    expect(message.content).not.toBe(compact.content);
  });

  it('returns an unchanged reply while the revision matches, and changes after a save', async () => {
    await repository.saveMessage(textMessage('a', 1, 'first'));
    const first = await readMessagePage(repository, {
      conversationId: CONVERSATION,
      pageSize: 10,
      order: 'desc',
      contentMode: 'compact',
    });
    expect(first.unchanged).toBe(false);
    expect(first.items).toHaveLength(1);

    const unchanged = await readMessagePage(repository, {
      conversationId: CONVERSATION,
      pageSize: 10,
      order: 'desc',
      contentMode: 'compact',
      knownRevision: first.revision,
    });
    expect(unchanged.unchanged).toBe(true);
    expect(unchanged.items).toEqual([]);
    expect(unchanged.total).toBe(1);

    await repository.saveMessage(textMessage('b', 2, 'second'));
    const changed = await readMessagePage(repository, {
      conversationId: CONVERSATION,
      pageSize: 10,
      order: 'desc',
      knownRevision: first.revision,
    });
    expect(changed.unchanged).toBe(false);
    expect(changed.items[0]?.id).toBe('b');
    expect(changed.revision).toBeGreaterThan(first.revision);
  });

  it('bumps the revision when a conversation is cleared or removed', async () => {
    await repository.saveMessage(textMessage('a', 1, 'first'));
    const before = repository.messageRevision(CONVERSATION);
    await repository.clearMessages(CONVERSATION);
    expect(repository.messageRevision(CONVERSATION)).toBeGreaterThan(before);
    expect(await repository.countMessages(CONVERSATION)).toBe(0);
  });
});
