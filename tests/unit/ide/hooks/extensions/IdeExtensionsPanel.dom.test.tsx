/**
 * @vitest-environment jsdom
 */

import type { PackageContributionChangedEvent, PackageContributionState } from '@/common/packages';
import { ConfigProvider } from '@arco-design/web-react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const packageMocks = vi.hoisted(() => {
  let listener: ((event: PackageContributionChangedEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  return {
    contributions: vi.fn(),
    list: vi.fn(),
    contributionUpdateMode: vi.fn(() => 'push' as const),
    onContributionsChanged: vi.fn((next: (event: PackageContributionChangedEvent) => void) => {
      listener = next;
      return unsubscribe;
    }),
    waitForContributions: vi.fn(),
    emit: (event: PackageContributionChangedEvent) => listener?.(event),
    unsubscribe,
  };
});

vi.mock('@/renderer/pages/hub/packageClient', () => ({
  packageClient: {
    contributions: packageMocks.contributions,
    list: packageMocks.list,
    contributionUpdateMode: packageMocks.contributionUpdateMode,
    onContributionsChanged: packageMocks.onContributionsChanged,
    waitForContributions: packageMocks.waitForContributions,
  },
}));

const packageHostMocks = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'loading' | 'failed',
  mounted: vi.fn(),
  unmounted: vi.fn(),
}));

vi.mock('@/renderer/pages/hub/PackageAppHost', async () => {
  const ReactModule = await import('react');
  return {
    PackageAppHost: ({ packageId, moduleId, onBack }: { packageId: string; moduleId: string; onBack: () => void }) => {
      ReactModule.useEffect(() => {
        packageHostMocks.mounted(packageId, moduleId);
        return () => packageHostMocks.unmounted(packageId, moduleId);
      }, [packageId, moduleId]);
      if (packageHostMocks.status === 'loading') {
        return ReactModule.createElement('div', { role: 'status', 'aria-label': 'host-loading' });
      }
      if (packageHostMocks.status === 'failed') {
        return ReactModule.createElement(
          'div',
          { role: 'alert', 'aria-label': 'host-failed' },
          ReactModule.createElement('button', { type: 'button', onClick: onBack }, 'host-back')
        );
      }
      return ReactModule.createElement('div', {
        'data-testid': 'mock-package-app-host',
        'data-package-id': packageId,
        'data-module-id': moduleId,
      });
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; defaultValue?: string }) => {
      if (key === 'packages.agent.title') return 'Localized Agent';
      if (values?.count !== undefined) return `${key}:${values.count}`;
      return values?.defaultValue ?? key;
    },
  }),
}));

import IdeExtensionsPanel from '@package-apps/ide/renderer/hooks/extensions/IdeExtensionsPanel';

const contributionState = (
  revision: number,
  subtabs: PackageContributionState['snapshot']['subtabs'],
  diagnostics: PackageContributionState['diagnostics'] = []
): PackageContributionState => ({
  snapshot: {
    revision,
    packageIds: [...new Set(subtabs.map((subtab) => subtab.packageId))],
    apps: [],
    activityGroups: [],
    subtabs,
    commands: [],
    settings: [],
  },
  diagnostics,
});

const subtab = (
  title: string,
  packageId: string,
  activityGroupId: 'codebase' | 'agent-ops' = 'codebase',
  titleKey?: string,
  activation: 'on-open' | 'on-startup' = 'on-open'
) => ({
  id: title.toLowerCase(),
  title,
  titleKey,
  activityGroupId,
  moduleId: 'main',
  activation,
  key: `${packageId}:${title}`,
  packageId,
  packageVersion: '1.0.0',
});

