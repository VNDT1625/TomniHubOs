import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/common/types/agent/liveSessions', () => ({
  liveSessionsChannels: { report: { invoke: mocks.invoke } },
}));

import { useReportLiveSessions } from '@/renderer/hooks/useReportLiveSessions';

const session = (id: string, status: 'idle' | 'working' = 'idle') => ({ id, title: id, status }) as const;

describe('useReportLiveSessions', () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(true);
  });

  it('reports the sessions on mount and again only when they change', () => {
    const { rerender } = renderHook(({ list }) => useReportLiveSessions('com.tomni.design-studio', list), {
      initialProps: { list: [session('a')] },
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenLastCalledWith({ appId: 'com.tomni.design-studio', sessions: [session('a')] });

    rerender({ list: [session('a')] });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    rerender({ list: [session('a'), session('b', 'working')] });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('removes the app from Active when the screen unmounts', () => {
    const { unmount } = renderHook(() => useReportLiveSessions('com.tomni.design-studio', [session('a')]));
    mocks.invoke.mockClear();
    unmount();
    expect(mocks.invoke).toHaveBeenCalledWith({ appId: 'com.tomni.design-studio', sessions: [] });
  });

  it('sends announced actions, re-sends when they change, and unmounts without them', () => {
    type Actions = { create?: true; close?: true };
    const { rerender, unmount } = renderHook(
      ({ actions }: { actions?: Actions }) => useReportLiveSessions('com.tomni.notes', [session('a')], actions),
      { initialProps: { actions: { create: true } as Actions } }
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith({
      appId: 'com.tomni.notes',
      sessions: [session('a')],
      actions: { create: true },
    });
    rerender({ actions: { create: true } });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    rerender({ actions: { create: true, close: true } });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    unmount();
    const last = mocks.invoke.mock.calls.at(-1)?.[0];
    expect(last).toEqual({ appId: 'com.tomni.notes', sessions: [] });
    expect(last).not.toHaveProperty('actions');
  });

  it('swallows a failing report instead of raising it to the app', async () => {
    mocks.invoke.mockRejectedValue(new Error('main unavailable'));
    expect(() => renderHook(() => useReportLiveSessions('com.tomni.design-studio', [session('a')]))).not.toThrow();
    await Promise.resolve();
  });
});
