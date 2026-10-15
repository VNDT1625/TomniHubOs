/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const mocks = vi.hoisted(() => ({
  packageList: vi.fn(),
  connectionsList: vi.fn(),
  setPackageEnabled: vi.fn(),
  listServers: vi.fn(),
  listSkills: vi.fn(),
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

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: { listServers: { invoke: mocks.listServers } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      typeof options?.defaultValue === 'string' ? options.defaultValue : key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({ useConversationContextSafe: () => undefined }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@/renderer/services/FileService', () => ({ FileService: { processDroppedFiles: vi.fn() } }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('@/renderer/components/skills/SkillDocumentModal', () => ({ SkillDocumentModal: () => null }));

import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import { requestPluginEnable } from '@/renderer/components/media/attachMenu/useInstalledPlugins';

const PACKAGE = 'com.community.context-mode';
const SERVER = `pkgconn:${PACKAGE}:context-mode-source`;

const packageRows = [{ manifest: { id: PACKAGE, name: 'Context Mode' }, state: 'installed' }];
const connectionViews = [
  { key: 'mcp:context-mode-source', kind: 'mcp', title: 'context-mode', enabled: false, status: 'off', runsCode: true },
];

const renderButton = (openFileSelector: () => void = vi.fn()): void => {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FileAttachButton openFileSelector={openFileSelector} loadedMcpStatuses={[]} />
    </SWRConfig>
  );
};

const openPluginColumn = async (): Promise<void> => {
  await settle();
  fireEvent.click(screen.getByTestId('tomnyagentic-attach-folder-btn'));
  await screen.findByTestId('attach-menu');
  fireEvent.click(screen.getByTestId('attach-category-mcp'));
  await screen.findByTestId('attach-menu-panel');
};

/** Lets pending SWR loads settle, then the plain button path (no plugin entries) is the one that renders. */
const settle = async (): Promise<void> => {
  await waitFor(() => expect(mocks.connectionsList).toHaveBeenCalled());
  await waitFor(() => expect(mocks.listServers).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  mocks.packageList.mockResolvedValue(packageRows);
  mocks.listSkills.mockResolvedValue([]);
  mocks.listServers.mockResolvedValue([]);
  mocks.connectionsList.mockResolvedValue({ ok: true, data: connectionViews });
  mocks.setPackageEnabled.mockResolvedValue({
    ok: true,
    data: { enabled: [], stayedOff: [{ key: 'mcp:context-mode-source', reason: 'Not approved yet.' }] },
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    packageConnections: { list: mocks.connectionsList, setPackageEnabled: mocks.setPackageEnabled },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('FileAttachButton Plugin column with installed plugins', () => {
  it('lists an installed plugin that is off under its package and counts it in Plugin', async () => {
    renderButton();
    await openPluginColumn();
    expect(screen.getByTestId('attach-category-mcp').textContent).toContain('· 1');

    const row = await screen.findByTestId(`attach-mcp-${SERVER}`);
    expect(row.textContent).toContain('context-mode');
    expect(row.textContent).toContain('Off');
    expect(screen.getByTestId(`attach-menu-group-${PACKAGE}`).textContent).toContain('Context Mode');
  });

  it('picking an off plugin turns its package on, shows the refusal and notifies the Hub', async () => {
    const dispatched = vi.fn();
    window.addEventListener('tomni-packages-changed', dispatched);
    try {
      renderButton();
      await openPluginColumn();
      fireEvent.click(await screen.findByTestId(`attach-mcp-${SERVER}`));

      await waitFor(() => expect(mocks.setPackageEnabled).toHaveBeenCalledTimes(1));
      expect(mocks.setPackageEnabled).toHaveBeenCalledWith({ packageId: PACKAGE, enabled: true });
      await waitFor(() => expect(dispatched).toHaveBeenCalled());
      expect(mocks.warning).toHaveBeenCalledWith('Not approved yet.');
    } finally {
      window.removeEventListener('tomni-packages-changed', dispatched);
    }
  });

  it('does not list a plugin whose server is already in the catalog as off', async () => {
    mocks.listServers.mockResolvedValue([
      { id: SERVER, name: 'context-mode', extension: { name: `package:${PACKAGE}` } },
    ]);
    const openFileSelector = vi.fn();
    renderButton(openFileSelector);
    await settle();

    // Nothing to list (the server is in the catalog and not attached to this chat), so the plain button renders.
    fireEvent.click(screen.getByTestId('tomnyagentic-attach-folder-btn'));
    expect(openFileSelector).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('attach-menu')).toBeNull();
  });

  it('does not list installed plugins before the catalog has loaded', async () => {
    mocks.listServers.mockReturnValue(new Promise(() => undefined));
    const openFileSelector = vi.fn();
    renderButton(openFileSelector);
    await settle();

    fireEvent.click(screen.getByTestId('tomnyagentic-attach-folder-btn'));
    expect(openFileSelector).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`attach-mcp-${SERVER}`)).toBeNull();
  });
});

describe('requestPluginEnable', () => {
  it('reports unavailable when the package bridge is missing', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    await expect(requestPluginEnable(PACKAGE)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('reports the failure code when the package switch refuses', async () => {
    mocks.setPackageEnabled.mockResolvedValue({ ok: false, error: 'PACKAGE_BLOCKED' });
    await expect(requestPluginEnable(PACKAGE)).resolves.toEqual({ kind: 'failed', code: 'PACKAGE_BLOCKED' });
  });
});
