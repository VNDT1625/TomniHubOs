/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type LegacyDatabaseImport = {
  source: string;
  imported_at: number;
  conversations: number;
  messages: number;
};

export type NativeConversationSnapshot = {
  version: 1;
  conversations: TChatConversation[];
  messages: TMessage[];
  migrations?: {
    /** Kept for readers introduced during the first native cutover. */
    legacyDatabase?: { source: string; imported_at: number };
    legacyDatabases?: LegacyDatabaseImport[];
  };
};

const EMPTY_SNAPSHOT: NativeConversationSnapshot = { version: 1, conversations: [], messages: [] };
const clone = <T>(value: T): T => structuredClone(value);

const jsonValue = (value: unknown, fallback: unknown): unknown => {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const messageKey = (message: Pick<TMessage, 'conversation_id' | 'id'>): string =>
  `${message.conversation_id}\0${message.id}`;

/** Atomic, serialized persistence for renderer-compatible conversation records. */
export class NativeConversationRepository {
  private snapshot: NativeConversationSnapshot = clone(EMPTY_SNAPSHOT);
  private initialized: Promise<void> | undefined;
  private writeQueue = Promise.resolve();
  private readonly legacyDatabasePaths: string[];

  public constructor(
    private readonly filePath: string,
    legacyDatabasePath?: string | readonly string[]
  ) {
    const candidates = typeof legacyDatabasePath === 'string' ? [legacyDatabasePath] : (legacyDatabasePath ?? []);
    this.legacyDatabasePaths = [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
  }

  public initialize(): Promise<void> {
    this.initialized ??= this.load();
    return this.initialized;
  }

  public async getConversation(id: string): Promise<TChatConversation | undefined> {
    await this.initialize();
    const value = this.snapshot.conversations.find((item) => item.id === id);
    return value ? clone(value) : undefined;
  }

  public async listConversations(): Promise<TChatConversation[]> {
    await this.initialize();
    return clone(this.snapshot.conversations).toSorted((left, right) => right.modified_at - left.modified_at);
  }

  public async saveConversation(conversation: TChatConversation): Promise<void> {
    await this.initialize();
    const index = this.snapshot.conversations.findIndex((item) => item.id === conversation.id);
    if (index >= 0) this.snapshot.conversations[index] = clone(conversation);
    else this.snapshot.conversations.push(clone(conversation));
    await this.flush();
  }

  public async removeConversation(id: string): Promise<boolean> {
    await this.initialize();
    const before = this.snapshot.conversations.length;
    this.snapshot.conversations = this.snapshot.conversations.filter((item) => item.id !== id);
    this.snapshot.messages = this.snapshot.messages.filter((item) => item.conversation_id !== id);
    if (before === this.snapshot.conversations.length) return false;
    await this.flush();
    return true;
  }

  public async listMessages(conversationId: string): Promise<TMessage[]> {
    await this.initialize();
    return clone(this.snapshot.messages.filter((item) => item.conversation_id === conversationId)).toSorted(
      (left, right) => (left.created_at ?? 0) - (right.created_at ?? 0)
    );
  }

  public async getMessage(conversationId: string, messageId: string): Promise<TMessage | undefined> {
    await this.initialize();
    const value = this.snapshot.messages.find(
      (item) => item.conversation_id === conversationId && (item.id === messageId || item.msg_id === messageId)
    );
    return value ? clone(value) : undefined;
  }

  public async saveMessage(message: TMessage): Promise<void> {
    await this.initialize();
    const index = this.snapshot.messages.findIndex(
      (item) => item.conversation_id === message.conversation_id && item.id === message.id
    );
    if (index >= 0) this.snapshot.messages[index] = clone(message);
    else this.snapshot.messages.push(clone(message));
    await this.flush();
  }

  public async clearMessages(conversationId: string): Promise<void> {
    await this.initialize();
    this.snapshot.messages = this.snapshot.messages.filter((item) => item.conversation_id !== conversationId);
    await this.flush();
  }

  private async load(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let shouldFlush = false;
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<NativeConversationSnapshot>;
      this.snapshot = {
        version: 1,
        conversations: Array.isArray(value.conversations) ? value.conversations : [],
        messages: Array.isArray(value.messages) ? value.messages : [],
        ...(value.migrations ? { migrations: value.migrations } : {}),
      };
      for (const conversation of this.snapshot.conversations) {
        if (conversation.status === 'running') {
          conversation.status = 'finished';
          shouldFlush = true;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.snapshot = clone(EMPTY_SNAPSHOT);
      shouldFlush = true;
    }

    if (await this.mergeLegacyDatabases()) shouldFlush = true;
    if (shouldFlush) await this.flush();
  }

  private async mergeLegacyDatabases(): Promise<boolean> {
    const migrations = (this.snapshot.migrations ??= {});
    const imports = (migrations.legacyDatabases ??= []);
    const importedSources = new Set(imports.map((entry) => path.resolve(entry.source)));
    if (migrations.legacyDatabase?.source) importedSources.add(path.resolve(migrations.legacyDatabase.source));

    const conversationIds = new Set(this.snapshot.conversations.map((conversation) => conversation.id));
    const messageIds = new Set(this.snapshot.messages.map(messageKey));
    let changed = false;

    for (const source of this.legacyDatabasePaths) {
      if (!existsSync(source) || importedSources.has(source)) continue;
      let imported: Pick<NativeConversationSnapshot, 'conversations' | 'messages'>;
      try {
        imported = await this.readLegacyDatabase(source, conversationIds);
      } catch (error) {
        console.warn('[TomnyCore] Legacy conversation import skipped:', source, error);
        continue;
      }

      let conversationCount = 0;
      for (const conversation of imported.conversations) {
        if (conversationIds.has(conversation.id)) continue;
        conversationIds.add(conversation.id);
        this.snapshot.conversations.push(conversation);
        conversationCount += 1;
      }

      let messageCount = 0;
      for (const message of imported.messages) {
        const key = messageKey(message);
        if (!conversationIds.has(message.conversation_id) || messageIds.has(key)) continue;
        messageIds.add(key);
        this.snapshot.messages.push(message);
        messageCount += 1;
      }

      const importedAt = Date.now();
      imports.push({
        source,
        imported_at: importedAt,
        conversations: conversationCount,
        messages: messageCount,
      });
      migrations.legacyDatabase ??= { source, imported_at: importedAt };
      importedSources.add(source);
      changed = true;
    }

    return changed;
  }

  private async readLegacyDatabase(
    source: string,
    knownConversationIds: ReadonlySet<string>
  ): Promise<Pick<NativeConversationSnapshot, 'conversations' | 'messages'>> {
    const module = await import('better-sqlite3');
    const Database = module.default;
    const database = new Database(source, { readonly: true, fileMustExist: true });
    try {
      const rows = database.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as Array<
        Record<string, unknown>
      >;
      const conversations = rows.flatMap((row): TChatConversation[] => {
        if (typeof row.id !== 'string' || typeof row.type !== 'string') return [];
        const extra = jsonValue(row.extra, {});
        const model = jsonValue(row.model, undefined);
        return [
          {
            id: row.id,
            name: typeof row.name === 'string' ? row.name : 'Conversation',
            type: row.type,
            extra: extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {},
            ...(model && typeof model === 'object' && !Array.isArray(model) ? { model } : {}),
            status: row.status,
            source: row.source,
            channel_chat_id: row.channel_chat_id,
            created_at: typeof row.created_at === 'number' ? row.created_at : Date.now(),
            modified_at: typeof row.updated_at === 'number' ? row.updated_at : Date.now(),
          } as TChatConversation,
        ];
      });

      const allowedConversationIds = new Set(knownConversationIds);
      for (const conversation of conversations) allowedConversationIds.add(conversation.id);
      const messageRows = database.prepare('SELECT * FROM messages ORDER BY created_at ASC').all() as Array<
        Record<string, unknown>
      >;
      const messages = messageRows.flatMap((row): TMessage[] => {
        if (
          typeof row.id !== 'string' ||
          typeof row.conversation_id !== 'string' ||
          typeof row.type !== 'string' ||
          !allowedConversationIds.has(row.conversation_id)
        )
          return [];
        return [
          {
            id: row.id,
            msg_id: typeof row.msg_id === 'string' ? row.msg_id : undefined,
            conversation_id: row.conversation_id,
            type: row.type,
            content: jsonValue(row.content, {}),
            position: row.position,
            status: row.status,
            created_at: typeof row.created_at === 'number' ? row.created_at : Date.now(),
          } as TMessage,
        ];
      });
      return { conversations, messages };
    } finally {
      database.close();
    }
  }

  private async flush(): Promise<void> {
    const snapshot = clone(this.snapshot);
    this.writeQueue = this.writeQueue.then(async () => {
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }
}
