/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Conversation store writes and history paging (2026-10-15). A burst of saves shares one persisted write, and every
 * caller's change is in the file once its save resolves. A history page clones only the requested messages.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeConversationRepository } from '@process/services/database/nativeConversation';
import type { TMessage } from '@/common/chat/chatLib';

const directories: string[] = [];

const message = (index: number, conversationId = 'conv-1'): TMessage =>
  ({
    id: `m-${index}`,
    msg_id: `m-${index}`,
    type: 'text',
    conversation_id: conversationId,
    position: 'left',
    created_at: 1_000 + index,
    status: 'finish',
    content: { content: `message ${index}` },
  }) as unknown as TMessage;

const makeRepository = async (): Promise<{ repository: NativeConversationRepository; filePath: string }> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-repo-paging-'));
  directories.push(directory);
  const filePath = path.join(directory, 'conversations.json');
  return { repository: new NativeConversationRepository(filePath), filePath };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('conversation store writes', () => {
  it('persists every message of a concurrent burst once the saves resolve', async () => {
    const { repository, filePath } = await makeRepository();
    await Promise.all(Array.from({ length: 25 }, (_unused, index) => repository.saveMessage(message(index))));
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { messages: TMessage[] };
    expect(persisted.messages.map((item) => item.id).toSorted()).toEqual(
      Array.from({ length: 25 }, (_unused, index) => `m-${index}`).toSorted()
    );
  });

  it('keeps a later save after an earlier one that was already written', async () => {
    const { repository, filePath } = await makeRepository();
    await repository.saveMessage(message(1));
    await repository.saveMessage(message(2));
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { messages: TMessage[] };
    expect(persisted.messages).toHaveLength(2);
  });
});

describe('conversation history paging', () => {
  it('returns the requested page oldest first, with the total of the conversation', async () => {
    const { repository } = await makeRepository();
    await Promise.all(Array.from({ length: 7 }, (_unused, index) => repository.saveMessage(message(index))));
    await repository.saveMessage(message(99, 'other'));
    const page = await repository.pageMessages('conv-1', 2, 3, false);
    expect(page.total).toBe(7);
    expect(page.items.map((item) => item.id)).toEqual(['m-2', 'm-3', 'm-4']);
  });

  it('returns newest first when descending and never includes another conversation', async () => {
    const { repository } = await makeRepository();
    await Promise.all(Array.from({ length: 4 }, (_unused, index) => repository.saveMessage(message(index))));
    await repository.saveMessage(message(50, 'other'));
    const page = await repository.pageMessages('conv-1', 0, 2, true);
    expect(page.items.map((item) => item.id)).toEqual(['m-3', 'm-2']);
    expect(page.total).toBe(4);
  });
});
