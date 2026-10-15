import { describe, expect, it, vi } from 'vitest';
import { registerLauncherBridge } from '@process/integrations/connections/ipc/launcherBridge';
import { LAUNCHER_CHANNELS } from '@/common/types/platform/launcher';

const setup = () => {
  const callbacks = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  const event = { sender: {} };
  const bind = vi.fn().mockResolvedValue(true);
  const get = vi.fn().mockResolvedValue('C:/Apps/demo.exe');
  const verify = vi.fn().mockResolvedValue(true);
  const syncPackage = vi.fn().mockResolvedValue([]);
  const launch = vi.fn().mockResolvedValue(undefined);
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const chooseFile = vi.fn().mockResolvedValue('C:/Apps/demo.exe');
  let enabled = false;
  const registry = {
    view: vi.fn().mockImplementation(async () => [
      {
        key: 'launcher:app',
        connection: {
          kind: 'launcher',
          id: 'app',
          target: {
            kind: 'installed',
            executable: 'demo.exe',
            release: { owner: 'acme', repo: 'demo' },
          },
        },
        state: { enabled },
      },
    ]),
    syncPackage,
  };
  const dispose = registerLauncherBridge({
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, data: unknown) => Promise<unknown>) => {
        callbacks.set(channel, fn);
      },
      removeHandler: (channel: string) => {
        callbacks.delete(channel);
      },
    } as never,
    verifySender: (sender) => sender === event,
    registry: registry as never,
    bindings: { get, bind, forget: vi.fn(), reconcile: vi.fn() } as never,
    probe: { verify, find: vi.fn() },
    chooseFile,
    launch,
    openExternal,
  } as never);
  const invoke = (action: keyof typeof LAUNCHER_CHANNELS, payload: unknown, source: unknown = event) =>
    callbacks.get(LAUNCHER_CHANNELS[action])!(source, payload);
  return {
    invoke,
    dispose,
    callbacks,
    bind,
    get,
    verify,
    syncPackage,
    launch,
    chooseFile,
    openExternal,
    enable: () => {
      enabled = true;
    },
  };
};
const params = { packageId: 'local.demo', connectionId: 'app' };

describe('T5.6 launcher Main IPC', () => {
  it('never accepts a file path, an untrusted sender or additional request properties', async () => {
    const s = setup();
    expect(await s.invoke('link', { ...params, path: 'C:/untrusted.exe' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await s.invoke('link', params, { sender: {} })).toEqual({ ok: false, error: 'DENIED' });
    expect(s.chooseFile).not.toHaveBeenCalled();
    s.dispose();
  });
  it('requires explicit native pick, and only allows open when connection has been approved', async () => {
    const s = setup();
    expect(await s.invoke('open', params)).toEqual({ ok: false, error: 'NOT_ENABLED' });
    expect(s.launch).not.toHaveBeenCalled();
    expect(await s.invoke('link', params)).toEqual({ ok: true });
    expect(s.chooseFile).toHaveBeenCalledWith(expect.anything(), 'demo.exe');
    expect(s.bind).toHaveBeenCalledWith('local.demo', 'app', 'demo.exe', 'C:/Apps/demo.exe');
    expect(s.syncPackage).toHaveBeenCalledWith('local.demo');
    s.enable();
    expect(await s.invoke('open', params)).toEqual({ ok: true });
    expect(s.verify).toHaveBeenCalledWith('demo.exe', 'C:/Apps/demo.exe');
    expect(s.launch).toHaveBeenCalledWith('C:/Apps/demo.exe');
    s.dispose();
  });
  it('derives a download link from verified adapter data, never from renderer URL', async () => {
    const s = setup();
    expect(await s.invoke('download', params)).toEqual({ ok: true });
    expect(s.openExternal).toHaveBeenCalledWith('https://github.com/acme/demo/releases/latest');
    s.dispose();
    expect(s.callbacks.size).toBe(0);
  });
});
