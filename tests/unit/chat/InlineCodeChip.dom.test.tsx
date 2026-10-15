/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@arco-design/web-react', () => ({ Message: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@icon-park/react', () => ({ Copy: () => null, Down: () => null, Up: () => null, PreviewOpen: () => null }));
vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: vi.fn(() => Promise.resolve()) }));
vi.mock('react-syntax-highlighter', () => ({ default: () => null }));
vi.mock('react-syntax-highlighter/dist/esm/styles/hljs', () => ({ vs: {}, vs2015: {} }));
vi.mock('katex', () => ({ default: { renderToString: () => '' } }));
vi.mock('@/renderer/components/Markdown/ChartBlock', () => ({ default: () => null }));
vi.mock('@/renderer/components/Markdown/MermaidBlock', () => ({ default: () => null }));
vi.mock('@/renderer/components/Markdown/SpotlightBlock', () => ({ default: () => null }));
vi.mock('@/renderer/components/Markdown/richUi/RichUiBlock', () => ({ default: () => null }));
vi.mock('@/renderer/components/Markdown/htmlPreview/HtmlLiveBlock', () => ({ default: () => null }));

import { InlineCodeChip } from '@/renderer/components/Markdown/CodeBlock';
import { copyText } from '@/renderer/utils/ui/clipboard';

const copyMock = vi.mocked(copyText);

const mockSelection = (value: { isCollapsed: boolean; text: string } | null) => {
  vi.spyOn(window, 'getSelection').mockReturnValue(
    value
      ? ({ isCollapsed: value.isCollapsed, toString: () => value.text } as unknown as Selection)
      : null
  );
};

describe('InlineCodeChip', () => {
  beforeEach(() => {
    copyMock.mockClear();
    mockSelection({ isCollapsed: true, text: '' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders an accessible button chip with the path token class', () => {
    render(<InlineCodeChip text='src/App.tsx' isPath={true} />);
    const chip = screen.getByRole('button', { name: 'common.copy' });
    expect(chip).toHaveAttribute('tabindex', '0');
    expect(chip).toHaveClass('tomni-md-chip', 'tomni-md-chip--path');
    expect(chip).toHaveTextContent('src/App.tsx');
  });

  it('renders a plain command chip without the path class', () => {
    render(<InlineCodeChip text='opencode -s ses_ebf67622fffeMxGeKVYk9Ax8tx' isPath={false} />);
    const chip = screen.getByRole('button', { name: 'common.copy' });
    expect(chip).toHaveClass('tomni-md-chip');
    expect(chip).not.toHaveClass('tomni-md-chip--path');
  });

  it('copies its text on click and shows the copied state', async () => {
    render(<InlineCodeChip text='ses_123' isPath={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }));
    expect(copyMock).toHaveBeenCalledWith('ses_123');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.copy' })).toHaveAttribute('data-copied', 'true');
    });
  });

  it('does not copy when a text selection is active', () => {
    mockSelection({ isCollapsed: false, text: 'partial' });
    render(<InlineCodeChip text='ses_123' isPath={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }));
    expect(copyMock).not.toHaveBeenCalled();
  });

  it('copies on Enter and Space from the keyboard', () => {
    render(<InlineCodeChip text='ses_key' isPath={false} />);
    const chip = screen.getByRole('button', { name: 'common.copy' });
    fireEvent.keyDown(chip, { key: 'Enter' });
    fireEvent.keyDown(chip, { key: ' ' });
    expect(copyMock).toHaveBeenCalledTimes(2);
    expect(copyMock).toHaveBeenNthCalledWith(1, 'ses_key');
  });

  it('ignores other keys', () => {
    render(<InlineCodeChip text='ses_key' isPath={false} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'common.copy' }), { key: 'a' });
    expect(copyMock).not.toHaveBeenCalled();
  });
});
