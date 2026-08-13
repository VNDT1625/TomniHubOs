/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isElectronDesktop } from '@/renderer/utils/platform';

type RuntimeWindow = Window & {
  electronAPI?: { emit: () => void; on: () => void };
  __backendPort?: number;
};

const runtimeWindow = window as RuntimeWindow;

afterEach(() => {
  delete runtimeWindow.electronAPI;
  delete runtimeWindow.__backendPort;
});

describe('runtime platform detection', () => {
  it('does not confuse a host Electron preload with the Tomny desktop app', () => {
    runtimeWindow.electronAPI = { emit: () => undefined, on: () => undefined };
    expect(isElectronDesktop()).toBe(false);
  });

  it('recognizes the Tomny preload by its backend marker', () => {
    runtimeWindow.electronAPI = { emit: () => undefined, on: () => undefined };
    runtimeWindow.__backendPort = 0;
    expect(isElectronDesktop()).toBe(true);
  });
});
