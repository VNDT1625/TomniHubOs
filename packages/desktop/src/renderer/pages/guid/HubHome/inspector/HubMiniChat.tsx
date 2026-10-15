/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import MarkdownView from '@/renderer/components/Markdown';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const MINI_CHAT_HISTORY_LIMIT = 40;
const HISTORY_REFRESH_MS = 8_000;
const MAX_MINI_MESSAGE_CHARS = 250_000;

type Props = { item: HubActivityItem };

const visibleMessage = (message: TMessage): boolean =>
  !message.hidden &&
  (message.type === 'text' || message.type === 'tool_group' || message.type === 'tool_call' || message.type === 'tips');

export const HubMiniChat = ({ item }: Props) => {
  const { t } = useTranslation();
  const conversationId = item.kind === 'agent' ? item.sourceId : undefined;
  const [history, setHistory] = useState<{ id: string; messages: TMessage[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  useEffect(() => {
    if (!conversationId || (item.status !== 'running' && item.status !== 'needs_input')) return undefined;
    const timer = window.setInterval(() => setRevision((v) => v + 1), HISTORY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [conversationId, item.status]);

  // Shared native DB, same conversation ID as the full Chat. This is a
  // bounded projection, not a new conversation or an alternate storage path.
  useEffect(() => {
    if (!conversationId) return undefined;
    let alive = true;
    void ipcBridge.database.getConversationMessages
      .invoke({
        conversation_id: conversationId,
        page: 1,
        page_size: MINI_CHAT_HISTORY_LIMIT,
        order: 'desc',
        content_mode: 'compact',
      })
      .then((page) => {
        if (!alive) return;
        const messages = (page.items ?? [])
          .filter(visibleMessage)
          .toSorted((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
        setHistory({ id: conversationId, messages, hasMore: Boolean(page.has_more) });
        setError(false);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [conversationId, revision, item.status === 'done' || item.status === 'error']);

  const messages = history?.id === conversationId ? history.messages : [];
  const lastAssistantText = useMemo(
    () => messages.toReversed().find((message) => message.type === 'text' && message.position !== 'right'),
    [messages]
  );
  const stream = item.preview?.trim() ?? '';
  const persisted = lastAssistantText?.type === 'text' ? lastAssistantText.content.content.trim() : '';
  // Native DB may already contain a partial copy of the same streamed turn.
  // Render the longer version once, rather than two parallel assistant bubbles.
  const sameTurn =
    stream.length >= 16 &&
    persisted.length >= 16 &&
    (stream.includes(persisted) || persisted.includes(stream) || stream.slice(0, 64) === persisted.slice(0, 64));
  const showLive = Boolean(
    stream &&
    (item.status === 'running' || item.status === 'needs_input') &&
    (!sameTurn || stream.length > persisted.length)
  );
  const skipSavedAssistantId = showLive && sameTurn ? lastAssistantText?.id : undefined;

  useEffect(() => {
    const host = containerRef.current?.closest('.hub-inspector-detail-body');
    if (!(host instanceof HTMLElement)) return;
    pinnedToBottom.current = true;
    const onScroll = () => {
      pinnedToBottom.current = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
      setShowScrollBottom(!pinnedToBottom.current);
    };
    host.addEventListener('scroll', onScroll, { passive: true });
    host.scrollTop = host.scrollHeight;
    return () => host.removeEventListener('scroll', onScroll);
  }, [conversationId]);

  useEffect(() => {
    const host = containerRef.current?.closest('.hub-inspector-detail-body');
    if (host instanceof HTMLElement && pinnedToBottom.current) host.scrollTop = host.scrollHeight;
  }, [history, stream, showLive]);

  return (
    <div ref={containerRef} className='hub-inspector-mini-chat' data-testid='hub-inspector-mini-chat'>
      {history?.hasMore && (
        <p className='hub-inspector-muted'>
          {t('guid.hubHome.inspector.olderHistory', { defaultValue: 'Các tin nhắn cũ hơn có trong Session đầy đủ.' })}
        </p>
      )}
      {messages.map((message) => {
        if (message.id === skipSavedAssistantId) return null;
        const content = message.type === 'text' ? message.content.content : '';
        const kind = message.position === 'right' ? 'user' : 'assistant';
        if (message.type === 'text') {
          if (!content.trim()) return null;
          return (
            <article key={message.id} className={`hub-inspector-mini-message hub-inspector-mini-message--${kind}`}>
              <div className='hub-inspector-mini-sender'>
                {kind === 'user'
                  ? t('guid.hubHome.inspector.user', { defaultValue: 'Bạn' })
                  : item.agentName || item.title}
              </div>
              {kind === 'user' ? (
                <p>{content.slice(0, MAX_MINI_MESSAGE_CHARS)}</p>
              ) : (
                <MarkdownView compact previewSourceId={item.id}>
                  {content.slice(0, MAX_MINI_MESSAGE_CHARS)}
                </MarkdownView>
              )}
            </article>
          );
        }
        if (message.type === 'tool_group') {
          return (
            <div key={message.id} className='hub-inspector-mini-tool'>
              {t('guid.hubHome.inspector.toolCalls', { defaultValue: 'Tool Calls' })} · {message.content.length}
              <span>
                {message.content
                  .slice(0, 3)
                  .map((tool) => tool.name)
                  .join(' · ')}
              </span>
            </div>
          );
        }
        if (message.type === 'tool_call') {
          return (
            <div key={message.id} className='hub-inspector-mini-tool'>
              {message.content.name}
            </div>
          );
        }
        if (message.type === 'tips') {
          return (
            <div key={message.id} className='hub-inspector-mini-tool'>
              {message.content.content}
            </div>
          );
        }
        return null;
      })}
      {showLive && (
        <article className='hub-inspector-mini-message hub-inspector-mini-message--assistant'>
          <div className='hub-inspector-mini-sender'>
            {item.agentName || item.title} · {t('guid.hubHome.live.running')}
          </div>
          <MarkdownView compact streaming previewSourceId={item.id}>
            {item.preview!}
          </MarkdownView>
        </article>
      )}
      {showScrollBottom && (
        <button
          type='button'
          className='hub-inspector-scroll-bottom'
          data-testid='hub-mini-chat-scroll-bottom'
          aria-label={t('guid.hubHome.inspector.scrollBottom', { defaultValue: 'Cuộn xuống tin nhắn mới nhất' })}
          onClick={() => {
            const host = containerRef.current?.closest('.hub-inspector-detail-body');
            if (host instanceof HTMLElement) {
              host.scrollTop = host.scrollHeight;
              pinnedToBottom.current = true;
              setShowScrollBottom(false);
            }
          }}
        >
          <ArrowDown size={15} />
        </button>
      )}
      {!messages.length && !showLive && (
        <p className='hub-inspector-muted'>
          {error
            ? t('guid.hubHome.inspector.historyError', {
                defaultValue: 'Không đọc được lịch sử hội thoại. Hãy mở Session đầy đủ.',
              })
            : t('guid.hubHome.inspector.noReply', { defaultValue: 'Chưa có tin nhắn nào trong phiên.' })}
        </p>
      )}
    </div>
  );
};
