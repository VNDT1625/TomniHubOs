import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HubHome from '@/renderer/pages/guid/HubHome';
import { parseRecentHubApps } from '@/renderer/pages/guid/HubHome/catalog';

const systemMetricsMock = vi.hoisted(() => ({ useSystemMetrics: vi.fn() }));
const preferenceMocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  changeLanguage: vi.fn(),
}));
const packageMocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/renderer/pages/hub/packageClient', () => ({
  packageClient: { list: packageMocks.list },
}));

vi.mock('@/renderer/pages/settings/ResourceSettings/system/useSystemMetrics', () => ({
  useSystemMetrics: systemMetricsMock.useSystemMetrics,
}));

vi.mock('@/renderer/services/i18n', () => ({
  changeLanguage: preferenceMocks.changeLanguage,
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user', username: 'Test User' } }),
}));

const readySystemMetrics = () => ({
  status: 'ready' as const,
  staticInfo: {
    disks: [
      { mount: 'C:', totalMB: 1_000, freeMB: 500 },
      { mount: 'D:', totalMB: 3_000, freeMB: 1_000 },
    ],
  },
  live: {
    cpu: { overallPercent: 31.6 },
    memory: { usedPercent: 47.8 },
  },
  history: [],
  refreshStatic: vi.fn(),
  setProcessPriority: vi.fn(),
});

const translations: Record<string, string> = {
  'guid.hubHome.quickPromptsLabel': 'Quick prompts',
  'guid.hubHome.quickPrompts.plan': 'Create a plan',
  'guid.hubHome.quickPrompts.analyze': 'Analyze data',
  'guid.hubHome.quickPrompts.write': 'Write a document',
  'guid.hubHome.quickPrompts.build': 'Build an app',
  'guid.hubHome.appsTitle': 'Apps',
  'guid.hubHome.appsSubtitle': 'Open a tool directly or explore an app group.',
  'guid.hubHome.viewAll': 'View all',
  'guid.hubHome.allApps': 'All apps',
  'guid.hubHome.recentTitle': 'Continue',
  'guid.hubHome.recentSubtitle': 'Return to recent apps.',
  'guid.hubHome.recentEmpty': 'No recent apps',
  'guid.hubHome.launcherHint': 'Choose an app',
  'guid.hubHome.status.title': 'Tomny status',
  'guid.hubHome.status.runtimeTitle': 'Agent runtime',
  'guid.hubHome.status.ready': 'Ready',
  'guid.hubHome.status.agents': 'Agents',
  'guid.hubHome.status.capabilities': 'Capabilities',
  'guid.hubHome.status.workspace': 'Workspace',
  'guid.hubHome.status.optional': 'Optional',
  'guid.hubHome.status.modelTitle': 'Active agent',
  'guid.hubHome.status.automatic': 'Automatic',
  'guid.hubHome.status.systemTitle': 'System',
  'guid.hubHome.status.coreReady': 'Core ready',
  'guid.hubHome.status.coreReadyHint': 'Local orchestration',
  'guid.hubHome.status.vaultProtected': 'Vault protected',
  'guid.hubHome.status.vaultProtectedHint': 'Secrets isolated',
  'guid.hubHome.status.noWorkspace': 'No workspace',
  'guid.hubHome.status.workspaceHint': 'Working context',
  'guid.hubHome.title': 'What do you want to accomplish today?',
  'guid.hubHome.subtitle': 'Tomny is ready to help with every task.',
  'guid.hubHome.shell.primaryNavigation': 'Primary navigation',
  'guid.hubHome.shell.nav.home': 'Home',
  'guid.hubHome.shell.nav.manage': 'Manage',
  'guid.hubHome.shell.nav.products': 'Products',
  'guid.hubHome.shell.nav.history': 'History',
  'guid.hubHome.shell.nav.company': 'Company',
  'guid.hubHome.shell.nav.settings': 'Settings',
  'guid.hubHome.shell.pinnedApps': 'Pinned apps',
  'guid.hubHome.shell.workspaces': 'Workspaces',
  'guid.hubHome.shell.searchPlaceholder': 'Search Tomny',
  'guid.hubHome.shell.store': 'Store',
  'guid.hubHome.shell.storeHint': 'Explore apps and packages',
  'guid.hubHome.shell.more': 'More',
  'guid.hubHome.shell.version': 'Tomny Hub v1.0.0',
  'guid.hubHome.shell.support': 'Support',
  'guid.hubHome.shell.feedback': 'Feedback',
  'guid.hubHome.shell.coreHealthy': 'Tomny Core is healthy',
  'guid.hubHome.status.workTitle': 'Work',
  'guid.hubHome.status.notificationsTitle': 'Notifications',
  'guid.hubHome.status.modelsTitle': 'Models',
  'guid.hubHome.status.manage': 'Manage',
  'guid.hubHome.status.details': 'Details',
  'guid.hubHome.status.cpu': 'CPU',
  'guid.hubHome.status.ram': 'RAM',
  'guid.hubHome.status.storage': 'Storage',
  'guid.hubHome.status.connection': 'Connection',
  'guid.hubHome.status.connectionGood': 'Good',
  'common.loading': 'Loading',
  'common.error': 'Error',
  'common.collapse': 'Collapse',
  'common.expand': 'Expand',
  'common.goToSettings': 'Go to settings',
  'settings.theme': 'Theme',
  'settings.lightMode': 'Light',
  'settings.darkMode': 'Dark',
  'settings.language': 'Language',
  'settings.personalProfile.title': 'Personal profile',
  'guid.workspace.specifyWorkspace': 'Choose workspace',
};

