/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  user: { username: 'ada', email: 'ada@example.com' } as { username: string; email?: string } | null,
  logout: vi.fn(),
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import BillingSettings from '@/renderer/pages/settings/BillingSettings';
import ProfileSettings from '@/renderer/pages/settings/ProfileSettings';

afterEach(() => {
  cleanup();
  auth.user = { username: 'ada', email: 'ada@example.com' };
  auth.logout.mockClear();
});

describe('profile settings', () => {
  it('shows the real account, signs out, and keeps the unconnected controls off', () => {
    const { container } = render(<ProfileSettings />);
    expect(screen.getByTestId('profile-username').textContent).toBe('ada');
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByTestId('settings-not-active')).toBeTruthy();
    fireEvent.click(screen.getByText('settings.profileSettings.logout'));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    for (const control of container.querySelectorAll('button[role="switch"]')) {
      expect(control.hasAttribute('disabled')).toBe(true);
    }
    for (const label of ['exportDataBtn', 'clearHistoryBtn', 'configSync']) {
      expect(screen.getByText(`settings.profileSettings.${label}`).closest('button')?.disabled).toBe(true);
    }
  });

  it('invents nothing when nobody is signed in', () => {
    auth.user = null;
    render(<ProfileSettings />);
    expect(screen.getByTestId('profile-username').textContent).toBe('settings.profileSettings.noAccount');
    expect(screen.queryByText('settings.profileSettings.logout')).toBeNull();
    expect(screen.queryByText(/@/u)).toBeNull();
  });
});

describe('billing settings', () => {
  it('shows no made-up plan, usage or cost and disables the spending cap', () => {
    const { container } = render(<BillingSettings />);
    expect(screen.getByTestId('settings-not-active')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$\d|\d{1,3},\d{3}/u);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(container.querySelector('input')?.disabled).toBe(true);
  });
});
