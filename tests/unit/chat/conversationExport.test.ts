import { describe, expect, it } from 'vitest';
import {
  sanitizeFileName,
  buildDefaultExportFileName,
  buildConversationExportText,
  buildConversationExportJson,
} from '../../../packages/desktop/src/renderer/utils/chat/conversationExport';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';

describe('conversationExport', () => {
  const conversation: TChatConversation = {
    id: 'conv-123456789',
    name: 'Thảo luận kiến trúc',
    type: 'chat',
    created_at: 1000,
    updated_at: 2000,
    model_id: 'gpt-4o',
  } as any;

  const messages: TMessage[] = [
    {
      id: 'm1',
      msg_id: 'm1',
      type: 'text',
      position: 'right',
      created_at: 1000,
      content: { content: 'Xin chào agent' },
    },
    {
      id: 'm2',
      msg_id: 'm2',
      type: 'text',
      position: 'left',
      created_at: 1050,
      content: { content: 'Chào bạn! Tôi có thể giúp gì?' },
    },
  ];

  it('sanitizes invalid filename characters', () => {
    expect(sanitizeFileName('file:name/test*?.txt')).toBe('file_name_test__.txt');
  });

  it('builds text export correctly', () => {
    const labels = {
      conversation: 'Hội thoại',
      conversation_id: 'ID',
      exportedAt: 'Thời gian xuất',
      type: 'Loại',
      noMessages: 'Không có tin nhắn',
      user: 'Người dùng',
      assistant: 'Agent',
      system: 'Hệ thống',
    };

    const text = buildConversationExportText(conversation, messages, labels);
    expect(text).toContain('Hội thoại: Thảo luận kiến trúc');
    expect(text).toContain('ID: conv-123456789');
    expect(text).toContain('Xin chào agent');
    expect(text).toContain('Chào bạn! Tôi có thể giúp gì?');
  });

  it('builds structured JSON export correctly', () => {
    const jsonStr = buildConversationExportJson(conversation, messages);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.conversation.id).toBe('conv-123456789');
    expect(parsed.conversation.name).toBe('Thảo luận kiến trúc');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[0].content).toBe('Xin chào agent');
    expect(parsed.messages[1].role).toBe('assistant');
  });
});
