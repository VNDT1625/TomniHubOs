import { render } from '@testing-library/react';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { remarkRichText } from '@/renderer/components/Markdown/remarkRichText';

const show = (markdown: string): HTMLElement => {
  const { container } = render(<ReactMarkdown remarkPlugins={[remarkGfm, remarkRichText]}>{markdown}</ReactMarkdown>);
  return container;
};

describe('==highlight==', () => {
  it('marks the text and keeps the surrounding words', () => {
    const view = show('Dùng ==Laya== để chọn tool, rồi ==chạy thử== luôn');
    const marks = [...view.querySelectorAll('mark')].map((mark) => mark.textContent);
    expect(marks).toEqual(['Laya', 'chạy thử']);
    expect(view.textContent).toBe('Dùng Laya để chọn tool, rồi chạy thử luôn');
  });

  it('works inside bold text and list items', () => {
    const view = show('- mục ==một==\n- **đậm ==hai==**');
    expect(view.querySelectorAll('li mark')).toHaveLength(2);
  });

  it('leaves code, links and lone equals signs alone', () => {
    const view = show('`a ==b== c` và [x ==y==](https://example.com) và a == b == c, x === y');
    expect(view.querySelectorAll('mark')).toHaveLength(0);
    expect(view.querySelector('code')?.textContent).toBe('a ==b== c');
  });
});

describe('GitHub alerts', () => {
  it.each([
    ['NOTE', 'note', 'Ghi chú'],
    ['TIP', 'tip', 'Mẹo'],
    ['IMPORTANT', 'important', 'Quan trọng'],
    ['WARNING', 'warning', 'Cảnh báo'],
    ['CAUTION', 'caution', 'Thận trọng'],
  ])('turns [!%s] into a titled callout', (marker, kind, title) => {
    const view = show(`> [!${marker}]\n> Nội dung quan trọng`);
    const quote = view.querySelector('blockquote');
    expect(quote?.className).toBe(`md-alert md-alert-${kind}`);
    expect(quote?.querySelector('.md-alert-title')?.textContent).toBe(title);
    expect(quote?.textContent).toContain('Nội dung quan trọng');
    expect(quote?.textContent).not.toContain('[!');
  });

  it('accepts the marker on its own line and any letter case', () => {
    const view = show('> [!warning]\n>\n> dòng một\n>\n> dòng hai');
    expect(view.querySelector('blockquote')?.className).toContain('md-alert-warning');
    expect(view.querySelectorAll('blockquote p').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps an ordinary quote, and an unknown marker, as they are', () => {
    const plain = show('> chỉ là trích dẫn');
    expect(plain.querySelector('blockquote')?.className).toBe('');
    const unknown = show('> [!FOO]\n> x');
    expect(unknown.querySelector('blockquote')?.className).toBe('');
    expect(unknown.textContent).toContain('[!FOO]');
  });

  it('highlights inside an alert', () => {
    const view = show('> [!TIP]\n> thử ==cách này==');
    expect(view.querySelector('blockquote mark')?.textContent).toBe('cách này');
  });
});
