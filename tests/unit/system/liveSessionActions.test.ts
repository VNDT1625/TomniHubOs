// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { normalizeActions } from '@/common/liveSessions/model';
import { emitPackageSessionAction, onPackageSessionAction } from '@/renderer/pages/hub/packageSessionActions';

describe('normalizeActions', () => {
  it('keeps only the abilities an app really claims', () => {
    expect(normalizeActions({ create: true, close: true })).toEqual({ create: true, close: true });
    expect(normalizeActions({ create: true })).toEqual({ create: true });
    expect(normalizeActions({ close: true, create: false })).toEqual({ close: true });
  });

  it('treats anything that is not a plain object with a true flag as no abilities', () => {
    expect(normalizeActions(undefined)).toBeUndefined();
    expect(normalizeActions(null)).toBeUndefined();
    expect(normalizeActions('create')).toBeUndefined();
    expect(normalizeActions([true])).toBeUndefined();
    expect(normalizeActions({})).toBeUndefined();
    expect(normalizeActions({ create: 'yes', close: 1 })).toBeUndefined();
    expect(normalizeActions({ delete: true })).toBeUndefined();
  });
});

describe('package session action bus', () => {
  it('delivers a create request and a close request to a listener', () => {
    const listener = vi.fn();
    const stop = onPackageSessionAction(listener);
    emitPackageSessionAction({ packageId: 'com.acme.board', kind: 'create' });
    emitPackageSessionAction({ packageId: 'com.acme.board', kind: 'close', sessionId: 'tab-1' });
    expect(listener).toHaveBeenNthCalledWith(1, { packageId: 'com.acme.board', kind: 'create' });
    expect(listener).toHaveBeenNthCalledWith(2, { packageId: 'com.acme.board', kind: 'close', sessionId: 'tab-1' });
    stop();
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    onPackageSessionAction(listener)();
    emitPackageSessionAction({ packageId: 'com.acme.board', kind: 'create' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores malformed events instead of throwing', () => {
    const listener = vi.fn();
    const stop = onPackageSessionAction(listener);
    window.dispatchEvent(new CustomEvent('tomni-hub-session-action', { detail: null }));
    window.dispatchEvent(new CustomEvent('tomni-hub-session-action', { detail: { kind: 'close' } }));
    window.dispatchEvent(new CustomEvent('tomni-hub-session-action', { detail: { packageId: 'p', kind: 'close' } }));
    window.dispatchEvent(new CustomEvent('tomni-hub-session-action', { detail: { packageId: 'p', kind: 'wipe' } }));
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
