/**
 * @vitest-environment jsdom
 */

import type { PackageListing, PackageUpdatePermissionConsentChallenge } from '@/common/packages';
import StoreProductDetail from '@/renderer/pages/hub/StoreProductDetail';
import { Message, Modal } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const packageMocks = vi.hoisted(() => ({
  list: vi.fn(),
  preparePermissionUpdate: vi.fn(),
  approvePermissionUpdate: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
}));

vi.mock('@/renderer/pages/hub/packageClient', () => ({
  packageClient: packageMocks,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
    t: (key: string, values?: { index?: number; name?: string; version?: string }) =>
      ({
        'common.loading': 'Loading',
        'common.retry': 'Retry',
        'common.add': 'Add',
        'common.edit': 'Edit',
        'common.confirm': 'Confirm',
        'common.cancel': 'Cancel',
        'common.remove': 'Remove',
        'common.version': 'Version',
        'manager.palette.open': 'Open',
        'guid.hubHome.storeDetail.back': 'Back to Store',
        'guid.hubHome.storeDetail.app': 'App',
        'guid.hubHome.storeDetail.installed': 'Installed',
        'guid.hubHome.storeDetail.available': 'Available',
        'guid.hubHome.storeDetail.verified': 'Verified',
        'guid.hubHome.storeDetail.install': 'Install',
        'guid.hubHome.storeDetail.update': 'Update',
        'guid.hubHome.storeDetail.reinstall': 'Reinstall',
        'guid.hubHome.storeDetail.updateAvailable': 'Update available',
        'guid.hubHome.storeDetail.incompatible': 'Not compatible',
        'guid.hubHome.storeDetail.quarantined': 'Security check failed',
        'guid.hubHome.storeDetail.removeTitle': `Remove ${values?.name}?`,
        'guid.hubHome.storeDetail.removeDescription': 'Remove package files.',
        'guid.hubHome.storeDetail.size': 'Size',
        'guid.hubHome.storeDetail.compatibility': 'Compatibility',
        'guid.hubHome.storeDetail.previewLabel': 'Capability preview',
        'guid.hubHome.storeDetail.previewDescription': 'Real modules included in this package.',
        'guid.hubHome.storeDetail.previewImageAlt': `${values?.name} preview image ${values?.index}`,
        'guid.hubHome.storeDetail.about': 'About',
        'guid.hubHome.storeDetail.whatsInside': "What's inside",
        'guid.hubHome.storeDetail.releaseNotes': "What's new",
        'guid.hubHome.storeDetail.releaseNotesBody': 'Signed release.',
        'guid.hubHome.storeDetail.developer': 'Developer',
        'guid.hubHome.storeDetail.publisher': 'Publisher',
        'guid.hubHome.storeDetail.packageType': 'Package type',
        'guid.hubHome.storeDetail.trust': 'Trust',
        'guid.hubHome.storeDetail.firstParty': 'Tomny verified',
        'guid.hubHome.storeDetail.storeSigned': 'Store signed',
        'guid.hubHome.storeDetail.permissions': 'Permissions',
        'guid.hubHome.storeDetail.noPermissions': 'No permissions',
        'guid.hubHome.storeDetail.dependencies': 'Dependencies',
        'guid.hubHome.storeDetail.noDependencies': 'No dependencies',
        'guid.hubHome.storeDetail.notFound': 'Product unavailable',
      })[key] ??
      (key === 'guid.hubHome.storeDetail.previewTitle'
        ? `Explore ${values?.name}`
        : key === 'guid.hubHome.storeDetail.currentRelease'
          ? `Version ${values?.version}`
          : key),
  }),
}));

const createIdeListing = (state: PackageListing['state'] = 'available'): PackageListing => {
  const manifest = {
    schemaVersion: 1,
    id: 'com.tomni.ide',
    publisherId: 'com.tomni',
    name: 'IDE',
    description: 'Agentic development workspace',
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=0.0.0' },
    modules: [
      {
        id: 'ide',
        title: 'IDE & App Builder',
        surface: 'apps/ide',
        pinnable: true,
        runtime: 'trusted-react',
        entrypoint: 'app.js',
      },
    ],
    permissions: ['workspace.read', 'model.invoke'],
    dependencies: [],
    tags: ['ide', 'development'],
    artifact: {
      integrity: 'sha256-test',
      sizeBytes: 26_387_978,
      signature: { algorithm: 'ed25519', keyId: 'test', value: 'signature' },
    },
  } satisfies PackageListing['manifest'];
  const installed = state === 'installed';

  return {
    manifest,
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    state,
    updateAvailable: false,
    compatible: true,
    enabled: installed,
    ...(installed
      ? {
          installedVersion: manifest.version,
          installedManifest: manifest,
          installedTrust: 'signed-first-party' as const,
        }
      : {}),
  };
};

const permissionChallenge: PackageUpdatePermissionConsentChallenge = {
  challengeId: 'permission-challenge-1',
  packageId: 'com.tomni.ide',
  from: { version: '1.0.0', revision: `sha256-${'a'.repeat(64)}` },
  to: { version: '2.0.0', revision: `sha256-${'b'.repeat(64)}` },
  permissions: { added: ['filesystem.write'], removed: ['workspace.read'], changed: [] },
  issuedAt: '2030-01-01T00:00:00.000Z',
  expiresAt: '2030-01-01T00:02:00.000Z',
};

