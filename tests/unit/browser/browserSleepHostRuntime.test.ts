import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareProfile: vi.fn(async () => undefined),
  registerBridge: vi.fn(),
  disposeBridge: vi.fn(),
  ensureMcp: vi.fn(async () => undefined),
  stopMcp: vi.fn(async () => undefined),
  disposeControl: vi.fn(),
  setHubSleeping: vi.fn(),
  listTabs: vi.fn(() => [{ id: 'regular' }, { id: 'agent' }]),
}));
vi.mock('@process/integrations/browserExtensions/profile', () => ({
  prepareBrowserProfile: mocks.prepareProfile,
}));
vi.mock('@process/browser/browserBridge', () => ({
  registerBrowserBridge: mocks.registerBridge,
  disposeBrowserBridge: mocks.disposeBridge,
  getBrowserServices: () => ({
    viewManager: { setHubSleeping: mocks.setHubSleeping, listTabs: mocks.listTabs },
    isAgentMode: (id: string) => id === 'agent',
  }),
}));
vi.mock('@process/browser/browserControlMcpHost', () => ({ stopBrowserControlMcpHost: mocks.stopMcp }));
vi.mock('@process/browser/registerBrowserControlMcp', () => ({ ensureBrowserControlMcpRegistered: mocks.ensureMcp }));
vi.mock('@process/browser/browserControlWiring', () => ({ disposeBrowserControl: mocks.disposeControl }));

import { activate, deactivate } from '@process/browser/browserHostRuntime';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Browser package background throttle lifecycle', () => {
  it('throttles only idle user tabs on hide and restores them on show, cleaning up on deactivate', async () => {
    const window = new EventEmitter() as EventEmitter & { isVisible: () => boolean; isDestroyed: () => boolean };
    window.isVisible = () => true;
    window.isDestroyed = () => false;

    await activate({ getMainWindow: () => window as never });
    window.emit('hide');
    expect(mocks.setHubSleeping).toHaveBeenCalledWith(true, ['agent']);
    window.emit('show');
    expect(mocks.setHubSleeping).toHaveBeenCalledWith(false);
    await deactivate();
    mocks.setHubSleeping.mockClear();
    window.emit('hide');
    expect(mocks.setHubSleeping).not.toHaveBeenCalled();
  });

  it('starts already hidden windows throttled', async () => {
    const window = new EventEmitter() as EventEmitter & { isVisible: () => boolean; isDestroyed: () => boolean };
    window.isVisible = () => false;
    window.isDestroyed = () => false;
    await activate({ getMainWindow: () => window as never });
    expect(mocks.setHubSleeping).toHaveBeenCalledWith(true, ['agent']);
    await deactivate();
  });
});
