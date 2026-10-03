import { describe, expect, it, vi, beforeEach } from 'vitest';
import EventEmitter from 'eventemitter3';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\temp\\test-userdata'),
    isPackaged: false,
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({ isDestroyed: vi.fn(() => false) })),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('@process/experimentalCore/coreRegistry', () => ({
  detectCoreTargets: vi.fn(async () => [
    {
      id: 'codex',
      name: 'Codex CLI',
      protocol: 'codex-app-server',
      candidates: ['codex'],
      args: ['app-server'],
      detail: 'OpenAI app-server (JSONL stdio)',
      runnable: true,
      detected: true,
      available: true,
      command: 'C:\\Users\\MyPC\\AppData\\Roaming\\npm\\codex.cmd',
    },
    {
      id: 'tomny',
      name: 'Tomny CLI',
      protocol: 'tomny-json-stream',
      candidates: ['tomny'],
      args: ['--json-stream'],
      detail: 'Built-in Tomny agent',
      runnable: true,
      detected: true,
      available: true,
      command: 'C:\\NDT\\PJ\\TomniHubOS\\resources\\bundled-tomny-cli\\win32-x64\\tomny.exe',
    },
  ]),
  resolveExecutableOnPath: vi.fn(async (c: string[]) => c[0]),
}));

vi.mock('@process/services/database/legacyCatalogReader', () => ({
  readLegacyCatalog: vi.fn(async () => ({
    providers: [],
    assistants: [],
    agents: [],
  })),
}));

vi.mock('@process/services/database/runLegacyDatabaseMigrations', () => ({
  discoverLegacyDatabasePaths: vi.fn(() => []),
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async () => null),
  },
}));

describe('agent catalog IPC roundtrip', () => {
  it('dispatches getAvailableAgents through exact Electron IPC wire protocol', async () => {
    const { registerAgentCatalogBridge } = await import('@process/resources/agentCatalogBridge');
    const { acpConversation } = await import('@/common/adapter/ipcBridge');

    // Wire up Electron IPC simulation
    const ADAPTER_BRIDGE_EVENT_KEY = 'office-ai-bridge-adapter';

    // Main side platform emitter
    let mainPlatformEmitter: any;
    // Renderer side platform emitter
    let rendererPlatformEmitter: any;

    // Electron webContents and ipcRenderer mock
    const fakeWebContents = {
      isDestroyed: () => false,
      send: (channel: string, value: string) => {
        // Main sends to Renderer via webContents.send
        if (channel === ADAPTER_BRIDGE_EVENT_KEY) {
          // In preload:
          fakeIpcRendererOnHandler({} as any, value);
        }
      },
    };

    let fakeIpcRendererOnHandler: (event: any, value: any) => void = () => {};

    // Main adapter setup (packages/desktop/src/common/adapter/main.ts)
    const mainAdapter = {
      emit(name: string, data: unknown) {
        const serialized = JSON.stringify({ name, data });
        fakeWebContents.send(ADAPTER_BRIDGE_EVENT_KEY, serialized);
      },
      on(emitter: any) {
        mainPlatformEmitter = emitter;
      },
    };

    // Main ipcMain.handle handler:
    const handleMainIpc = async (event: any, info: unknown) => {
      let parsed: { name: string; data: unknown };
      if (typeof info === 'string') {
        parsed = JSON.parse(info);
      } else {
        parsed = info as any;
      }
      return mainPlatformEmitter.emit(parsed.name, parsed.data);
    };

    // Preload electronAPI mock:
    const electronAPI = {
      emit: async (name: string, data: unknown) => {
        const payload = JSON.stringify({ name, data });
        return handleMainIpc({} as any, payload);
      },
      on: (callback: (event: { value: string }) => void) => {
        fakeIpcRendererOnHandler = (_event: any, value: unknown) => {
          if (typeof value === 'string') callback({ value });
        };
      },
    };

    // Renderer adapter setup (packages/desktop/src/common/adapter/browser.ts)
    const rendererAdapter = {
      emit(name: string, data: unknown) {
        return electronAPI.emit(name, data);
      },
      on(emitter: any) {
        rendererPlatformEmitter = emitter;
        electronAPI.on((event) => {
          try {
            const { value } = event;
            const { name: evtName, data: evtData } = JSON.parse(value);
            emitter.emit(evtName, evtData);
          } catch (e) {
            console.warn('JSON parsing error:', e);
          }
        });
      },
    };

    // Setup Main platform bridge
    const { bridge } = await import('@office-ai/platform');

    // In our single-process test, bridge is a singleton, so let us set up the round-trip
    bridge.adapter({
      emit(name: string, data: unknown) {
        // If it starts with subscribe-, it is from invoke (renderer) to main
        if (name.startsWith('subscribe-')) {
          rendererAdapter.emit(name, data);
        } else if (name.startsWith('subscribe.callback-')) {
          mainAdapter.emit(name, data);
        }
      },
      on(emitter: any) {
        mainPlatformEmitter = emitter;
        rendererPlatformEmitter = emitter;
        electronAPI.on((event) => {
          const { value } = event;
          const { name: evtName, data: evtData } = JSON.parse(value);
          emitter.emit(evtName, evtData);
        });
      },
    });

    registerAgentCatalogBridge();

    const agents = await acpConversation.getAvailableAgents.invoke();
    expect(agents).toBeDefined();
    expect(Array.isArray(agents)).toBe(true);
    expect((agents as any[]).length).toBe(2);
  });
});
