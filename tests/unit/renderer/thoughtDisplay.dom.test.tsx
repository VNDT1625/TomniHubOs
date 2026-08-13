/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

describe('ThoughtDisplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one elapsed clock when the active thought subject changes', () => {
    vi.setSystemTime(new Date('2026-07-21T00:00:00.000Z'));
    const { rerender } = render(<ThoughtDisplay thought={{ subject: 'Planning', description: '' }} running />);

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('(2s)')).toBeInTheDocument();

    rerender(<ThoughtDisplay thought={{ subject: 'Executing', description: '' }} running />);
    expect(screen.getByText('(2s)')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('(3s)')).toBeInTheDocument();
  });

  it('stops after completion and starts a fresh clock on the next run', () => {
    vi.setSystemTime(new Date('2026-07-21T00:00:00.000Z'));
    const { rerender } = render(<ThoughtDisplay thought={{ subject: 'Planning', description: '' }} running />);

    act(() => vi.advanceTimersByTime(2_000));
    rerender(<ThoughtDisplay thought={{ subject: 'Planning', description: '' }} running={false} />);
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByText('(5s)')).not.toBeInTheDocument();

    rerender(<ThoughtDisplay thought={{ subject: 'Planning', description: '' }} running />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('(1s)')).toBeInTheDocument();
  });
});
