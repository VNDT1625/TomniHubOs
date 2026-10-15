/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HookSettingsRow } from '@/common/integrations/hooks/hookSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(opts?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/gu, (_m, name: string) => String(opts?.[name] ?? '')),
  }),
}));

import { AutoSelectRow } from '@/renderer/components/media/attachMenu/AutoSelectRow';
import { HookMenuList } from '@/renderer/components/media/attachMenu/HookColumn';

const hook = (overrides: Partial<HookSettingsRow> & { id: string }): HookSettingsRow => ({
  source: 'user',
  event: 'PreToolUse',
  form: 'exec',
  command: 'node check.js',
  timeoutSec: 10,
  status: 'ready',
  approved: true,
  active: true,
  ...overrides,
});

describe('AutoSelectRow', () => {
  afterEach(() => cleanup());

  it('is a switch with aria-checked that reflects the state', () => {
    const { rerender } = render(<AutoSelectRow autoSelect={false} onToggleAutoSelect={vi.fn()} />);
    const off = screen.getByRole('switch', { name: 'Auto' });
    expect(off).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('attach-auto-hint')).toHaveTextContent('Turn on to let Laya choose');
    rerender(<AutoSelectRow autoSelect onToggleAutoSelect={vi.fn()} />);
    const on = screen.getByRole('switch', { name: 'Auto' });
    expect(on).toHaveAttribute('aria-checked', 'true');
    expect(on).toHaveAttribute('data-state', 'on');
    expect(screen.getByTestId('attach-auto-hint')).toHaveTextContent('Laya will pick');
  });

  it('toggles on click and on the keyboard (Space)', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<AutoSelectRow autoSelect={false} onToggleAutoSelect={onToggle} />);
    await user.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    screen.getByRole('switch').focus();
    await user.keyboard(' ');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});

describe('HookMenuList (Hook column)', () => {
  afterEach(() => cleanup());

  it('shows an empty state and the switch note when no hook is active', () => {
    render(<HookMenuList hooks={[]} packageNames={new Map()} />);
    expect(screen.getByTestId('attach-hook-empty')).toHaveTextContent('No active hooks');
    expect(screen.getByTestId('attach-hook-note')).toHaveTextContent('Turn them on or off in Settings');
  });

  it('groups package hooks under the package name and keeps user hooks under Other', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <HookMenuList
        packageNames={new Map([['pkg-a', 'Package A']])}
        hooks={[
          hook({ id: 'h1', source: 'package', pluginId: 'pkg-a', event: 'PostToolUse', matcher: 'Bash' }),
          hook({ id: 'h2', source: 'package', pluginId: 'pkg-a', command: 'python lint.py' }),
          hook({ id: 'h3', source: 'user', command: 'bash mine.sh' }),
        ]}
      />
    );
    expect(screen.getByText('Other')).toBeTruthy();
    const group = screen.getByTestId('attach-hook-group-pkg-a');
    expect(within(group).getByText('Package A')).toBeTruthy();
    expect(within(group).getByText('2 hook')).toBeTruthy();
    expect(screen.getByTestId('attach-hook-h1')).toHaveTextContent('PostToolUse · Bash');
    expect(screen.getByTestId('attach-hook-h3')).toHaveTextContent('bash mine.sh');

    const header = within(group).getByRole('button', { name: /Package A/u });
    await user.click(header);
    expect(screen.queryByTestId('attach-hook-h1')).toBeNull();
    await user.click(header);
    expect(screen.getByTestId('attach-hook-h1')).toBeTruthy();
  });
});
