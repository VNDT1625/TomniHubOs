/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { STUDIO_SPLIT_ROUTE_REDIRECT_BOOTSTRAP_CHANNEL } from '@/common/packages/studioCompatibility';
import { BACKEND_BOOTSTRAP_IPC_CHANNELS, registerTrustedBootstrapIpc } from '@process/startup/bootstrapIpc';

type Handler = (event: { returnValue?: unknown }) => void;

const register = (trusted: boolean): Map<string, Handler> => {
  const handlers = new Map<string, Handler>();
  registerTrustedBootstrapIpc({
    ipcMain: { on: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)) } as never,
    isTrustedSender: vi.fn(() => trusted),
    getBackendPort: () => 4567,
    getBackendStartupFailed: () => true,
    getBackendStartupFailure: () => ({ reason: 'backend_startup_failed' }),
    getStudioSplitRouteRedirectEnabled: () => true,
  });
  return handlers;
};

describe('trusted preload bootstrap IPC', () => {
  it('returns bootstrap state only to a trusted desktop renderer', () => {
    const handlers = register(true);
    const port = {} as { returnValue?: unknown };
    const failure = {} as { returnValue?: unknown };
    const studio = {} as { returnValue?: unknown };
    handlers.get(BACKEND_BOOTSTRAP_IPC_CHANNELS.port)?.(port);
    handlers.get(BACKEND_BOOTSTRAP_IPC_CHANNELS.startupFailure)?.(failure);
    handlers.get(STUDIO_SPLIT_ROUTE_REDIRECT_BOOTSTRAP_CHANNEL)?.(studio);

    expect(port.returnValue).toBe(4567);
    expect(failure.returnValue).toEqual({ reason: 'backend_startup_failed' });
    expect(studio.returnValue).toBe(true);
  });

  it('fails closed for an untrusted sender without reading bootstrap state', () => {
    const handlers = register(false);
    const port = {} as { returnValue?: unknown };
    const startupFailed = {} as { returnValue?: unknown };
    const failure = {} as { returnValue?: unknown };
    const studio = {} as { returnValue?: unknown };
    handlers.get(BACKEND_BOOTSTRAP_IPC_CHANNELS.port)?.(port);
    handlers.get(BACKEND_BOOTSTRAP_IPC_CHANNELS.startupFailed)?.(startupFailed);
    handlers.get(BACKEND_BOOTSTRAP_IPC_CHANNELS.startupFailure)?.(failure);
    handlers.get(STUDIO_SPLIT_ROUTE_REDIRECT_BOOTSTRAP_CHANNEL)?.(studio);

    expect(port.returnValue).toBe(0);
    expect(startupFailed.returnValue).toBe(false);
    expect(failure.returnValue).toBeNull();
    expect(studio.returnValue).toBe(false);
  });
});
