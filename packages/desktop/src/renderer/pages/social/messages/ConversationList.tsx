/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import type { UnifiedConversation } from '@/common/types/social';
import styles from './Messenger.module.css';

export interface ConversationListProps {
  conversations: UnifiedConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({ conversations, selectedId, onSelect }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.participant.name.toLowerCase().includes(q) ||
      c.participant.handle.toLowerCase().includes(q) ||
      (c.lastMessageSnippet?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <aside className={styles.sidebar}>
      <div className={styles.searchHeader}>
        <span className={styles.searchTitle}>Tin nhắn</span>
        <div className={styles.searchInputWrapper}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type='text'
            className={styles.searchInput}
            placeholder='Tìm cuộc trò chuyện...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.conversationList}>
        {filteredConversations.map((conv) => {
          const isSelected = conv.id === selectedId;
          const authorInitial = conv.participant.name.trim().charAt(0).toUpperCase() || 'U';

          const timeString = conv.lastMessageAt
            ? new Date(conv.lastMessageAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '';

          return (
            <div
              key={conv.id}
              className={`${styles.conversationItem} ${isSelected ? styles.conversationItemActive : ''}`}
              role='button'
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => onSelect(conv.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(conv.id);
                }
              }}
            >
              <div className={styles.avatar}>
                {conv.participant.avatarUrl ? (
                  <img
                    src={conv.participant.avatarUrl}
                    alt={conv.participant.name}
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  authorInitial
                )}
              </div>

              <div className={styles.convMeta}>
                <div className={styles.convTopRow}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span className={styles.participantName}>{conv.participant.name}</span>
                    <span className={styles.platformTag}>{conv.platform}</span>
                  </div>
                  {timeString && <span className={styles.convTime}>{timeString}</span>}
                </div>

                <div className={styles.convBottomRow}>
                  <span className={styles.lastMessageSnippet}>{conv.lastMessageSnippet || 'Chưa có tin nhắn'}</span>
                  {conv.unreadCount > 0 && <span className={styles.unreadBadge}>{conv.unreadCount}</span>}
                </div>
              </div>
            </div>
          );
        })}

        {filteredConversations.length === 0 && (
          <div className={styles.emptyState} style={{ padding: 32 }}>
            <span>Không tìm thấy cuộc trò chuyện nào</span>
          </div>
        )}
      </div>
    </aside>
  );
};
