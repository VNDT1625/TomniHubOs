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
  enable: vi.fn(),
  disable: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock('@/renderer/pages/hub/packageClient', () => ({
  packageClient: packageMocks,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
    t: (
      key: string,
      values?: { index?: number; name?: string; version?: string; operation?: string; capability?: string }
    ) =>
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
        'guid.hubHome.storeDetail.price': 'Price',
        'guid.hubHome.storeDetail.paymentUnavailable': 'Checkout is not available yet.',
        'guid.hubHome.storeDetail.enable': 'Enable',
        'guid.hubHome.storeDetail.disable': 'Disable',
        'guid.hubHome.storeDetail.rollback': 'Roll back',
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
        'guid.hubHome.storeDetail.aiAccessTitle': 'AI access',
        'guid.hubHome.storeDetail.aiAccessDescription': 'Separate per-operation permission.',
        'guid.hubHome.storeDetail.aiAccessSeparateConsent': 'Separate consent',
        'guid.hubHome.storeDetail.aiAccessAllow': 'Allow AI access',
        'guid.hubHome.storeDetail.aiAccessRevoke': 'Revoke AI access',
        'guid.hubHome.storeDetail.aiAccessConfirmTitle': 'Allow AI access to this Surface?',
        'guid.hubHome.storeDetail.aiAccessConfirmDescription': `${values?.operation} ${values?.capability}`,
        'guid.hubHome.storeDetail.aiAccessConfirmPackage': 'Package and version',
        'guid.hubHome.storeDetail.aiAccessConfirmPublisher': 'Publisher',
        'guid.hubHome.storeDetail.aiAccessConfirmOperation': 'Operation',
        'guid.hubHome.storeDetail.aiAccessConfirmCapability': 'Capability',
        'guid.hubHome.storeDetail.aiAccessConfirmSecretUse': 'Secret use',
        'guid.hubHome.storeDetail.aiAccessConfirmSecretUseYes': 'Uses a secret',
        'guid.hubHome.storeDetail.aiAccessConfirmSecretUseNo': 'Does not use a secret',
        'guid.hubHome.storeDetail.aiAccessConfirmDataClasses': 'Data classes',
        'guid.hubHome.storeDetail.aiAccessConfirmDestinations': 'Destinations',
        'guid.hubHome.storeDetail.aiAccessConfirmExpiresAt': 'Expires at',
        'guid.hubHome.storeDetail.aiAccessConfirmNone': 'None declared',
        'guid.hubHome.storeDetail.aiAccessGranted': 'AI access granted for this operation.',
        'guid.hubHome.storeDetail.aiAccessRevoked': 'AI access revoked for this operation.',
        'guid.hubHome.storeDetail.aiAccessUnavailable': 'AI access is unavailable.',
        'guid.hubHome.storeDetail.notFound': 'Product unavailable',
      })[key] ??
      (key === 'guid.hubHome.storeDetail.previewTitle'
        ? `Explore ${values?.name}`
        : key === 'guid.hubHome.storeDetail.currentRelease'
          ? `Version ${values?.version}`
          : key),
  }),
}));

