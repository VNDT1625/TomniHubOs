import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { LOCAL_KEY_CHANNELS } from '@/common/types/platform/packageConnections';
import { registerLocalKeyBridge, type LocalKeyBridgeDeps } from '@process/integrations/connections/ipc/localKeyBridge';

type Handler = (event: IpcMainInvokeEvent) => Promise<unknown>;

const setup = (overrides: Partial<Omit<LocalKeyBridgeDeps, 'ipcMain'>> = {}) => {
  const handlers = new Map<string, Handler>();
  const removeHandler = vi.fn((channel: string) => {
    handlers.delete(channel);
  });
  const deps = {
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      },
      removeHandler,
    },
    verifySender: vi.fn(() => true),
    confirm: vi.fn(async () => true),
    revoke: vi.fn(async () => 2),
    audit: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as LocalKeyBridgeDeps;
  const dispose = registerLocalKeyBridge(deps);
  const invoke = (): Promise<unknown> => {
    const handler = handlers.get(LOCAL_KEY_CHANNELS.revoke);
    if (!handler) throw new Error('channel not registered');
    return handler({ sender: {}, senderFrame: {} } as unknown as IpcMainInvokeEvent);
  };
  return { deps, dispose, invoke, handlers, removeHandler };
};

describe('packages.revokeLocalKey channel', () => {
  it('rejects a sender that is not the main window top frame, before asking or revoking anything', async () => {
    const { deps, invoke } = setup({ verifySender: vi.fn(() => false) });

    await expect(invoke()).resolves.toEqual({ ok: false, error: 'DENIED' });
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.revoke).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it('revokes nothing when the person does not approve the native confirmation, and records the cancel', async () => {
    const { deps, invoke } = setup({ confirm: vi.fn(async () => false) });

    await expect(invoke()).resolves.toEqual({ ok: false, error: 'CANCELLED' });
    expect(deps.revoke).not.toHaveBeenCalled();
    expect(deps.audit).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('treats a confirmation that throws as a cancel', async () => {
    const { deps, invoke } = setup({
      confirm: vi.fn(async () => {
        throw new Error('dialog closed');
      }),
    });

    await expect(invoke()).resolves.toEqual({ ok: false, error: 'CANCELLED' });
    expect(deps.revoke).not.toHaveBeenCalled();
  });

  it('returns only the count, and its receipt holds no key id, package id or path', async () => {
    const { deps, invoke } = setup();

    await expect(invoke()).resolves.toEqual({ ok: true, unsignedPackages: 2 });
    expect(deps.revoke).toHaveBeenCalledTimes(1);
    expect(deps.audit).toHaveBeenCalledWith({ status: 'completed', unsignedPackages: 2 });
  });

  it('reports a failed revocation as FAILED and records it', async () => {
    const { deps, invoke } = setup({
      revoke: vi.fn(async () => {
        throw new Error('disk full at /secret/path');
      }),
    });

    await expect(invoke()).resolves.toEqual({ ok: false, error: 'FAILED' });
    expect(deps.audit).toHaveBeenCalledWith({ status: 'failed' });
  });

  it('removes the channel when disposed, and refuses calls after that', async () => {
    const { dispose, removeHandler, handlers } = setup();
    dispose();

    expect(removeHandler).toHaveBeenCalledWith(LOCAL_KEY_CHANNELS.revoke);
    expect(handlers.has(LOCAL_KEY_CHANNELS.revoke)).toBe(false);
  });
});
