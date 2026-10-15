/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const storage = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  return {
    values,
    listeners,
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      values.set(key, value);
      listeners.get(key)?.forEach((listener) => listener(value));
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      values.delete(key);
      listeners.get(key)?.forEach((listener) => listener(undefined));
      return Promise.resolve();
    }),
    subscribe: vi.fn((key: string, listener: (value: unknown) => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => set.delete(listener);
    }),
  };
});

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: storage.get,
    set: storage.set,
    remove: storage.remove,
    subscribe: storage.subscribe,
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import MarkdownTextColorSettings from '@/renderer/pages/settings/DisplaySettings/MarkdownTextColorSettings';

const KEY = 'ui.markdownTextColors';

describe('MarkdownTextColorSettings', () => {
  beforeEach(() => {
    storage.values.clear();
    storage.listeners.clear();
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--md-h1');
    document.documentElement.style.removeProperty('--md-link');
  });

  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty('--md-h1');
    document.documentElement.style.removeProperty('--md-link');
  });

  it('persists a picked color and applies it as a root CSS variable', async () => {
    render(<MarkdownTextColorSettings />);
    const input = screen.getByLabelText('settings.markdownColors.tokens.h1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#33AA55' } });

    expect(document.documentElement.style.getPropertyValue('--md-h1')).toBe('#33aa55');
    expect(storage.set).toHaveBeenCalledWith(KEY, { h1: '#33aa55' });
    await waitFor(() => expect(storage.values.get(KEY)).toEqual({ h1: '#33aa55' }));
  });

  it('restores a saved override on mount and ignores invalid values', () => {
    storage.values.set(KEY, { link: '#101010', h1: 'not-a-color' });
    render(<MarkdownTextColorSettings />);
    const link = screen.getByLabelText('settings.markdownColors.tokens.link') as HTMLInputElement;
    expect(link.value).toBe('#101010');
    const h1 = screen.getByLabelText('settings.markdownColors.tokens.h1') as HTMLInputElement;
    expect(h1.value).toBe('#1d4ed8');
  });

  it('resets one token to its default and removes its variable', () => {
    storage.values.set(KEY, { h1: '#33aa55', link: '#101010' });
    document.documentElement.style.setProperty('--md-h1', '#33aa55');
    render(<MarkdownTextColorSettings />);

    const resetButtons = screen.getAllByRole('button', { name: 'settings.markdownColors.resetToken' });
    fireEvent.click(resetButtons[0]);

    expect(document.documentElement.style.getPropertyValue('--md-h1')).toBe('');
    expect(storage.values.get(KEY)).toEqual({ link: '#101010' });
  });

  it('resets all overrides and removes the stored key', () => {
    storage.values.set(KEY, { h1: '#33aa55' });
    document.documentElement.style.setProperty('--md-h1', '#33aa55');
    render(<MarkdownTextColorSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.markdownColors.resetAll' }));

    expect(document.documentElement.style.getPropertyValue('--md-h1')).toBe('');
    expect(storage.remove).toHaveBeenCalledWith(KEY);
    expect(storage.values.has(KEY)).toBe(false);
  });

  it('renders the live preview with the shared Markdown token classes', () => {
    render(<MarkdownTextColorSettings />);
    const preview = screen.getByTestId('markdown-color-preview');
    expect(preview).toHaveClass('tomni-md-body', 'tomni-md-preview');
    expect(preview.querySelector('h1')).not.toBeNull();
    expect(preview.querySelector('code.tomni-md-chip.tomni-md-chip--path')).not.toBeNull();
    expect(preview.querySelector('blockquote')).not.toBeNull();
  });
});
