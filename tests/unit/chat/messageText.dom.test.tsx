/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageText } from '@/common/chat/chatLib';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import MessageText, { parseBuild0Input } from '@/renderer/pages/conversation/Messages/components/MessageText';

const mockFilePreview = vi.fn(({ path }: { path: string }) => <div data-testid='file-preview'>{path}</div>);
const { mockAddToSendBox } = vi.hoisted(() => ({ mockAddToSendBox: vi.fn() }));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ addToSendBox: mockAddToSendBox }),
}));

vi.mock('@/renderer/components/chat/CollapsibleContent', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/renderer/components/media/FilePreview', () => ({
  __esModule: true,
  default: (props: { path: string }) => mockFilePreview(props),
}));

vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/utils/chat/skillSuggestParser', () => ({
  hasSkillSuggest: () => false,
  stripSkillSuggest: (content: string) => content,
}));

vi.mock('@/renderer/utils/chat/thinkTagFilter', () => ({
  hasThinkTags: () => false,
  stripThinkTags: (content: string) => content,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: () => null,
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@arco-design/web-react', () => {
  // oxlint-disable-next-line eslint-plugin-unicorn(consistent-function-scoping) -- hoisted mock factory owns this test component.\n
  const TextArea = ({
    value,
    placeholder,
    onChange,
  }: {
    value?: string;
    placeholder?: string;
    onChange?: (value: string) => void;
  }) => <textarea aria-label={placeholder} value={value} onChange={(event) => onChange?.(event.currentTarget.value)} />;
  return {
    Alert: () => null,
    Button: ({
      children,
      disabled,
      onClick,
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button type='button' disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Input: { TextArea },
    Message: {
      error: vi.fn(),
    },
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@icon-park/react', () => ({
  Copy: () => <span data-testid='copy-icon' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('MessageText attachment paths', () => {
  it('resolves relative attachment paths against the current workspace before previewing', () => {
    const message: IMessageText = {
      id: 'msg-1',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'right',
      createdAt: Date.now(),
      content: {
        content: 'look at this\n\n[[TOMNY_FILES]]\nuploads/photo.png',
      },
    };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );

    expect(screen.getByTestId('file-preview')).toHaveTextContent('/workspace/demo/uploads/photo.png');
  });

  it('keeps absolute attachment paths unchanged before previewing', () => {
    const message: IMessageText = {
      id: 'msg-2',
      msg_id: 'msg-2',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'right',
      createdAt: Date.now(),
      content: {
        content: 'look at this\n\n[[TOMNY_FILES]]\n/Users/demo/Desktop/photo.png',
      },
    };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );

    expect(screen.getByTestId('file-preview')).toHaveTextContent('/Users/demo/Desktop/photo.png');
  });
});
describe('MessageText Build0 structured input', () => {
  it('parses a complete marker and rejects malformed structured input', () => {
    const parsed = parseBuild0Input(
      'Choose one\n<build0_input>{"title":"Architecture","questions":[{"id":"path","label":"Path","type":"single","options":[{"label":"Recommended","value":"recommended"}]}]}</build0_input>'
    );

    expect(parsed?.text).toBe('Choose one');
    expect(parsed?.request.questions[0]?.options[0]?.value).toBe('recommended');
    expect(parseBuild0Input('<build0_input>{bad json}</build0_input>')).toBeNull();
  });

  it('renders click and text fields in chat, then prepares a concise answer in the composer', () => {
    mockAddToSendBox.mockClear();
    const message: IMessageText = {
      id: 'msg-build0',
      msg_id: 'msg-build0',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      content: {
        content:
          'I need two details.\n<build0_input>{"title":"Backend choices","description":"Pick what fits.","questions":[{"id":"architecture","label":"Architecture","type":"single","options":[{"label":"No extra requirements","value":"none","recommended":true},{"label":"Customize","value":"custom"}]},{"id":"notes","label":"Additional notes","type":"text","placeholder":"Write any constraint","required":false}]}</build0_input>',
      },
    };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );

    expect(screen.getByTestId('build0-structured-input')).toBeInTheDocument();
    expect(screen.queryByText(/<build0_input>/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /No extra requirements/ }));
    fireEvent.change(screen.getByLabelText('Write any constraint'), { target: { value: 'EU hosting' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    expect(mockAddToSendBox).toHaveBeenCalledWith(
      'Backend choices\n- Architecture: No extra requirements\n- Additional notes: EU hosting'
    );
  });
});
