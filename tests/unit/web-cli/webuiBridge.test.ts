/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setInitialPassword: vi.fn(),
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
      getStatus: { provider: vi.fn() },
      start: { provider: vi.fn() },
      stop: { provider: vi.fn() },
      statusChanged: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/utils/webuiConfig', () => ({
  getDesktopWebUIStatus: vi.fn(),
  setDesktopWebUIInitialPassword: mocks.setInitialPassword,
  startDesktopWebUI: vi.fn(),
  stopDesktopWebUI: vi.fn(),
}));

vi.mock('@process/tomnigateway', () => ({
  getTomniGatewayEndpoint: mocks.getGateway,
}));

import { maybeSeedInitialPassword } from '@/process/bridge/webuiBridge';

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
});
