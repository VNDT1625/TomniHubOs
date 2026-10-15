import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('@/renderer/utils/platform', () => platform);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
const memory = vi.hoisted(() => ({ handlePersonalMemoryCommand: vi.fn(() => true) }));
vi.mock('@/renderer/services/personalMemoryCommand', () => memory);

import { emitter } from '@/renderer/utils/emitter';
import SelectionContextMenu, {
  clampMenuPosition,
} from '@/renderer/pages/conversation/Messages/components/SelectionContextMenu';

const messages = [{ id: 'm1', position: 'left' }] as never;

const selectText = (element: HTMLElement): void => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const setup = () => {
  render(
    <div>
      <div id='message-m1'>
        <p data-testid='text'>chatgpt là một llm api</p>
      </div>
      <p data-testid='outside'>không phải tin nhắn</p>
      <SelectionContextMenu messages={messages} />
    </div>
  );
};

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  platform.openExternalUrl.mockReset();
});

describe('the right-click menu on selected message text', () => {
  it('opens a two-tier menu at the cursor when text inside a message is selected', () => {
    setup();
    selectText(screen.getByTestId('text'));
    fireEvent.contextMenu(screen.getByTestId('text'), { clientX: 40, clientY: 50 });

    const menu = screen.getByTestId('selection-context-menu');
    expect(menu).toBeTruthy();
    for (const label of [
      'Sao chép',
      'Tìm trên Google',
      'Tìm trong mã nguồn GitHub',
      'Tìm trên X',
      'Dịch sang tiếng Việt',
      'Hỏi về đoạn này',
      'Ghi nhớ lâu dài',
      'Làm bằng lệnh terminal',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Tra cứu nhanh')).toBeTruthy();
    expect(screen.getByText('Hub Agent OS')).toBeTruthy();
  });

  it('leaves the normal menu alone when nothing is selected or the selection is outside a message', () => {
    setup();
    const nothing = fireEvent.contextMenu(screen.getByTestId('text'));
    expect(nothing).toBe(true);
    expect(screen.queryByTestId('selection-context-menu')).toBeNull();

    selectText(screen.getByTestId('outside'));
    expect(fireEvent.contextMenu(screen.getByTestId('outside'))).toBe(true);
    expect(screen.queryByTestId('selection-context-menu')).toBeNull();
  });

  it('searches with the selected text, encoded, and closes', () => {
    setup();
    selectText(screen.getByTestId('text'));
    fireEvent.contextMenu(screen.getByTestId('text'));
    fireEvent.click(screen.getByText('Tìm trên Google'));
    expect(platform.openExternalUrl).toHaveBeenCalledWith(
      `https://www.google.com/search?q=${encodeURIComponent('chatgpt là một llm api')}`
    );
    expect(screen.queryByTestId('selection-context-menu')).toBeNull();
  });

  it('quotes the selection into the message box and can prefill a translation request', () => {
    setup();
    const replies: unknown[] = [];
    const fills: unknown[] = [];
    const onReply = (event: unknown): void => void replies.push(event);
    const onFill = (event: unknown): void => void fills.push(event);
    emitter.on('sendbox.reply', onReply as never);
    emitter.on('sendbox.fill', onFill as never);

    selectText(screen.getByTestId('text'));
    fireEvent.contextMenu(screen.getByTestId('text'));
    fireEvent.click(screen.getByText('Hỏi về đoạn này'));
    expect(replies).toEqual([{ messageId: 'm1', content: 'chatgpt là một llm api', position: 'left' }]);

    selectText(screen.getByTestId('text'));
    fireEvent.contextMenu(screen.getByTestId('text'));
    fireEvent.click(screen.getByText('Dịch sang tiếng Việt'));
    expect(String(fills[0])).toContain('chatgpt là một llm api');

    selectText(screen.getByTestId('text'));
    fireEvent.contextMenu(screen.getByTestId('text'));
    fireEvent.click(screen.getByText('Làm bằng lệnh terminal'));
    expect(fills[1]).toBe('/terminal chatgpt là một llm api');

    selectText(screen.getByTestId('text'));
    fireEvent.contextMenu(screen.getByTestId('text'));
    fireEvent.click(screen.getByText('Ghi nhớ lâu dài'));
    expect(memory.handlePersonalMemoryCommand).toHaveBeenCalledWith('/remember chatgpt là một llm api');

    emitter.off('sendbox.reply', onReply as never);
    emitter.off('sendbox.fill', onFill as never);
  });

  it('closes on Escape', () => {
    setup();
    selectText(screen.getByTestId('text'));
    fireEvent.contextMenu(screen.getByTestId('text'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('selection-context-menu')).toBeNull();
  });
});

describe('where the menu opens', () => {
  it('stays inside the window near the right and bottom edges', () => {
    expect(clampMenuPosition(990, 790, 6, { width: 1000, height: 800 })).toEqual({ left: 744, top: 564 });
    expect(clampMenuPosition(-5, -5, 6, { width: 1000, height: 800 })).toEqual({ left: 8, top: 8 });
  });
});
