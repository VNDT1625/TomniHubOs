/**
 * @vitest-environment jsdom
 */

import HubWorkspacePage from '@/renderer/pages/hub/HubWorkspacePage';
import { Message } from '@arco-design/web-react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const packageMocks = vi.hoisted(() => ({
  federatedSearch: vi.fn(),
  install: vi.fn(),
  list: vi.fn(),
  refresh: vi.fn(),
  search: vi.fn(),
  uninstall: vi.fn(),
}));

vi.mock('@/renderer/components/layout/Sider', () => ({ default: () => null }));
vi.mock('@package-apps/company/renderer/company/CompanyPage', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/HubHome/catalog', () => ({ HUB_APPS: [], parseRecentHubApps: () => [] }));
vi.mock('@/renderer/pages/hub/PackageAppHost', () => ({
  getFirstRunnablePackageModule: () => undefined,
  PackageAppHost: () => null,
}));
vi.mock('@/renderer/pages/hub/StoreProductDetail', () => ({ default: () => null }));
vi.mock('@/renderer/pages/hub/StoreProductDetail/permissionConsent', () => ({
  requestPackagePermissionUpdateConsent: () => Promise.resolve(undefined),
}));
vi.mock('@/renderer/pages/hub/packageClient', () => ({ packageClient: packageMocks }));
vi.mock('@/renderer/pages/manager/useManagerStore', () => ({
  useManagerStore: () => ({ data: { events: [], notes: [], tasks: [] } }),
}));
vi.mock('@/common/packages/studioCompatibility', () => ({
  createStudioCompatibilityLegacyFallbackDestination: () => '/',
  isStudioPackageGateNavigationState: () => false,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.refresh': 'Refresh',
        'guid.hubHome.shell.searchPlaceholder': 'Search in Tomny',
        'guid.hubHome.shell.store': 'Store',
        'guid.hubHome.shell.storeHint': 'Discover apps and packages',
        'guid.hubHome.status.coreReady': 'Tomny Core is ready',
        'guid.hubHome.status.coreReadyHint': 'Local orchestration is available',
        'guid.hubHome.status.notificationsTitle': 'Notifications',
        'guid.hubHome.status.notificationApprovalRequested': 'Approval requested',
        'guid.hubHome.status.notificationWorkspaceActivity': 'Workspace activity',
        'guid.hubHome.status.systemTitle': 'System',
        'guid.hubHome.status.workInProgress': '0 in progress',
        'guid.hubHome.status.workTitle': 'Work',
        'guid.hubHome.storeDetail.empty': 'No Store packages match this view.',
        'guid.hubHome.storeDetail.publisherSubmission': 'Submit package',
        'guid.hubHome.storeDetail.publisherSubmissionCancelled': 'Package submission cancelled.',
        'guid.hubHome.storeDetail.publisherSubmissionFailed':
          'Package submission could not be completed. Please try again.',
        'guid.hubHome.storeDetail.publisherSubmissionSuccess': 'Package submitted for Store review.',
        'guid.hubHome.storeDetail.publisherSubmissionTechnicalPass':
          'Automatic technical checks passed. Awaiting authoritative Store publication.',
        'guid.hubHome.storeDetail.publisherSubmissionHumanReview':
          'Human review is required. This package is not published.',
        'guid.hubHome.storeDetail.publisherSubmissionUnavailable':
          'Publisher access is unavailable. Sign in with a publisher account and try again.',
        'guid.hubHome.viewAll': 'View all',
      })[key] ?? key,
  }),
}));

const renderStore = (): void => {
  render(
    <MemoryRouter>
      <HubWorkspacePage kind='store' />
    </MemoryRouter>
  );
};

