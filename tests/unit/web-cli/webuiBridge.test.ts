/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStatusProvider: vi.fn(),
  startProvider: vi.fn(),
  stopProvider: vi.fn(),
  setInitialPassword: vi.fn(),
  getStatus: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  getGateway: vi.fn(async () => ({
    url: 'http://127.0.0.1:43123',
    wsUrl: 'ws://127.0.0.1:43123/ws/v1',
    port: 43123,
    sessionToken: 'native-gateway-token',
  })),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    webui: {
      getStatus: { provider: mocks.getStatusProvider },
      start: { provider: mocks.startProvider },
      stop: { provider: mocks.stopProvider },
      statusChanged: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/utils/webuiConfig', () => ({
  getDesktopWebUIStatus: mocks.getStatus,
  restoreDesktopWebUIFromPreferences: vi.fn(),
  setDesktopWebUIInitialPassword: mocks.setInitialPassword,
  startDesktopWebUI: mocks.start,
  stopDesktopWebUI: mocks.stop,
}));

vi.mock('@process/tomnigateway', () => ({
  getTomniGatewayEndpoint: mocks.getGateway,
}));

import {
  createWebUIAccountExecutionLease,
  initWebuiBridge,
  maybeSeedInitialPassword,
} from '@/process/bridge/webuiBridge';

afterEach(() => {
  delete (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('WebUI credential bootstrap', () => {
  it('seeds the native gateway credential without a legacy backend port', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { needs_setup: true, username: 'admin' } }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { new_password: 'generated-password' } }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await maybeSeedInitialPassword();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:43123/api/auth/status',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer native-gateway-token',
          'x-tomni-internal': '1',
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:43123/api/webui/reset-password',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer native-gateway-token',
          'x-tomni-internal': '1',
        }),
      })
    );
    expect(mocks.setInitialPassword).toHaveBeenCalledWith('generated-password');
  });

  it('fails closed before all WebUI IPC work when the account is not online', async () => {
    const requireAuthenticatedAccount = vi.fn(() => {
      throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
    });
    initWebuiBridge({ requireAuthenticatedAccount });
    const getStatus = mocks.getStatusProvider.mock.calls.at(-1)?.[0] as (() => Promise<unknown>) | undefined;
    const start = mocks.startProvider.mock.calls.at(-1)?.[0] as ((value: unknown) => Promise<unknown>) | undefined;
    const stop = mocks.stopProvider.mock.calls.at(-1)?.[0] as (() => Promise<unknown>) | undefined;
    if (!getStatus || !start || !stop) throw new Error('WebUI handlers were not registered.');

    await expect(getStatus()).rejects.toThrow('ACCOUNT_SESSION_ONLINE_REQUIRED');
    await expect(start({ allowRemote: true })).rejects.toThrow('ACCOUNT_SESSION_ONLINE_REQUIRED');
    await expect(stop()).rejects.toThrow('ACCOUNT_SESSION_ONLINE_REQUIRED');
    expect(requireAuthenticatedAccount).toHaveBeenCalledTimes(3);
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.getGateway).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('stops a just-created WebUI host when sign-out races the interactive start', async () => {
    const requireAuthenticatedAccount = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
      });
    mocks.start.mockResolvedValue({ port: 25808, localUrl: 'http://127.0.0.1:25808' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ needs_setup: false }), { status: 200 }))
    );
    initWebuiBridge({ requireAuthenticatedAccount });
    const start = mocks.startProvider.mock.calls.at(-1)?.[0] as ((value: unknown) => Promise<unknown>) | undefined;
    if (!start) throw new Error('WebUI start handler was not registered.');

    await expect(start({ allowRemote: true })).rejects.toThrow('ACCOUNT_SESSION_ONLINE_REQUIRED');
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('restores only after online admission and rolls back a WebUI start that races account loss', async () => {
    const restore = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const requireAuthenticatedAccount = vi.fn();
    const lease = createWebUIAccountExecutionLease({ requireAuthenticatedAccount, restore, stop });

    await lease.start();
    expect(restore).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    await lease.stop();
    expect(stop).toHaveBeenCalledOnce();

    requireAuthenticatedAccount
      .mockReset()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
      });
    await expect(lease.start()).rejects.toThrow('ACCOUNT_SESSION_ONLINE_REQUIRED');
    expect(restore).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
