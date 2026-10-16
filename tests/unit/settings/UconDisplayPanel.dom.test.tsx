import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const settings = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const listeners = new Set<(value: unknown) => void>();
  return {
    values,
    listeners,
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
      listeners.forEach((listener) => listener(value));
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
      listeners.forEach((listener) => listener(undefined));
    }),
    subscribe: vi.fn((_key: string, listener: (value: unknown) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
});
vi.mock('@/common/config/configService', () => ({ configService: settings }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    ...rest
  }: React.PropsWithChildren<{ onClick?: () => void; 'data-testid'?: string }>) => (
    <button {...rest} type='button' onClick={onClick}>
      {children}
    </button>
  ),
  Switch: ({
    checked,
    onChange,
    disabled,
    ...rest
  }: {
    checked: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
    'data-testid'?: string;
  }) => (
    <input
      {...rest}
      type='checkbox'
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
  Modal: ({
    visible,
    children,
    onCancel,
    title,
  }: React.PropsWithChildren<{ visible: boolean; onCancel: () => void; title: string }>) =>
    visible ? (
      <div role='dialog' aria-label={title}>
        <button type='button' onClick={onCancel}>
          Close
        </button>
        {children}
      </div>
    ) : null,
}));
vi.mock('@/renderer/components/agents/UconBot', () => ({
  UconBot: ({ avatar, label, cliAgentId }: { avatar?: string; label: string; cliAgentId?: string }) => (
    <span data-testid='mock-ucon' data-avatar={avatar} data-cli={cliAgentId}>
      {label}
    </span>
  ),
}));
vi.mock('@/renderer/components/agents/uconPackageSkins', () => ({
  useUconPackageSkins: () => [],
  encodePackageAvatar: ({ packageId, skinId }: { packageId: string; skinId: string }) =>
    'uconpkg:' + packageId + ':' + skinId,
}));

import UconDisplayPanel from '@/renderer/pages/settings/DisplaySettings/UconDisplayPanel';

describe('Settings > Display > UCON', () => {
  beforeEach(() => {
    settings.values.clear();
    settings.listeners.clear();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('persists display switches and restores defaults without erasing avatar data', async () => {
    settings.values.set('assistant.avatar', 'uconcli:grok');
    render(<UconDisplayPanel />);
    const enabled = screen.getByTestId('ucon-pref-enabled') as HTMLInputElement;
    expect(enabled.checked).toBe(true);
    fireEvent.click(enabled);
    expect(settings.set).toHaveBeenCalledWith('ui.uconDisplay', expect.objectContaining({ enabled: false }));
    expect(screen.getByTestId('ucon-pref-live')).toBeDisabled();
    fireEvent.click(screen.getByTestId('reset-ucon-prefs'));
    expect(settings.remove).toHaveBeenCalledWith('ui.uconDisplay');
    expect(settings.values.get('assistant.avatar')).toBe('uconcli:grok');
  });

  it('opens live gallery with 10 Core skins and 11 CLI skins including Grok', () => {
    render(<UconDisplayPanel />);
    fireEvent.click(screen.getByTestId('open-ucon-gallery'));
    expect(screen.getByTestId('ucon-gallery')).toBeInTheDocument();
    expect(screen.getByTestId('ucon-skin-tomny')).toBeInTheDocument();
    expect(screen.getByTestId('ucon-skin-cli:grok')).toBeInTheDocument();
    expect(screen.getByTestId('ucon-skin-grid').querySelectorAll('button')).toHaveLength(21);
    fireEvent.change(screen.getByTestId('ucon-filter'), { target: { value: 'cli' } });
    expect(screen.getByTestId('ucon-skin-grid').querySelectorAll('button')).toHaveLength(11);
    fireEvent.change(screen.getByTestId('ucon-search'), { target: { value: 'grok' } });
    fireEvent.click(screen.getByTestId('ucon-skin-cli:grok'));
    expect(screen.getByTestId('ucon-avatar-marker')).toHaveTextContent('uconcli:grok');
    fireEvent.change(screen.getByTestId('ucon-preview-state'), { target: { value: 'error' } });
    expect(screen.getByTestId('ucon-selected-preview')).toBeInTheDocument();
  });

  it('opens Studio with editable Core accessories and a bounded preview avatar marker', () => {
    render(<UconDisplayPanel />);
    fireEvent.click(screen.getByTestId('open-ucon-studio'));
    expect(screen.getByTestId('ucon-studio-slots')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('ucon-studio-ears'), { target: { value: 'fin' } });
    expect(screen.getByTestId('ucon-avatar-marker')).toHaveTextContent('ucon:core;ears=fin');
    expect(settings.set).not.toHaveBeenCalled();
  });
});