const packageListing = (packageId: string, runtime: 'trusted-react' | 'sandboxed-web' = 'trusted-react') => {
  const manifest = {
    id: packageId,
    version: '1.0.0',
    publisherId: 'com.tomni',
    modules: [
      {
        id: 'main',
        title: 'Main',
        surface: 'ide',
        pinnable: false,
        runtime,
        entrypoint: runtime === 'trusted-react' ? 'main.js' : 'main.html',
      },
    ],
  };
  return {
    manifest,
    installedManifest: structuredClone(manifest),
    installedTrust: 'signed-first-party' as const,
    state: 'installed' as const,
    enabled: true,
    delivery: 'downloaded-package' as const,
    trust: 'signed-first-party' as const,
  };
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const renderPanel = (onOpenStore = vi.fn()) =>
  render(
    <ConfigProvider>
      <IdeExtensionsPanel onOpenStore={onOpenStore} />
    </ConfigProvider>
  );

beforeEach(() => {
  packageMocks.contributions.mockReset();
  packageMocks.list.mockReset();
  packageMocks.list.mockImplementation(async () =>
    ['pkg.alpha', 'pkg.beta', 'pkg.shared', 'pkg.code', 'pkg.agent'].map((packageId) => packageListing(packageId))
  );
  packageMocks.contributionUpdateMode.mockReturnValue('push');
  packageMocks.onContributionsChanged.mockClear();
  packageMocks.waitForContributions.mockReset();
  packageMocks.unsubscribe.mockClear();
  packageHostMocks.status = 'ready';
  packageHostMocks.mounted.mockClear();
  packageHostMocks.unmounted.mockClear();
});

afterEach(() => cleanup());

describe('IDE Extensions panel live contributions', () => {
  it('shows install and uninstall changes from contribution revisions without remounting', async () => {
    packageMocks.contributions
      .mockResolvedValueOnce(contributionState(1, [subtab('Alpha tools', 'pkg.alpha')]))
      .mockResolvedValueOnce(contributionState(2, []))
      .mockResolvedValueOnce(contributionState(3, [subtab('Beta tools', 'pkg.beta')]));
    const view = renderPanel();

    expect(await screen.findAllByText('Alpha tools')).not.toHaveLength(0);
    act(() => packageMocks.emit({ revision: 2 }));
    await waitFor(() => expect(screen.queryByText('Alpha tools')).not.toBeInTheDocument());
    expect(screen.getByText('ide.extensions.emptyHint')).toBeInTheDocument();

    act(() => packageMocks.emit({ revision: 3 }));
    expect(await screen.findAllByText('Beta tools')).not.toHaveLength(0);
    expect(packageMocks.contributions).toHaveBeenCalledTimes(3);
    expect(document.body.contains(view.container)).toBe(true);
  });

  it('restores focus after uninstall and exposes active state to assistive technology', async () => {
    const user = userEvent.setup();
    packageMocks.contributions
      .mockResolvedValueOnce(
        contributionState(1, [subtab('Alpha tools', 'pkg.shared'), subtab('Beta tools', 'pkg.shared')])
      )
      .mockResolvedValueOnce(contributionState(2, [subtab('Alpha tools', 'pkg.shared')]));
    renderPanel();

    const alpha = await screen.findByRole('button', { name: /Alpha tools/ });
    const beta = screen.getByRole('button', { name: /Beta tools/ });
    const codebase = screen.getByRole('button', { name: /ide.extensions.groups.codebase/ });
    expect(codebase).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('ide.extensions.installedCount:1')).toBeInTheDocument();

    await user.click(beta);
    expect(beta).toHaveAttribute('aria-current', 'page');
    beta.focus();
    act(() => packageMocks.emit({ revision: 2 }));
    await waitFor(() => expect(alpha).toHaveFocus());
    expect(alpha).toHaveAttribute('aria-current', 'page');
  });

  it('redacts package ids from diagnostics and unsubscribes on unmount', async () => {
    packageMocks.contributions.mockResolvedValue(
      contributionState(1, [], [{ packageId: 'secret.package.id', code: 'invalid-package' }])
    );
    const view = renderPanel();

    expect(await screen.findByRole('status', { name: 'ide.extensions.diagnostics.title' })).toHaveTextContent(
      'ide.extensions.diagnostics.invalidPackage \u00b7 1'
    );
    expect(screen.queryByText('secret.package.id')).not.toBeInTheDocument();
    view.unmount();
    expect(packageMocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('switches groups by keyboard and opens Store for the selected package', async () => {
    const user = userEvent.setup();
    const openStore = vi.fn();
    packageMocks.contributions.mockResolvedValue(
      contributionState(1, [subtab('Code tools', 'pkg.code'), subtab('Agent tools', 'pkg.agent', 'agent-ops')])
    );
    renderPanel(openStore);

    expect(await screen.findAllByText('Code tools')).not.toHaveLength(0);
    const agentGroup = screen.getByRole('button', { name: /ide.extensions.groups.agentOps/ });
    agentGroup.focus();
    await user.keyboard('{Enter}');
    expect(agentGroup).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findAllByText('Agent tools')).not.toHaveLength(0);
    fireEvent.click(screen.getByText('ide.extensions.openPackage'));
    expect(openStore).toHaveBeenLastCalledWith('pkg.agent');
    fireEvent.click(screen.getByText('ide.extensions.browseStore'));
    expect(openStore).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByText('ide.extensions.refresh'));
    await waitFor(() => expect(packageMocks.contributions).toHaveBeenCalledTimes(2));
  });

  it('opens the selected contribution through PackageAppHost and returns focus to the list', async () => {
    const user = userEvent.setup();
    packageMocks.contributions.mockResolvedValue(contributionState(1, [subtab('Alpha tools', 'pkg.alpha')]));
    renderPanel();

    const open = await screen.findByRole('button', { name: 'ide.extensions.runtime.open' });
    await user.click(open);
    const host = await screen.findByTestId('mock-package-app-host');
    expect(host).toHaveAttribute('data-package-id', 'pkg.alpha');
    expect(host).toHaveAttribute('data-module-id', 'main');
    expect(packageHostMocks.mounted).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'ide.extensions.runtime.back' }));
    expect(screen.queryByTestId('mock-package-app-host')).not.toBeInTheDocument();
    expect(packageHostMocks.unmounted).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'ide.extensions.runtime.open' })).toHaveFocus();
  });

  it('blocks a stale installed Store extension even when the catalog now claims first-party trust', async () => {
    const user = userEvent.setup();
    const listing = packageListing('pkg.stale');
    listing.installedTrust = 'signed-store';
    listing.installedManifest.publisherId = 'com.example.publisher';
    packageMocks.list.mockResolvedValue([listing]);
    packageMocks.contributions.mockResolvedValue(contributionState(1, [subtab('Stale tools', 'pkg.stale')]));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'ide.extensions.runtime.open' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ide.extensions.runtime.unsupportedBlocked');
    expect(packageHostMocks.mounted).not.toHaveBeenCalled();
  });

  it('does not use a refreshed catalog manifest when the installed extension record is incomplete', async () => {
    const user = userEvent.setup();
    const listing = packageListing('pkg.incomplete');
    delete listing.installedManifest;
    delete listing.installedTrust;
    packageMocks.list.mockResolvedValue([listing]);
    packageMocks.contributions.mockResolvedValue(contributionState(1, [subtab('Incomplete tools', 'pkg.incomplete')]));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'ide.extensions.runtime.open' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ide.extensions.runtime.unsupportedBlocked');
    expect(packageHostMocks.mounted).not.toHaveBeenCalled();
  });

  it('blocks sandboxed-web contributions without mounting PackageAppHost', async () => {
    const user = userEvent.setup();
    packageMocks.list.mockResolvedValue([packageListing('pkg.sandbox', 'sandboxed-web')]);
    packageMocks.contributions.mockResolvedValue(contributionState(1, [subtab('Sandbox tools', 'pkg.sandbox')]));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'ide.extensions.runtime.open' }));
    const policyAlert = await screen.findByRole('alert');
    expect(policyAlert).toHaveTextContent('ide.extensions.runtime.blockedTitle');
    expect(policyAlert).toHaveTextContent('ide.extensions.runtime.sandboxedWebBlocked');
    expect(packageHostMocks.mounted).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mock-package-app-host')).not.toBeInTheDocument();
  });

  it('falls back to the Extensions list when the active contribution is uninstalled', async () => {
    const user = userEvent.setup();
    packageMocks.contributions
      .mockResolvedValueOnce(
        contributionState(1, [subtab('Alpha tools', 'pkg.alpha'), subtab('Beta tools', 'pkg.beta')])
      )
      .mockResolvedValueOnce(contributionState(2, [subtab('Alpha tools', 'pkg.alpha')]));
    const view = renderPanel();

    await user.click(await screen.findByRole('button', { name: /Beta tools/ }));
    await user.click(screen.getByRole('button', { name: 'ide.extensions.runtime.open' }));
    expect(await screen.findByTestId('mock-package-app-host')).toHaveAttribute('data-package-id', 'pkg.beta');

    act(() => packageMocks.emit({ revision: 2 }));
    await waitFor(() => expect(screen.queryByTestId('mock-package-app-host')).not.toBeInTheDocument());
    expect(packageHostMocks.unmounted).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Alpha tools/ })).toHaveFocus();
    expect(document.body.contains(view.container)).toBe(true);
  });

  it.each([
    ['loading', 'status', 'host-loading'],
    ['failed', 'alert', 'host-failed'],
  ] as const)('preserves the PackageAppHost %s state and back fallback', async (status, role, label) => {
    const user = userEvent.setup();
    packageHostMocks.status = status;
    packageMocks.contributions.mockResolvedValue(contributionState(1, [subtab('Alpha tools', 'pkg.alpha')]));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'ide.extensions.runtime.open' }));
    expect(await screen.findByRole(role, { name: label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ide.extensions.runtime.back' })).toBeInTheDocument();
  });

  it('resolves contribution title keys and translates activation values', async () => {
    packageMocks.contributions.mockResolvedValue(
      contributionState(1, [subtab('Raw fallback', 'pkg.agent', 'codebase', 'packages.agent.title', 'on-startup')])
    );
    renderPanel();

    expect(await screen.findAllByText('Localized Agent')).not.toHaveLength(0);
    expect(screen.queryByText('Raw fallback')).not.toBeInTheDocument();
    expect(await screen.findByText('ide.extensions.activation.onStartup')).toBeInTheDocument();
  });

  it('announces loading as a polite status', async () => {
    const pending = deferred<PackageContributionState>();
    packageMocks.contributions.mockReturnValue(pending.promise);
    renderPanel();

    expect(screen.getByRole('status', { name: 'ide.extensions.loading' })).toHaveAttribute('aria-live', 'polite');
    await act(async () => pending.resolve(contributionState(1, [])));
  });

  it('shows an assertive retry alert when contributions cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    packageMocks.contributions.mockRejectedValue(new Error('offline'));
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('ide.extensions.loadFailed');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    fireEvent.click(screen.getByText('ide.extensions.retry'));
    await waitFor(() => expect(packageMocks.contributions).toHaveBeenCalledTimes(2));
    error.mockRestore();
  });
});
