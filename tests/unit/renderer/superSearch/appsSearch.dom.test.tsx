import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SuperSearch from '@/renderer/components/layout/SuperSearch';

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getUserConversations: { invoke: vi.fn().mockResolvedValue({ items: [] }) } },
    mcpService: { listServers: { invoke: vi.fn().mockResolvedValue([]) } },
    windowControls: { restart: { invoke: vi.fn() } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const fixtures = vi.hoisted(() => {
  const manifest = (id: string, name: string, description: string) => ({
    id,
    name,
    description,
    tags: [],
    modules: [],
  });
  const listing = (id: string, name: string, description: string, installed: boolean) => ({
    manifest: manifest(id, name, description),
    delivery: 'downloaded-package',
    state: installed ? 'installed' : 'available',
    installedManifest: installed ? manifest(id, name, description) : undefined,
    enabled: true,
  });

  return { listing, manifest };
});

vi.mock('@/renderer/pages/hub/packageClient', () => ({
  packageClient: {
    list: vi
      .fn()
      .mockResolvedValue([
        fixtures.listing('com.acme.notes', 'Ghi chú nhanh', 'Sổ tay', true),
        fixtures.listing('com.acme.calc', 'Calculator', 'Math helper', false),
      ]),
  },
}));

vi.mock('@/renderer/pages/hub/PackageAppHost', () => ({
  getRunnablePackageModules: (item: { installedManifest?: { name: string } }) =>
    item.installedManifest ? [{ id: 'main', title: item.installedManifest.name, pinnable: true }] : [],
}));

const Where: React.FC = () => <output data-testid='where'>{useLocation().pathname}</output>;

const open = (query: string) => {
  render(
    <MemoryRouter initialEntries={['/guid']}>
      <SuperSearch />
      <Where />
    </MemoryRouter>
  );
  const input = screen.getByRole('combobox', { name: 'common.superSearch.ariaLabel' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: query } });
  return input;
};

describe('SuperSearch app results', () => {
  it('finds an installed package app by unaccented name and launches it', async () => {
    const input = open('ghi chu');
    await waitFor(() => expect(screen.getByText('Ghi chú nhanh')).toBeInTheDocument());
    expect(screen.getAllByText('common.superSearch.source.apps').length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/com.acme.notes/main');
  });

  it('finds a built-in app and opens a store-only package on its Store page', async () => {
    const input = open('calculator');
    await waitFor(() => expect(screen.getByText('Calculator')).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent('/store/package/com.acme.calc');
  });
});
