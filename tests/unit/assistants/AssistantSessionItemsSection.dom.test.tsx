/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';

vi.mock('@arco-design/web-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arco-design/web-react')>()),
  Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

const servers: Partial<IMcpServer>[] = [
  { id: 'srv-pkg-1', name: 'Search One', enabled: true, extension: { name: 'web-pack', displayName: 'Web Pack' } },
  { id: 'srv-pkg-2', name: 'Search Two', enabled: false, extension: { name: 'web-pack', displayName: 'Web Pack' } },
  { id: 'srv-solo', name: 'Solo Tool', enabled: true },
];

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: vi.fn(async () => ({ allServers: servers })),
}));

import AssistantSessionItemsSection, {
  groupPluginServers,
  hookOptionLabel,
  toggleId,
} from '@/renderer/pages/settings/AssistantSettings/AssistantSessionItemsSection';
import { useAssistantSessionApply } from '@/renderer/hooks/assistant/useAssistantSessionApply';

const HOOK_ON = 'f'.repeat(64);
const HOOK_OFF = '0'.repeat(64);

const installHookBridge = (
  rows: Array<{ id: string; event: string; command: string; active: boolean; approved: boolean }>
) => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    hookSettings: {
      list: vi.fn(async () => ({ ok: true, data: { hooks: rows, switches: {} } })),
    },
  };
};

describe('groupPluginServers and helpers', () => {
  it('clusters servers by package and keeps standalone servers apart', () => {
    const grouped = groupPluginServers(servers as IMcpServer[]);
    expect(grouped.clusters.map((cluster) => cluster.label)).toEqual(['Web Pack']);
    expect(grouped.clusters[0]?.servers.map((server) => server.id)).toEqual(['srv-pkg-1', 'srv-pkg-2']);
    expect(grouped.standalone.map((server) => server.id)).toEqual(['srv-solo']);
  });

  it('toggles ids without duplicates and shortens long hook labels', () => {
    expect(toggleId(['a'], 'a', true)).toEqual(['a']);
    expect(toggleId(['a', 'b'], 'a', false)).toEqual(['b']);
    const label = hookOptionLabel({ event: 'PreToolUse', command: 'x'.repeat(300) });
    expect(label.length).toBeLessThanOrEqual(120);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('AssistantSessionItemsSection', () => {
  beforeEach(() => {
    installHookBridge([
      { id: HOOK_ON, event: 'PreToolUse', command: 'check.sh', active: true, approved: true },
      { id: HOOK_OFF, event: 'Stop', command: 'notify.sh', active: false, approved: false },
    ]);
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows package clusters, an Other group for standalone plugins, and hook status', async () => {
    render(
      <AssistantSessionItemsSection
        selectedPlugins={[]}
        setSelectedPlugins={vi.fn()}
        selectedHooks={[]}
        setSelectedHooks={vi.fn()}
      />
    );
    expect(await screen.findByTestId('plugin-cluster-web-pack')).toBeTruthy();
    expect(screen.getByTestId('plugin-cluster-other')).toBeTruthy();
    expect(screen.getByTestId(`hook-option-${HOOK_OFF}`).textContent).toContain('Needs approval');
    expect(screen.getByTestId(`plugin-option-srv-pkg-2`).textContent).toContain('Off');
  });

  it('reports selections for plugins and hooks through the setters', async () => {
    const setSelectedPlugins = vi.fn();
    const setSelectedHooks = vi.fn();
    render(
      <AssistantSessionItemsSection
        selectedPlugins={[]}
        setSelectedPlugins={setSelectedPlugins}
        selectedHooks={[]}
        setSelectedHooks={setSelectedHooks}
      />
    );
    const user = userEvent.setup();
    await user.click(await screen.findByText('Solo Tool'));
    expect(setSelectedPlugins).toHaveBeenCalledWith(['srv-solo']);
    await user.click(screen.getByText(/PreToolUse/u));
    expect(setSelectedHooks).toHaveBeenCalledWith([HOOK_ON]);
  });
});

describe('useAssistantSessionApply', () => {
  beforeEach(() => {
    installHookBridge([{ id: HOOK_ON, event: 'PreToolUse', command: 'check.sh', active: true, approved: true }]);
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('plans once per selected assistant and announces unavailable items', async () => {
    const onApply = vi.fn();
    const assistant = {
      id: 'research',
      enabled_skills: ['web-search'],
      custom_skill_names: [],
      enabled_plugins: ['srv-solo', 'srv-missing'],
      enabled_hooks: [HOOK_ON, HOOK_OFF],
    } as never;
    const { result } = renderHook(() =>
      useAssistantSessionApply({
        assistant,
        plugins: [{ id: 'srv-solo', enabled: true }],
        skillNames: ['web-search'],
        ready: true,
        onApply,
      })
    );
    await waitFor(() => expect(result.current.notices.length).toBe(2));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({
      skills: ['web-search'],
      pluginIds: ['srv-solo'],
      hookIds: [HOOK_ON],
    });
    expect(result.current.hookIds).toEqual([HOOK_ON]);
    await act(async () => {});
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an assistant or before the catalogs are ready', async () => {
    const onApply = vi.fn();
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useAssistantSessionApply({
          assistant: {
            id: 'a',
            enabled_skills: [],
            custom_skill_names: [],
            enabled_plugins: [],
            enabled_hooks: [],
          } as never,
          plugins: [],
          skillNames: [],
          ready,
          onApply,
        }),
      { initialProps: { ready: false } }
    );
    await act(async () => {});
    expect(onApply).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(result.current.notices).toEqual([]);
  });
});
