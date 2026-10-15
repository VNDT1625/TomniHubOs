import { ipcBridge } from '@/common';
import type { PackageListing, PackageManifest } from '@/common/packages';
import { ConfigProvider, Message } from '@arco-design/web-react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HubHome from '@/renderer/pages/guid/HubHome';
import HubShell from '@/renderer/pages/guid/shell/HubShell';
import { parseRecentHubApps } from '@/renderer/pages/guid/HubHome/catalog';

const systemMetricsMock = vi.hoisted(() => ({ useSystemMetrics: vi.fn() }));
const packageMocks = vi.hoisted(() => ({ list: vi.fn() }));
const connectionMocks = vi.hoisted(() => ({ list: vi.fn() }));
const webEmbedMocks = vi.hoisted(() => ({ openApp: vi.fn() }));
const activityMock = vi.hoisted(() => ({
  items: [] as unknown[],
  stop: vi.fn(),
  respond: vi.fn(),
  dismiss: vi.fn(),
}));
const conversationMock = vi.hoisted(() => ({ conversations: [] as unknown[] }));
const liveSessionsMock = vi.hoisted(() => ({ apps: [] as unknown[] }));
// The shell navigates through the router; tests observe it through the same spy HubHome receives.
const routerMock = vi.hoisted(() => ({
  onNavigate: undefined as ((path: string, state?: unknown) => void) | undefined,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => (path: string, options?: { state?: unknown }) =>
      options?.state === undefined ? routerMock.onNavigate?.(path) : routerMock.onNavigate?.(path, options.state),
  };
});

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({ conversations: conversationMock.conversations }),
}));
vi.mock('@/renderer/pages/hub/packageClient', () => ({ packageClient: { list: packageMocks.list } }));
vi.mock('@/common/integrations/webEmbed/webEmbedClient', () => ({ webEmbedClient: webEmbedMocks }));
vi.mock('@/renderer/pages/hub/PackageAppHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/hub/PackageAppHost')>();
  return {
    ...actual,
    PackageAppHost: ({
      packageId,
      moduleId,
      onBack,
      allowSandboxedWeb,
    }: React.ComponentProps<typeof actual.PackageAppHost>) => (
      <section
        data-testid='home-package-surface'
        data-package-id={packageId}
        data-module-id={moduleId}
        data-sandboxed-web={String(allowSandboxedWeb)}
      >
        <button type='button' onClick={onBack}>
          Back to Home
        </button>
      </section>
    ),
  };
});
vi.mock('@/renderer/pages/settings/ResourceSettings/system/useSystemMetrics', () => ({
  useSystemMetrics: systemMetricsMock.useSystemMetrics,
}));
vi.mock('@/renderer/pages/guid/HubHome/useLiveSessions', () => ({
  useLiveSessions: () => ({ apps: liveSessionsMock.apps, ready: true }),
}));
vi.mock('@/renderer/pages/guid/HubHome/terminal/HumanTerminalWorkspace', () => ({
  HumanTerminalWorkspace: () => <section data-testid='hub-terminal-workspace-fixture'>Terminal sessions only</section>,
}));
vi.mock('@/renderer/pages/guid/HubHome/useHubActivity', () => ({
  useHubActivity: () => ({
    items: activityMock.items,
    ready: true,
    stop: activityMock.stop,
    respond: activityMock.respond,
    dismiss: activityMock.dismiss,
  }),
}));
vi.mock('@/renderer/services/notificationService', () => ({
  useNotifications: () => ({ notifications: [] }),
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, info: vi.fn(), warning: vi.fn(), error: vi.fn() } };
});

const readySystemMetrics = () => ({
  status: 'ready' as const,
  staticInfo: {
    disks: [
      { mount: 'C:', totalMB: 1_000, freeMB: 500 },
      { mount: 'D:', totalMB: 3_000, freeMB: 1_000 },
    ],
  },
  live: { cpu: { overallPercent: 31.6 }, memory: { usedPercent: 47.8 } },
  history: [],
  refreshStatic: vi.fn(),
  setProcessPriority: vi.fn(),
});

