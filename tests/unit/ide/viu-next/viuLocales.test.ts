/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPremiumStarterProject } from '@/common/viu';

type ViuLocaleBlock = {
  modes: { design: string; prototype: string; present: string };
  canvas: { panHint: string };
};

const LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'zh-TW', 'ko-KR', 'tr-TR', 'ru-RU', 'uk-UA', 'vi-VN'];
const localeRoot = join(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales');

const readViuNext = (locale: string): ViuLocaleBlock => {
  const file = join(localeRoot, locale, 'ide.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { viu: { next: ViuLocaleBlock } }).viu.next;
};

const flattenStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(flattenStrings);
};

describe('VIU locale Unicode integrity', () => {
  it('keeps Vietnamese editor controls intact', () => {
    const locale = readViuNext('vi-VN');

    expect(locale.modes).toEqual({
      design: 'Thi\u1ebft k\u1ebf',
      prototype: 'Nguy\u00ean m\u1eabu',
      present: 'Tr\u00ecnh chi\u1ebfu',
    });
  });

  it('keeps intentional Unicode punctuation in the reference locale', () => {
    expect(readViuNext('en-US').canvas.panHint).toContain('\u00b7');
  });

  it('keeps starter content free of encoding placeholders', () => {
    const project = createPremiumStarterProject();
    const visibleText = [
      project.title,
      ...Object.values(project.nodes).flatMap((node) => [node.name, node.content?.text ?? '']),
    ].join('\n');

    expect(visibleText).toContain('\u2192');
    expect(visibleText).toContain('\u2190');
    expect(visibleText).toContain('\u00b7');
    expect(visibleText).not.toMatch(/[A-Za-z] \? |\? [A-Za-z]/u);
  });

  it.each(LOCALES)('contains no replacement or mojibake pattern in %s', (localeName) => {
    const strings = flattenStrings(readViuNext(localeName));
    const joined = strings.join('\n');

    expect(joined).not.toContain('\ufffd');
    expect(joined).not.toMatch(/\?{2,}/u);
    expect(joined).not.toMatch(/[\p{L}]\?[\p{L}]/u);
  });
});
