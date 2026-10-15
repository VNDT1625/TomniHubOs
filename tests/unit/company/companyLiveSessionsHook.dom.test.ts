import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  runs: [] as unknown[],
  listeners: new Set<() => void>(),
}));

vi.mock('@/common/types/agent/liveSessions', () => ({
  liveSessionsChannels: { report: { invoke: mocks.invoke } },
}));
vi.mock('@package-apps/company/renderer/company/useCompanyPipeline', () => ({
  listCompanyRuns: () => mocks.runs,
  subscribeCompanyRuns: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));

const runningRun = (companyId: string) => ({
  companyId,
  snapshot: { phase: 'running', states: { r1: { updatedAt: 5, task: 'Build' } }, pending: [] },
});

const load = async () => {
  vi.resetModules();
  return import('@package-apps/company/renderer/company/useCompanyLiveSessions');
};

const lastReport = (): { appId: string; sessions: Array<{ id: string }> } | undefined =>
  mocks.invoke.mock.calls.at(-1)?.[0];

describe('useCompanyLiveSessions', () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(true);
    mocks.runs = [];
    mocks.listeners.clear();
  });

  it('reports the running company runs and follows later changes', async () => {
    const { useCompanyLiveSessions } = await load();
    mocks.runs = [runningRun('acme')];
    renderHook(() => useCompanyLiveSessions());
    expect(lastReport()).toEqual({
      appId: 'com.tomni.company',
      sessions: [
        { id: 'acme', title: 'acme', status: 'working', icon: 'building', lastActiveAt: 5, detail: 'Build' },
      ],
    });

    mocks.runs = [runningRun('acme'), runningRun('globex')];
    for (const listener of mocks.listeners) listener();
    expect(lastReport()?.sessions.map((session) => session.id)).toEqual(['acme', 'globex']);
  });

  it('keeps a run listed after the Company page unmounts, because the run itself keeps going', async () => {
    const { useCompanyLiveSessions } = await load();
    mocks.runs = [runningRun('acme')];
    const view = renderHook(() => useCompanyLiveSessions());
    mocks.invoke.mockClear();

    view.unmount();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(1);

    mocks.runs = [];
    for (const listener of mocks.listeners) listener();
    expect(lastReport()).toEqual({ appId: 'com.tomni.company', sessions: [] });
  });

  it('subscribes only once however many times the page mounts', async () => {
    const { useCompanyLiveSessions } = await load();
    renderHook(() => useCompanyLiveSessions()).unmount();
    renderHook(() => useCompanyLiveSessions());
    expect(mocks.listeners.size).toBe(1);
  });

  it('does not resend an unchanged list and never raises a failed report', async () => {
    const { useCompanyLiveSessions } = await load();
    mocks.invoke.mockRejectedValue(new Error('main unavailable'));
    mocks.runs = [runningRun('acme')];
    expect(() => renderHook(() => useCompanyLiveSessions())).not.toThrow();
    const calls = mocks.invoke.mock.calls.length;
    for (const listener of mocks.listeners) listener();
    expect(mocks.invoke.mock.calls.length).toBe(calls);
  });
});
