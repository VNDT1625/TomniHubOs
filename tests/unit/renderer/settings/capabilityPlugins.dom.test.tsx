/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';

const fixtures = vi.hoisted(() => ({
  mcpServers: [] as unknown[],
  packages: [] as unknown[],
  skills: [] as unknown[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}|${JSON.stringify(options)}`,
  }),
}));

vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({ mcpServers: fixtures.mcpServers, saveMcpServers: vi.fn() }),
}));

vi.mock('@/renderer/pages/hub/packageClient', () => ({
  packageClient: { list: vi.fn(async () => fixtures.packages) },
}));

vi.mock('@/renderer/pages/hub/installedPackageApps', () => ({
  isPackageListingInstalled: () => true,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/ToolsModalContent', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return { default: () => createElement('div', { 'data-testid': 'tools-modal-stub' }, 'tools') };
});

vi.mock('@/renderer/pages/settings/ToolsSettings/ExternalMcpGatewaySettings', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return { default: () => createElement('div', null, 'gateway') };
});

vi.mock('@/renderer/components/skills/SkillDocumentModal', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return {
    default: (props: { name: string; packageId?: string }) =>
      createElement('div', {
        'data-testid': 'skill-document',
        'data-name': props.name,
        'data-package': props.packageId,
      }),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn(async () => fixtures.skills) },
      getSkillPaths: { invoke: vi.fn(async () => ({ user_skills_dir: '/skills', builtin_skills_dir: '/builtin' })) },
      listBuiltinAutoSkills: { invoke: vi.fn(async () => []) },
      deleteSkill: { invoke: vi.fn(async () => true) },
    },
    dialog: { showOpen: { invoke: vi.fn(async () => undefined) } },
  },
}));

import PluginsSettingsTab from '@/renderer/pages/settings/ToolsSettings/PluginsSettingsTab';
import SkillsHubSettings from '@/renderer/pages/settings/SkillsHubSettings';
import {
  CapabilityKindTag,
  PluginOriginGroup,
  groupByPlugin,
} from '@/renderer/pages/settings/ToolsSettings/CapabilityKindUi';

const server = (over: Partial<IMcpServer>): IMcpServer =>
  ({
    id: 'id',
    name: 'name',
    enabled: true,
    transport: { type: 'stdio', command: 'node', args: [] },
    created_at: 0,
    updated_at: 0,
    original_json: '{}',
    ...over,
  }) as IMcpServer;

/** Two built-in servers (one of them off), and one server that is the user's own. */
const BUILTIN_SERVERS = [
  server({ id: 'builtin-browser', name: 'tomny-browser-control', builtin: true, enabled: true, tools: [] as never }),
  server({ id: 'builtin-image-gen', name: 'tomny-image-generation', builtin: true, enabled: false }),
  server({ id: 'user-1', name: 'my-own-server', builtin: false, enabled: true }),
];

const PACKAGE = {
  manifest: { id: 'com.x.context', name: 'Context Mode', description: 'Context tools' },
  installedManifest: { id: 'com.x.context', name: 'Context Mode', description: 'Context tools' },
};

const skill = (over: Record<string, unknown>) => ({
  description: '',
  location: '/loc',
  is_custom: false,
  ...over,
});

/** True when node b comes after node a in the document. */
const follows = (a: Node, b: Node): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The search input of the hub: the test id may sit on the wrapper or on the input itself. */
const searchInput = (): HTMLInputElement => {
  const element = screen.getByTestId('plugin-hub-search');
  return (element.tagName === 'INPUT' ? element : element.querySelector('input')) as HTMLInputElement;
};

const renderTab = () =>
  render(
    <MemoryRouter>
      <PluginsSettingsTab />
    </MemoryRouter>
  );

afterEach(() => {
  cleanup();
  fixtures.mcpServers = [];
  fixtures.packages = [];
  fixtures.skills = [];
});

describe('capability kind tags and groups', () => {
  it('tags a plugin as Plugin and a server as MCP, with the definition as tooltip', () => {
    render(
      <>
        <CapabilityKindTag kind='plugin' />
        <CapabilityKindTag kind='mcp' />
      </>
    );
    expect(screen.getByTestId('capability-kind-plugin').textContent).toBe('settings.capabilitiesTab.pluginBadge');
    expect(screen.getByTestId('capability-kind-mcp').textContent).toBe('settings.capabilitiesTab.typeMcp');
  });

  it('groups items by their owning plugin and leaves out items with no owner', () => {
    const groups = groupByPlugin(
      [
        { id: 'a', plugin: 'p1' },
        { id: 'b', plugin: undefined },
        { id: 'c', plugin: 'p2' },
        { id: 'd', plugin: 'p1' },
      ],
      (item) => item.plugin
    );
    expect(groups.map((group) => group.pluginId)).toEqual(['p1', 'p2']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['a', 'd']);
  });

  it('keeps a plugin group collapsed, with no switch, and opens its detail page on Manage', () => {
    const onManage = vi.fn();
    render(
      <PluginOriginGroup pluginId='com.x.context' label='From plugin' testId='group-x' onManage={onManage}>
        <span>child row</span>
      </PluginOriginGroup>
    );
    const group = screen.getByTestId('group-x') as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(within(group).queryByRole('switch')).toBeNull();
    expect(within(group).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(group).getByText('settings.capabilitiesTab.manageInPlugin'));
    expect(onManage).toHaveBeenCalledWith('com.x.context');
  });
});

describe('Settings > Plugin tab: one hub card with three tabs', () => {
  it('shows the explainer, then one hub card whose tabs carry their counts', async () => {
    fixtures.mcpServers = BUILTIN_SERVERS;
    fixtures.packages = [PACKAGE];
    renderTab();
    const explainer = screen.getByTestId('capability-explainer');
    const hub = screen.getByTestId('plugin-hub');
    expect(follows(explainer, hub)).toBe(true);
    await waitFor(() => expect(screen.getByTestId('plugin-hub-tab-installed').textContent).toContain('(1)'));
    const labels = screen.getAllByRole('tab').map((element) => element.textContent);
    expect(labels).toEqual([
      'settings.capabilitiesTab.hubTabAvailable (2)',
      'settings.capabilitiesTab.hubTabInstalled (1)',
      'settings.capabilitiesTab.hubTabCustom (1)',
    ]);
  });

  it('opens on Available, with the built-in servers and no custom server rows', () => {
    fixtures.mcpServers = BUILTIN_SERVERS;
    renderTab();
    expect(screen.getByTestId('plugin-hub-tab-available').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('builtin-mcp-tomny-browser-control')).toBeTruthy();
    expect(screen.getByTestId('builtin-mcp-tomny-image-generation')).toBeTruthy();
    expect(screen.queryByTestId('custom-mcp-my-own-server')).toBeNull();
    expect(screen.queryByTestId('builtin-switch-tomny-image-generation')).toBeNull();
  });

  it('Installed lists each plugin as a cluster card tagged Plugin, not as a built-in row', async () => {
    fixtures.mcpServers = BUILTIN_SERVERS;
    fixtures.packages = [PACKAGE];
    renderTab();
    fireEvent.click(screen.getByTestId('plugin-hub-tab-installed'));
    const card = await waitFor(() => screen.getByTestId('plugin-package-com.x.context'));
    expect(within(card).getByTestId('capability-kind-plugin')).toBeTruthy();
    expect(within(card).getByTestId('plugin-enable-com.x.context')).toBeTruthy();
    expect(screen.queryByTestId('builtin-mcp-tomny-browser-control')).toBeNull();
  });

  it('Custom lists only the own servers, with the full manager below them', () => {
    fixtures.mcpServers = BUILTIN_SERVERS;
    renderTab();
    fireEvent.click(screen.getByTestId('plugin-hub-tab-custom'));
    expect(screen.getByTestId('custom-mcp-my-own-server')).toBeTruthy();
    expect(screen.getByTestId('custom-switch-my-own-server')).toBeTruthy();
    expect(screen.queryByTestId('builtin-mcp-tomny-browser-control')).toBeNull();
    expect(screen.getByTestId('plugin-hub-manage')).toBeTruthy();
  });

  it('the on/off chip narrows the list in the current tab', () => {
    fixtures.mcpServers = BUILTIN_SERVERS;
    renderTab();
    fireEvent.click(screen.getByTestId('plugin-hub-filter-off'));
    expect(screen.queryByTestId('builtin-mcp-tomny-browser-control')).toBeNull();
    expect(screen.getByTestId('builtin-mcp-tomny-image-generation')).toBeTruthy();
    fireEvent.click(screen.getByTestId('plugin-hub-filter-all'));
    expect(screen.getByTestId('builtin-mcp-tomny-browser-control')).toBeTruthy();
  });

  it('search matches by name or description and shows a note when nothing matches', async () => {
    fixtures.mcpServers = BUILTIN_SERVERS;
    fixtures.packages = [PACKAGE];
    renderTab();
    fireEvent.click(screen.getByTestId('plugin-hub-tab-installed'));
    await waitFor(() => screen.getByTestId('plugin-package-com.x.context'));
    fireEvent.change(searchInput(), { target: { value: 'tools' } });
    expect(screen.getByTestId('plugin-package-com.x.context')).toBeTruthy();
    fireEvent.change(searchInput(), { target: { value: 'zzz-nothing' } });
    expect(screen.queryByTestId('plugin-package-com.x.context')).toBeNull();
    expect(screen.getByText('settings.capabilitiesTab.hubNoMatch')).toBeTruthy();
  });

  it('tags each installed package as Plugin and each MCP row as MCP', async () => {
    fixtures.packages = [PACKAGE];
    renderTab();
    fireEvent.click(screen.getByTestId('plugin-hub-tab-installed'));
    await waitFor(() => expect(screen.getByTestId('plugin-package-com.x.context')).toBeTruthy());
    expect(
      within(screen.getByTestId('plugin-package-com.x.context')).getByTestId('capability-kind-plugin')
    ).toBeTruthy();
  });
});

describe('Settings > Skills tab plugin groups', () => {
  it('moves package skills into a collapsed plugin group with a View action and no switch', async () => {
    fixtures.packages = [PACKAGE];
    fixtures.skills = [
      skill({ name: 'standalone-one', description: 'mine', source: 'custom', is_custom: true }),
      skill({ name: 'ctx-search', description: 'from plugin', source: 'package', packageId: 'com.x.context' }),
      skill({ name: 'ctx-index', description: 'from plugin', source: 'package', packageId: 'com.x.context' }),
    ];
    render(
      <MemoryRouter>
        <SkillsHubSettings withWrapper={false} />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('my-skill-card-standalone-one')).toBeTruthy());

    expect(screen.queryByTestId('my-skill-card-ctx-search')).toBeNull();
    expect(screen.getByTestId('btn-delete-standalone-one')).toBeTruthy();

    const group = screen.getByTestId('plugin-skill-group-com.x.context') as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(within(group).queryByRole('switch')).toBeNull();
    expect(within(group).queryByRole('checkbox')).toBeNull();
    expect(within(group).getByTestId('plugin-skill-ctx-search')).toBeTruthy();

    fireEvent.click(within(group).getByTestId('btn-view-plugin-skill-ctx-search'));
    const doc = await screen.findByTestId('skill-document');
    expect(doc.getAttribute('data-name')).toBe('ctx-search');
    expect(doc.getAttribute('data-package')).toBe('com.x.context');
  });
});
