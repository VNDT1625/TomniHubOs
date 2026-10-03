/**
 * @vitest-environment jsdom
 */

import type { PackageContributionChangedEvent, PackageContributionState } from '@/common/packages';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type IdeExtensionsClient,
  useIdeExtensions,
} from '@package-apps/ide/renderer/hooks/extensions/useIdeExtensions';

const state = (revision: number, packageIds: string[] = []): PackageContributionState => ({
  snapshot: {
    revision,
    packageIds,
    apps: [],
    activityGroups: [],
    subtabs: [],
    commands: [],
    settings: [],
  },
  diagnostics: [],
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useIdeExtensions contribution updates', () => {
  it('subscribes to the dedicated Desktop revision event before loading current state', async () => {
    let listener: ((event: PackageContributionChangedEvent) => void) | undefined;
    const contributions = vi
      .fn()
      .mockResolvedValueOnce(state(1, ['pkg.alpha']))
      .mockResolvedValueOnce(state(2, []));
    const onContributionsChanged = vi.fn((next: (event: PackageContributionChangedEvent) => void) => {
      listener = next;
      return vi.fn();
    });
    const waitForContributions = vi.fn();
    const client = {
      contributionUpdateMode: () => 'push' as const,
      contributions,
      onContributionsChanged,
      waitForContributions,
    } satisfies IdeExtensionsClient;

    const hook = renderHook(() => useIdeExtensions(client));
    await waitFor(() => expect(hook.result.current.state?.snapshot.revision).toBe(1));
    expect(onContributionsChanged.mock.invocationCallOrder[0]).toBeLessThan(contributions.mock.invocationCallOrder[0]!);

    act(() => listener?.({ revision: 2 }));
    await waitFor(() => expect(hook.result.current.state?.snapshot.revision).toBe(2));
    expect(waitForContributions).not.toHaveBeenCalled();
  });

  it('continues Web waits after timeouts and applies install and uninstall revisions', async () => {
    const waits = [
      deferred<{ state: PackageContributionState; timedOut: boolean }>(),
      deferred<{ state: PackageContributionState; timedOut: boolean }>(),
      deferred<{ state: PackageContributionState; timedOut: boolean }>(),
      deferred<{ state: PackageContributionState; timedOut: boolean }>(),
    ];
    let waitIndex = 0;
    const waitForContributions = vi.fn((_afterRevision: number, _signal: AbortSignal) => waits[waitIndex++]!.promise);
    const contributions = vi.fn().mockResolvedValue(state(1, ['pkg.alpha']));
    const client = {
      contributionUpdateMode: () => 'long-poll' as const,
      contributions,
      onContributionsChanged: vi.fn(() => vi.fn()),
      waitForContributions,
    } satisfies IdeExtensionsClient;

    const hook = renderHook(() => useIdeExtensions(client));
    expect(waitForContributions).toHaveBeenCalledWith(0, expect.any(AbortSignal));
    expect(waitForContributions.mock.invocationCallOrder[0]).toBeLessThan(contributions.mock.invocationCallOrder[0]!);
    await waitFor(() => expect(hook.result.current.state?.snapshot.revision).toBe(1));

    waits[0]!.resolve({ state: state(1, ['pkg.alpha']), timedOut: true });
    await waitFor(() => expect(waitForContributions).toHaveBeenCalledTimes(2));
    expect(waitForContributions).toHaveBeenLastCalledWith(1, expect.any(AbortSignal));

    waits[1]!.resolve({ state: state(2, []), timedOut: false });
    await waitFor(() => expect(hook.result.current.state?.snapshot.revision).toBe(2));
    waits[2]!.resolve({ state: state(3, ['pkg.beta']), timedOut: false });
    await waitFor(() => expect(hook.result.current.state?.snapshot.revision).toBe(3));
    expect(hook.result.current.state?.snapshot.packageIds).toEqual(['pkg.beta']);
    hook.unmount();
  });

  it('aborts the Web wait and ignores a late response after unmount', async () => {
    const pending = deferred<{ state: PackageContributionState; timedOut: boolean }>();
    let signal: AbortSignal | undefined;
    const observed: number[] = [];
    const client = {
      contributionUpdateMode: () => 'long-poll' as const,
      contributions: vi.fn().mockResolvedValue(state(1)),
      onContributionsChanged: vi.fn(() => vi.fn()),
      waitForContributions: vi.fn((_revision: number, nextSignal: AbortSignal) => {
        signal = nextSignal;
        return pending.promise;
      }),
    } satisfies IdeExtensionsClient;

    const hook = renderHook(() => {
      const value = useIdeExtensions(client);
      if (value.state) observed.push(value.state.snapshot.revision);
      return value;
    });
    await waitFor(() => expect(hook.result.current.state?.snapshot.revision).toBe(1));
    hook.unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => pending.resolve({ state: state(9), timedOut: false }));
    expect(observed).not.toContain(9);
    expect(client.waitForContributions).toHaveBeenCalledOnce();
  });

  it('uses capped exponential delay only after Web transport errors', async () => {
    vi.useFakeTimers();
    const waitForContributions = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => new Promise(() => undefined));
    const client = {
      contributionUpdateMode: () => 'long-poll' as const,
      contributions: vi.fn().mockResolvedValue(state(1)),
      onContributionsChanged: vi.fn(() => vi.fn()),
      waitForContributions,
    } satisfies IdeExtensionsClient;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const hook = renderHook(() => useIdeExtensions(client));
    await act(async () => Promise.resolve());
    expect(waitForContributions).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(249));
    expect(waitForContributions).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(waitForContributions).toHaveBeenCalledTimes(2);
    hook.unmount();
    error.mockRestore();
  });
});
