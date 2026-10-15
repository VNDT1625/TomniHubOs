/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MARKDOWN_TEXT_TOKENS,
  applyMarkdownTextColors,
  getDefaultMarkdownTextColor,
  sanitizeMarkdownTextColors,
} from '@/renderer/utils/theme/markdownTextColors';

const CSS_PATH = path.resolve(__dirname, '../../../packages/desktop/src/renderer/styles/tomni-ui.css');

/** Returns the declared default of a token from the light or dark block of the Markdown token section. */
const readCssDefault = (css: string, theme: 'light' | 'dark', cssVar: string): string | undefined => {
  const start = css.indexOf('---- 1b. Markdown text tokens');
  const end = css.indexOf('/* Rules below are copied');
  const section = css.slice(start, end);
  const darkStart = section.indexOf("[data-theme='dark'] {");
  const block = theme === 'light' ? section.slice(0, darkStart) : section.slice(darkStart);
  const match = new RegExp(`${cssVar}:\\s*([^;]+);`).exec(block);
  return match?.[1].trim().toLowerCase();
};

describe('markdown text color tokens', () => {
  afterEach(() => {
    applyMarkdownTextColors({});
  });

  it('applies valid overrides as root --md-* properties and clears them on reset', () => {
    const root = document.documentElement;
    applyMarkdownTextColors({ h1: '#ABCDEF', link: '#123456' });
    expect(root.style.getPropertyValue('--md-h1')).toBe('#abcdef');
    expect(root.style.getPropertyValue('--md-link')).toBe('#123456');
    expect(root.style.getPropertyValue('--md-quote')).toBe('');

    applyMarkdownTextColors({});
    expect(root.style.getPropertyValue('--md-h1')).toBe('');
    expect(root.style.getPropertyValue('--md-link')).toBe('');
  });

  it('ignores invalid stored values and unknown tokens', () => {
    const root = document.documentElement;
    applyMarkdownTextColors({ h1: 'red', h2: '#12345', bold: 'url(x)', unknown: '#000000' });
    expect(root.style.getPropertyValue('--md-h1')).toBe('');
    expect(root.style.getPropertyValue('--md-h2')).toBe('');
    expect(root.style.getPropertyValue('--md-bold')).toBe('');
    expect(sanitizeMarkdownTextColors('not-an-object')).toEqual({});
  });

  it('keeps only valid entries when sanitizing', () => {
    expect(sanitizeMarkdownTextColors({ h1: '#AABBCC', path: 'blue', quote: '#000000' })).toEqual({
      h1: '#aabbcc',
      quote: '#000000',
    });
  });

  it('matches tomni-ui.css defaults with the TypeScript defaults table', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    for (const token of MARKDOWN_TEXT_TOKENS) {
      expect(readCssDefault(css, 'light', token.cssVar), token.cssVar).toBe(token.light);
      expect(readCssDefault(css, 'dark', token.cssVar), token.cssVar).toBe(token.dark);
      expect(getDefaultMarkdownTextColor(token.id, 'dark')).toBe(token.dark);
    }
  });

  it('defines token-classed rules for headings, links, strong text and inline code chips', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    for (const selector of [
      '.tomni-md-body h1',
      '.tomni-md-body h2',
      '.tomni-md-body h3',
      '.tomni-md-body strong',
      '.tomni-md-body a',
      '.tomni-md-body code.tomni-md-chip',
      '.tomni-md-body code.tomni-md-chip--path',
    ]) {
      expect(css).toContain(`${selector} {`);
    }
  });
});
