/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plugin groups in the attach and tools menus: one collapsed row per plugin for skills and hooks, a group checkbox
 * with checked / indeterminate / unchecked state, standalone items listed flat, and expansion kept for the session.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { HookSettingsRow } from '@/common/integrations/hooks/hookSettings';
import type { ToolsSelectMenuProps } from '@/renderer/components/media/attachMenu/ToolsSelectMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      (options?.defaultValue ?? key).replace('{{count}}', String(options?.count ?? '')),
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { listAvailableSkills: { invoke: vi.fn(async () => skillIndex) } },
    packagePlatform: { list: { invoke: vi.fn(async () => packageRows) } },
  },
}));

vi.mock('@/renderer/components/skills/SkillDocumentModal', () => ({
  SkillDocumentModal: () => null,
}));

vi.mock('@/renderer/components/media/attachMenu/useInstalledPlugins', () => ({
  useInstalledPlugins: () => [],
  useEnableInstalledPlugin: () => vi.fn(),
}));

vi.mock('@/renderer/components/media/attachMenu/HookColumn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/components/media/attachMenu/HookColumn')>();
  return { ...actual, useActiveHookRows: () => [] };
});

import ToolsSelectMenu from '@/renderer/components/media/attachMenu/ToolsSelectMenu';
import { HookMenuList } from '@/renderer/components/media/attachMenu/HookColumn';
import { PluginGroup, resetPluginGroupExpansion } from '@/renderer/components/media/attachMenu/PluginGroup';
import { groupCheckState } from '@/renderer/components/media/attachMenu/attachMenuModel';

const skillIndex = [
  { name: 'ctx-a', description: 'Context A', packageId: 'context-mode' },
  { name: 'ctx-b', description: 'Context B', packageId: 'context-mode' },
  { name: 'ctx-c', description: 'Context C', packageId: 'context-mode' },
  { name: 'my-note', description: 'My own note' },
];

const packageRows = [{ manifest: { id: 'context-mode', name: 'Context Mode' } }];

const allSkills = [
  { name: 'ctx-a', description: 'Context A', isAuto: false },
  { name: 'ctx-b', description: 'Context B', isAuto: false },
  { name: 'ctx-c', description: 'Context C', isAuto: false },
  { name: 'my-note', description: 'My own note', isAuto: false },
];

const renderToolsMenu = (overrides: Partial<ToolsSelectMenuProps> = {}) => {
  const props = {
    allSkills,
    disabledBuiltinSkills: [],
    enabledSkills: [],
    onToggleSkill: vi.fn(),
    mcpServers: [],
    selectedMcpServerIds: [],
    onToggleMcpServer: vi.fn(),
    onAddFiles: vi.fn(),
    ...overrides,
  };
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToolsSelectMenu {...props}>
        <button type='button'>open-menu</button>
      </ToolsSelectMenu>
    </SWRConfig>
  );
  return props;
};

/** Opens the Home tools menu and switches to the Skills column. */
const openSkillsColumn = async () => {
  fireEvent.click(screen.getByText('open-menu'));
  fireEvent.click(await screen.findByTestId('attach-category-skills'));
  await screen.findByTestId('attach-menu-group-context-mode');
};

const groupCheckbox = (): HTMLInputElement => {
  const group = screen.getByTestId('attach-select-all-context-mode');
  return within(group).getByRole('checkbox') as HTMLInputElement;
};

