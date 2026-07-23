/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startWebHost: vi.fn(async () => ({
    port: 25808,
    backendPort: 43123,
    url: 'http://127.0.0.1:25808',
    localUrl: 'http://127.0.0.1:25808',
    stop: vi.fn(async () => undefined),
  })),
  getGateway: vi.fn(async () => ({
    url: 'http://127.0.0.1:43123',
    wsUrl: 'ws://127.0.0.1:43123/ws/v1',
    port: 43123,
    sessionToken: 'native-gateway-token',
  })),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/tomni-data'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getAppPath: vi.fn(() => 'C:/tomni-app'),
    isPackaged: false,
  },
}));

vi.mock('@aionui/web-host', () => ({
  startWebHost: mocks.startWebHost,
}));

vi.mock('@process/tomnigateway', () => ({
  getTomniGatewayEndpoint: mocks.getGateway,
}));

vi.mock('@process/studio/cloudflareTunnel', () => ({
  ensureCloudflared: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
}));

vi.mock('@/process/utils/initStorage', () => ({
  ProcessConfig: { get: vi.fn(), set: vi.fn() },
  getSystemDir: vi.fn(() => ({
    cacheDir: 'C:/tomni-cache',
    workDir: 'C:/tomni-work',
    logDir: 'C:/tomni-log',
  })),
}));

vi.mock('@/process/utils/utils', () => ({
  getDataPath: vi.fn(() => 'C:/tomni-data'),
}));

import { startDesktopWebUI, stopDesktopWebUI } from '@/process/utils/webuiConfig';

afterEach(async () => {
  await stopDesktopWebUI();
  delete (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  vi.clearAllMocks();
});

describe('desktop WebUI native gateway', () => {
  it('starts from Settings without a legacy backend port', async () => {
    const result = await startDesktopWebUI({ port: 25808, allowRemote: false });

    expect(result.localUrl).toBe('http://127.0.0.1:25808');
    expect(mocks.getGateway).toHaveBeenCalledOnce();
    expect(mocks.startWebHost).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: {
          kind: 'useExistingGateway',
          port: 43123,
          sessionToken: 'native-gateway-token',
        },
      })
    );
  });

  it('preserves the full compatibility backend when it is available', async () => {
    (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort = 13400;

    await startDesktopWebUI({ port: 25808, allowRemote: false });

    expect(mocks.getGateway).not.toHaveBeenCalled();
    expect(mocks.startWebHost).toHaveBeenCalledWith(
      expect.objectContaining({ backend: { kind: 'useExistingBackend', port: 13400 } })
    );
  });
});