const translations: Record<string, string> = {
  'guid.hubHome.webEmbedError.UNAVAILABLE': 'Could not open this app.',
  'guid.hubHome.title': 'What do you want to accomplish today?',
  'guid.hubHome.subtitle': 'Tomny is ready to help with every task.',
  'guid.hubHome.allApps': 'All apps',
  'guid.hubHome.appsTitle': 'Apps',
  'guid.hubHome.launcherHint': 'Choose an app',
  'guid.hubHome.quickPromptsLabel': 'Quick prompts',
  'guid.hubHome.quickPrompts.plan': 'Create a plan',
  'guid.hubHome.quickPrompts.analyze': 'Analyze data',
  'guid.hubHome.quickPrompts.write': 'Write a document',
  'guid.hubHome.quickPrompts.build': 'Build an app',
  'guid.hubHome.composerContext.label': 'Next task context',
  'guid.hubHome.composerContext.defaultWorkspace': 'Default workspace',
  'guid.hubHome.composerContext.chooseWorkspace': 'Choose folder',
  'guid.hubHome.composerContext.changeWorkspace': 'Change folder',
  'guid.hubHome.composerContext.clearWorkspace': 'Clear folder',
  'guid.hubHome.composerContext.model': 'Model',
  'guid.hubHome.shell.primaryNavigation': 'Primary navigation',
  'guid.hubHome.shell.nav.home': 'Home',
  'guid.hubHome.shell.nav.manage': 'Manage',
  'guid.hubHome.shell.nav.history': 'History',
  'guid.hubHome.shell.nav.company': 'Company',
  'guid.hubHome.shell.pinnedApps': 'Pinned apps',
  'guid.hubHome.shell.workspaces': 'Workspaces',
  'guid.hubHome.shell.openAllWorkspaces': 'Open all workspaces',
  'guid.hubHome.shell.collapseAllWorkspaces': 'Collapse all workspaces',
  'guid.hubHome.shell.expandWorkspace': 'Expand workspace',
  'guid.hubHome.shell.collapseWorkspace': 'Collapse workspace',
  'guid.hubHome.shell.active': 'Active',
  'guid.hubHome.shell.activeEmpty': 'No app is open right now',
  'guid.hubHome.shell.expandApp': 'Expand app',
  'guid.hubHome.shell.collapseApp': 'Collapse app',
  'guid.hubHome.shell.statusWorking': 'Working',
  'guid.hubHome.shell.statusIdle': 'Idle',
  'guid.hubHome.shell.statusAttention': 'Needs your attention',
  'guid.hubHome.shell.statusError': 'Error',
  'guid.hubHome.shell.statusDormant': 'Inactive',
  'guid.hubHome.shell.statusSuspended': 'Suspended',
  'guid.hubHome.shell.appChat': 'Chat',
  'guid.hubHome.shell.appBrowser': 'Browser',
  'guid.hubHome.shell.appTerminal': 'Terminal',
  'guid.hubHome.shell.store': 'Store',
  'guid.hubHome.shell.storeHint': 'Explore apps and packages',
  'guid.hubHome.shell.more': 'More',
  'guid.hubHome.shell.version': 'Tomny Hub v1.0.0',
  'guid.hubHome.shell.support': 'Support',
  'guid.hubHome.shell.coreHealthy': 'Tomny Core is healthy',
  'guid.hubHome.status.title': 'Tomny status',
  'guid.hubHome.status.automatic': 'Automatic',
  'guid.hubHome.status.systemTitle': 'System',
  'guid.hubHome.status.noWorkspace': 'No workspace',
  'guid.hubHome.status.workspaceHint': 'Working context',
  'guid.hubHome.status.notificationsTitle': 'Notifications',
  'guid.hubHome.status.modelsTitle': 'Models',
  'guid.hubHome.status.manage': 'Manage',
  'guid.hubHome.status.cpu': 'CPU',
  'guid.hubHome.status.ram': 'RAM',
  'guid.hubHome.status.storage': 'Storage',
  'guid.hubHome.status.connection': 'Connection',
  'guid.hubHome.status.connectionGood': 'Good',
  'guid.hubHome.layout.startAgent': 'Start a new agent',
  'guid.hubHome.layout.statusInProgress': 'Running',
  'guid.hubHome.layout.statusTodo': 'Queued',
  'guid.hubHome.layout.tabWorkspace': 'Explorer tab',
  'guid.hubHome.memory.title': 'Session Memory',
  'guid.hubHome.context.title': 'Session context',
  'guid.hubHome.secrets.title': 'Secret keys',
  'guid.hubHome.memory.selectAgent': 'Select an agent to view memory',
  'guid.hubHome.layout.tabDiff': 'Diff tab',
  'guid.hubHome.layout.tabParams': 'Params tab',
  'guid.hubHome.layout.tabNotifications': 'Notifications tab',
  'guid.hubHome.layout.tabModel': 'Model tab',
  'guid.hubHome.layout.closeTab': 'Close tab',
  'guid.hubHome.layout.addTab': 'Add tab',
  'guid.hubHome.layout.noNotifications': 'No notifications',
  'guid.hubHome.layout.diffEmpty': 'Select an agent to see its diff',
  'guid.hubHome.layout.workspaceDefault': 'Default',
  'guid.hubHome.layout.workspaceSelectHint': 'Select an agent to see its workspace',
  'guid.hubHome.layout.terminal': 'Terminal',
  'guid.hubHome.layout.terminalHint': 'Open Terminal',
  'guid.hubHome.layout.viewMore': 'View more',
  'guid.hubHome.layout.showMore': 'Show more',
  'common.loading': 'Loading',
  'common.error': 'Error',
  'common.collapse': 'Collapse',
  'common.expand': 'Expand',
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
  git: 'Git',
  manager: 'Manager',
  automation: 'Automation',
  knowledge: 'Knowledge',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      const match = key.match(/^guid\.hubHome\.(?:apps|categories)\.([^.]+)\.(title|description)$/);
      if (match) return match[2] === 'title' ? labels[match[1]] : `${labels[match[1]]} description`;
      if (key === 'guid.hubHome.layout.agentCount') return `${options?.count ?? 0} agents`;
      if (key === 'guid.hubHome.layout.pingCount') return `${options?.count ?? 0} pings`;
      if (key === 'guid.hubHome.composerContext.attachments') return `${options?.count ?? 0} attached files`;
      if (key === 'guid.hubHome.live.running') return `${options?.count ?? 0} running`;
      if (key === 'guid.hubHome.live.attention') return `${options?.count ?? 0} need you`;
      if (key === 'guid.hubHome.live.slots') return `${options?.count ?? 0} tiles`;
      if (key === 'guid.hubHome.live.auto') return 'Auto';
      return translations[key] ?? key;
    },
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

const activityItem = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  kind: 'agent',
  sourceId: id.split(':').slice(1).join(':'),
  title: id,
  status: 'running',
  startedAt: 1,
  updatedAt: 1,
  steps: [],
  route: `/conversation/${id.split(':')[1]}`,
  canStop: true,
  ...patch,
});

const renderHome = (onNavigate = vi.fn(), initialPath = '/') => {
  routerMock.onNavigate = onNavigate;
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ConfigProvider>
        <HubShell>
          <HubHome
            composer={<div data-testid='hub-composer' />}
            onNavigate={onNavigate}
            onFocusComposer={vi.fn()}
            onPromptSelect={vi.fn()}
            onFocusDirectory={vi.fn()}
            agentCount={2}
            capabilityCount={4}
            selectedAgentName='Claude'
          />
        </HubShell>
      </ConfigProvider>
    </MemoryRouter>
  );
  return onNavigate;
};

const renderComposerHome = (overrides: Partial<React.ComponentProps<typeof HubHome>> = {}) => {
  const onFocusDirectory = vi.fn();
  let props: React.ComponentProps<typeof HubHome> = {
    composer: <textarea aria-label='Next task draft' defaultValue='' />,
    onNavigate: vi.fn(),
    onFocusComposer: vi.fn(),
    onPromptSelect: vi.fn(),
    onFocusDirectory,
    capabilityCount: 4,
    selectedAgentName: 'Claude',
    selectedModelName: 'Test Model',
    ...overrides,
  };
  routerMock.onNavigate = props.onNavigate;
  const tree = () => (
    <MemoryRouter>
      <ConfigProvider>
        <HubShell>
          <HubHome {...props} />
        </HubShell>
      </ConfigProvider>
    </MemoryRouter>
  );
  const view = render(tree());
  return {
    ...view,
    onFocusDirectory,
    update: (next: Partial<React.ComponentProps<typeof HubHome>> = {}) => {
      props = { ...props, ...next };
      view.rerender(tree());
    },
  };
};