describe('Store product detail', () => {
  beforeEach(() => {
    vi.spyOn(Message, 'error').mockReturnValue({ close: vi.fn() });
    packageMocks.list.mockReset();
    packageMocks.preparePermissionUpdate.mockReset();
    packageMocks.approvePermissionUpdate.mockReset();
    packageMocks.install.mockReset();
    packageMocks.uninstall.mockReset();
    packageMocks.list.mockResolvedValue([createIdeListing()]);
    packageMocks.preparePermissionUpdate.mockResolvedValue({ required: false });
    packageMocks.install.mockResolvedValue(createIdeListing('installed'));
    packageMocks.uninstall.mockResolvedValue(createIdeListing());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows catalog-backed product metadata and installs the package', async () => {
    render(<StoreProductDetail packageId='com.tomni.ide' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'IDE' })).toBeInTheDocument();
    expect(screen.getByText('workspace.read')).toBeInTheDocument();
    expect(screen.getAllByText('IDE & App Builder')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('store-product-installation'));

    await waitFor(() => expect(packageMocks.install).toHaveBeenCalledWith('com.tomni.ide'));
    expect(await screen.findByTestId('store-product-open')).toBeInTheDocument();
  });

  it('updates an older installed package without hiding its runnable version', async () => {
    const oldInstall = createIdeListing('installed');
    const update = {
      ...oldInstall,
      manifest: { ...oldInstall.manifest, version: '2.0.0' },
      installedManifest: oldInstall.manifest,
      installedVersion: '1.0.0',
      updateAvailable: true,
    } satisfies PackageListing;
    packageMocks.list.mockResolvedValue([update]);
    packageMocks.install.mockResolvedValue({
      ...update,
      installedManifest: update.manifest,
      installedVersion: '2.0.0',
      updateAvailable: false,
    });

    render(<StoreProductDetail packageId='com.tomni.ide' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByText('Update available')).toBeInTheDocument();
    expect(screen.getByTestId('store-product-open')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('store-product-installation'));

    await waitFor(() => expect(packageMocks.install).toHaveBeenCalledWith('com.tomni.ide'));
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
  });

  it('binds an exact permission approval to the package update', async () => {
    packageMocks.preparePermissionUpdate.mockResolvedValue({ required: true, challenge: permissionChallenge });
    packageMocks.approvePermissionUpdate.mockResolvedValue({
      receiptId: 'permission-receipt-1',
      ...permissionChallenge,
    });
    vi.spyOn(Modal, 'confirm').mockImplementation((options) => {
      void options.onOk?.();
      return undefined as never;
    });

    render(<StoreProductDetail packageId='com.tomni.ide' onBack={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('store-product-installation'));

    await waitFor(() =>
      expect(packageMocks.approvePermissionUpdate).toHaveBeenCalledWith('com.tomni.ide', 'permission-challenge-1')
    );
    expect(packageMocks.install).toHaveBeenCalledWith('com.tomni.ide', 'permission-receipt-1');
  });

  it('does not update when the permission change is cancelled', async () => {
    packageMocks.preparePermissionUpdate.mockResolvedValue({ required: true, challenge: permissionChallenge });
    vi.spyOn(Modal, 'confirm').mockImplementation((options) => {
      options.onCancel?.();
      return undefined as never;
    });

    render(<StoreProductDetail packageId='com.tomni.ide' onBack={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('store-product-installation'));

    await waitFor(() => expect(packageMocks.preparePermissionUpdate).toHaveBeenCalledWith('com.tomni.ide'));
    expect(packageMocks.approvePermissionUpdate).not.toHaveBeenCalled();
    expect(packageMocks.install).not.toHaveBeenCalled();
  });

  it('keeps product details visible when an install operation fails', async () => {
    packageMocks.install.mockRejectedValue(new Error('download offline'));
    render(<StoreProductDetail packageId='com.tomni.ide' onBack={vi.fn()} onOpen={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('store-product-installation'));

    expect(await screen.findByText('download offline')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'IDE' })).toBeInTheDocument();
  });

  it('opens the installed package through its runnable module', async () => {
    const onOpen = vi.fn();
    packageMocks.list.mockResolvedValue([createIdeListing('installed')]);

    render(<StoreProductDetail packageId='com.tomni.ide' onBack={vi.fn()} onOpen={onOpen} />);

    fireEvent.click(await screen.findByTestId('store-product-open'));
    expect(onOpen).toHaveBeenCalledWith('com.tomni.ide', 'ide');
  });

  it('shows publisher screenshots instead of the generated capability preview', async () => {
    const listing = createIdeListing();
    listing.manifest.screenshots = [{ url: 'https://cdn.tomny.dev/ide/workspace.webp', alt: 'IDE workspace preview' }];
    packageMocks.list.mockResolvedValue([listing]);

    render(<StoreProductDetail packageId='com.tomni.ide' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByRole('img', { name: 'IDE workspace preview' })).toHaveAttribute(
      'src',
      'https://cdn.tomny.dev/ide/workspace.webp'
    );
    expect(screen.queryByTestId('store-product-capability-preview')).not.toBeInTheDocument();
  });

  it('restores the capability preview when every publisher screenshot fails', async () => {
    const listing = createIdeListing();
    listing.manifest.screenshots = [{ url: 'https://cdn.tomny.dev/ide/missing.webp' }];
    packageMocks.list.mockResolvedValue([listing]);

    render(<StoreProductDetail packageId='com.tomni.ide' onBack={vi.fn()} onOpen={vi.fn()} />);

    fireEvent.error(await screen.findByRole('img', { name: 'IDE preview image 1' }));

    expect(await screen.findByTestId('store-product-capability-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('store-product-screenshots')).not.toBeInTheDocument();
  });

  it('fails clearly when the requested catalog product does not exist', async () => {
    packageMocks.list.mockResolvedValue([]);

    render(<StoreProductDetail packageId='com.tomni.missing' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByTestId('store-product-unavailable')).toHaveTextContent('Product unavailable');
    expect(screen.queryByTestId('store-product-installation')).not.toBeInTheDocument();
  });
});
