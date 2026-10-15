import { describe, expect, it, vi } from 'vitest';

import { clearSessionsOnRuntimeInvalidation } from '@/process/system/liveSessions/clearOnRuntimeInvalidation';

type Binding = { runtimeId: string; ownerId: string };
type Event = {
  packageId: string;
  runtimeId: string;
  ownerId: string;
  reason: 'runtime-closed' | 'owner-unavailable' | 'package-revoked';
};

const harness = (bindings: Binding[]) => {
  let listener: ((event: Event) => void) | undefined;
  const registry = {
    onInvalidated: (next: (event: Event) => void) => {
      listener = next;
      return () => undefined;
    },
    listRuntimeBindings: () => bindings,
  };
  const clear = vi.fn();
  clearSessionsOnRuntimeInvalidation(registry, clear);
  return { clear, fire: (event: Event) => listener?.(event) };
};

const event = (reason: Event['reason'], runtimeId = 'r1', ownerId = 'o1'): Event => ({
  packageId: 'com.acme.board',
  runtimeId,
  ownerId,
  reason,
});

describe('clearSessionsOnRuntimeInvalidation', () => {
  it('clears the package when its last runtime closes', () => {
    const { clear, fire } = harness([{ runtimeId: 'r1', ownerId: 'o1' }]);
    fire(event('runtime-closed'));
    expect(clear).toHaveBeenCalledWith('com.acme.board');
  });

  it('keeps the package sessions while another runtime is still live', () => {
    const { clear, fire } = harness([
      { runtimeId: 'r1', ownerId: 'o1' },
      { runtimeId: 'r2', ownerId: 'o2' },
    ]);
    fire(event('runtime-closed'));
    expect(clear).not.toHaveBeenCalled();
  });

  it('always clears when the package is revoked', () => {
    const { clear, fire } = harness([
      { runtimeId: 'r1', ownerId: 'o1' },
      { runtimeId: 'r2', ownerId: 'o2' },
    ]);
    fire(event('package-revoked'));
    expect(clear).toHaveBeenCalledWith('com.acme.board');
  });

  it('clears when a window closes and every remaining runtime belongs to that window', () => {
    // Main announces each of the window's runtimes before any of them is removed from the list.
    const { clear, fire } = harness([
      { runtimeId: 'r1', ownerId: 'o1' },
      { runtimeId: 'r2', ownerId: 'o1' },
    ]);
    fire(event('owner-unavailable', 'r1', 'o1'));
    expect(clear).toHaveBeenCalledWith('com.acme.board');
  });

  it('keeps the sessions when a window closes but another window still runs the package', () => {
    const { clear, fire } = harness([
      { runtimeId: 'r1', ownerId: 'o1' },
      { runtimeId: 'r2', ownerId: 'o2' },
    ]);
    fire(event('owner-unavailable', 'r1', 'o1'));
    expect(clear).not.toHaveBeenCalled();
  });
});