const installedPackage = (id: string, name: string, moduleId: string): PackageListing => {
  const manifest: PackageManifest = {
    schemaVersion: 1,
    id,
    publisherId: 'com.tomni',
    name,
    description: `${name} package`,
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '*' },
    modules: [
      {
        id: moduleId,
        title: name,
        surface: moduleId,
        pinnable: true,
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
      },
    ],
    permissions: [],
    dependencies: [],
    tags: [],
  };
  return {
    manifest,
    installedManifest: manifest,
    installedVersion: '1.0.0',
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    installedTrust: 'signed-first-party',
    state: 'installed',
    enabled: true,
    compatible: true,
    updateAvailable: false,
  };
};

beforeEach(() => {
  localStorage.clear();
  activityMock.items = [];
  activityMock.stop.mockReset().mockResolvedValue(true);
  activityMock.respond.mockReset().mockResolvedValue(true);
  activityMock.dismiss.mockReset().mockResolvedValue(true);
  conversationMock.conversations = [];
  liveSessionsMock.apps = [];
  routerMock.onNavigate = undefined;
  packageMocks.list.mockReset();
  packageMocks.list.mockResolvedValue([]);
  connectionMocks.list.mockReset();
  connectionMocks.list.mockResolvedValue({ ok: true, data: [] });
  webEmbedMocks.openApp.mockReset();
  webEmbedMocks.openApp.mockResolvedValue({ ok: true, tabId: 'app-tab' });
  window.electronAPI = { packageConnections: connectionMocks };
  systemMetricsMock.useSystemMetrics.mockReturnValue(readySystemMetrics());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HubHome (v3 layout)', () => {
  it('keeps resize separators above both Apps and Active', async () => {
    renderHome();
    const sidebar = screen.getByTestId('global-hub-sidebar');
    const apps = within(sidebar).getByRole('separator', { name: 'Pinned apps' });
    const workspaces = within(sidebar).getByRole('separator', { name: 'Active' });
    expect(apps).toHaveAttribute('aria-orientation', 'horizontal');
    expect(workspaces).toHaveAttribute('aria-orientation', 'horizontal');
    expect(apps.nextElementSibling).toHaveClass('hub-sider-apps');
    expect(workspaces.nextElementSibling).toHaveClass('hub-sider-workspaces');
    fireEvent.keyDown(workspaces, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(sidebar.querySelector('.hub-sider-content')).toHaveAttribute('data-sections-resized', 'true')
    );
    expect(sidebar.querySelector('.hub-sider-content')?.getAttribute('style')).toContain('--hub-sider-apps-h:');
    fireEvent.doubleClick(workspaces);
    await waitFor(() =>
      expect(sidebar.querySelector('.hub-sider-content')).not.toHaveAttribute('data-sections-resized')
    );
  });
  it('renders the supplied composer and the five suggestion chips on one row', () => {
    renderHome();

    expect(screen.getByTestId('hub-composer')).toBeInTheDocument();
    const row = screen.getByLabelText('Quick prompts');
    expect(within(row).getAllByRole('button')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Open all workspaces' })).toBeNull();
    expect(screen.queryByTestId('hub-composer-context')).toBeNull();
  });

  it('uses composer context instead of suggestions when Home begins with a chosen workspace', () => {
    renderComposerHome({ workspaceName: 'C:/Work/NextTask', attachmentCount: 2 });
    const context = screen.getByTestId('hub-composer-context');
    expect(screen.queryByLabelText('Quick prompts')).toBeNull();
    expect(context).toHaveTextContent('NextTask');

    expect(context).toHaveTextContent('Test Model');
    expect(within(context).getByLabelText('2 attached files')).toHaveTextContent('2');
    expect(within(context).getByTitle('Model: Test Model')).toBeInTheDocument();
    expect(within(context).getByTestId('hub-composer-workspace')).toBeEnabled();
  });

  it('places the attachment inventory in the context strip below the composer', () => {
    renderComposerHome({
      workspaceName: 'C:/Work/NextTask',
      attachmentInventory: <button data-testid='context-attachment-inventory'>📎 1</button>,
    });

    expect(
      within(screen.getByTestId('hub-composer-context')).getByTestId('context-attachment-inventory')
    ).toBeDefined();
  });

  it('does not resurrect suggestions after a workspace is selected and then cleared', () => {
    const view = renderComposerHome();
    const input = screen.getByRole('textbox', { name: 'Next task draft' });
    fireEvent.change(input, { target: { value: 'Unsent next task' } });
    expect(screen.getByLabelText('Quick prompts')).toBeInTheDocument();
    view.update({ workspaceName: 'C:/Work/Chosen' });
    const context = screen.getByTestId('hub-composer-context');
    expect(context).toHaveTextContent('Chosen');
    fireEvent.click(screen.getByTestId('hub-composer-workspace-clear'));
    expect(view.onFocusDirectory).toHaveBeenCalledWith('');
    view.update({ workspaceName: '' });
    expect(screen.getByTestId('hub-composer-context')).toBeInTheDocument();
    expect(screen.queryByLabelText('Quick prompts')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Next task draft' })).toBe(input);
    expect(input).toHaveValue('Unsent next task');
    expect(screen.queryByTestId('hub-composer-workspace-clear')).toBeNull();
  });

  it('keeps contextual composer mode after activity starts, completes and leaves the registry', async () => {
    const view = renderComposerHome();
    const input = screen.getByRole('textbox', { name: 'Next task draft' });
    fireEvent.change(input, { target: { value: 'Keep preparing the next task' } });
    input.focus();
    expect(screen.getByLabelText('Quick prompts')).toBeInTheDocument();
    activityMock.items = [activityItem('agent:context-task')];
    view.update();
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('1 running');
    expect(screen.getByRole('textbox', { name: 'Next task draft' })).toBe(input);
    expect(input).toHaveFocus();
    expect(screen.queryByLabelText('Quick prompts')).toBeNull();
    activityMock.items = [activityItem('agent:context-task', { status: 'done' })];
    view.update();
    fireEvent.contextMenu(screen.getByTestId('hub-agent-tile-agent:context-task'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'guid.hubHome.live.dismiss' }));
    await waitFor(() => expect(activityMock.dismiss).toHaveBeenCalledWith('agent:context-task'));
    activityMock.items = [];
    view.update();
    expect(screen.getByTestId('hub-promo-panel')).toBeInTheDocument();
    expect(screen.getByTestId('hub-composer-context')).not.toHaveTextContent('running');
    expect(screen.queryByLabelText('Quick prompts')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Next task draft' })).toBe(input);
    expect(input).toHaveValue('Keep preparing the next task');
  });

  it('selects the next-task workspace through the native folder dialog', async () => {
    const picker = vi.spyOn(ipcBridge.dialog.showOpen, 'invoke').mockResolvedValue(['C:/Work/FromDialog']);
    const view = renderComposerHome({ workspaceName: 'C:/Work/Before' });
    fireEvent.click(screen.getByTestId('hub-composer-workspace'));
    await waitFor(() => expect(view.onFocusDirectory).toHaveBeenCalledWith('C:/Work/FromDialog'));
    expect(localStorage.getItem('tomni.workspace.approvals.v1')).toContain('C:/Work/FromDialog');
    expect(picker).toHaveBeenCalledOnce();
    expect(picker).toHaveBeenCalledWith({ properties: ['openDirectory', 'createDirectory'] });
    view.update({ workspaceName: 'C:/Work/FromDialog' });
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('FromDialog');
  });

  it('keeps the current workspace when the native folder dialog is cancelled', async () => {
    const picker = vi.spyOn(ipcBridge.dialog.showOpen, 'invoke').mockResolvedValue(undefined);
    const view = renderComposerHome({ workspaceName: 'C:/Work/Before' });
    fireEvent.click(screen.getByTestId('hub-composer-workspace'));
    await waitFor(() => expect(picker).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('hub-composer-workspace')).toBeEnabled());
    expect(view.onFocusDirectory).not.toHaveBeenCalled();
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('Before');
  });

  it('routes a package into the shell centre and keeps the composer latch on Home', async () => {
    packageMocks.list.mockResolvedValue([installedPackage('com.tomni.notes', 'Notes', 'notes')]);
    activityMock.items = [activityItem('agent:previous-task')];
    const onNavigate = vi.fn();
    const view = renderComposerHome({ workspaceName: 'C:/Work/PreviouslyChosen', onNavigate });
    expect(screen.getByTestId('hub-composer-context')).toBeInTheDocument();
    activityMock.items = [];
    view.update({ workspaceName: '' });
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('Default workspace');

    fireEvent.click(screen.getByTestId('hub-open-launcher'));
    const launcher = screen.getByTestId('hub-app-launcher');
    fireEvent.click(await within(launcher).findByText('Notes'));
    expect(onNavigate).toHaveBeenCalledWith('/apps/com.tomni.notes/notes');
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('Default workspace');
    expect(screen.queryByLabelText('Quick prompts')).toBeNull();
    expect(screen.queryByTestId('hub-composer-workspace-clear')).toBeNull();
  });

  it('does not open duplicate native folder dialogs while a selection is pending', async () => {
    let finish!: (paths: string[] | undefined) => void;
    const picker = vi.spyOn(ipcBridge.dialog.showOpen, 'invoke').mockReturnValue(
      new Promise<string[] | undefined>((resolve) => {
        finish = resolve;
      })
    );
    const view = renderComposerHome({ workspaceName: 'C:/Work/Before' });
    const button = screen.getByTestId('hub-composer-workspace');
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(picker).toHaveBeenCalledOnce();
    await act(async () => finish(['C:/Work/After']));
    expect(view.onFocusDirectory).toHaveBeenCalledWith('C:/Work/After');
    expect(button).toBeEnabled();
  });

  it('moves the next-task workspace onto the selected live tile', () => {
    activityMock.items = [activityItem('agent:another-task', { workspace: 'C:/Work/OtherAgentFolder' })];
    const onSelectActivity = vi.fn();
    renderComposerHome({ workspaceName: 'C:/Work/NextTaskFolder', onSelectActivity });
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('NextTaskFolder');

    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:another-task'));
    // The chat input bar must follow the tile, otherwise the next message is composed
    // against a workspace the user never selected.
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('OtherAgentFolder');
    expect(screen.getByTestId('hub-composer-context')).not.toHaveTextContent('NextTaskFolder');
    expect(onSelectActivity).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent:another-task', workspace: 'C:/Work/OtherAgentFolder' })
    );
  });

  it('clears the reply target when the user clicks outside an agent tile', () => {
    activityMock.items = [activityItem('agent:another-task', { workspace: 'C:/Work/OtherAgentFolder' })];
    const onSelectActivity = vi.fn();
    renderComposerHome({ workspaceName: 'C:/Work/NextTaskFolder', onSelectActivity });
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:another-task'));
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('OtherAgentFolder');

    // The padding around the grid is outside the tile, but did not previously clear the
    // parent reply target. The next message would therefore go to the old agent.
    fireEvent.click(screen.getByTestId('hub-agent-grid'));
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('NextTaskFolder');
    expect(onSelectActivity).toHaveBeenLastCalledWith(undefined);
  });

  it('clears the reply target from the live-grid header too', () => {
    activityMock.items = [activityItem('agent:another-task', { workspace: 'C:/Work/OtherAgentFolder' })];
    const onSelectActivity = vi.fn();
    renderComposerHome({ workspaceName: 'C:/Work/NextTaskFolder', onSelectActivity });
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:another-task'));

    fireEvent.click(document.querySelector('.hub-grid-bar') as HTMLElement);
    expect(onSelectActivity).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('NextTaskFolder');
  });

  it('stops continuing an agent when an Explorer file belongs to another workspace', () => {
    activityMock.items = [activityItem('agent:another-task', { workspace: 'C:/Work/OtherAgentFolder' })];
    const onSelectActivity = vi.fn();
    renderComposerHome({ workspaceName: 'C:/Work/NextTaskFolder', onSelectActivity });
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:another-task'));
    onSelectActivity.mockClear();

    fireEvent.drop(screen.getByTestId('hub-home-center'), {
      dataTransfer: {
        getData: (type: string) =>
          type === 'application/x-tomni-explorer-workspace-root' ? 'C:/Work/NewExplorerFolder' : '',
      },
    });

    expect(onSelectActivity).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('NextTaskFolder');
  });

  it('keeps the reply target when a grid control is clicked', () => {
    activityMock.items = [activityItem('agent:another-task', { workspace: 'C:/Work/OtherAgentFolder' })];
    const onSelectActivity = vi.fn();
    renderComposerHome({ workspaceName: 'C:/Work/NextTaskFolder', onSelectActivity });
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:another-task'));
    onSelectActivity.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(onSelectActivity).not.toHaveBeenCalled();
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('OtherAgentFolder');
  });

  it('drops the reply target when the selected activity leaves the registry', () => {
    activityMock.items = [activityItem('agent:vanishing-task', { workspace: 'C:/Work/OtherAgentFolder' })];
    const onSelectActivity = vi.fn();
    const view = renderComposerHome({ workspaceName: 'C:/Work/NextTaskFolder', onSelectActivity });
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:vanishing-task'));
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('OtherAgentFolder');

    // The snapshot no longer carries the tile, so it stops looking selected — the composer
    // must stop replying into it too instead of silently continuing.
    activityMock.items = [];
    view.update();
    expect(onSelectActivity).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId('hub-composer-context')).toHaveTextContent('NextTaskFolder');
  });

  it('preserves the same chat input and draft across welcome, live, and terminal activity', async () => {
    const home = () => (
      <MemoryRouter>
        <ConfigProvider>
          <HubShell>
            <HubHome
              composer={<textarea aria-label='Chat draft' defaultValue='' />}
              onNavigate={vi.fn()}
              onFocusComposer={vi.fn()}
              onPromptSelect={vi.fn()}
              onFocusDirectory={vi.fn()}
              agentCount={2}
              capabilityCount={4}
              selectedAgentName='Claude'
            />
          </HubShell>
        </ConfigProvider>
      </MemoryRouter>
    );
    const view = render(home());
    const input = screen.getByRole('textbox', { name: 'Chat draft' });
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    input.focus();
    for (const status of ['running', 'done', 'stopped', 'error']) {
      activityMock.items = Array.from({ length: 8 }, (_, index) => activityItem(`agent:task-${index}`, { status }));
      view.rerender(home());
      expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBe(input);
      expect(input).toHaveValue('Keep this draft');
      expect(input).toHaveFocus();
    }
    activityMock.items = [];
    view.rerender(home());
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBe(input);
    expect(input).toHaveValue('Keep this draft');
    expect(input).toHaveFocus();
    await waitFor(() => expect(packageMocks.list).toHaveBeenCalled());
  });

  it('collapses and restores both side panels from the titlebar event and footer button', () => {
    renderHome();

    const shell = screen.getByTestId('hub-home-shell');
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
    act(() => {
      window.dispatchEvent(new CustomEvent('tomni-hub-toggle-sidebar'));
    });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
    act(() => {
      window.dispatchEvent(new CustomEvent('tomni-hub-toggle-sidebar'));
    });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    expect(shell).not.toHaveClass('hub-shell-rail-collapsed');
    fireEvent.click(screen.getByTestId('hub-footer-rail-toggle'));
    expect(shell).toHaveClass('hub-shell-rail-collapsed');
    fireEvent.click(screen.getByTestId('hub-footer-rail-toggle'));
    expect(shell).not.toHaveClass('hub-shell-rail-collapsed');
  });

  it('automatically collapses both side panels in a narrow window and restores them on expansion', () => {
    let compact = true;
    let narrowListener: ((event: MediaQueryListEvent) => void) | undefined;
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          get matches() {
            return query === '(max-width: 1100px)' && compact;
          },
          media: query,
          onchange: null,
          addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
            if (query === '(max-width: 1100px)' && typeof listener === 'function') {
              narrowListener = listener as (event: MediaQueryListEvent) => void;
            }
          },
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList
    );

    renderHome();

    const shell = screen.getByTestId('hub-home-shell');
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
    expect(shell).toHaveClass('hub-shell-rail-collapsed');
    expect(screen.getByTestId('hub-peek-sider').tagName).toBe('BUTTON');
    expect(screen.getByTestId('hub-peek-rail').tagName).toBe('BUTTON');
    expect(screen.getByTestId('hub-peek-sider').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('hub-peek-rail').querySelector('svg')).not.toBeNull();

    act(() => {
      compact = false;
      narrowListener?.({ matches: false } as MediaQueryListEvent);
    });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
    expect(shell).not.toHaveClass('hub-shell-rail-collapsed');
  });

  it('toggles the chat area from the footer button and Ctrl+Shift+H without unmounting it', () => {
    window.localStorage.removeItem('tomni.hub.chatHidden');
    renderHome();
    const shell = screen.getByTestId('hub-home-shell');
    const toggle = screen.getByTestId('hub-footer-chat-toggle');
    const center = screen.getByTestId('hub-shell-center');
    const composer = screen.getByTestId('hub-composer');

    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(shell).toHaveClass('hub-shell-chat-hidden');
    // Only the new-chat input bar hides: the centre keeps its content and no placeholder replaces it.
    expect(center).toBeInTheDocument();
    expect(center).toBeVisible();
    expect(screen.queryByTestId('hub-chat-hidden-note')).toBeNull();
    expect(window.localStorage.getItem('tomni.hub.chatHidden')).toBe('1');
    expect(screen.getByTestId('hub-composer')).toBe(composer);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(shell).not.toHaveClass('hub-shell-chat-hidden');
    expect(screen.getByTestId('hub-composer')).toBe(composer);

    fireEvent.keyDown(window, { key: 'H', ctrlKey: true, shiftKey: true });
    expect(shell).toHaveClass('hub-shell-chat-hidden');
    fireEvent.keyDown(window, { key: 'H', ctrlKey: true, shiftKey: true });
    expect(shell).not.toHaveClass('hub-shell-chat-hidden');
    expect(window.localStorage.getItem('tomni.hub.chatHidden')).toBe('0');
  });

  it('slides both side panels out from the frame edge and retracts them on mouse leave', () => {
    renderHome();
    const shell = screen.getByTestId('hub-home-shell');

    // An already-open panel ignores the pointer leaving it: only an edge hover may close.
    fireEvent.mouseLeave(screen.getByTestId('global-hub-sidebar'));
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
    fireEvent.mouseLeave(screen.getByTestId('global-hub-rail'));
    expect(shell).not.toHaveClass('hub-shell-rail-collapsed');

    // Collapsing exposes a 6px strip on the matching frame edge.
    act(() => {
      window.dispatchEvent(new CustomEvent('tomni-hub-toggle-sidebar'));
    });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
    expect(screen.getByTestId('hub-peek-sider')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-peek-rail')).toBeNull();

    fireEvent.click(screen.getByTestId('hub-footer-rail-toggle'));
    expect(shell).toHaveClass('hub-shell-rail-collapsed');
    expect(screen.getByTestId('hub-peek-rail')).toBeInTheDocument();

    // Hovering the strip opens the panel and removes the strip with it.
    fireEvent.mouseEnter(screen.getByTestId('hub-peek-sider'));
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
    expect(screen.queryByTestId('hub-peek-sider')).toBeNull();

    fireEvent.mouseEnter(screen.getByTestId('hub-peek-rail'));
    expect(shell).not.toHaveClass('hub-shell-rail-collapsed');
    expect(screen.queryByTestId('hub-peek-rail')).toBeNull();

    // Leaving the panel that an edge hover opened retracts it again.
    fireEvent.mouseLeave(screen.getByTestId('global-hub-sidebar'));
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
    expect(screen.getByTestId('hub-peek-sider')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('global-hub-rail'));
    expect(shell).toHaveClass('hub-shell-rail-collapsed');
    expect(screen.getByTestId('hub-peek-rail')).toBeInTheDocument();
  });

  it('navigates from the sidebar', () => {
    const onNavigate = renderHome();

    fireEvent.click(screen.getByTestId('hub-nav-store'));
    fireEvent.click(screen.getByTestId('hub-nav-schedule'));

    expect(onNavigate).toHaveBeenNthCalledWith(1, '/store');
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/scheduled');
  });

  it('lists Chat under Active, collapsed until opened, with a status colour per chat', () => {
    conversationMock.conversations = [
      { id: 'c1', name: 'Plan Q3', extra: { workspace: 'C:/Work/acme' } },
      { id: 'c2', name: 'Loose chat' },
    ];
    activityMock.items = [activityItem('agent:c1', { status: 'needs_input' })];
    const onNavigate = renderHome();
    const toggle = screen.getByTestId('hub-active-toggle-chat');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('hub-active-app-chat')).toHaveTextContent('Chat');
    expect(screen.queryByTestId('hub-active-session-chat:c1')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/acme/i)).toBeInTheDocument();
    expect(screen.getByTestId('hub-active-session-chat:c1')).toHaveAttribute('data-hub-status', 'attention');
    expect(screen.getByTestId('hub-active-session-chat:c2')).toHaveAttribute('data-hub-status', 'dormant');
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('hub-active-session-chat:c1'));
    expect(onNavigate).toHaveBeenCalledWith('/conversation/c1');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('hub-active-session-chat:c1')).toBeNull();
  });

  it('groups equivalent workspace paths under one folder heading', () => {
    conversationMock.conversations = [
      { id: 'path1', name: 'First spelling', extra: { workspace: 'C:/Work/Acme/' } },
      { id: 'path2', name: 'Second spelling', extra: { workspace: 'c:\\work\\acme' } },
      { id: 'path3', name: 'Third spelling', extra: { workspace: ' C:/WORK/ACME ' } },
    ];
    renderHome();
    fireEvent.click(screen.getByTestId('hub-active-toggle-chat'));
    expect(document.querySelectorAll('.hub-active-group-label')).toHaveLength(1);
    for (const id of ['path1', 'path2', 'path3'])
      expect(screen.getByTestId(`hub-active-session-chat:${id}`)).toBeInTheDocument();
  });

  it('keeps Chat collapsed when new conversations arrive, then lists them on expansion', () => {
    conversationMock.conversations = [{ id: 'old', name: 'Existing chat', extra: { workspace: 'C:/Work/Acme' } }];
    const view = renderComposerHome();
    conversationMock.conversations = [
      { id: 'new', name: 'New chat', extra: { workspace: 'C:/Work/Acme' }, created_at: 100 },
      { id: 'old', name: 'Existing chat', extra: { workspace: 'C:/Work/Acme' }, created_at: 1 },
    ];
    view.update();
    const toggle = screen.getByTestId('hub-active-toggle-chat');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('hub-active-session-chat:new')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('hub-active-session-chat:new')).toBeInTheDocument();
    expect(screen.getByTestId('hub-active-session-chat:old')).toBeInTheDocument();
  });

  it('shows an empty line when no app holds a session', () => {
    renderHome();
    expect(screen.getByText('No app is open right now')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-active-app-chat')).toBeNull();
  });

  it('lists apps that report sessions and opens the Terminal dock from one', () => {
    liveSessionsMock.apps = [
      { appId: 'terminal', updatedAt: 10, sessions: [{ id: 's1', title: 'bash', status: 'working' }] },
    ];
    const onNavigate = renderHome();
    expect(screen.getByTestId('hub-active-app-terminal')).toHaveTextContent('Terminal');
    expect(screen.getByTestId('hub-active-app-terminal')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('hub-active-toggle-terminal'));
    expect(screen.getByTestId('hub-active-session-terminal:s1')).toHaveAttribute('data-hub-status', 'working');
    fireEvent.click(screen.getByTestId('hub-active-session-terminal:s1'));
    expect(onNavigate).toHaveBeenCalledWith('/ide');
  });

  it('focuses the clicked browser tab and colours the app row by its most urgent tab', async () => {
    const { consumeRequestedActiveTab } = await import('@package-apps/browser/renderer/browser/constants');
    liveSessionsMock.apps = [
      {
        appId: 'com.tomni.browser',
        updatedAt: 10,
        sessions: [
          { id: 'tab-1', title: 'Google', status: 'idle', lastActiveAt: Date.now() },
          { id: 'tab-2', title: 'Broken page', status: 'error' },
        ],
      },
    ];
    const onNavigate = renderHome();
    expect(screen.getByTestId('hub-active-app-com.tomni.browser').closest('[data-hub-status]')).toHaveAttribute(
      'data-hub-status',
      'error'
    );
    fireEvent.click(screen.getByTestId('hub-active-toggle-com.tomni.browser'));
    fireEvent.click(screen.getByTestId('hub-active-session-com.tomni.browser:tab-1'));
    expect(onNavigate).toHaveBeenCalledWith('/browser');
    expect(consumeRequestedActiveTab()).toBe('tab-1');
  });

  it('ignores a session of an app that is no longer installed', () => {
    liveSessionsMock.apps = [
      { appId: 'com.gone.app', updatedAt: 10, sessions: [{ id: 'x', title: 'Ghost', status: 'idle' }] },
    ];
    const onNavigate = renderHome();
    fireEvent.click(screen.getByTestId('hub-active-toggle-com.gone.app'));
    fireEvent.click(screen.getByTestId('hub-active-session-com.gone.app:x'));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('shows enabled assistants in the normal Hub welcome catalog', () => {
    const onSelectAssistant = vi.fn();
    const view = renderComposerHome({
      assistants: [
        { id: 'code-pro', name: 'Code Pro', enabled: true },
        { id: 'disabled', name: 'Disabled', enabled: false },
      ] as never,
      onSelectAssistant,
    } as never);

    expect(screen.getByTestId('hub-assistant-code-pro')).toHaveTextContent('Code Pro');
    expect(screen.queryByTestId('hub-assistant-disabled')).toBeNull();
    fireEvent.click(screen.getByTestId('hub-assistant-code-pro'));
    expect(onSelectAssistant).toHaveBeenCalledWith('custom:code-pro');
    view.unmount();
  });


  it('shows apps and a Store promo when no agent is running', () => {
    const onNavigate = renderHome();

    expect(screen.getByText('What do you want to accomplish today?')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('hub-welcome-app-browser'));
    expect(onNavigate).toHaveBeenCalledWith('/browser');

    fireEvent.click(screen.getByTestId('hub-welcome-store'));
    expect(onNavigate).toHaveBeenCalledWith('/store');
  });

  it('shows live work from any workspace as tiles with start-agent slots', () => {
    activityMock.items = [
      activityItem('agent:c1', {
        title: 'Summarize Q3',
        workspace: 'C:/work/finance',
        steps: [{ id: 's1', label: 'Read report', state: 'done' }],
      }),
      activityItem('schedule:job1', { kind: 'schedule', title: 'Nightly digest', canStop: true }),
    ];
    const onNavigate = renderHome();

    const tile = screen.getByTestId('hub-agent-tile-agent:c1');
    expect(tile).toHaveTextContent('Summarize Q3');
    expect(tile).toHaveTextContent('finance');
    expect(tile).toHaveTextContent('Read report');
    expect(screen.getByTestId('hub-agent-tile-schedule:job1')).toBeInTheDocument();
    expect(screen.queryByText('What do you want to accomplish today?')).not.toBeInTheDocument();
    // Auto mode (default) lets the two agents share the stage without fillers.
    expect(within(screen.getByTestId('hub-agent-grid')).queryAllByText('Start a new agent')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '4 tiles' }));
    expect(within(screen.getByTestId('hub-agent-grid')).getAllByText('Start a new agent')).toHaveLength(2);
    expect(screen.getByTestId('hub-sidebar-running')).toHaveTextContent('1 running');

    fireEvent.doubleClick(tile);
    expect(onNavigate).toHaveBeenCalledWith('/conversation/c1');
  });

  it('answers a permission question from the tile', () => {
    activityMock.items = [
      activityItem('agent:c2', {
        status: 'needs_input',
        prompt: {
          id: 'perm-1',
          title: 'Run npm install?',
          description: '',
          options: [
            { label: 'Allow', value: 'proceed_once' },
            { label: 'Deny', value: 'cancel' },
          ],
        },
      }),
    ];
    renderHome();

    expect(screen.getByTestId('hub-footer-attention')).toHaveTextContent('1 need you');
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(activityMock.respond).toHaveBeenCalledWith('agent:c2', 'perm-1', 'proceed_once');
  });

  it('stops running work from the tile context menu', async () => {
    activityMock.items = [activityItem('agent:c3', { title: 'Long build' })];
    renderHome();

    fireEvent.contextMenu(screen.getByTestId('hub-agent-tile-agent:c3'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'guid.hubHome.live.stop' }));
    await waitFor(() => expect(activityMock.stop).toHaveBeenCalledWith('agent:c3'));
  });

  it('routes an installed Notes surface into the shell centre while preserving sidebar and rail', async () => {
    // Regression: pinnable package modules must appear in both the APPS sidebar and the launcher.
    packageMocks.list.mockResolvedValue([installedPackage('com.tomni.notes', 'Notes', 'notes')]);
    const onNavigate = renderHome();
    const sidebar = screen.getByTestId('global-hub-sidebar');
    const explorer = screen.getByTestId('hub-workspace-panel');

    fireEvent.click(screen.getByTestId('hub-open-launcher'));
    const launcher = screen.getByTestId('hub-app-launcher');
    expect(within(launcher).getByTestId('hub-app-icon-chat')).toBeInTheDocument();
    expect(within(launcher).getByText('Chat')).toBeInTheDocument();
    expect(within(launcher).queryByText('guid.hubHome.apps.chat.description')).toBeNull();
    fireEvent.click(await within(launcher).findByText('Notes'));
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(launcher.isConnected).toBe(true);
    expect(launcher.closest('.arco-modal-wrapper')).toHaveStyle({ display: 'block' });

    expect(onNavigate).toHaveBeenCalledWith('/apps/com.tomni.notes/notes');
    expect(screen.getByTestId('global-hub-sidebar')).toBe(sidebar);
    expect(screen.getByTestId('hub-workspace-panel')).toBe(explorer);
    await waitFor(() => expect(screen.getByTestId('hub-app-launcher')).toBeVisible());
  });

  it('opens an enabled web-embed app from the launcher by its package and connection ids', async () => {
    packageMocks.list.mockResolvedValue([installedPackage('com.community.medisign', 'MediSign', 'medisign')]);
    connectionMocks.list.mockResolvedValue({
      ok: true,
      data: [
        {
          key: 'web-embed:medisign',
          kind: 'web-embed',
          title: 'MediSign',
          runsCode: true,
          enabled: true,
          status: 'on',
        },
      ],
    });
    renderHome();

    fireEvent.click(screen.getByTestId('hub-open-launcher'));
    const launcher = screen.getByTestId('hub-app-launcher');
    await within(launcher).findByTestId('hub-web-embed-app-icon-web-embed:com.community.medisign:medisign');
    fireEvent.click(within(launcher).getByTestId('hub-web-embed-app-icon-web-embed:com.community.medisign:medisign'));

    await waitFor(() =>
      expect(webEmbedMocks.openApp).toHaveBeenCalledWith({
        packageId: 'com.community.medisign',
        connectionId: 'medisign',
      })
    );
  });

  it('lists an enabled web-embed app even when its package has no module surface', async () => {
    const medisign = installedPackage('com.community.medisign', 'MediSign', 'medisign');
    const manifest = { ...medisign.manifest, modules: [] };
    packageMocks.list.mockResolvedValue([{ ...medisign, manifest, installedManifest: manifest }]);
    connectionMocks.list.mockResolvedValue({
      ok: true,
      data: [
        {
          key: 'web-embed:medisign',
          kind: 'web-embed',
          title: 'MediSign',
          runsCode: true,
          enabled: true,
          status: 'on',
        },
      ],
    });
    renderHome();

    fireEvent.click(screen.getByTestId('hub-open-launcher'));
    expect(
      await within(screen.getByTestId('hub-app-launcher')).findByTestId(
        'hub-web-embed-app-icon-web-embed:com.community.medisign:medisign'
      )
    ).toBeInTheDocument();
  });

  it('shows a translated error when opening a web-embed app fails', async () => {
    packageMocks.list.mockResolvedValue([installedPackage('com.community.medisign', 'MediSign', 'medisign')]);
    connectionMocks.list.mockResolvedValue({
      ok: true,
      data: [
        {
          key: 'web-embed:medisign',
          kind: 'web-embed',
          title: 'MediSign',
          runsCode: true,
          enabled: true,
          status: 'on',
        },
      ],
    });
    webEmbedMocks.openApp.mockResolvedValue({ ok: false, error: 'UNAVAILABLE' });
    const error = vi.spyOn(Message, 'error');
    renderHome();

    fireEvent.click(screen.getByTestId('hub-open-launcher'));
    const launcher = screen.getByTestId('hub-app-launcher');
    await within(launcher).findByTestId('hub-web-embed-app-icon-web-embed:com.community.medisign:medisign');
    fireEvent.click(within(launcher).getByTestId('hub-web-embed-app-icon-web-embed:com.community.medisign:medisign'));

    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not open this app.'));
  });

  it('opens with Explorer only and reveals stored Diff after selecting an agent tile', async () => {
    localStorage.setItem('tomni.hub.railTabs.v1', JSON.stringify({ openTabs: ['files', 'diff'], active: 'diff' }));
    const view = renderComposerHome();
    expect(screen.getByTestId('hub-rail-tab-files')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-rail-tab-diff')).toBeNull();
    fireEvent.click(screen.getByTestId('hub-rail-tab-add'));
    expect(await screen.findByRole('menuitem', { name: 'Explorer tab' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Diff tab' })).toBeNull();

    activityMock.items = [activityItem('agent:rail-task')];
    view.update();
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:rail-task'));
    expect(screen.getByTestId('hub-rail-tab-diff')).toHaveAttribute('aria-selected', 'true');
  });

  it('suggests Session Memory only after selecting an agent tile', async () => {
    const view = renderComposerHome();
    activityMock.items = [activityItem('agent:memory-task')];
    view.update();
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:memory-task'));
    fireEvent.click(screen.getByTestId('hub-rail-tab-add'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Session Memory' }));
    expect(screen.getByTestId('hub-rail-tab-memory')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('menuitem', { name: 'Model tab' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close tab: Session Memory' }));
    expect(screen.queryByTestId('hub-rail-tab-memory')).toBeNull();
  });

  it('suggests Session context only after selecting an agent tile', async () => {
    const view = renderComposerHome();
    fireEvent.click(screen.getByTestId('hub-rail-tab-add'));
    expect(screen.queryByRole('menuitem', { name: 'Session context' })).toBeNull();

    activityMock.items = [activityItem('agent:context-task')];
    view.update();
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:context-task'));
    fireEvent.click(screen.getByTestId('hub-rail-tab-add'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Session context' }));

    expect(screen.getByTestId('hub-rail-tab-context')).toHaveAttribute('aria-selected', 'true');
  });

  it('suggests Secret keys only after selecting an agent tile', async () => {
    const view = renderComposerHome();
    fireEvent.click(screen.getByTestId('hub-rail-tab-add'));
    expect(screen.queryByRole('menuitem', { name: 'Secret keys' })).toBeNull();

    activityMock.items = [activityItem('agent:secret-task', { workspace: 'C:/Work/SecretAgent' })];
    view.update();
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:secret-task'));
    fireEvent.click(screen.getByTestId('hub-rail-tab-add'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Secret keys' }));

    expect(screen.getByTestId('hub-rail-tab-secrets')).toHaveAttribute('aria-selected', 'true');
  });

  it('removes an open Secret keys tab when the agent selection is cleared', async () => {
    const view = renderComposerHome();
    activityMock.items = [activityItem('agent:secret-task', { workspace: 'C:/Work/SecretAgent' })];
    view.update();
    fireEvent.click(screen.getByTestId('hub-agent-tile-agent:secret-task'));
    fireEvent.click(screen.getByTestId('hub-rail-tab-add'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Secret keys' }));
    expect(screen.getByTestId('hub-rail-tab-secrets')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hub-agent-grid'));

    expect(screen.queryByTestId('hub-rail-tab-secrets')).toBeNull();
    expect(screen.queryByRole('tabpanel', { name: 'Secret keys' })).toBeNull();
  });

  it('keeps Explorer open and supports keyboard tab navigation when no agent is selected', () => {
    renderHome();
    expect(screen.getByRole('button', { name: 'Close tab: Explorer tab' })).toBeDisabled();
    const files = screen.getByTestId('hub-rail-tab-files');
    fireEvent.keyDown(files, { key: 'ArrowRight' });
    expect(files).toHaveFocus();
  });

      it('keeps Chat and Terminal mutually exclusive in the main Home viewport', () => {
    renderHome(vi.fn(), '/guid');
    expect(screen.queryByRole('button', { name: 'Support' })).toBeNull();
    expect(screen.getByTestId('hub-agent-grid')).toBeInTheDocument();
    expect(screen.getByTestId('hub-composer')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-terminal-workspace-fixture')).toBeNull();

    fireEvent.click(screen.getByTestId('hub-footer-terminal'));
    expect(screen.getByTestId('hub-terminal-workspace-fixture')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-agent-grid')).toBeNull();
    expect(screen.queryByTestId('hub-composer')).toBeNull();
            expect(screen.getByTestId('hub-footer-terminal')).toHaveAttribute('aria-pressed', 'true');



    fireEvent.click(screen.getByTestId('hub-footer-terminal'));
    expect(screen.getByTestId('hub-terminal-workspace-fixture')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hub-footer-chat-toggle'));
    expect(screen.queryByTestId('hub-terminal-workspace-fixture')).toBeNull();
    expect(screen.getByTestId('hub-agent-grid')).toBeInTheDocument();
    expect(screen.getByTestId('hub-composer')).toBeInTheDocument();
  });
    it('uses Terminal Mode instead of opening the installed Terminal package from the footer', async () => {
    packageMocks.list.mockResolvedValue([installedPackage('com.tomni.terminal', 'Terminal', 'terminal')]);
    const onNavigate = renderHome();
    const sidebar = screen.getByTestId('global-hub-sidebar');
        fireEvent.click(screen.getByTestId('hub-footer-terminal'));

    expect(onNavigate).not.toHaveBeenCalledWith('/apps/com.tomni.terminal/terminal');
    expect(screen.getByTestId('hub-terminal-workspace-fixture')).toBeInTheDocument();
    expect(screen.getByTestId('global-hub-sidebar')).toBe(sidebar);
  });

  it('ignores invalid recent-app storage safely', () => {
    expect(parseRecentHubApps('{broken')).toEqual([]);
    expect(parseRecentHubApps('["browser","unknown",4]')).toEqual(['browser']);
  });
});
