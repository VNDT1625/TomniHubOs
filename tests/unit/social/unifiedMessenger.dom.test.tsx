import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConversationList } from '@/renderer/pages/social/messages/ConversationList';
import { ChatWindow } from '@/renderer/pages/social/messages/ChatWindow';
import type { UnifiedConversation, UnifiedMessage } from '@/common/types/social';

describe('Unified Messenger Components', () => {
  const mockConversation: UnifiedConversation = {
    id: 'facebook:acc-fb-1:conv-101',
    platform: 'facebook',
    accountId: 'acc-fb-1',
    threadId: 'conv-101',
    participant: {
      name: 'Sarah Connor',
      handle: 'sarahc',
      avatarUrl: '',
    },
    lastMessageSnippet: 'Are you ready for the deployment?',
    lastMessageAt: Date.now() - 100000,
    unreadCount: 3,
  };

  const mockMessages: UnifiedMessage[] = [
    {
      id: 'msg-1',
      conversationId: 'facebook:acc-fb-1:conv-101',
      senderId: 'p-1',
      isFromMe: false,
      content: 'Are you ready for the deployment?',
      sentAt: Date.now() - 100000,
      status: 'read',
    },
    {
      id: 'msg-2',
      conversationId: 'facebook:acc-fb-1:conv-101',
      senderId: 'me',
      isFromMe: true,
      content: 'Yes, everything is set!',
      sentAt: Date.now() - 50000,
      status: 'read',
    },
  ];

  it('renders ConversationList with participant, last message and unread badge', () => {
    const onSelect = vi.fn();
    render(<ConversationList conversations={[mockConversation]} selectedId={null} onSelect={onSelect} />);

    expect(screen.getByText('Sarah Connor')).toBeDefined();
    expect(screen.getByText(/Are you ready for the deployment?/i)).toBeDefined();
    expect(screen.getByText('3')).toBeDefined(); // unread badge

    const item = screen.getByText('Sarah Connor');
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith(mockConversation.id);
    const option = screen.getByRole('button', { name: /Sarah Connor/i });
    fireEvent.keyDown(option, { key: 'Enter' });
    fireEvent.keyDown(option, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('preserves the draft on rejected receipt, supports Shift+Enter and blocks duplicate pending submissions', async () => {
    let resolve!: (value: boolean) => void;
    const onSend = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          })
      )
      .mockResolvedValueOnce(true);
    render(<ChatWindow conversation={mockConversation} messages={[]} onSendMessage={onSend} />);
    const input = screen.getByPlaceholderText(/Nhập tin nhắn/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Please reply' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /gửi/i })).toBeDisabled();
    resolve(false);
    await waitFor(() => expect(screen.getByRole('button', { name: /gửi/i })).not.toBeDisabled());
    expect(input.value).toBe('Please reply');
    fireEvent.click(screen.getByRole('button', { name: /gửi/i }));
    await waitFor(() => expect(input.value).toBe(''));
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('renders ChatWindow and fires onSendMessage when submitting text', async () => {
    const onSend = vi.fn();
    render(<ChatWindow conversation={mockConversation} messages={mockMessages} onSendMessage={onSend} />);

    expect(screen.getByText('Sarah Connor')).toBeDefined();
    expect(screen.getByText('Are you ready for the deployment?')).toBeDefined();
    expect(screen.getByText('Yes, everything is set!')).toBeDefined();

    const input = screen.getByPlaceholderText(/Nhập tin nhắn/i);
    fireEvent.change(input, { target: { value: 'Got it, launching now!' } });

    const sendBtn = screen.getByRole('button', { name: /gửi/i });
    fireEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledWith('Got it, launching now!');
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));
  });
});
