/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcListener = (event: unknown, ...args: unknown[]) => void;

type FakeWebContents = {
  isDestroyed: ReturnType<typeof vi.fn>;
  mainFrame: object;
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

type FakeWindow = {
  destroy: ReturnType<typeof vi.fn>;
  getPosition: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  webContents: FakeWebContents;
};

const mocks = vi.hoisted(() => {
  const windows: FakeWindow[] = [];
  const handlers = new Map<string, IpcListener>();
  return {
    confirmationInvoke: vi.fn(() => Promise.resolve()),
    confirmationRemoveEmit: vi.fn(),
    handlers,
    windows,
    createWindow: vi.fn(() => {
      const webContents: FakeWebContents = {
        isDestroyed: vi.fn(() => false),
        mainFrame: {},
        on: vi.fn(),
        send: vi.fn(),
      };
      const window: FakeWindow = {
        destroy: vi.fn(),
        getPosition: vi.fn(() => [10, 20]),
        isDestroyed: vi.fn(() => false),
        loadFile: vi.fn(() => Promise.resolve()),
        loadURL: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
        setAlwaysOnTop: vi.fn(),
        setPosition: vi.fn(),
        show: vi.fn(),
        webContents,
      };
      windows.push(window);
      return window;
    }),
  };
});

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: function MockBrowserWindow(): FakeWindow {
    return mocks.createWindow();
  },
  ipcMain: {
    on: vi.fn((channel: string, listener: IpcListener) => {
      mocks.handlers.set(channel, listener);
    }),
    removeAllListeners: vi.fn((channel: string) => {
      mocks.handlers.delete(channel);
    }),
  },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { height: 1080, width: 1920, x: 0, y: 0 } })),
    getPrimaryDisplay: vi.fn(() => ({ workArea: { height: 1080, width: 1920, x: 0, y: 0 } })),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        confirm: { invoke: mocks.confirmationInvoke },
        remove: { emit: mocks.confirmationRemoveEmit },
      },
    },
  },
}));

vi.mock('@process/services/i18n', () => ({ default: { t: (value: string) => value } }));
vi.mock('@process/utils/initStorage', () => ({ ProcessConfig: { get: vi.fn(() => Promise.resolve('light')) } }));

type PetConfirmManager = typeof import('@/process/pet/petConfirmManager');

const confirmation = {
  call_id: 'call-1',
  conversation_id: 'conversation-1',
  description: 'Allow the operation?',
  id: 'message-1',
  options: [{ label: 'Allow once', value: 'proceed_once' }],
};

const senderEvent = (webContents: FakeWebContents): unknown => ({
  sender: webContents,
  senderFrame: webContents.mainFrame,
});

async function createManagerWithConfirmation(): Promise<{
  handler: IpcListener;
  manager: PetConfirmManager;
  window: FakeWindow;
}> {
  const manager = await import('@/process/pet/petConfirmManager');
  manager.initPetConfirmManager({ height: 280, width: 280, x: 100, y: 100 });
  manager.showPetConfirmation(confirmation);

  const handler = mocks.handlers.get('pet:confirm-respond');
  const window = mocks.windows.at(-1);
  if (!handler || !window) throw new Error('Expected the pet confirmation handler and window');
  return { handler, manager, window };
}

describe('pet confirmation IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.windows.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forwards an offered response from the live confirmation window main frame', async () => {
    const { handler, window } = await createManagerWithConfirmation();

    handler(senderEvent(window.webContents), {
      call_id: 'call-1',
      conversation_id: 'conversation-1',
      data: 'proceed_once',
      msg_id: 'message-1',
    });

    expect(mocks.confirmationRemoveEmit).toHaveBeenCalledWith({ conversation_id: 'conversation-1', id: 'message-1' });
    expect(mocks.confirmationInvoke).toHaveBeenCalledWith({
      call_id: 'call-1',
      conversation_id: 'conversation-1',
      data: 'proceed_once',
      msg_id: 'message-1',
    });
  });

  it('does not forward a response from another renderer', async () => {
    const { handler } = await createManagerWithConfirmation();
    const untrustedWebContents: FakeWebContents = {
      isDestroyed: vi.fn(() => false),
      mainFrame: {},
      on: vi.fn(),
      send: vi.fn(),
    };

    handler(senderEvent(untrustedWebContents), {
      call_id: 'call-1',
      conversation_id: 'conversation-1',
      data: 'proceed_once',
      msg_id: 'message-1',
    });

    expect(mocks.confirmationRemoveEmit).not.toHaveBeenCalled();
    expect(mocks.confirmationInvoke).not.toHaveBeenCalled();
  });

  it('does not forward an unoffered or over-specified response from the trusted window', async () => {
    const { handler, window } = await createManagerWithConfirmation();

    handler(senderEvent(window.webContents), {
      call_id: 'call-1',
      conversation_id: 'conversation-1',
      data: 'proceed_always',
      msg_id: 'message-1',
      unexpected: true,
    });

    expect(mocks.confirmationRemoveEmit).not.toHaveBeenCalled();
    expect(mocks.confirmationInvoke).not.toHaveBeenCalled();
  });
});
