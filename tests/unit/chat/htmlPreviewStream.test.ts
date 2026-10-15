import { describe, expect, it } from 'vitest';
import { extractHtmlPreviewBlocks, MAX_HTML_STREAM_SIZE } from '@/common/chat/htmlPreviewStream';

describe('full HTML streaming extraction', () => {
  it('keeps an unfinished HTML fence renderable while the model is still writing', () => {
    expect(extractHtmlPreviewBlocks('Giải thích:\n\n```html\n<!doctype html><main>Work in progress')).toEqual([
      '<!doctype html><main>Work in progress',
    ]);
  });

  it('extracts multiple completed HTML snippets without swallowing surrounding Markdown', () => {
    const markdown =
      'Start\n```html:index.html\n<h1>Page one</h1>\n```\nBetween\n```htm\n<div>Page two</div>\n```\nEnd';
    expect(extractHtmlPreviewBlocks(markdown)).toEqual(['<h1>Page one</h1>', '<div>Page two</div>']);
  });

  it('does not truncate a real HTML page at the Home 8K summary boundary', () => {
    const longHtml = '<main>' + 'a'.repeat(15000) + '</main>';
    expect(extractHtmlPreviewBlocks('```html\n' + longHtml + '\n```')[0]).toBe(longHtml);
  });

  it('bounds transport payloads and ignores unrelated code fences', () => {
    expect(extractHtmlPreviewBlocks('```python\nprint(1)\n```')).toEqual([]);
    expect(extractHtmlPreviewBlocks('```html\n' + 'x'.repeat(MAX_HTML_STREAM_SIZE + 500))[0].length).toBe(
      MAX_HTML_STREAM_SIZE
    );
  });
});
