/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { emitter } from '@/renderer/utils/emitter';
import { openExternalUrl } from '@/renderer/utils/platform';
import { handlePersonalMemoryCommand } from '@/renderer/services/personalMemoryCommand';
import { Brain, Copy, Github, Google, Quote, Terminal, Translate, Twitter } from '@icon-park/react';
import { Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findMessageElement, getEffectiveSelection } from './SelectionReplyButton';

type MenuState = { x: number; y: number; text: string; msgId: string; msgPos: string };
type MenuAction = {
  key: string;
  label: string;
  icon: React.ReactNode;
  tone?: string;
  run: (menu: MenuState) => unknown;
};

const MENU_WIDTH = 248;
const ROW_HEIGHT = 34;
const MAX_QUERY_LENGTH = 300;

const searchUrl = (base: string, text: string): string =>
  `${base}${encodeURIComponent(text.slice(0, MAX_QUERY_LENGTH))}`;

/** Where a right-click menu opens, kept inside the window. */
export const clampMenuPosition = (
  x: number,
  y: number,
  rows: number,
  viewport: { width: number; height: number }
): { left: number; top: number } => {
  const height = rows * ROW_HEIGHT + 24;
  return {
    left: Math.max(8, Math.min(x, viewport.width - MENU_WIDTH - 8)),
    top: Math.max(8, Math.min(y, viewport.height - height - 8)),
  };
};

/**
 * Right-clicking selected text inside a message opens a two-tier menu: quick lookups first, then what only
 * this app can do with the text. Without a selection the browser's own menu is left alone.
 */
const SelectionContextMenu: React.FC<{ messages: TMessage[] }> = ({ messages }) => {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const selection = getEffectiveSelection(event.target);
      const text = selection && !selection.isCollapsed ? selection.toString().trim() : '';
      if (!selection || text === '') return;
      const messageElement = findMessageElement(selection);
      if (!messageElement) return;
      event.preventDefault();
      const msgId = messageElement.id.slice('message-'.length);
      const msg = messagesRef.current.find((candidate) => candidate.id === msgId);
      setMenu({ x: event.clientX, y: event.clientY, text, msgId, msgPos: msg?.position ?? 'left' });
    };
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
    };
  }, [close]);

  if (!menu) return null;

  const lookups: MenuAction[] = [
    {
      key: 'copy',
      label: t('messages.contextMenu.copy', { defaultValue: 'Sao chép' }),
      icon: <Copy theme='outline' size='15' fill='currentColor' />,
      run: async ({ text }) => {
        try {
          await navigator.clipboard.writeText(text);
          Message.success(t('messages.copySuccess', { defaultValue: 'Đã sao chép' }));
        } catch {
          Message.error(t('messages.copyFailed', { defaultValue: 'Không sao chép được' }));
        }
      },
    },
    {
      key: 'google',
      label: t('messages.contextMenu.google', { defaultValue: 'Tìm trên Google' }),
      icon: <Google theme='outline' size='15' fill='#4285f4' />,
      run: ({ text }) => openExternalUrl(searchUrl('https://www.google.com/search?q=', text)),
    },
    {
      key: 'github',
      label: t('messages.contextMenu.github', { defaultValue: 'Tìm trong mã nguồn GitHub' }),
      icon: <Github theme='outline' size='15' fill='currentColor' />,
      run: ({ text }) => openExternalUrl(searchUrl('https://github.com/search?type=code&q=', text)),
    },
    {
      key: 'x',
      label: t('messages.contextMenu.x', { defaultValue: 'Tìm trên X' }),
      icon: <Twitter theme='outline' size='15' fill='#1d9bf0' />,
      run: ({ text }) => openExternalUrl(searchUrl('https://x.com/search?q=', text)),
    },
    {
      key: 'translate',
      label: t('messages.contextMenu.translate', { defaultValue: 'Dịch sang tiếng Việt' }),
      icon: <Translate theme='outline' size='15' fill='#14b8a6' />,
      run: ({ text }) =>
        emitter.emit('sendbox.fill', `Dịch sang tiếng Việt, giữ nguyên thuật ngữ kỹ thuật:\n\n${text}`),
    },
  ];
  const appActions: MenuAction[] = [
    {
      key: 'ask',
      label: t('messages.contextMenu.ask', { defaultValue: 'Hỏi về đoạn này' }),
      icon: <Quote theme='filled' size='15' fill='currentColor' />,
      tone: 'var(--brand)',
      run: ({ text, msgId, msgPos }) =>
        emitter.emit('sendbox.reply', {
          messageId: msgId,
          content: text,
          position: msgPos as 'left' | 'right' | 'center' | 'pop',
        }),
    },
    {
      key: 'remember',
      label: t('messages.contextMenu.remember', { defaultValue: 'Ghi nhớ lâu dài' }),
      icon: <Brain theme='outline' size='15' fill='#8b5cf6' />,
      // Same path as typing /remember: a user-locked fact in Personal Context, capped and de-duplicated there.
      run: ({ text }) => handlePersonalMemoryCommand(`/remember ${text}`),
    },
    {
      key: 'terminal',
      label: t('messages.contextMenu.terminal', { defaultValue: 'Làm bằng lệnh terminal' }),
      icon: <Terminal theme='outline' size='15' fill='currentColor' />,
      // Only prefills /terminal; the user reviews and sends, and every command still goes through approval.
      run: ({ text }) => emitter.emit('sendbox.fill', `/terminal ${text}`),
    },
  ];

  const runAction = (action: MenuAction): void => {
    const current = menu;
    close();
    void Promise.resolve(action.run(current)).catch((): undefined => undefined);
  };

  const { left, top } = clampMenuPosition(menu.x, menu.y, lookups.length + appActions.length, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const renderGroup = (title: string, actions: MenuAction[]): React.ReactNode => (
    <div role='group' aria-label={title}>
      <div
        className='px-12px pt-8px pb-4px text-11px font-semibold tracking-wide uppercase'
        style={{ color: 'var(--color-text-3)' }}
      >
        {title}
      </div>
      {actions.map((action) => (
        <button
          key={action.key}
          type='button'
          role='menuitem'
          className='w-full flex items-center gap-10px px-12px bg-transparent border-none cursor-pointer text-left text-13px hover:bg-[var(--color-fill-2)] transition-colors'
          style={{ height: ROW_HEIGHT, color: action.tone ?? 'var(--color-text-1)' }}
          onClick={() => runAction(action)}
        >
          <span className='flex items-center justify-center w-18px'>{action.icon}</span>
          <span className='flex-1 truncate'>{action.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={menuRef}
      role='menu'
      data-testid='selection-context-menu'
      className='fixed z-9999 rd-12px overflow-hidden py-4px'
      style={{
        left,
        top,
        width: MENU_WIDTH,
        background: 'color-mix(in srgb, var(--color-bg-1) 94%, transparent)',
        border: '1px solid var(--color-border-2)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.22)',
        backdropFilter: 'blur(14px) saturate(1.1)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renderGroup(t('messages.contextMenu.lookup', { defaultValue: 'Tra cứu nhanh' }), lookups)}
      <div className='my-4px h-1px' style={{ background: 'var(--color-border-2)' }} />
      {renderGroup(t('messages.contextMenu.hub', { defaultValue: 'Hub Agent OS' }), appActions)}
    </div>
  );
};

export default SelectionContextMenu;
