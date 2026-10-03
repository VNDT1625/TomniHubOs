import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findIpcInventoryViolations,
  scanBaseIpcInventory,
  scanIpcInventoryFromSources,
} from '../../../packages/desktop/src/process/foundation/ipcInventory';

const repositoryRoot = resolve(__dirname, '../../..');

describe('base preload and IPC inventory', () => {
  it('deterministically enumerates live preload APIs and registered IPC handlers', () => {
    const first = scanBaseIpcInventory(repositoryRoot);
    const second = scanBaseIpcInventory(repositoryRoot);

    expect(second).toEqual(first);
    expect(first.preloadApis.map((api) => api.name)).toContain('electronAPI');
    expect(first.preloadMethods.map((method) => method.method)).toContain('creatorPreview.open');
    expect(first.rendererChannels.map((channel) => channel.channel)).toContain('foundation:execute-run');
    expect(first.handlers.map((channel) => channel.channel)).toContain('foundation:execute-run');
    expect(first.handlers.map((channel) => channel.channel)).toContain('get-backend-port');
    expect(
      first.mainToRendererChannels.filter((channel) => channel.staticChannel).map((channel) => channel.channel)
    ).toEqual(expect.arrayContaining(['tray:navigate-to-guid', 'pet:state-changed']));
    expect(findIpcInventoryViolations(first)).toEqual([]);
  });

  it('reports an unregistered literal renderer-to-main IPC fixture', () => {
    const inventory = scanIpcInventoryFromSources({
      'packages/desktop/src/preload/fixture.ts': `
        contextBridge.exposeInMainWorld('fixtureAPI', {
          registered: () => ipcRenderer.invoke('fixture:registered'),
          missing: () => ipcRenderer.send('fixture:missing'),
        });
      `,
      'packages/desktop/src/process/fixture.ts': `
        ipcMain.handle('fixture:registered', async () => ({ ok: true }));
      `,
    });

    expect(inventory.preloadMethods.map((method) => method.method)).toEqual(['registered', 'missing']);
    expect(findIpcInventoryViolations(inventory)).toEqual([
      expect.objectContaining({ channel: 'fixture:missing', reason: 'unregistered-renderer-channel' }),
    ]);
  });

  it('reports an unobserved literal Main-to-renderer IPC fixture without treating dynamic channels as missing', () => {
    const inventory = scanIpcInventoryFromSources({
      'packages/desktop/src/preload/fixture.ts': `
        const loopChannels = ['fixture:loop-observed'];
        for (const channel of loopChannels) {
          ipcRenderer.on(channel, () => undefined);
        }
        const DYNAMIC_CHANNEL = runtimeChannel();
        ipcRenderer.on(DYNAMIC_CHANNEL, () => undefined);
        ipcRenderer.on('fixture:direct-observed', () => undefined);
      `,
      'packages/desktop/src/process/fixture.ts': `
        mainWindow.webContents.send('fixture:loop-observed');
        mainWindow.webContents.send('fixture:direct-observed');
        mainWindow.webContents.send('fixture:missing');
        mainWindow.webContents.send(DYNAMIC_CHANNEL);
      `,
    });

    expect(inventory.mainToRendererChannels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'fixture:loop-observed', staticChannel: true }),
        expect.objectContaining({ channel: '<dynamic:DYNAMIC_CHANNEL>', staticChannel: false }),
      ])
    );
    expect(findIpcInventoryViolations(inventory)).toEqual([
      expect.objectContaining({ channel: 'fixture:missing', reason: 'unobserved-main-to-renderer-channel' }),
    ]);
  });
});
