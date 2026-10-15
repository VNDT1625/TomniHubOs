/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigProvider } from '@arco-design/web-react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GuidActionRow from '@/renderer/pages/guid/components/GuidActionRow';
import { ATTACH_MENU_TRIGGER } from '@/renderer/components/media/attachMenu/attachMenuModel';

const mocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  packageList: vi.fn(),
}));

vi.mock('@/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common')>();
  return {
    ...actual,
    ipcBridge: {
      ...actual.ipcBridge,
      fs: { ...actual.ipcBridge.fs, listAvailableSkills: { invoke: mocks.listAvailableSkills } },
      packagePlatform: { ...actual.ipcBridge.packagePlatform, list: { invoke: mocks.packageList } },
    },
  };
});

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
}));

vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid='markdown-body'>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const base = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return base.replace('{{count}}', String(options?.count ?? '')).replace('{{name}}', String(options?.name ?? ''));
    },
    i18n: { language: 'en-US' },
  }),
}));

type ActionRowProps = React.ComponentProps<typeof GuidActionRow>;

const SKILL_DOC = '---\nname: ctx-skill\ndescription: Package skill\n---\n# Package body';

const skillIndex = [
  {
    name: 'ctx-skill',
    description: 'Package skill',
    location: '/x',
    is_custom: false,
    source: 'package',
    packageId: 'context-mode',
  },
  { name: 'my-skill', description: 'Standalone skill', location: '/y', is_custom: true, source: 'custom' },
];
const packageRows = [{ manifest: { id: 'context-mode', name: 'Context Mode' } }];

const allSkills: ActionRowProps['allSkills'] = [
  { name: 'ctx-skill', description: 'Package skill', isAuto: false },
  { name: 'my-skill', description: 'Standalone skill', isAuto: false },
];

const mcpServers = [
  {
    id: 'pkgconn:context-mode:main',
    name: 'Context Mode MCP',
    extension: { name: 'package:context-mode' },
  },
  { id: 'my-mcp-id', name: 'My MCP' },
] as unknown as ActionRowProps['mcpServers'];

const renderRow = (overrides: Partial<ActionRowProps> = {}) => {
  const onToggleSkill = vi.fn();
  const onToggleMcpServer = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConfigProvider>
        <GuidActionRow
          variant='default'
          files={[]}
          onFilesUploaded={vi.fn()}
          modelSelectorNode={null}
          selectedAgent='tomnyagentic'
          selectedMode='default'
          onModeSelect={vi.fn()}
          is_presetAgent={false}
          selectedAgentInfo={undefined}
          assistants={[]}
          localeKey='en-US'
          onClosePresetTag={vi.fn()}
          allSkills={allSkills}
          disabledBuiltinSkills={[]}
          enabledSkills={['my-skill']}
          onToggleSkill={onToggleSkill}
          mcpServers={mcpServers}
          selectedMcpServerIds={['my-mcp-id']}
          onToggleMcpServer={onToggleMcpServer}
          loading={false}
          isButtonDisabled={false}
          onSend={vi.fn()}
          {...overrides}
        />
      </ConfigProvider>
    </SWRConfig>
  );
  return { onToggleSkill, onToggleMcpServer };
};

const openFromPlus = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getByTestId('file-upload-btn'));
  return screen.findByTestId('attach-menu');
};

const readDocument = (): ReturnType<typeof vi.fn> =>
  (window as unknown as { electronAPI: { skillDocuments: { read: ReturnType<typeof vi.fn> } } }).electronAPI
    .skillDocuments.read;

