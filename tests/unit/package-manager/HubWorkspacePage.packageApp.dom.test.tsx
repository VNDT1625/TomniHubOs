/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/components/layout/Sider', () => ({ default: () => <nav data-testid='hub-package-sidebar' /> }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/HubHome/catalog', () => ({ HUB_APPS: [], parseRecentHubApps: () => [] }));
vi.mock('@/renderer/pages/manager/useManagerStore', () => ({
  useManagerStore: () => ({ data: { events: [], notes: [], tasks: [] } }),
}));
vi.mock('@/common/packages/studioCompatibility', () => ({
  createStudioCompatibilityLegacyFallbackDestination: () => '/store',
  isStudioPackageGateNavigationState: () => false,
}));
vi.mock('@/renderer/pages/company/CompanyPage', () => ({ default: () => null }));
vi.mock('@/renderer/pages/hub/PackageAppHost', () => ({
  getFirstRunnablePackageModule: () => undefined,
  PackageAppHost: ({
    packageId,
    moduleId,
    allowSandboxedWeb,
  }: {
    packageId: string;
    moduleId: string;
    allowSandboxedWeb: boolean;
  }) => <output data-testid='package-app-host'>{`${packageId}:${moduleId}:${String(allowSandboxedWeb)}`}</output>,
}));
vi.mock('@/renderer/pages/hub/packageClient', () => ({ packageClient: {} }));
vi.mock('@/renderer/pages/hub/StoreProductDetail', () => ({ default: () => null }));
vi.mock('@/renderer/pages/hub/StoreProductDetail/permissionConsent', () => ({
  requestPackagePermissionUpdateConsent: () => Promise.resolve(undefined),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import HubWorkspacePage from '@/renderer/pages/hub/HubWorkspacePage';

describe('HubWorkspacePage package workspace', () => {
  it('keeps Hub navigation and header while removing Store-only controls', () => {
    render(
      <MemoryRouter>
        <HubWorkspacePage kind='package-app' packageId='com.tomni.calculator' moduleId='calculator' />
      </MemoryRouter>
    );

    expect(screen.getByTestId('hub-package-app-page')).toBeInTheDocument();
    expect(screen.getByTestId('hub-package-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'guid.hubHome.status.notificationsTitle' })).toBeInTheDocument();
    expect(screen.getByTestId('package-app-host')).toHaveTextContent('com.tomni.calculator:calculator:true');
    expect(screen.queryByTestId('hub-status-rail')).not.toBeInTheDocument();
    expect(screen.queryByText('guid.hubHome.shell.store')).not.toBeInTheDocument();
  });
});
