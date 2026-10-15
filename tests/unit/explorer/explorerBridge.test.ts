import { EventEmitter } from 'node:events';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { EXPLORER_CHANNELS } from '@/common/types/platform/explorer';
import { registerExplorerBridge, type ExplorerServicePort } from '@process/resources/explorer/explorerBridge';
import { ExplorerServiceError } from '@process/resources/explorer/explorerService';

const ignorePickerResult = (_value: string): void => {};
type Handler = Parameters<IpcMain['handle']>[1];
const setup = (chooseRoot = async (): Promise<string | null> => 'C:\\work') => {
  const handlers = new Map<string, Handler>();
  const sender = Object.assign(new EventEmitter(), { id: 42 });
  const event = { sender } as unknown as IpcMainInvokeEvent;
  const service: ExplorerServicePort = {
    openSession: vi.fn(async () => ({ id: 'session', root: 'C:\\work', expiresAt: Date.now() + 60000 })),
    list: vi.fn(async () => ({ relativePath: '', entries: [], truncated: false })),
    action: vi.fn(async () => ({ receiptId: 'receipt', affectedPaths: ['a.txt'] })),
    close: vi.fn(),
    closeOwner: vi.fn(),
  };
  const verifySender = vi.fn(() => true);
  const dispose = registerExplorerBridge({
    ipcMain: {
      handle: (name, handler) => {
        handlers.set(name, handler);
      },
      removeHandler: (name) => {
        handlers.delete(name);
      },
    },
    service,
    verifySender,
    chooseRoot,
  });
  const call = (channel: string, payload: unknown): Promise<unknown> => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error('Handler missing');
    return Promise.resolve(handler(event, payload));
  };
  return { call, sender, service, verifySender, dispose };
};

describe('Explorer sender-bound bridge', () => {
  it('rejects untrusted senders before granting or touching files', async () => {
    const fixture = setup();
    fixture.verifySender.mockReturnValue(false);
    expect(await fixture.call(EXPLORER_CHANNELS.open, {})).toEqual({ ok: false, code: 'DENIED' });
    expect(fixture.service.openSession).not.toHaveBeenCalled();
  });

  it('bounds strict mutation payloads and forwards only schema fields', async () => {
    const fixture = setup();
    expect(
      await fixture.call(EXPLORER_CHANNELS.action, {
        sessionId: 'session',
        operation: 'delete',
        paths: ['a'],
        root: 'C:\\',
      })
    ).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(
      await fixture.call(EXPLORER_CHANNELS.action, {
        sessionId: 'session',
        operation: 'delete',
        paths: Array.from({ length: 101 }, () => 'a'),
      })
    ).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(fixture.service.action).not.toHaveBeenCalled();
    expect(
      await fixture.call(EXPLORER_CHANNELS.action, {
        sessionId: 'session',
        operation: 'rename',
        paths: ['a.txt'],
        name: 'b.txt',
      })
    ).toEqual({ ok: true, data: { receiptId: 'receipt', affectedPaths: ['a.txt'] } });
    expect(fixture.service.action).toHaveBeenCalledWith(42, {
      sessionId: 'session',
      operation: 'rename',
      paths: ['a.txt'],
      name: 'b.txt',
    });
  });

  it('does not issue a grant after navigation while the picker is open', async () => {
    let finishPicker: (value: string) => void = ignorePickerResult;
    const picker = new Promise<string>((resolve) => {
      finishPicker = resolve;
    });
    const fixture = setup(() => picker);
    const pending = fixture.call(EXPLORER_CHANNELS.open, { pick: true });
    fixture.sender.emit('did-start-navigation', {}, 'https://example.com', false, true);
    finishPicker('C:\\work');
    expect(await pending).toEqual({ ok: false, code: 'DENIED' });
    expect(fixture.service.openSession).not.toHaveBeenCalled();
    expect(fixture.service.closeOwner).toHaveBeenCalledWith(42);
  });

  it('returns recovery information instead of hiding partial filesystem effects', async () => {
    const fixture = setup();
    vi.mocked(fixture.service.action).mockRejectedValue(
      Object.assign(new ExplorerServiceError('IO_ERROR'), {
        receiptId: 'partial',
        affectedPaths: ['copied.txt'],
        mayHaveCommitted: true,
      })
    );
    expect(
      await fixture.call(EXPLORER_CHANNELS.action, {
        sessionId: 'session',
        operation: 'copy',
        paths: ['a.txt'],
        destination: 'target',
      })
    ).toEqual({
      ok: false,
      code: 'IO_ERROR',
      receiptId: 'partial',
      affectedPaths: ['copied.txt'],
      mayHaveCommitted: true,
    });
  });

  it('revokes sessions and removes lifecycle listeners on disposal', async () => {
    const fixture = setup();
    await fixture.call(EXPLORER_CHANNELS.open, {});
    fixture.dispose();
    expect(fixture.service.closeOwner).toHaveBeenCalledWith(42);
    expect(fixture.sender.listenerCount('did-start-navigation')).toBe(0);
    expect(fixture.sender.listenerCount('destroyed')).toBe(0);
  });
});