beforeEach(() => {
  mocks.listAvailableSkills.mockResolvedValue(skillIndex);
  mocks.packageList.mockResolvedValue(packageRows);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    skillDocuments: {
      read: vi.fn(async () => ({
        ok: true,
        data: { name: 'ctx-skill', description: 'Package skill', packageId: 'context-mode', content: SKILL_DOC },
      })),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GuidActionRow tools menu placement and interaction', () => {
  it('opens upward on click only, from both the plus and the more button, and keeps file actions', async () => {
    expect(ATTACH_MENU_TRIGGER).toMatchObject({
      position: 'tl',
      trigger: 'click',
      clickToClose: true,
      autoFitPosition: true,
    });
    renderRow();
    fireEvent.mouseEnter(screen.getByTestId('file-upload-btn'));
    expect(screen.queryByTestId('attach-menu')).toBeNull();
    await openFromPlus();
    expect(screen.getByTestId('attach-add-files')).toBeTruthy();
    expect(screen.getByTestId('attach-my-device')).toBeTruthy();
    expect(screen.getByTestId('attach-category-skills').textContent).toContain('(1/2)');
    expect(screen.getByTestId('attach-category-mcp').textContent).toContain('(1/2)');
    expect(screen.queryByTestId('attach-menu-panel')).toBeNull();
  });

  it('opens the same menu from the hub more button', async () => {
    renderRow({ variant: 'hub' });
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.shell.more' }));
    expect(await screen.findByTestId('attach-menu')).toBeTruthy();
    expect(screen.getByTestId('attach-category-skills')).toBeTruthy();
  });

  it('opens Skills as a second column beside the main menu and switches columns on click', async () => {
    renderRow();
    await openFromPlus();
    fireEvent.click(screen.getByTestId('attach-category-skills'));
    expect((await screen.findByTestId('attach-menu-panel')).getAttribute('data-category')).toBe('skills');
    expect(screen.getByTestId('attach-category-mcp')).toBeTruthy();
    expect(screen.getByTestId('attach-add-files')).toBeTruthy();

    fireEvent.click(screen.getByTestId('attach-category-mcp'));
    expect(screen.getByTestId('attach-menu-panel').getAttribute('data-category')).toBe('mcp');
    expect(screen.getByTestId('attach-category-skills')).toBeTruthy();
  });

  it('clusters package items under the package name and keeps standalone items under Other', async () => {
    renderRow();
    await openFromPlus();
    fireEvent.click(screen.getByTestId('attach-category-skills'));
    const group = await screen.findByTestId('attach-menu-group-context-mode');
    expect(within(group).getByText('Context Mode')).toBeTruthy();
    expect(group.textContent).toMatch(/1 plugin\s+·\s+1 skill/);
    expect(within(group).getByTestId('attach-skill-ctx-skill')).toBeTruthy();

    expect(screen.getByTestId('attach-menu-other-label').textContent).toBe('Other');
    const standalone = screen.getByTestId('attach-skill-my-skill');
    expect(standalone.closest('[data-testid^="attach-menu-group-"]')).toBeNull();
  });

  it('calls the toggle callbacks with the same arguments from rows and checkboxes', async () => {
    const { onToggleSkill, onToggleMcpServer } = renderRow();
    await openFromPlus();
    fireEvent.click(screen.getByTestId('attach-category-skills'));

    fireEvent.click(await screen.findByTestId('attach-skill-toggle-my-skill'));
    expect(onToggleSkill).toHaveBeenCalledTimes(1);
    expect(onToggleSkill).toHaveBeenLastCalledWith('my-skill', false);

    fireEvent.click(within(screen.getByTestId('attach-skill-ctx-skill')).getByRole('checkbox'));
    expect(onToggleSkill).toHaveBeenCalledTimes(2);
    expect(onToggleSkill).toHaveBeenLastCalledWith('ctx-skill', false);

    fireEvent.click(screen.getByTestId('attach-category-mcp'));
    fireEvent.click(await screen.findByTestId('attach-mcp-my-mcp-id'));
    expect(onToggleMcpServer).toHaveBeenCalledTimes(1);
    expect(onToggleMcpServer).toHaveBeenLastCalledWith('my-mcp-id');
  });

  it('selects every item of a package with one select-all row', async () => {
    const { onToggleSkill } = renderRow();
    await openFromPlus();
    fireEvent.click(screen.getByTestId('attach-category-skills'));
    fireEvent.click(await screen.findByTestId('attach-select-all-context-mode'));
    expect(onToggleSkill).toHaveBeenCalledTimes(1);
    expect(onToggleSkill).toHaveBeenLastCalledWith('ctx-skill', false);
  });

  it('labels the MCP column Plugin and tags MCP server rows', async () => {
    renderRow();
    await openFromPlus();
    expect(screen.getByTestId('attach-category-mcp').textContent).toContain('Plugin');
    fireEvent.click(screen.getByTestId('attach-category-mcp'));
    const serverRow = await screen.findByTestId('attach-mcp-my-mcp-id');
    expect(serverRow.textContent).toContain('MCP');
  });

  it('renders the Auto switch only when its toggle is provided and forwards the click', async () => {
    renderRow();
    await openFromPlus();
    expect(screen.queryByTestId('attach-auto-select')).toBeNull();
  });

  it('forwards the Auto switch click and hides manual lists plus shows the hint when autoSelect is on', async () => {
    const onToggleAutoSelect = vi.fn();
    renderRow({ onToggleAutoSelect });
    await openFromPlus();
    fireEvent.click(screen.getByTestId('attach-auto-select'));
    expect(onToggleAutoSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('attach-auto-hint')).toHaveTextContent('Turn on to let Laya choose');
    cleanup();

    renderRow({ onToggleAutoSelect, autoSelect: true });
    await openFromPlus();
    expect(screen.getByTestId('attach-auto-hint').textContent).toContain('Laya will pick');
    expect(screen.queryByTestId('attach-category-skills')).toBeNull();
    expect(screen.queryByTestId('attach-category-mcp')).toBeNull();
    expect(screen.getByTestId('attach-add-files')).toBeTruthy();
  });


  it('opens the read-only viewer from Xem without toggling the skill', async () => {
    const { onToggleSkill } = renderRow();
    await openFromPlus();
    fireEvent.click(screen.getByTestId('attach-category-skills'));
    const view = await screen.findByTestId('attach-skill-view-ctx-skill');
    await act(async () => {
      fireEvent.click(view);
    });
    expect(onToggleSkill).not.toHaveBeenCalled();
    expect(readDocument()).toHaveBeenCalledWith({ name: 'ctx-skill', packageId: 'context-mode' });
    const modal = await screen.findByTestId('skill-document-modal');
    expect(modal.textContent).toContain('Package: Context Mode');
    await waitFor(() => expect(screen.getByTestId('markdown-body').textContent).toContain('# Package body'));
  });
});
