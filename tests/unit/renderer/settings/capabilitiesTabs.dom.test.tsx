/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ pluginsOpenExternal: undefined as boolean | undefined }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return {
    default: ({ children }: { children: React.ReactNode }) =>
      createElement('div', { 'data-testid': 'settings-wrapper' }, children),
  };
});

vi.mock('@/renderer/pages/settings/AssistantSettings', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return { default: () => createElement('div', { 'data-testid': 'assistants-stub' }, 'assistants') };
});

vi.mock('@/renderer/pages/settings/SkillsHubSettings', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return { default: () => createElement('div', { 'data-testid': 'skills-stub' }, 'skills') };
});

vi.mock('@/renderer/pages/integrations/hooks/HooksPage', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return { default: () => createElement('div', { 'data-testid': 'hooks-stub' }, 'hooks') };
});

vi.mock('@/renderer/pages/settings/ToolsSettings/PluginsSettingsTab', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return {
    default: (props: { openExternal?: boolean }) => {
      probe.pluginsOpenExternal = props.openExternal;
      return createElement('div', { 'data-testid': 'plugins-stub' }, 'plugins');
    },
  };
});

import CapabilitiesSettings, { resolveCapabilitiesTab } from '@/renderer/pages/settings/CapabilitiesSettings';

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path='/settings/capabilities' element={<CapabilitiesSettings />} />
      </Routes>
    </MemoryRouter>
  );

const tabLabels = (): string[] => screen.getAllByRole('tab').map((element) => element.textContent ?? '');

const selectedLabel = (): string | undefined =>
  screen.getAllByRole('tab').find((element) => element.getAttribute('aria-selected') === 'true')?.textContent ??
  undefined;

afterEach(() => {
  cleanup();
  probe.pluginsOpenExternal = undefined;
});

describe('Settings > Customize tabs', () => {
  it('shows exactly four tabs in the agreed order', () => {
    renderAt('/settings/capabilities');
    expect(tabLabels()).toEqual([
      'settings.capabilitiesTab.assistants',
      'settings.capabilitiesTab.skills',
      'settings.capabilitiesTab.hooks',
      'settings.capabilitiesTab.plugins',
    ]);
  });

  it('opens Assistants when no tab is given', () => {
    renderAt('/settings/capabilities');
    expect(selectedLabel()).toBe('settings.capabilitiesTab.assistants');
    expect(screen.getByTestId('assistants-stub')).toBeTruthy();
  });

  it('maps the legacy ?tab=tools link to Plugins without opening the external section', () => {
    renderAt('/settings/capabilities?tab=tools');
    expect(selectedLabel()).toBe('settings.capabilitiesTab.plugins');
    expect(screen.getByTestId('plugins-stub')).toBeTruthy();
    expect(probe.pluginsOpenExternal).toBe(false);
  });

  it('maps the legacy ?tab=mcp-gateway link to Plugins and asks it to open the external section', () => {
    renderAt('/settings/capabilities?tab=mcp-gateway');
    expect(selectedLabel()).toBe('settings.capabilitiesTab.plugins');
    expect(probe.pluginsOpenExternal).toBe(true);
  });

  it('selects the first tab for ?tab=assistants and keeps the other current keys working', () => {
    renderAt('/settings/capabilities?tab=assistants');
    expect(selectedLabel()).toBe('settings.capabilitiesTab.assistants');
    cleanup();
    renderAt('/settings/capabilities?tab=hooks');
    expect(selectedLabel()).toBe('settings.capabilitiesTab.hooks');
  });

  it('falls back to Assistants for an unknown tab', () => {
    renderAt('/settings/capabilities?tab=nonsense');
    expect(selectedLabel()).toBe('settings.capabilitiesTab.assistants');
  });

  it('switches tabs on click', () => {
    renderAt('/settings/capabilities');
    fireEvent.click(screen.getByRole('tab', { name: 'settings.capabilitiesTab.hooks' }));
    expect(selectedLabel()).toBe('settings.capabilitiesTab.hooks');
    expect(screen.getByTestId('hooks-stub')).toBeTruthy();
  });
});

describe('resolveCapabilitiesTab', () => {
  it('maps current keys to themselves and legacy keys to their new home', () => {
    expect(resolveCapabilitiesTab('skills')).toBe('skills');
    expect(resolveCapabilitiesTab('tools')).toBe('plugins');
    expect(resolveCapabilitiesTab('mcp-gateway')).toBe('plugins');
    expect(resolveCapabilitiesTab('assistants')).toBe('assistants');
  });

  it('returns undefined for missing or unknown values', () => {
    expect(resolveCapabilitiesTab(null)).toBeUndefined();
    expect(resolveCapabilitiesTab('nonsense')).toBeUndefined();
  });
});