describe('plugin skill groups in the tools menu', () => {
  beforeEach(() => {
    resetPluginGroupExpansion();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists standalone skills flat and keeps each plugin group collapsed by default', async () => {
    renderToolsMenu();
    await openSkillsColumn();

    expect(screen.getByTestId('attach-skill-my-note')).toBeTruthy();
    expect(screen.queryByTestId('attach-skill-ctx-a')).toBeNull();

    const toggle = screen.getByTestId('attach-menu-group-context-mode-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.textContent).toContain('Context Mode');
    expect(toggle.textContent).toContain('3 skill');
  });

  it('expands the group in place and shows each member with its description', async () => {
    renderToolsMenu();
    await openSkillsColumn();

    fireEvent.click(screen.getByTestId('attach-menu-group-context-mode-toggle'));

    expect(screen.getByTestId('attach-menu-group-context-mode-toggle').getAttribute('aria-expanded')).toBe('true');
    const member = screen.getByTestId('attach-skill-ctx-a');
    expect(within(member).getByText('Context A')).toBeTruthy();
    expect(screen.getByTestId('attach-skill-ctx-b')).toBeTruthy();
    expect(screen.getByTestId('attach-skill-ctx-c')).toBeTruthy();
  });

  it('selects every member when the group checkbox is unchecked', async () => {
    const props = renderToolsMenu();
    await openSkillsColumn();
    fireEvent.click(screen.getByTestId('attach-menu-group-context-mode-toggle'));

    expect(groupCheckbox().checked).toBe(false);
    fireEvent.click(groupCheckbox());

    expect(props.onToggleSkill).toHaveBeenCalledTimes(3);
    expect(props.onToggleSkill).toHaveBeenCalledWith('ctx-a', false);
    expect(props.onToggleSkill).toHaveBeenCalledWith('ctx-b', false);
    expect(props.onToggleSkill).toHaveBeenCalledWith('ctx-c', false);
  });

  it('shows indeterminate when some members are on and turns on only the members that are off', async () => {
    const props = renderToolsMenu({ enabledSkills: ['ctx-a'] });
    await openSkillsColumn();
    fireEvent.click(screen.getByTestId('attach-menu-group-context-mode-toggle'));

    const checkWrap = screen.getByTestId('attach-select-all-context-mode');
    expect(
      checkWrap.matches('.arco-checkbox-indeterminate') ||
        checkWrap.querySelector('.arco-checkbox-indeterminate') !== null
    ).toBe(true);
    fireEvent.click(groupCheckbox());

    expect(props.onToggleSkill).toHaveBeenCalledTimes(2);
    expect(props.onToggleSkill).toHaveBeenCalledWith('ctx-b', false);
    expect(props.onToggleSkill).toHaveBeenCalledWith('ctx-c', false);
  });

  it('turns off every member when all of them are on', async () => {
    const props = renderToolsMenu({ enabledSkills: ['ctx-a', 'ctx-b', 'ctx-c'] });
    await openSkillsColumn();
    fireEvent.click(screen.getByTestId('attach-menu-group-context-mode-toggle'));

    expect(groupCheckbox().checked).toBe(true);
    fireEvent.click(groupCheckbox());

    expect(props.onToggleSkill).toHaveBeenCalledTimes(3);
    expect(props.onToggleSkill).toHaveBeenCalledWith('ctx-a', false);
  });

  it('keeps a group expanded for the session after the menu is closed and opened again', async () => {
    renderToolsMenu();
    await openSkillsColumn();
    fireEvent.click(screen.getByTestId('attach-menu-group-context-mode-toggle'));
    expect(screen.getByTestId('attach-skill-ctx-a')).toBeTruthy();

    cleanup();
    renderToolsMenu();
    await openSkillsColumn();

    expect(screen.getByTestId('attach-menu-group-context-mode-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('attach-skill-ctx-a')).toBeTruthy();
  });
});

describe('PluginGroup', () => {
  beforeEach(() => {
    resetPluginGroupExpansion();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the name with its full text as tooltip and toggles aria-expanded on click', () => {
    render(
      <PluginGroup groupKey='skills:demo' testId='group-demo' name='Demo Plugin' countLabel='2 skill'>
        <div data-testid='member'>member</div>
      </PluginGroup>
    );
    const toggle = screen.getByTestId('group-demo-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('member')).toBeNull();
    expect(screen.getByTitle('Demo Plugin')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('member')).toBeTruthy();
  });

  it('renders no checkbox when no check is given', () => {
    render(
      <PluginGroup groupKey='hooks:demo' testId='group-plain' name='Plain' countLabel='1 hook'>
        <span>item</span>
      </PluginGroup>
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('groupCheckState', () => {
  it('reads checked, indeterminate and unchecked from the members', () => {
    expect(groupCheckState([])).toBe('unchecked');
    expect(groupCheckState([false, false])).toBe('unchecked');
    expect(groupCheckState([true, false])).toBe('indeterminate');
    expect(groupCheckState([true, true])).toBe('checked');
  });
});

describe('plugin hook groups', () => {
  const hook = (id: string, pluginId: string | undefined, command: string): HookSettingsRow =>
    ({
      id,
      source: pluginId === undefined ? 'user' : 'package',
      pluginId,
      event: 'PreToolUse',
      matcher: 'Bash',
      command,
      active: true,
    }) as unknown as HookSettingsRow;

  const hooks = [
    hook('p1', 'context-mode', 'ctx hook one'),
    hook('p2', 'context-mode', 'ctx hook two'),
    hook('u1', undefined, 'my own hook'),
  ];

  beforeEach(() => {
    resetPluginGroupExpansion();
  });

  afterEach(() => {
    cleanup();
  });

  it('lists standalone hooks flat and collapses each plugin group by default', async () => {
    render(<HookMenuList hooks={hooks} packageNames={new Map([['context-mode', 'Context Mode']])} />);

    expect(screen.getByTestId('attach-hook-u1')).toBeTruthy();
    expect(screen.queryByTestId('attach-hook-p1')).toBeNull();

    const toggle = screen.getByTestId('attach-hook-group-context-mode-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Context Mode');
    expect(toggle.textContent).toContain('2 hook');

    fireEvent.click(toggle);
    expect(screen.getByTestId('attach-hook-p1')).toBeTruthy();
    expect(screen.getByTestId('attach-hook-p2')).toBeTruthy();
  });
});