describe('Hub Store publisher submission', () => {
  beforeEach(() => {
    packageMocks.federatedSearch.mockReset();
    packageMocks.install.mockReset();
    packageMocks.list.mockReset();
    packageMocks.refresh.mockReset();
    packageMocks.search.mockReset();
    packageMocks.uninstall.mockReset();
    packageMocks.list.mockResolvedValue([]);
    packageMocks.federatedSearch.mockResolvedValue({ items: [], sources: [] });
    vi.spyOn(Message, 'error').mockReturnValue({ close: vi.fn() });
    vi.spyOn(Message, 'info').mockReturnValue({ close: vi.fn() });
    vi.spyOn(Message, 'success').mockReturnValue({ close: vi.fn() });
  });

  afterEach(() => {
    window.electronAPI = undefined;
    vi.restoreAllMocks();
  });

  it('shows only the title, refresh and a plus publish button in the header (no search or subtitle)', async () => {
    renderStore();
    expect(screen.getByRole('heading', { name: 'Store' })).toBeInTheDocument();
    expect(screen.queryByText('Discover apps and packages')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search in Tomny')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit package' })).toBe(screen.getByTestId('store-publisher-submit'));
    expect(screen.queryByText('Submit package')).not.toBeInTheDocument();
    await waitFor(() => expect(packageMocks.list).toHaveBeenCalled());
    expect(packageMocks.search).not.toHaveBeenCalled();
    expect(packageMocks.federatedSearch).not.toHaveBeenCalled();
  });

  it('submits through the narrow Main-owned picker only and disables while pending', async () => {
    let resolveSubmission: ((value: { ok: true; receipt: never }) => void) | undefined;
    const pickAndSubmit = vi.fn(
      () =>
        new Promise<{ ok: true; receipt: never }>((resolve) => {
          resolveSubmission = resolve;
        })
    );
    window.electronAPI = { publisherSubmission: { pickAndSubmit } };

    renderStore();
    const submitButton = screen.getByTestId('store-publisher-submit');
    fireEvent.click(submitButton);

    expect(submitButton).toBeDisabled();
    await waitFor(() => {
      expect(pickAndSubmit).toHaveBeenCalledWith({ idempotencyKey: expect.any(String) });
    });
    expect(packageMocks.install).not.toHaveBeenCalled();
    expect(packageMocks.uninstall).not.toHaveBeenCalled();
    expect(packageMocks.refresh).not.toHaveBeenCalled();

    resolveSubmission?.({
      ok: true,
      receipt: {
        submissionId: 'submission-1',
        packageId: 'com.tomni.example',
        version: '1.0.0',
        status: 'auto-approved',
        review: { disposition: 'auto-approved', findings: [] },
        submittedAt: '2026-08-20T00:00:00.000Z',
      } as never,
    });
    await waitFor(() => {
      expect(Message.success).toHaveBeenCalledWith('Package submitted for Store review.');
    });
    expect(await screen.findByTestId('store-publisher-submission-result')).toHaveTextContent(
      'Automatic technical checks passed. Awaiting authoritative Store publication.'
    );
  });

  it('shows redacted deterministic findings when human review is required without claiming publication', async () => {
    const pickAndSubmit = vi.fn().mockResolvedValue({
      ok: true,
      receipt: {
        submissionId: 'submission-1',
        packageId: 'com.tomni.example',
        version: '1.0.0',
        status: 'human-review-required',
        review: {
          disposition: 'human-review-required',
          findings: [
            {
              code: 'PERMISSIONS_REQUIRE_REVIEW',
              severity: 'warning',
              evidence: 'The package declares one or more permissions.',
              remediation: 'Request authoritative review for the declared permissions.',
            },
          ],
        },
        submittedAt: '2026-08-20T00:00:00.000Z',
      },
    });
    window.electronAPI = { publisherSubmission: { pickAndSubmit } } as never;

    renderStore();
    fireEvent.click(screen.getByTestId('store-publisher-submit'));

    expect(await screen.findByTestId('store-publisher-submission-result')).toHaveTextContent(
      'Human review is required. This package is not published.'
    );
    expect(screen.getByTestId('store-publisher-review-finding-PERMISSIONS_REQUIRE_REVIEW')).toHaveTextContent(
      'Request authoritative review for the declared permissions.'
    );
    expect(packageMocks.install).not.toHaveBeenCalled();
  });

  it('keeps the account or publisher-authority failure opaque and stable', async () => {
    const pickAndSubmit = vi.fn().mockResolvedValue({ ok: false, code: 'PUBLISHER_SUBMISSION_ACCOUNT_REQUIRED' });
    window.electronAPI = { publisherSubmission: { pickAndSubmit } };

    renderStore();
    fireEvent.click(screen.getByTestId('store-publisher-submit'));

    await waitFor(() => {
      expect(Message.error).toHaveBeenCalledWith(
        'Publisher access is unavailable. Sign in with a publisher account and try again.'
      );
    });
    expect(pickAndSubmit).toHaveBeenCalledTimes(1);
    expect(packageMocks.install).not.toHaveBeenCalled();
    expect(packageMocks.uninstall).not.toHaveBeenCalled();
  });
});