const labels: Record<string, string> = {
  communication: 'Communication',
  creative: 'Creative',
  developer: 'Developer tools',
  productivity: 'Productivity',
  chat: 'Chat',
  browser: 'Browser',
  company: 'Company',
  studio: 'Studio',
  music: 'Music',
  realtime: 'Realtime',
  ide: 'IDE',
  terminal: 'Terminal',
  git: 'Git',
  manager: 'Manager',
  automation: 'Automation',
  knowledge: 'Knowledge',
};

vi.mock('@renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: preferenceMocks.setTheme,
    colorScheme: 'default',
    setColorScheme: vi.fn(),
    fontScale: 1,
    setFontScale: vi.fn(),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { category?: string }) => {
      if (key === 'guid.hubHome.openCategory') return `Open ${options?.category ?? ''} apps`;
      const match = key.match(/^guid\.hubHome\.(?:apps|categories)\.([^.]+)\.(title|description)$/);
      if (match) return match[2] === 'title' ? labels[match[1]] : `${labels[match[1]]} description`;
      return translations[key] ?? key;
    },
    i18n: {
      language: 'vi-VN',
      resolvedLanguage: 'vi-VN',
    },
  }),
}));

const renderHome = (onNavigate = vi.fn()) => {
  render(
    <MemoryRouter>
      <ConfigProvider>
        <HubHome
          composer={<div data-testid='hub-composer' />}
          onNavigate={onNavigate}
          onFocusComposer={vi.fn()}
          onPromptSelect={vi.fn()}
          agentCount={2}
          capabilityCount={4}
          selectedAgentName='Claude'
        />
      </ConfigProvider>
    </MemoryRouter>
  );
  return onNavigate;
};

beforeEach(() => {
  localStorage.clear();
  preferenceMocks.setTheme.mockReset();
  preferenceMocks.changeLanguage.mockReset();
  packageMocks.list.mockReset();
  packageMocks.list.mockResolvedValue([]);
  systemMetricsMock.useSystemMetrics.mockReturnValue(readySystemMetrics());
});
afterEach(cleanup);

