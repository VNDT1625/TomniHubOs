/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, CloseSmall, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { TMessage } from '@/common/chat/chatLib';

export interface ConversationSearchBarProps {
  messages: TMessage[];
  onJumpToMessage: (messageId: string) => void;
  onClose: () => void;
}

export function searchConversationMessages(messages: TMessage[], query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const matchedIds: string[] = [];
  for (const m of messages) {
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (m.content && typeof m.content === 'object' && 'content' in m.content) {
      text = String((m.content as { content?: unknown }).content || '');
    }

    if (text.toLowerCase().includes(trimmed)) {
      matchedIds.push(m.id);
    }
  }

  return matchedIds;
}

export const ConversationSearchBar: React.FC<ConversationSearchBarProps> = ({ messages, onJumpToMessage, onClose }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matchedIds = useMemo(() => searchConversationMessages(messages, query), [messages, query]);

  const totalMatches = matchedIds.length;

  const jumpToMatch = useCallback(
    (index: number) => {
      if (totalMatches === 0) return;
      const targetId = matchedIds[index];
      if (targetId) {
        onJumpToMessage(targetId);
      }
    },
    [matchedIds, onJumpToMessage, totalMatches]
  );

  const handleNext = () => {
    if (totalMatches === 0) return;
    const next = (currentIndex + 1) % totalMatches;
    setCurrentIndex(next);
    jumpToMatch(next);
  };

  const handlePrev = () => {
    if (totalMatches === 0) return;
    const prev = (currentIndex - 1 + totalMatches) % totalMatches;
    setCurrentIndex(prev);
    jumpToMatch(prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  };

  useEffect(() => {
    setCurrentIndex(0);
    if (matchedIds.length > 0) {
      jumpToMatch(0);
    }
  }, [matchedIds, jumpToMatch]);

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className='absolute top-12px right-16px z-50 flex items-center gap-6px p-6px rd-10px b-1 b-solid border-border-2 shadow-lg animate-fade-in'
      style={{
        background: 'var(--color-bg-popup, var(--bg-1))',
        backdropFilter: 'blur(10px)',
      }}
      data-testid='conversation-search-bar'
      onKeyDown={handleKeyDown}
    >
      <Input
        ref={inputRef as any}
        size='small'
        prefix={<Search theme='outline' size='14' />}
        placeholder={t('common.search', { defaultValue: 'Tìm kiếm...' })}
        value={query}
        onChange={setQuery}
        style={{ width: 180 }}
      />

      {query.trim() && (
        <span className='text-11px text-t-secondary whitespace-nowrap select-none px-4px'>
          {totalMatches > 0 ? `${currentIndex + 1} / ${totalMatches}` : '0 kết quả'}
        </span>
      )}

      <div className='flex items-center gap-2px'>
        <Button
          size='mini'
          type='text'
          icon={<ArrowUp theme='outline' size='14' />}
          disabled={totalMatches <= 1}
          onClick={handlePrev}
          title='Trước (Shift+Enter)'
          data-testid='search-prev-btn'
        />
        <Button
          size='mini'
          type='text'
          icon={<ArrowDown theme='outline' size='14' />}
          disabled={totalMatches <= 1}
          onClick={handleNext}
          title='Sau (Enter)'
          data-testid='search-next-btn'
        />
        <Button
          size='mini'
          type='text'
          icon={<CloseSmall theme='outline' size='14' />}
          onClick={onClose}
          title='Đóng (Esc)'
          data-testid='search-close-btn'
        />
      </div>
    </div>
  );
};

export default ConversationSearchBar;
