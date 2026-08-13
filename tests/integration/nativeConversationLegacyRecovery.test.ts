/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { NativeConversationRepository } from '@process/services/database/nativeConversation';
import { resolveLegacyDatabasePath } from '@process/services/database/runLegacyDatabaseMigrations';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirectories: string[] = [];

vi.mock('better-sqlite3', () => ({
  default: class LegacyDatabaseFixture {
    public prepare(query: string): { all: () => Array<Record<string, unknown>> } {
      return {
        all: () =>
          query.includes('FROM conversations')
            ? [
                {
                  id: 'legacy-chat',
                  user_id: 'system_default_user',
                  name: 'Legacy chat',
                  type: 'acp',
                  extra: '{}',
                  model: null,
                  status: 'finished',
                  source: null,
                  channel_chat_id: null,
                  created_at: 1,
                  updated_at: 2,
                },
              ]
            : [
                {
                  id: 'legacy-message',
                  conversation_id: 'legacy-chat',
                  msg_id: 'legacy-message',
                  type: 'text',
                  content: '{"content":"still here"}',
                  position: 'left',
                  status: 'finish',
                  created_at: 3,
                },
              ],
      };
    }

    public close(): void {}
  },
}));

const createLegacyDatabase = async (directory: string): Promise<string> => {
  await mkdir(directory, { recursive: true });
  const databasePath = path.join(directory, 'tomny-backend.db');
  await writeFile(databasePath, 'legacy fixture', 'utf8');
  return databasePath;
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('native conversation legacy recovery', () => {
  it('resolves the database filename used by the existing backend', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-legacy-path-'));
    tempDirectories.push(directory);
    const legacyPath = await createLegacyDatabase(directory);

    expect(resolveLegacyDatabasePath(directory)).toBe(legacyPath);
  });

  it('recovers legacy rows when an earlier cutover already persisted an empty JSON snapshot', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-legacy-recovery-'));
    tempDirectories.push(directory);
    const legacyPath = await createLegacyDatabase(directory);
    const jsonPath = path.join(directory, 'tomni-core', 'conversations.json');
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify({ version: 1, conversations: [], messages: [] }), 'utf8');

    const first = new NativeConversationRepository(jsonPath, legacyPath);
    await first.initialize();
    expect((await first.listConversations()).map((conversation) => conversation.id)).toEqual(['legacy-chat']);
    expect((await first.listMessages('legacy-chat')).map((message) => message.id)).toEqual(['legacy-message']);

    const restarted = new NativeConversationRepository(jsonPath, legacyPath);
    await restarted.initialize();
    expect((await restarted.listConversations()).map((conversation) => conversation.id)).toEqual(['legacy-chat']);
    expect((await restarted.listMessages('legacy-chat')).map((message) => message.id)).toEqual(['legacy-message']);

    const persisted = JSON.parse(await readFile(jsonPath, 'utf8')) as {
      conversations: unknown[];
      messages: unknown[];
      migrations?: { legacyDatabase?: { source: string } };
    };
    expect(persisted.conversations).toHaveLength(1);
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.migrations?.legacyDatabase?.source).toBe(legacyPath);
  });

  it('does not resurrect a user-deleted imported conversation after restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-legacy-delete-'));
    tempDirectories.push(directory);
    const legacyPath = await createLegacyDatabase(directory);
    const jsonPath = path.join(directory, 'tomni-core', 'conversations.json');

    const imported = new NativeConversationRepository(jsonPath, legacyPath);
    await imported.initialize();
    await imported.removeConversation('legacy-chat');

    const restarted = new NativeConversationRepository(jsonPath, legacyPath);
    await restarted.initialize();
    expect(await restarted.listConversations()).toEqual([]);
    expect(await restarted.listMessages('legacy-chat')).toEqual([]);
  });
});
