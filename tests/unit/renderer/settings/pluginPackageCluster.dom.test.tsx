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
  connections: [] as unknown[],
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
    default: (props: { name: string }) =>
      createElement('div', { 'data-testid': 'skill-document', 'data-name': props.name }),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn(async () => fixtures.skills) },
    },
  },
}));

import PluginsSettingsTab from '@/renderer/pages/settings/ToolsSettings/PluginsSettingsTab';

const PACKAGE = {
  manifest: { id: 'com.x.context', name: 'Context Mode', description: 'Context tools' },
  installedManifest: { id: 'com.x.context', name: 'Context Mode', description: 'Context tools' },
};

const packageServer = (id: string): IMcpServer =>
  ({
    id,
    name: 'context-mode',
    enabled: true,
    transport: { type: 'stdio', command: 'npx', args: [] },
    created_at: 0,
    updated_at: 0,
    original_json: '{}',
  }) as IMcpServer;

const connection = (kind: string, key: string, extra: Record<string, unknown> = {}) => ({
  key,
  kind,
  title: key,
  runsCode: false,
  enabled: true,
  status: 'on',
  ...extra,
});

/** Renders the hub and opens its Installed tab, where the plugin cards are. */
const renderInstalledTab = async () => {
  render(
    <MemoryRouter>
      <PluginsSettingsTab />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByTestId('plugin-hub-tab-installed'));
  return waitFor(() => screen.getByTestId('plugin-package-com.x.context'));
};

afterEach(() => {
  cleanup();
  fixtures.mcpServers = [];
  fixtures.packages = [];
  fixtures.connections = [];
  fixtures.skills = [];
  Reflect.deleteProperty(window, 'electronAPI');
});

describe('plugin cluster of a package', () => {
  it('counts the MCP servers, skills and hooks of an installed package on its plugin card', async () => {
    fixtures.packages = [PACKAGE];
    fixtures.mcpServers = [packageServer('pkgconn:com.x.context:context-mode')];
    fixtures.connections = [
      connection('skill', 'skill:a'),
      connection('skill', 'skill:b'),
      connection('hook', 'hook:1'),
      connection('mcp', 'mcp:ctx'),
    ];
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      packageConnections: {
        list: vi.fn(async () => ({ ok: true, data: fixtures.connections })),
      },
    };
    const card = await renderInstalledTab();
    await waitFor(() => expect(within(card).getByText('settings.capabilitiesTab.skills 2')).toBeTruthy());
    expect(within(card).getByText('settings.capabilitiesTab.typeMcp 1')).toBeTruthy();
    expect(within(card).getByText('settings.capabilitiesTab.hooks 1')).toBeTruthy();
  });

  it('shows no counts for a package that has none, and still renders without the connections API', async () => {
    fixtures.packages = [PACKAGE];
    const card = await renderInstalledTab();
    expect(within(card).queryByText(/settings\.capabilitiesTab\.(typeMcp|skills|hooks) \d/u)).toBeNull();
    expect(within(card).getByTestId('capability-kind-plugin')).toBeTruthy();
  });

  it('shows the start-again switch only for a plugin with code-running connections', async () => {
    fixtures.packages = [PACKAGE];
    fixtures.connections = [connection('mcp', 'mcp:ctx', { runsCode: true, autoStart: true })];
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      packageConnections: { list: vi.fn(async () => ({ ok: true, data: fixtures.connections })) },
    };
    const card = await renderInstalledTab();
    await waitFor(() => expect(within(card).getByTestId('plugin-autostart-com.x.context')).toBeTruthy());
    expect(within(card).getByText('guid.hubHome.connections.autoStart')).toBeTruthy();
  });

  it('expands to list the skills of the plugin, and View opens the skill document', async () => {
    fixtures.packages = [PACKAGE];
    fixtures.connections = [connection('skill', 'skill:ctx-search')];
    fixtures.skills = [
      { name: 'ctx-search', description: 'search', source: 'package', packageId: 'com.x.context', location: '/l' },
    ];
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      packageConnections: { list: vi.fn(async () => ({ ok: true, data: fixtures.connections })) },
    };
    const card = await renderInstalledTab();
    expect(within(card).queryByTestId('plugin-detail-com.x.context')).toBeNull();

    fireEvent.click(within(card).getByTestId('plugin-details-toggle-com.x.context'));
    const detail = await waitFor(() => within(card).getByTestId('plugin-detail-com.x.context'));
    fireEvent.click(within(detail).getByTestId('plugin-skill-view-ctx-search'));
    const doc = await screen.findByTestId('skill-document');
    expect(doc.getAttribute('data-name')).toBe('ctx-search');
  });
});
