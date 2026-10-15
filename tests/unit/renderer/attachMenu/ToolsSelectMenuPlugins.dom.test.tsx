/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const mocks = vi.hoisted(() => ({
  packageList: vi.fn(),
  listSkills: vi.fn(),
  connectionsList: vi.fn(),
  setPackageEnabled: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { warning: mocks.warning, error: mocks.error, info: vi.fn(), success: vi.fn() } };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { listAvailableSkills: { invoke: mocks.listSkills } },
    packagePlatform: { list: { invoke: mocks.packageList } },
  },
}));

vi.mock('@/renderer/components/skills/SkillDocumentModal', () => ({ SkillDocumentModal: () => null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      return typeof options?.defaultValue === 'string' ? options.defaultValue : key;
    },
    i18n: { language: 'en-US' },
  }),
}));

import ToolsSelectMenu from '@/renderer/components/media/attachMenu/ToolsSelectMenu';

const PACKAGE = 'com.community.context-mode';
const SERVER = `pkgconn:${PACKAGE}:context-mode-source`;

const packageRows = [{ manifest: { id: PACKAGE, name: 'Context Mode' }, state: 'installed' }];
const connectionViews = [
  { key: 'mcp:context-mode-source', kind: 'mcp', title: 'context-mode', enabled: false, status: 'off', runsCode: true },
  { key: 'hook:posttooluse-0', kind: 'hook', title: 'PostToolUse', enabled: false, status: 'off', runsCode: true },
];

const STDIO = { type: 'stdio', command: 'x' };

const renderMenu = (catalog: Array<{ id: string; name: string }>, selected: string[] = []) => {
  const onToggleMcpServer = vi.fn();
  const servers = catalog.map((server) => ({ ...server, enabled: true, transport: STDIO }));
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToolsSelectMenu
        allSkills={[]}
        disabledBuiltinSkills={[]}
        enabledSkills={[]}
        onToggleSkill={vi.fn()}
        mcpServers={servers as never}
        selectedMcpServerIds={selected}
        onToggleMcpServer={onToggleMcpServer}
        onAddFiles={vi.fn()}
      >
        <button data-testid='tools-trigger'>tools</button>
      </ToolsSelectMenu>
    </SWRConfig>
  );
  return { onToggleMcpServer };
};

const openPluginColumn = async (): Promise<void> => {
  fireEvent.click(screen.getByTestId('tools-trigger'));
  await screen.findByTestId('attach-menu');
  fireEvent.click(screen.getByTestId('attach-category-mcp'));
  await screen.findByTestId('attach-menu-panel');
};

beforeEach(() => {
  mocks.packageList.mockResolvedValue(packageRows);
  mocks.listSkills.mockResolvedValue([]);
  mocks.connectionsList.mockResolvedValue({ ok: true, data: connectionViews });
  mocks.setPackageEnabled.mockResolvedValue({
    ok: true,
    data: { enabled: [], stayedOff: [{ key: 'mcp:context-mode-source', reason: 'Bạn chưa duyệt.' }] },
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    packageConnections: { list: mocks.connectionsList, setPackageEnabled: mocks.setPackageEnabled },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ToolsSelectMenu Plugin column with installed plugins', () => {
  it('lists an installed plugin that is off, under its package name', async () => {
    renderMenu([]);
    await openPluginColumn();
    const row = await screen.findByTestId(`attach-mcp-${SERVER}`);
    expect(row.textContent).toContain('context-mode');
    expect(row.textContent).toContain('Off');
    expect(screen.getByTestId(`attach-menu-group-${PACKAGE}`).textContent).toContain('Context Mode');
    expect(screen.getByTestId('attach-category-mcp').textContent).toContain('(0/1)');
  });

  it('picking an off plugin turns its package on and reports a refusal', async () => {
    const dispatched = vi.fn();
    window.addEventListener('tomni-packages-changed', dispatched);
    renderMenu([]);
    await openPluginColumn();
    fireEvent.click(await screen.findByTestId(`attach-mcp-${SERVER}`));

    await waitFor(() => expect(mocks.setPackageEnabled).toHaveBeenCalledTimes(1));
    expect(mocks.setPackageEnabled).toHaveBeenCalledWith({ packageId: PACKAGE, enabled: true });
    await waitFor(() => expect(dispatched).toHaveBeenCalled());
    window.removeEventListener('tomni-packages-changed', dispatched);
    // The reason of the MCP connection that stayed off is shown, not swallowed.
    expect(mocks.warning).toHaveBeenCalledWith('Bạn chưa duyệt.');
  });

  it('a plugin that is on is attached like any server', async () => {
    mocks.connectionsList.mockResolvedValue({
      ok: true,
      data: [{ ...connectionViews[0], enabled: true, status: 'on' }],
    });
    const { onToggleMcpServer } = renderMenu([{ id: SERVER, name: 'context-mode' }]);
    await openPluginColumn();
    fireEvent.click(await screen.findByTestId(`attach-mcp-${SERVER}`));

    expect(onToggleMcpServer).toHaveBeenCalledWith(SERVER);
    expect(mocks.setPackageEnabled).not.toHaveBeenCalled();
    expect(screen.getByTestId('attach-category-mcp').textContent).toContain('(0/1)');
  });
});