describe('HubHome', () => {
  it('shows an installed downloaded app and opens its package route', async () => {
    packageMocks.list.mockResolvedValue([
      {
        manifest: {
          id: 'com.tomni.notes',
          name: 'Notes',
          description: 'Local notes',
          modules: [{ id: 'notes' }],
        },
        delivery: 'downloaded-package',
      },
    ]);
    const onNavigate = renderHome();

    const notesButton = await screen.findByRole('button', { name: /NotesLocal notes/ });
    fireEvent.click(notesButton);

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/store/app/com.tomni.notes/notes'));
  });

  it('renders the supplied composer surface', () => {
    renderHome();

    expect(screen.getByTestId('hub-composer')).toBeInTheDocument();
  });

  it('collapses and restores the sidebar from the brand control', () => {
    renderHome();

    const shell = screen.getByTestId('hub-home-shell');
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
  });

  it('opens an app directly without opening the category launcher', () => {
    const onNavigate = renderHome();

    fireEvent.click(screen.getByTestId('hub-app-browser'));

    expect(onNavigate).toHaveBeenCalledWith('/browser', undefined);
    expect(screen.queryByTestId('hub-app-launcher')).not.toBeInTheDocument();
  });

  it('opens the dedicated Store and History Hub pages', () => {
    const onNavigate = renderHome();

    fireEvent.click(screen.getAllByRole('button', { name: 'Store' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, '/store');
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/history');
  });

  it('opens a category-scoped launcher from the category surface', () => {
    renderHome();

    fireEvent.click(screen.getByTestId('hub-category-communication'));

    const launcher = screen.getByTestId('hub-app-launcher');
    expect(within(launcher).getByText('Chat')).toBeInTheDocument();
    expect(within(launcher).getByText('Browser')).toBeInTheDocument();
    expect(within(launcher).queryByText('IDE')).not.toBeInTheDocument();
  });

  it('opens every base and installed app from the top-level View all action', async () => {
    packageMocks.list.mockResolvedValue([
      {
        manifest: {
          id: 'com.tomni.ide',
          name: 'IDE',
          description: 'Development environment',
          modules: [{ id: 'ide' }],
        },
        delivery: 'downloaded-package',
      },
    ]);
    renderHome();

    await screen.findByRole('button', { name: /IDEDevelopment environment/ });
    fireEvent.click(screen.getAllByRole('button', { name: 'View all' })[0]);

    const launcher = screen.getByTestId('hub-app-launcher');
    expect(within(launcher).getByText('Chat')).toBeInTheDocument();
    expect(within(launcher).getByText('IDE')).toBeInTheDocument();
    expect(within(launcher).getByText('Knowledge')).toBeInTheDocument();
  });

  it('shows live CPU, RAM, and aggregate storage usage from System Insight', () => {
    renderHome();

    const systemCard = within(screen.getByTestId('hub-system-status'));
    expect(systemCard.getByText('32%')).toBeInTheDocument();
    expect(systemCard.getByText('48%')).toBeInTheDocument();
    expect(systemCard.getByText('63%')).toBeInTheDocument();
  });

  it('opens the existing resource observation page from System details', () => {
    const onNavigate = renderHome();

    fireEvent.click(within(screen.getByTestId('hub-system-status')).getByRole('button', { name: 'Details' }));

    expect(onNavigate).toHaveBeenCalledWith('/settings/resource');
  });

  it('opens the existing notification surface from the header', () => {
    const onNavigate = renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(onNavigate).toHaveBeenCalledWith('/settings/realtime');
  });

  it('opens Store from navigation, sidebar shortcut, and header shortcut', () => {
    const onNavigate = renderHome();

    const storeButtons = screen.getAllByRole('button', { name: 'Store' });
    expect(storeButtons).toHaveLength(3);
    storeButtons.forEach((button) => fireEvent.click(button));

    expect(onNavigate).toHaveBeenCalledTimes(3);
    expect(onNavigate).toHaveBeenNthCalledWith(1, '/store');
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/store');
    expect(onNavigate).toHaveBeenNthCalledWith(3, '/store');
  });

  it('opens support from the Hub footer', () => {
    const onNavigate = renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Support' }));

    expect(onNavigate).toHaveBeenCalledWith('/settings/about');
  });

  it('keeps unavailable metrics neutral while System Insight is loading', () => {
    systemMetricsMock.useSystemMetrics.mockReturnValue({
      ...readySystemMetrics(),
      status: 'loading',
      staticInfo: null,
      live: null,
    });
    renderHome();

    const systemCard = within(screen.getByTestId('hub-system-status'));
    expect(systemCard.getAllByText('—')).toHaveLength(3);
    expect(systemCard.getByText('Loading')).toBeInTheDocument();
  });

  it('shows a safe error state when System Insight is unavailable', () => {
    systemMetricsMock.useSystemMetrics.mockReturnValue({
      ...readySystemMetrics(),
      status: 'error',
      staticInfo: null,
      live: null,
    });
    renderHome();

    const systemCard = within(screen.getByTestId('hub-system-status'));
    expect(systemCard.getAllByText('—')).toHaveLength(3);
    expect(systemCard.getByText('Error')).toBeInTheDocument();
  });

  it('changes theme from the compact header popup', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Test User' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(preferenceMocks.setTheme).toHaveBeenCalledWith('dark');
  });

  it('changes language from the compact header popup', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Test User' }));
    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(preferenceMocks.changeLanguage).toHaveBeenCalledWith('en-US');
  });

  it('keeps account access in the header and Settings in primary navigation', () => {
    const onNavigate = renderHome();

    expect(screen.getByRole('button', { name: 'Test User' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenCalledWith('/settings/model');
  });

  it('opens personal settings from the account quick panel', () => {
    const onNavigate = renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Test User' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to settings' }));

    expect(onNavigate).toHaveBeenCalledWith('/settings/personal');
  });

  it('ignores invalid recent-app storage safely', () => {
    expect(parseRecentHubApps('{broken')).toEqual([]);
    expect(parseRecentHubApps('["browser","unknown",4]')).toEqual(['browser']);
  });
});