const createCompanyListing = (state: PackageListing['state'] = 'available'): PackageListing => {
  const manifest = {
    schemaVersion: 1,
    id: 'com.tomni.company',
    publisherId: 'com.tomni',
    name: 'Company',
    description: 'Signed multi-agent company workspace',
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=0.0.0' },
    modules: [
      {
        id: 'company',
        title: 'Company workspace',
        surface: 'apps/company',
        pinnable: true,
        runtime: 'trusted-react',
        entrypoint: 'app.js',
      },
    ],
    permissions: ['workspace.read', 'model.invoke'],
    dependencies: [],
    tags: ['company', 'agents'],
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
  packageId: 'com.tomni.company',
  from: { version: '1.0.0', revision: `sha256-${'a'.repeat(64)}` },
  to: { version: '2.0.0', revision: `sha256-${'b'.repeat(64)}` },
  permissions: { added: ['filesystem.write'], removed: ['workspace.read'], changed: [] },
  issuedAt: '2030-01-01T00:00:00.000Z',
  expiresAt: '2030-01-01T00:02:00.000Z',
};

describe('Store product detail', () => {
  beforeEach(() => {
    vi.spyOn(Message, 'error').mockReturnValue({ close: vi.fn() });
    vi.spyOn(Message, 'success').mockReturnValue({ close: vi.fn() });
    packageMocks.list.mockReset();
    packageMocks.preparePermissionUpdate.mockReset();
    packageMocks.approvePermissionUpdate.mockReset();
    packageMocks.install.mockReset();
    packageMocks.uninstall.mockReset();
    packageMocks.enable.mockReset();
    packageMocks.disable.mockReset();
    packageMocks.rollback.mockReset();
    packageMocks.list.mockResolvedValue([createCompanyListing()]);
    packageMocks.preparePermissionUpdate.mockResolvedValue({ required: false });
    packageMocks.install.mockResolvedValue(createCompanyListing('installed'));
    packageMocks.uninstall.mockResolvedValue(createCompanyListing());
    packageMocks.enable.mockResolvedValue(createCompanyListing('installed'));
    packageMocks.disable.mockResolvedValue({ ...createCompanyListing('installed'), enabled: false });
    packageMocks.rollback.mockResolvedValue(createCompanyListing('installed'));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  it('shows catalog-backed product metadata and installs the package', async () => {
    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Company' })).toBeInTheDocument();
    expect(screen.getByText('workspace.read')).toBeInTheDocument();
    expect(screen.getAllByText('Company workspace')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('store-product-installation'));

    await waitFor(() => expect(packageMocks.install).toHaveBeenCalledWith('com.tomni.company'));
    expect(await screen.findByTestId('store-product-open')).toBeInTheDocument();
  });

  it('shows a signed paid offer but never attempts installation before checkout exists', async () => {
    const listing = createCompanyListing();
    listing.offer = {
      schemaVersion: 1,
      offerId: 'offer-company-pro',
      productId: 'product-company-pro',
      package: {
        packageId: listing.manifest.id,
        packageVersion: listing.manifest.version,
        publisherId: listing.manifest.publisherId,
      },
      sellerKind: 'first-party',
      price: { currency: 'USD', amountMinor: 1999 },
      taxTreatment: 'exclusive',
      revision: 'offer-revision-1',
      active: true,
    };
    packageMocks.list.mockResolvedValue([listing]);

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByTestId('store-product-offer')).toHaveTextContent('Price $19.99');
    expect(screen.getByTestId('store-product-payment-unavailable')).toHaveTextContent('Checkout is not available yet.');
    expect(screen.getByTestId('store-product-installation')).toBeDisabled();
    expect(packageMocks.install).not.toHaveBeenCalled();
  });

  it('updates an older installed package without hiding its runnable version', async () => {
    const oldInstall = createCompanyListing('installed');
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

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByText('Update available')).toBeInTheDocument();
    expect(screen.getByTestId('store-product-open')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('store-product-installation'));

    await waitFor(() => expect(packageMocks.install).toHaveBeenCalledWith('com.tomni.company'));
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

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('store-product-installation'));

    await waitFor(() =>
      expect(packageMocks.approvePermissionUpdate).toHaveBeenCalledWith('com.tomni.company', 'permission-challenge-1')
    );
    expect(packageMocks.install).toHaveBeenCalledWith('com.tomni.company', 'permission-receipt-1');
  });

  it('does not update when the permission change is cancelled', async () => {
    packageMocks.preparePermissionUpdate.mockResolvedValue({ required: true, challenge: permissionChallenge });
    vi.spyOn(Modal, 'confirm').mockImplementation((options) => {
      options.onCancel?.();
      return undefined as never;
    });

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('store-product-installation'));

    await waitFor(() => expect(packageMocks.preparePermissionUpdate).toHaveBeenCalledWith('com.tomni.company'));
    expect(packageMocks.approvePermissionUpdate).not.toHaveBeenCalled();
    expect(packageMocks.install).not.toHaveBeenCalled();
  });

  it('keeps product details visible when an install operation fails', async () => {
    packageMocks.install.mockRejectedValue(new Error('download offline'));
    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('store-product-installation'));

    expect(await screen.findByText('download offline')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Company' })).toBeInTheDocument();
  });

  it('opens the installed package through its runnable module', async () => {
    const onOpen = vi.fn();
    packageMocks.list.mockResolvedValue([createCompanyListing('installed')]);

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={onOpen} />);

    fireEvent.click(await screen.findByTestId('store-product-open'));
    expect(onOpen).toHaveBeenCalledWith('com.tomni.company', 'company');
    expect(screen.queryByTestId('store-product-rollback')).not.toBeInTheDocument();
  });

  it('opens a signed enabled Surface while its separately declared AI operation remains unconsented', async () => {
    const listing = createCompanyListing('installed');
    listing.installedManifest = {
      ...listing.installedManifest!,
      aiAccess: {
        schemaVersion: 1,
        operations: [
          {
            id: 'workspace.write',
            capability: 'workspace.write',
            inputSchemaVersion: 1,
            dataClasses: ['workspace'],
            destinationIds: ['local'],
          },
        ],
      },
    };
    packageMocks.list.mockResolvedValue([listing]);
    const requestChallenge = vi.fn();
    const confirmChallenge = vi.fn();
    const listConsents = vi.fn().mockResolvedValue({ ok: true, consents: [] });
    const onOpen = vi.fn();
    window.electronAPI = {
      packageSurfaceAiAccess: {
        requestChallenge,
        confirmChallenge,
        revokeConsent: vi.fn(),
        listConsents,
      },
    } as never;

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={onOpen} />);

    expect(await screen.findByTestId('store-product-ai-grant-workspace.write')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('store-product-open'));

    expect(onOpen).toHaveBeenCalledWith('com.tomni.company', 'company');
    expect(listConsents).toHaveBeenCalledWith({ packageId: 'com.tomni.company' });
    expect(requestChallenge).not.toHaveBeenCalled();
    expect(confirmChallenge).not.toHaveBeenCalled();
  });

  it('keeps the installed Surface open action visible after the user denies AI access', async () => {
    const listing = createCompanyListing('installed');
    listing.installedManifest = {
      ...listing.installedManifest!,
      aiAccess: {
        schemaVersion: 1,
        operations: [
          {
            id: 'workspace.write',
            capability: 'workspace.write',
            inputSchemaVersion: 1,
            dataClasses: ['workspace'],
            destinationIds: ['local'],
          },
        ],
      },
    };
    packageMocks.list.mockResolvedValue([listing]);
    const requestChallenge = vi.fn().mockResolvedValue({
      ok: true,
      challenge: {
        challengeId: 'challenge-denied',
        packageId: 'com.tomni.company',
        packageVersion: '1.0.0',
        publisherId: 'com.tomni',
        operationId: 'workspace.write',
        capability: 'workspace.write',
        dataClasses: ['workspace'],
        destinationIds: ['local'],
        secretUse: false,
        expiresAt: '2030-01-01T00:05:00.000Z',
      },
    });
    const confirmChallenge = vi.fn().mockResolvedValue({ ok: true, approved: false });
    window.electronAPI = {
      packageSurfaceAiAccess: {
        requestChallenge,
        confirmChallenge,
        revokeConsent: vi.fn(),
        listConsents: vi.fn().mockResolvedValue({ ok: true, consents: [] }),
      },
    } as never;
    vi.spyOn(Modal, 'confirm').mockImplementation((options) => {
      options.onCancel?.();
      return undefined as never;
    });

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('store-product-ai-grant-workspace.write'));

    await waitFor(() =>
      expect(confirmChallenge).toHaveBeenCalledWith({ challengeId: 'challenge-denied', approved: false })
    );
    expect(screen.getByTestId('store-product-open')).toBeInTheDocument();
  });

  it('uses only the narrow Main challenge and consent APIs for declared AI operations', async () => {
    const listing = createCompanyListing('installed');
    listing.installedManifest = {
      ...listing.installedManifest!,
      aiAccess: {
        schemaVersion: 1,
        operations: [
          {
            id: 'workspace.write',
            capability: 'workspace.write',
            inputSchemaVersion: 1,
            dataClasses: ['workspace'],
            destinationIds: ['local'],
          },
        ],
      },
    };
    packageMocks.list.mockResolvedValue([listing]);
    const requestChallenge = vi.fn().mockResolvedValue({
      ok: true,
      challenge: {
        challengeId: 'challenge-1',
        packageId: 'com.tomni.company',
        packageVersion: '1.0.0',
        publisherId: 'com.tomni',
        operationId: 'workspace.write',
        capability: 'workspace.write',
        dataClasses: ['workspace'],
        destinationIds: ['local'],
        secretUse: false,
        expiresAt: '2030-01-01T00:05:00.000Z',
      },
    });
    const confirmChallenge = vi.fn().mockResolvedValue({
      ok: true,
      approved: true,
      consentId: 'consent-1',
      expiresAt: '2030-01-01T01:00:00.000Z',
    });
    const listConsents = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, consents: [] })
      .mockResolvedValue({
        ok: true,
        consents: [
          {
            consentId: 'consent-1',
            packageId: 'com.tomni.company',
            packageVersion: '1.0.0',
            operationId: 'workspace.write',
            expiresAt: '2030-01-01T01:00:00.000Z',
          },
        ],
      });
    window.electronAPI = {
      packageSurfaceAiAccess: {
        requestChallenge,
        confirmChallenge,
        revokeConsent: vi.fn(),
        listConsents,
      },
    };
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation((options) => {
      void options.onOk?.();
      return undefined as never;
    });

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('store-product-ai-grant-workspace.write'));

    await waitFor(() =>
      expect(requestChallenge).toHaveBeenCalledWith({ packageId: 'com.tomni.company', operationId: 'workspace.write' })
    );
    await waitFor(() => expect(confirmChallenge).toHaveBeenCalledWith({ challengeId: 'challenge-1', approved: true }));
    const confirmation = confirmSpy.mock.calls[0]?.[0];
    expect(confirmation).toEqual(
      expect.objectContaining({
        title: 'Allow AI access to this Surface?',
        okText: 'Allow AI access',
      })
    );
    render(<>{confirmation?.content}</>);
    expect(await screen.findByTestId('store-product-ai-access-challenge-package')).toHaveTextContent(
      'com.tomni.company · 1.0.0'
    );
    expect(screen.getByTestId('store-product-ai-access-challenge-publisher')).toHaveTextContent('com.tomni');
    expect(screen.getByTestId('store-product-ai-access-challenge-operation')).toHaveTextContent('workspace.write');
    expect(screen.getByTestId('store-product-ai-access-challenge-capability')).toHaveTextContent('workspace.write');
    expect(screen.getByTestId('store-product-ai-access-challenge-secret-use')).toHaveTextContent(
      'Does not use a secret'
    );
    expect(screen.getByTestId('store-product-ai-access-challenge-data-classes')).toHaveTextContent('workspace');
    expect(screen.getByTestId('store-product-ai-access-challenge-destinations')).toHaveTextContent('local');
    expect(screen.getByTestId('store-product-ai-access-challenge-expires-at')).toHaveTextContent(
      '2030-01-01T00:05:00.000Z'
    );
    expect(await screen.findByTestId('store-product-ai-revoke-workspace.write')).toBeInTheDocument();
    expect(packageMocks.install).not.toHaveBeenCalled();
    expect(packageMocks.enable).not.toHaveBeenCalled();
  });

  it('revokes the exact existing AI consent, returns the operation to the visible ungranted state, and leaves the package untouched', async () => {
    const listing = createCompanyListing('installed');
    listing.installedManifest = {
      ...listing.installedManifest!,
      aiAccess: {
        schemaVersion: 1,
        operations: [
          {
            id: 'workspace.write',
            capability: 'workspace.write',
            inputSchemaVersion: 1,
            dataClasses: ['workspace'],
            destinationIds: ['local'],
          },
        ],
      },
    };
    packageMocks.list.mockResolvedValue([listing]);
    const requestChallenge = vi.fn();
    const confirmChallenge = vi.fn();
    const revokeConsent = vi.fn().mockResolvedValue({ ok: true, revoked: true });
    const listConsents = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        consents: [
          {
            consentId: 'consent-current',
            packageId: 'com.tomni.company',
            packageVersion: '1.0.0',
            operationId: 'workspace.write',
            expiresAt: '2030-01-01T01:00:00.000Z',
          },
        ],
      })
      .mockResolvedValue({ ok: true, consents: [] });
    const onOpen = vi.fn();
    window.electronAPI = {
      packageSurfaceAiAccess: { requestChallenge, confirmChallenge, revokeConsent, listConsents },
    } as never;

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={onOpen} />);

    fireEvent.click(await screen.findByTestId('store-product-ai-revoke-workspace.write'));

    await waitFor(() => expect(revokeConsent).toHaveBeenCalledWith({ consentId: 'consent-current' }));
    expect(revokeConsent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listConsents).toHaveBeenCalledTimes(2));
    expect(listConsents).toHaveBeenNthCalledWith(1, { packageId: 'com.tomni.company' });
    expect(listConsents).toHaveBeenNthCalledWith(2, { packageId: 'com.tomni.company' });
    expect(await screen.findByTestId('store-product-ai-grant-workspace.write')).toBeInTheDocument();
    expect(screen.queryByTestId('store-product-ai-revoke-workspace.write')).not.toBeInTheDocument();
    expect(Message.success).toHaveBeenCalledWith('AI access revoked for this operation.');
    expect(packageMocks.install).not.toHaveBeenCalled();
    expect(packageMocks.enable).not.toHaveBeenCalled();
    expect(packageMocks.disable).not.toHaveBeenCalled();
    expect(packageMocks.uninstall).not.toHaveBeenCalled();
    expect(packageMocks.rollback).not.toHaveBeenCalled();
    expect(requestChallenge).not.toHaveBeenCalled();
    expect(confirmChallenge).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('disables an enabled installed package and keeps its Surface closed until re-enabled', async () => {
    packageMocks.list.mockResolvedValue([createCompanyListing('installed')]);
    packageMocks.disable.mockResolvedValue({ ...createCompanyListing('installed'), enabled: false });

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('store-product-disable'));

    await waitFor(() => expect(packageMocks.disable).toHaveBeenCalledWith('com.tomni.company'));
    expect(screen.queryByTestId('store-product-open')).not.toBeInTheDocument();
    expect(screen.getByTestId('store-product-enable')).toBeInTheDocument();
  });

  it('enables an installed package and exposes rollback only when a prior version exists', async () => {
    const disabledWithRollback = {
      ...createCompanyListing('installed'),
      enabled: false,
      previousVersion: '0.9.0',
    } satisfies PackageListing;
    packageMocks.list.mockResolvedValue([disabledWithRollback]);
    packageMocks.enable.mockResolvedValue({ ...disabledWithRollback, enabled: true });
    packageMocks.rollback.mockResolvedValue({
      ...disabledWithRollback,
      manifest: { ...disabledWithRollback.manifest, version: '0.9.0' },
      installedVersion: '0.9.0',
      previousVersion: '1.0.0',
    });

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByTestId('store-product-rollback')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('store-product-enable'));
    await waitFor(() => expect(packageMocks.enable).toHaveBeenCalledWith('com.tomni.company'));
    expect(screen.getByTestId('store-product-open')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('store-product-rollback'));
    await waitFor(() => expect(packageMocks.rollback).toHaveBeenCalledWith('com.tomni.company'));
  });

  it('shows publisher screenshots instead of the generated capability preview', async () => {
    const listing = createCompanyListing();
    listing.manifest.screenshots = [
      { url: 'https://cdn.tomny.dev/ide/workspace.webp', alt: 'Company workspace preview' },
    ];
    packageMocks.list.mockResolvedValue([listing]);

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByRole('img', { name: 'Company workspace preview' })).toHaveAttribute(
      'src',
      'https://cdn.tomny.dev/ide/workspace.webp'
    );
    expect(screen.queryByTestId('store-product-capability-preview')).not.toBeInTheDocument();
  });

  it('restores the capability preview when every publisher screenshot fails', async () => {
    const listing = createCompanyListing();
    listing.manifest.screenshots = [{ url: 'https://cdn.tomny.dev/ide/missing.webp' }];
    packageMocks.list.mockResolvedValue([listing]);

    render(<StoreProductDetail packageId='com.tomni.company' onBack={vi.fn()} onOpen={vi.fn()} />);

    fireEvent.error(await screen.findByRole('img', { name: 'Company preview image 1' }));

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
