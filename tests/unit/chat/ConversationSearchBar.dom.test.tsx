/** @vitest-environment jsdom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConversationSearchBar, {
  searchConversationMessages,
} from '../../../packages/desktop/src/renderer/pages/conversation/Messages/components/ConversationSearchBar';
import type { TMessage } from '@/common/chat/chatLib';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue || k }),
}));

describe('ConversationSearchBar', () => {
  const messages: TMessage[] = [
    {
      id: 'm1',
      msg_id: 'm1',
      type: 'text',
      position: 'right',
      created_at: 1,
      content: { content: 'Cách tối ưu React component' },
    },
    {
      id: 'm2',
      msg_id: 'm2',
      type: 'text',
      position: 'left',
      created_at: 2,
      content: { content: 'Có thể dùng React.memo và useMemo để tối ưu' },
    },
    {
      id: 'm3',
      msg_id: 'm3',
      type: 'text',
      position: 'right',
      created_at: 3,
      content: { content: 'Cảm ơn bạn' },
    },
  ];

  it('searches messages matching query', () => {
    const matches = searchConversationMessages(messages, 'React');
    expect(matches).toEqual(['m1', 'm2']);
  });

  it('navigates next and previous matches', () => {
    const onJump = vi.fn();
    const onClose = vi.fn();

    render(<ConversationSearchBar messages={messages} onJumpToMessage={onJump} onClose={onClose} />);

    const input = screen.getByPlaceholderText('Tìm kiếm...');
    fireEvent.change(input, { target: { value: 'React' } });

    expect(screen.getByText('1 / 2')).toBeDefined();
    expect(onJump).toHaveBeenCalledWith('m1');

    const nextBtn = screen.getByTestId('search-next-btn');
    fireEvent.click(nextBtn);

    expect(screen.getByText('2 / 2')).toBeDefined();
    expect(onJump).toHaveBeenCalledWith('m2');
  });

  it('closes on Escape or clicking close button', () => {
    const onClose = vi.fn();

    render(<ConversationSearchBar messages={messages} onJumpToMessage={vi.fn()} onClose={onClose} />);

    const closeBtn = screen.getByTestId('search-close-btn');
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });
});
