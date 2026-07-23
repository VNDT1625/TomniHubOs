/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';

const mocks = vi.hoisted(() => ({
  listExtensionServers: vi.fn(async (): Promise<IMcpServer[]> => []),
  ensureCatalog: vi.fn(async () => ({ userServers: [], builtinServers: [], allServers: [] as IMcpServer[] })),
  getConfig: vi.fn(),
  setConfig: vi.fn(async () => {
    throw new Error('legacy settings route unavailable');
  }),
  setLocalConfig: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    mcpService: { listExtensionServers: { invoke: mocks.listExtensionServers } },
  },
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: mocks.getConfig,
    set: mocks.setConfig,
    setLocal: mocks.setLocalConfig,
  },
}));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: mocks.ensureCatalog,
}));

import { useMcpServers } from '@/renderer/hooks/mcp/useMcpServers';

const server: IMcpServer = {
  id: 'native-server',
  name: 'Native Server',
  enabled: true,
  transport: { type: 'stdio', command: 'native-mcp' },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useMcpServers native persistence boundary', () => {
  it('updates the renderer cache without calling the legacy settings endpoint', async () => {
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));

    await act(async () => {
      await expect(result.current.saveMcpServers([server])).resolves.toBeUndefined();
    });

    expect(result.current.mcpServers).toEqual([server]);
    expect(mocks.setLocalConfig).toHaveBeenCalledWith('mcp.config', [server]);
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });
});
