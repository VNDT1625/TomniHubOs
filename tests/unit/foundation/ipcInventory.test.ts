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
});
