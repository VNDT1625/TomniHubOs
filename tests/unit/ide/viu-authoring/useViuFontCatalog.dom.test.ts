/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createViuFontOptions,
  useViuFontCatalog,
} from '@package-apps/design/renderer/viu/next/authoring/useViuFontCatalog';

type FontWindow = Window & {
  queryLocalFonts?: () => Promise<readonly { family: string }[]>;
};

const fontWindow = window as FontWindow;
const originalQueryLocalFonts = fontWindow.queryLocalFonts;

afterEach(() => {
  if (originalQueryLocalFonts) fontWindow.queryLocalFonts = originalQueryLocalFonts;
  else Reflect.deleteProperty(fontWindow, 'queryLocalFonts');
  vi.restoreAllMocks();
});

describe('VIU local font catalog', () => {
  it('starts with a broad searchable catalog instead of four hardcoded families', () => {
    const options = createViuFontOptions([], 'Custom Brand Font, sans-serif');

    expect(options.length).toBeGreaterThan(40);
    expect(options.some((option) => option.value === 'Custom Brand Font')).toBe(true);
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
  });

  it('keeps every exposed face so the catalog can describe family depth', () => {
    const options = createViuFontOptions([
      { family: 'Aptos', style: 'Regular' },
      { family: 'Aptos', style: 'Italic' },
      { family: 'Aptos', style: 'SemiBold' },
    ]);
    const aptos = options.find((option) => option.value === 'Aptos');

    expect(aptos?.source).toBe('system');
    expect(aptos?.styles).toEqual(['Italic', 'Regular', 'SemiBold']);
  });

  it('loads every unique installed family exposed by Chromium', async () => {
    fontWindow.queryLocalFonts = vi
      .fn()
      .mockResolvedValue([
        { family: 'Aptos' },
        { family: 'Aptos' },
        { family: 'Be Vietnam Pro' },
        { family: 'SVN-Gilroy' },
      ]);
    const { result } = renderHook(() => useViuFontCatalog());

    await act(() => result.current.loadSystemFonts());

    expect(result.current.status).toBe('ready');
    expect(result.current.systemFontCount).toBe(3);
    expect(result.current.options.map((option) => option.value)).toEqual(
      expect.arrayContaining(['Aptos', 'Be Vietnam Pro', 'SVN-Gilroy'])
    );
  });

  it('reports unsupported runtimes without throwing', async () => {
    Reflect.deleteProperty(fontWindow, 'queryLocalFonts');
    const { result } = renderHook(() => useViuFontCatalog());

    await act(() => result.current.loadSystemFonts());

    expect(result.current.status).toBe('unsupported');
  });
});
