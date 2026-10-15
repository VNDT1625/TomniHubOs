/** Signed package gate regression: missing apps must never execute a bundled IDE/Browser route. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  list: vi.fn(),
    install: vi.fn(),
  refresh: vi.fn(),
  consent: vi.fn(),
}));
vi.mock('@/renderer/pages/hub/packageClient', () => ({
    packageClient: { list: mock.list, refresh: mock.refresh, install: mock.install },
}));
vi.mock('@/renderer/pages/hub/StoreProductDetail/permissionConsent', () => ({
  requestPackagePermissionUpdateConsent: mock.consent,
}));
vi.mock('@/renderer/pages/hub/PackageAppHost', () => ({
  getFirstRunnablePackageModule: (item: { enabled: boolean; installedManifest?: { modules: Array<{ id: string }> } }) =>
    item.enabled ? item.installedManifest?.modules[0] : undefined,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
    <button type='button' onClick={onClick} disabled={disabled}>{children}</button>,
  Alert: ({ content }: { content: string }) => <div role='alert'>{content}</div>,
}));

import DefaultPackageRoute from '@/renderer/pages/guid/shell/DefaultPackageRoute';

const example = (state: 'available' | 'installed', compatible = true) => {
  const manifest = {
    id: 'com.tomni.ide', name: 'IDE', type: 'app' as const, publisherId: 'com.tomni',
    modules: [{ id: 'ide', entrypoint: 'app.js', runtime: 'trusted-react' as const, title: 'IDE' }],
  };
  return {
    manifest, installedManifest: state === 'installed' ? manifest : undefined,
    delivery: 'downloaded-package' as const, trust: 'signed-first-party' as const,
    installedTrust: state === 'installed' ? 'signed-first-party' as const : undefined,
    state, enabled: state === 'installed', revoked: false, compatible,
  };
};

const AppDestination: React.FC = () => {
  const { packageId, moduleId } = useParams();
  return <output data-testid='package-destination'>{packageId}:{moduleId}</output>;
};

const view = () => render(
  <MemoryRouter initialEntries={['/ide']}>
    <Routes>
      <Route path='/ide' element={<DefaultPackageRoute app='ide' />} />
      <Route path='/apps/:packageId/:moduleId' element={<AppDestination />} />
      <Route path='/store/package/:packageId' element={<output data-testid='package-management' />} />
    </Routes>
  </MemoryRouter>
);

describe('default optional package route', () => {
  beforeEach(() => {
    mock.list.mockReset();
        mock.install.mockReset();
    mock.refresh.mockReset();
    mock.consent.mockReset();
    mock.consent.mockResolvedValue(undefined);
  });

    it('refreshes Store releases and allows a missing app to download when a compatible release appears', async () => {
    mock.list.mockResolvedValue([example('available', false)]);
    mock.refresh.mockResolvedValue([example('available', true)]);
    mock.install.mockResolvedValue(example('installed'));
    view();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('common.refresh'));
    expect(await screen.findByText('guid.hubHome.layout.installAndOpen')).toBeInTheDocument();
    expect(mock.refresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('guid.hubHome.layout.installAndOpen'));
    expect(await screen.findByTestId('package-destination')).toHaveTextContent('com.tomni.ide:ide');
  });

  it('never opens a missing or host-incompatible signed IDE artifact', async () => {
    mock.list.mockResolvedValue([example('available', false)]);
    view();
    expect(await screen.findByTestId('default-package-gate-ide')).toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.queryByTestId('package-destination')).not.toBeInTheDocument();
    expect(screen.queryByText('guid.hubHome.layout.installAndOpen')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('guid.hubHome.layout.managePackage'));
    expect(await screen.findByTestId('package-management')).toBeInTheDocument();
    expect(mock.install).not.toHaveBeenCalled();
  });

    it('keeps an installed but host-incompatible package behind the gate', async () => {
    mock.list.mockResolvedValue([example('installed', false)]);
    view();
    expect(await screen.findByTestId('default-package-gate-ide')).toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.queryByTestId('package-destination')).not.toBeInTheDocument();
  });

  it('opens only an actually installed, enabled IDE package module', async () => {
    mock.list.mockResolvedValue([example('installed')]);
    view();
    expect(await screen.findByTestId('package-destination')).toHaveTextContent('com.tomni.ide:ide');
    expect(mock.install).not.toHaveBeenCalled();
  });

    it('retries a failed download after uninstall and opens only when verified installation finishes', async () => {
    mock.list.mockResolvedValue([{
      ...example('available'), state: 'failed', installedVersion: '1.0.0', installedManifest: undefined,
    }]);
    mock.install.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
    mock.install.mockResolvedValueOnce(example('installed'));
    view();
    fireEvent.click(await screen.findByText('guid.hubHome.layout.installAndOpen'));
    expect(await screen.findByRole('alert')).toHaveTextContent('NETWORK_UNAVAILABLE');
    expect(screen.queryByTestId('package-destination')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('guid.hubHome.layout.installAndOpen'));
    expect(await screen.findByTestId('package-destination')).toHaveTextContent('com.tomni.ide:ide');
    expect(mock.install).toHaveBeenCalledTimes(2);
  });

  it('downloads through permission consent, then opens the verified installed module', async () => {
    mock.list.mockResolvedValue([example('available')]);
    mock.install.mockResolvedValue(example('installed'));
    view();
    fireEvent.click(await screen.findByText('guid.hubHome.layout.installAndOpen'));
    await waitFor(() => expect(mock.install).toHaveBeenCalledWith('com.tomni.ide', undefined));
    expect(await screen.findByTestId('package-destination')).toHaveTextContent('com.tomni.ide:ide');
    expect(mock.consent).toHaveBeenCalledOnce();
  });
});
