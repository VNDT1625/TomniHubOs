/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const mocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  packageList: vi.fn(),
  listServers: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { listAvailableSkills: { invoke: mocks.listAvailableSkills } },
    packagePlatform: { list: { invoke: mocks.packageList } },
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: { listServers: { invoke: mocks.listServers } },
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

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({ useConversationContextSafe: () => undefined }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@/renderer/services/FileService', () => ({ FileService: { processDroppedFiles: vi.fn() } }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: mocks.emit } }));
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid='markdown-body'>{children}</div>,
}));

import FileAttachButton, {
  ATTACH_MENU_TRIGGER,
  buildAttachMenuModel,
  packageIdOfMcp,
} from '@/renderer/components/media/FileAttachButton';

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
const servers = [
  { id: 'pkgconn:context-mode:main', name: 'Context Mode MCP', extension: { name: 'package:context-mode' } },
  { id: 'my-mcp-id', name: 'My MCP' },
];

const renderButton = (): void => {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FileAttachButton
        openFileSelector={vi.fn()}
        loadedSkills={['ctx-skill', 'my-skill']}
        loadedMcpStatuses={[
          { id: 'pkgconn:context-mode:main', name: 'Context Mode MCP', status: 'loaded' },
          { id: 'my-mcp-id', name: 'My MCP', status: 'loaded' },
        ]}
      />
    </SWRConfig>
  );
};

const openMenu = async (): Promise<void> => {
  fireEvent.click(screen.getByTestId('tomnyagentic-attach-folder-btn'));
  await screen.findByTestId('attach-menu');
};

