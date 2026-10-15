/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, RefreshCw } from 'lucide-react';
import type { UnifiedConversation, UnifiedMessage } from '@/common/types/social';
import styles from './Messenger.module.css';

export interface ChatWindowProps {
  conversation: UnifiedConversation | null;
  messages: UnifiedMessage[];
  error?: string | null;
  onRefreshMessages?: () => void;
  refreshingMessages?: boolean;
  onSendMessage: (text: string) => Promise<boolean> | boolean | void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  messages,
  error,
  onRefreshMessages,
  refreshingMessages,
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);
  // Synchronous guard: two Enter/key events can arrive before React commits sending=true.
  const sendingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef(conversation?.id);

  useEffect(() => {
    conversationRef.current = conversation?.id;
    setInputText('');
  }, [conversation?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!conversation) {
    return (
      <main className={styles.chatWindow}>
        <div className={styles.emptyState}>
          <MessageSquare size={48} strokeWidth={1.5} />
          <span>Chọn một cuộc trò chuyện để bắt đầu nhắn tin</span>
        </div>
      </main>
    );
  }

  const handleSend = async () => {
        if (!inputText.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const targetId = conversation.id;
    const draft = inputText.trim();
    try {
      const sent = await onSendMessage(draft);
      // An old conversation's completed send must not clear another draft.
      if (sent !== false && conversationRef.current === targetId)
        setInputText((current) => (current.trim() === draft ? '' : current));
        } catch {
      // Keep the draft if transport throws. The parent owns provider error reporting.
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  const authorInitial = conversation.participant.name.trim().charAt(0).toUpperCase() || 'U';

  return (
    <main className={styles.chatWindow}>
      {/* Chat Header */}
      <header className={styles.chatHeader}>
        <div className={styles.headerUserInfo}>
          <div className={styles.avatar} style={{ width: 38, height: 38 }}>
            {conversation.participant.avatarUrl ? (
              <img
                src={conversation.participant.avatarUrl}
                alt={conversation.participant.name}
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              authorInitial
            )}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={styles.headerUserName}>{conversation.participant.name}</span>
              <span className={styles.platformTag}>{conversation.platform}</span>
            </div>
            <span className={styles.headerUserHandle}>@{conversation.participant.handle}</span>
          </div>
          {onRefreshMessages && (
            <button
              type='button'
              className={styles.sendButton}
              onClick={onRefreshMessages}
              disabled={refreshingMessages}
              aria-label='Đồng bộ hội thoại'
              title='Lấy tin nhắn mới'
            >
              <RefreshCw size={17} />
            </button>
          )}
        </div>
      </header>

      {error && (
        <div role='alert' style={{ padding: '8px 20px', fontSize: 13, color: 'var(--color-danger, #dc2626)' }}>
          {error}
        </div>
      )}

      {/* Messages thread */}
      <div className={styles.messagesContainer}>
        {messages.map((msg) => {
          const isOut = msg.isFromMe;
          const timeString = new Date(msg.sentAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });

          return (
            <div key={msg.id} className={`${styles.messageRow} ${isOut ? styles.outgoingRow : styles.incomingRow}`}>
              <div className={`${styles.messageBubble} ${isOut ? styles.outgoingBubble : styles.incomingBubble}`}>
                {msg.content}
              </div>
              <span className={styles.messageTime}>{timeString}</span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input footer */}
      <footer className={styles.chatInputFooter}>
        <textarea
          rows={2}
          className={styles.chatInput}
          placeholder='Nhập tin nhắn...'
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type='button'
          className={styles.sendButton}
          onClick={() => void handleSend()}
          disabled={sending || !inputText.trim()}
          aria-label='Gửi tin nhắn'
        >
          <Send size={18} />
        </button>
      </footer>
    </main>
  );
};
