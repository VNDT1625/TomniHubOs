/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ConversationList } from './ConversationList';
import { ChatWindow } from './ChatWindow';
import type { UnifiedConversation, UnifiedMessage } from '@/common/types/social';
import { social as socialApi } from '@/common/adapter/ipcBridge';
import styles from './Messenger.module.css';

export interface UnifiedMessengerViewProps {
  selectedAccountId?: string | null;
  refreshKey?: number;
}

export const UnifiedMessengerView: React.FC<UnifiedMessengerViewProps> = ({ selectedAccountId, refreshKey }) => {
  const [conversations, setConversations] = useState<UnifiedConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [_loading, setLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshingThread, setRefreshingThread] = useState(false);
  const conversationRequest = useRef(0);
  const messageRequest = useRef(0);
  const selectedIdRef = useRef<string | null>(null);

  // Fetch conversations
  const fetchConversations = useCallback(
    async (sync = false) => {
      const request = ++conversationRequest.current;
      let syncFailed = false;
      if (sync) {
        try {
          await socialApi.refreshConversations.invoke({ accountId: selectedAccountId || undefined });
        } catch {
          syncFailed = true;
        }
      }
      try {
        const list = await socialApi.getConversations.invoke({ accountId: selectedAccountId || undefined });
        if (request !== conversationRequest.current) return;
        setConversations(list || []);
        setSyncError(
          syncFailed ? 'Chưa thể đồng bộ tin nhắn mới từ mạng xã hội. Đang hiển thị hội thoại trong bộ nhớ đệm.' : null
        );
      } catch {
        if (request === conversationRequest.current) setSyncError('Không thể tải danh sách hội thoại đã lưu.');
      }
    },
    [selectedAccountId]
  );

  useEffect(() => {
    // Never show the previous account's conversations while switching accounts.
    conversationRequest.current += 1;
    messageRequest.current += 1;
    selectedIdRef.current = null;
    setSelectedId(null);
    setConversations([]);
    setMessages([]);
    setSendError(null);
    setSyncError(null);
  }, [selectedAccountId]);

  useEffect(() => {
    void fetchConversations(Boolean(refreshKey));
    return () => {
      conversationRequest.current += 1;
    };
  }, [fetchConversations, refreshKey]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (convId: string) => {
    const request = ++messageRequest.current;
    setLoading(true);
    try {
      if (typeof socialApi?.getThread?.invoke === 'function') {
        const history = await socialApi.getThread.invoke({
          conversationId: convId,
        });
        if (request === messageRequest.current && selectedIdRef.current === convId) setMessages(history || []);
      }
    } catch {
      if (request === messageRequest.current) setSendError('Không thể tải lịch sử hội thoại đã lưu.');
    } finally {
      if (request === messageRequest.current) setLoading(false);
    }
  }, []);

  const handleSelectConversation = (convId: string) => {
    selectedIdRef.current = convId;
    setSelectedId(convId);
    setMessages([]);
    setSendError(null);
    fetchMessages(convId);
  };

  const handleRefreshThread = async () => {
    const targetId = selectedIdRef.current;
    if (!targetId || refreshingThread) return;
    setRefreshingThread(true);
    setSendError(null);
    try {
      await socialApi.refreshThread.invoke({ conversationId: targetId });
      if (selectedIdRef.current === targetId) await fetchMessages(targetId);
    } catch {
      if (selectedIdRef.current === targetId)
        setSendError('Chưa thể đồng bộ tin nhắn mới. Lịch sử đã lưu vẫn có thể xem.');
    } finally {
      setRefreshingThread(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    const targetId = selectedIdRef.current;
    if (!targetId) return false;

    setSendError(null);
    try {
      if (typeof socialApi?.sendMessage?.invoke !== 'function') throw new Error('SOCIAL_CONNECTOR_UNAVAILABLE');
      const sent = await socialApi.sendMessage.invoke({ conversationId: targetId, content: text });
      if (!sent) throw new Error('SOCIAL_MESSAGE_NO_RECEIPT');
      if (selectedIdRef.current === targetId) setMessages((prev) => [...prev, sent]);
      return true;
    } catch {
      if (selectedIdRef.current === targetId)
        setSendError('Không gửi được tin nhắn. Nền tảng chưa có kết nối gửi tin được xác minh.');
      return false;
    }
  };

  const activeConversation = conversations.find((c) => c.id === selectedId) || null;

  return (
    <div className={styles.container}>
      <ConversationList conversations={conversations} selectedId={selectedId} onSelect={handleSelectConversation} />
      <ChatWindow
        conversation={activeConversation}
        messages={messages}
        error={sendError || syncError}
        onRefreshMessages={handleRefreshThread}
        refreshingMessages={refreshingThread}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
};

export default UnifiedMessengerView;