beforeEach(() => {
  mocks.listAvailableSkills.mockResolvedValue(skillIndex);
  mocks.packageList.mockResolvedValue(packageRows);
  mocks.listServers.mockResolvedValue(servers);
  mocks.emit.mockClear();
  const readDocument = vi.fn(async () => ({
    ok: true,
    data: { name: 'ctx-skill', description: 'Package skill', packageId: 'context-mode', content: SKILL_DOC },
  }));
  (window as unknown as { electronAPI: unknown }).electronAPI = { skillDocuments: { read: readDocument } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FileAttachButton menu placement and interaction', () => {
  it('opens upward on click and stays closed on hover', async () => {
    expect(ATTACH_MENU_TRIGGER).toMatchObject({
      position: 'tl',
      trigger: 'click',
      clickToClose: true,
      autoFitPosition: true,
    });
    renderButton();
    expect(screen.queryByTestId('attach-menu')).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('tomnyagentic-attach-folder-btn'));
    expect(screen.queryByTestId('attach-menu')).toBeNull();
    await openMenu();
    expect(screen.getByTestId('attach-category-mcp').textContent).toContain('· 2');
    expect(screen.getByTestId('attach-category-skills').textContent).toContain('· 2');
    expect(screen.queryByTestId('attach-menu-panel')).toBeNull();
  });

  it('opens the MCP column beside the main menu and switches it without hiding the main menu', async () => {
    renderButton();
    await openMenu();
    fireEvent.click(screen.getByTestId('attach-category-mcp'));
    const panel = await screen.findByTestId('attach-menu-panel');
    expect(panel.getAttribute('data-category')).toBe('mcp');
    expect(screen.getByTestId('attach-open-mcp-settings')).toBeTruthy();
    expect(screen.getByTestId('attach-category-skills')).toBeTruthy();

    fireEvent.click(screen.getByTestId('attach-category-skills'));
    expect(screen.getByTestId('attach-menu-panel').getAttribute('data-category')).toBe('skills');
    expect(screen.getByTestId('attach-category-mcp')).toBeTruthy();
    expect(screen.getByTestId('attach-category-skills')).toBeTruthy();
  });

  it('groups package items under the package and keeps standalone items as flat rows outside any group', async () => {
    renderButton();
    await openMenu();
    fireEvent.click(screen.getByTestId('attach-category-mcp'));
    const group = await screen.findByTestId('attach-menu-group-context-mode');
    expect(within(group).getByText('Context Mode')).toBeTruthy();
    expect(group.textContent).toMatch(/1 plugin\s+·\s+1 skill/);
    expect(within(group).getByTestId('attach-mcp-pkgconn:context-mode:main')).toBeTruthy();

    // Standalone MCP stays flat: not inside any package group, and not renamed or hidden.
    const standalone = screen.getByTestId('attach-mcp-my-mcp-id');
    expect(standalone.closest('[data-testid^="attach-menu-group-"]')).toBeNull();
    expect(standalone.textContent).toContain('My MCP');

    fireEvent.click(screen.getByTestId('attach-category-skills'));
    const skillGroup = await screen.findByTestId('attach-menu-group-context-mode');
    expect(within(skillGroup).getByTestId('attach-skill-ctx-skill')).toBeTruthy();
    expect(screen.getByTestId('attach-skill-my-skill').closest('[data-testid^="attach-menu-group-"]')).toBeNull();
  });

  it('collapses and expands a package group', async () => {
    renderButton();
    await openMenu();
    fireEvent.click(screen.getByTestId('attach-category-skills'));
    const toggle = await screen.findByTestId('attach-menu-group-toggle-context-mode');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('attach-skill-ctx-skill')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('attach-skill-ctx-skill')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('attach-skill-ctx-skill')).toBeTruthy();
  });

  it('opens the read-only viewer from the Xem action without filling the sendbox', async () => {
    renderButton();
    await openMenu();
    fireEvent.click(screen.getByTestId('attach-category-skills'));
    const view = await screen.findByTestId('attach-skill-view-ctx-skill');
    await act(async () => {
      fireEvent.click(view);
    });
    expect(mocks.emit).not.toHaveBeenCalled();
    const bridge = (window as unknown as { electronAPI: { skillDocuments: { read: ReturnType<typeof vi.fn> } } })
      .electronAPI.skillDocuments.read;
    expect(bridge).toHaveBeenCalledWith({ name: 'ctx-skill', packageId: 'context-mode' });
    const modal = await screen.findByTestId('skill-document-modal');
    expect(modal.textContent).toContain('Package: Context Mode');
    await waitFor(() => expect(screen.getByTestId('markdown-body').textContent).toContain('# Package body'));
    expect(screen.getByTestId('markdown-body').textContent).not.toContain('description: Package skill');
  });

  it('shows the Auto switch when a toggle is given and hides the manual lists while auto is on', async () => {
    const onToggleAutoSelect = vi.fn();
    const tree = (autoSelect: boolean) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FileAttachButton
          openFileSelector={vi.fn()}
          loadedSkills={['ctx-skill', 'my-skill']}
          loadedMcpStatuses={[{ id: 'my-mcp-id', name: 'My MCP', status: 'loaded' }]}
          autoSelect={autoSelect}
          onToggleAutoSelect={onToggleAutoSelect}
        />
      </SWRConfig>
    );
    const { rerender } = render(tree(false));
    await openMenu();
    fireEvent.click(screen.getByTestId('attach-auto-select'));
    expect(onToggleAutoSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('attach-category-mcp')).toBeTruthy();

    rerender(tree(true));
    expect(screen.getByTestId('attach-auto-hint').textContent).toContain('Laya will pick');
    expect(screen.queryByTestId('attach-category-mcp')).toBeNull();
    expect(screen.queryByTestId('attach-category-skills')).toBeNull();
  });


  it('still fills the sendbox when the skill row body is clicked', async () => {
    renderButton();
    await openMenu();
    fireEvent.click(screen.getByTestId('attach-category-skills'));
    fireEvent.click(await screen.findByText('my-skill'));
    expect(mocks.emit).toHaveBeenCalledWith('sendbox.fill', '/my-skill ');
  });
});

describe('FileAttachButton model helpers', () => {
  it('reads the owning package from connection ids and from extension provenance only', () => {
    expect(packageIdOfMcp({ id: 'pkgconn:context-mode:main', name: 'x', status: 'loaded' })).toBe('context-mode');
    expect(
      packageIdOfMcp({ id: 'legacy', name: 'Legacy', status: 'loaded' }, [
        { id: 'legacy', name: 'Legacy', extension: { name: 'package:tool-pack' } } as never,
      ])
    ).toBe('tool-pack');
    expect(packageIdOfMcp({ id: 'user-made', name: 'User made', status: 'loaded' }, [])).toBeUndefined();
  });

  it('keeps standalone entries out of package clusters', () => {
    const model = buildAttachMenuModel(
      [{ item: { id: 'a', name: 'A', status: 'loaded' } }],
      [{ name: 'solo' }, { name: 'packed', packageId: 'pk' }],
      new Map([['pk', 'Pack']])
    );
    expect(model.standalone.skills.map((skill) => skill.name)).toEqual(['solo']);
    expect(model.standalone.mcp).toHaveLength(1);
    expect(model.packages).toEqual([
      { packageId: 'pk', name: 'Pack', mcp: [], skills: [{ name: 'packed', packageId: 'pk' }] },
    ]);
  });
});
