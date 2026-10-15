import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SuperSearch from '@/renderer/components/layout/SuperSearch';
import { addEventListener, consumeRequestedBrowserUrl } from '@/renderer/utils/emitter';

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getUserConversations: { invoke: vi.fn().mockResolvedValue({ items: [] }) } },
    mcpService: { listServers: { invoke: vi.fn().mockResolvedValue([]) } },
    windowControls: { restart: { invoke: vi.fn() } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
  }),
}));

const Where: React.FC = () => <output data-testid='where'>{useLocation().pathname}</output>;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SuperSearch />
      <Where />
    </MemoryRouter>
  );

const input = () => screen.getByRole('combobox', { name: 'common.superSearch.ariaLabel' });

afterEach(() => {
  consumeRequestedBrowserUrl();
});

describe('SuperSearch (header)', () => {
  it('opens a centre listbox with per-source rank badges and runs the selected hit with Enter', async () => {
    renderAt('/guid');
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'store' } });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText(/superSearch\.rank/).length).toBeGreaterThan(0);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent('/store');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('moves the selection with the arrow keys and closes with Escape', async () => {
    renderAt('/guid');
    fireEvent.change(input(), { target: { value: 'settings' } });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('scopes a query with the alias prefix and hands the URL to the Browser app', async () => {
    renderAt('/guid');
    fireEvent.change(input(), { target: { value: 'fb: abc' } });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Facebook');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent('/browser');
    expect(consumeRequestedBrowserUrl()).toBe('https://www.facebook.com/search/top?q=abc');
  });

  it('shows scope tabs and switches scope when one is clicked', async () => {
    renderAt('/guid');
    fireEvent.focus(input());
    fireEvent.click(screen.getByRole('tab', { name: /Facebook/ }));
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Facebook');
  });

  it('turns engine-specific in the Browser app and searches with the chosen engine', async () => {
    const opened: string[] = [];
    const off = addEventListener('browser.openUrl', (url) => opened.push(url));
    renderAt('/browser');
    expect(screen.getByRole('combobox', { name: 'common.superSearch.ariaLabel' })).toBeInTheDocument();
    const engine = screen.getByRole('combobox', { name: 'common.superSearch.engineLabel' }) as HTMLSelectElement;
    expect(engine.value).toBe('google');
    expect(screen.queryByText('Ctrl + K')).not.toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'yahoo : abcxyz' } });
    expect(engine.value).toBe('yahoo');
    expect(input()).toHaveValue('abcxyz');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.keyDown(input(), { key: 'Enter' });
    });
    off();
    expect(opened).toEqual(['https://search.yahoo.com/search?p=abcxyz']);
    expect(screen.getByTestId('where')).toHaveTextContent('/browser');
  });

  it('announces the panel to the Browser app so its native view steps aside', async () => {
    const states: boolean[] = [];
    const off = addEventListener('browser.overlay', (open) => states.push(open));
    renderAt('/browser');
    fireEvent.focus(input());
    await waitFor(() => expect(states).toContain(true));
    fireEvent.keyDown(input(), { key: 'Escape' });
    await waitFor(() => expect(states.at(-1)).toBe(false));
    off();
  });
});
