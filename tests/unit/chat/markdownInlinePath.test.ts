/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isInlinePath } from '@/renderer/components/Markdown/markdownUtils';

describe('isInlinePath', () => {
  it.each([
    'src/renderer/App.tsx',
    'packages\\desktop\\src\\main.ts',
    'C:\\NDT\\PJ\\TomniHubOS\\AGENTS.md',
    '~/projects/app',
    './scripts/check-i18n.js',
    'README.md',
    'tomni-ui.css',
  ])('treats %s as a path', (text) => {
    expect(isInlinePath(text)).toBe(true);
  });

  it.each([
    'opencode -s ses_ebf67622fffeMxGeKVYk9Ax8tx',
    'ses_ebf67622fffeMxGeKVYk9Ax8tx',
    'https://example.com/a/b',
    'hello',
    '1.2.3',
    'x = a / b',
    '',
    'a'.repeat(300),
  ])('does not treat %s as a path', (text) => {
    expect(isInlinePath(text)).toBe(false);
  });
});
