/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageThinking } from '@/common/chat/chatLib';
import MessageThinking from '@/renderer/pages/conversation/Messages/components/MessageThinking';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

function createThinkingMessage(
  createdAt: number,
  msgId = 'msg-1',
  status: IMessageThinking['content']['status'] = 'thinking',
  duration?: number
): IMessageThinking {
  return {
    id: 'thinking-1',
    type: 'thinking',
    msg_id: msgId,
    conversation_id: 'conversation-1',
    position: 'left',
    created_at: createdAt,
    content: {
      content: 'analyzing',
      status,
      duration,
    },
  };
}

describe('MessageThinking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves elapsed time when the component remounts for an active thinking message', () => {
    vi.setSystemTime(new Date('2026-05-26T09:00:10.000Z'));
    const createdAt = Date.now() - 5_000;

    const { unmount } = render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    expect(screen.getByText('Thinking... · 5s')).toBeInTheDocument();

    unmount();

    vi.setSystemTime(new Date('2026-05-26T09:00:12.000Z'));
    render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    expect(screen.getByText('Thinking... · 7s')).toBeInTheDocument();
  });

  it('does not restart the clock when a live thinking update changes created_at', () => {
    vi.setSystemTime(new Date('2026-05-26T09:00:10.000Z'));
    const firstCreatedAt = Date.now() - 5_000;
    const { rerender } = render(<MessageThinking message={createThinkingMessage(firstCreatedAt)} />);

    expect(screen.getByText('Thinking... · 5s')).toBeInTheDocument();
    vi.setSystemTime(new Date('2026-05-26T09:00:12.000Z'));
    rerender(<MessageThinking message={createThinkingMessage(Date.now())} />);
    expect(screen.getByText('Thinking... · 7s')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('Thinking... · 8s')).toBeInTheDocument();
  });

  it('freezes the elapsed clock when thinking receives a done update', () => {
    vi.setSystemTime(new Date('2026-05-26T09:00:10.000Z'));
    const createdAt = Date.now() - 5_000;
    const { rerender } = render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    rerender(<MessageThinking message={createThinkingMessage(Date.now(), 'msg-1', 'done', 5_000)} />);
    act(() => vi.advanceTimersByTime(10_000));

    expect(screen.getByText('Thought complete · 5s')).toBeInTheDocument();
    expect(screen.queryByText(/15s/u)).not.toBeInTheDocument();
  });
});
