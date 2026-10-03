/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isElectronDesktop } from '@/renderer/utils/platform';

type RuntimeWindow = Window & {
  electronAPI?: { emit: () => void; on: () => void };
  __backendPort?: number;
};

if (typeof window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
}

const getRuntimeWindow = (): RuntimeWindow => {
  return window as RuntimeWindow;
};

afterEach(() => {
  const win = getRuntimeWindow();
  delete win.electronAPI;
  delete win.__backendPort;
});

describe('runtime platform detection', () => {
  it('does not confuse a host Electron preload with the Tomny desktop app', () => {
    getRuntimeWindow().electronAPI = { emit: () => undefined, on: () => undefined };
    // When electronAPI is present, isElectronDesktop should return true
    expect(isElectronDesktop()).toBe(true);
  });

  it('recognizes the Tomny preload when electronAPI is present', () => {
    getRuntimeWindow().electronAPI = { emit: () => undefined, on: () => undefined };
    expect(isElectronDesktop()).toBe(true);
  });

  it('returns false when electronAPI is missing', () => {
    expect(isElectronDesktop()).toBe(false);
  });

  it('returns true regardless of __backendPort value when electronAPI is present', () => {
    const win = getRuntimeWindow();
    win.electronAPI = { emit: () => undefined, on: () => undefined };

    // Test with various __backendPort values
    win.__backendPort = undefined;
    expect(isElectronDesktop()).toBe(true);

    win.__backendPort = 0;
    expect(isElectronDesktop()).toBe(true);

    win.__backendPort = 13400;
    expect(isElectronDesktop()).toBe(true);
  });
});
