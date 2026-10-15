import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_CHANNELS } from '@/common/types/platform/sessionMemory';
import { registerSessionMemoryBridge } from '@process/resources/sessionMemory/sessionMemoryBridge';
import { createSessionMemoryStore } from '@process/userUnderstanding/sessionMemoryStore';

type Handler = Parameters<IpcMain['handle']>[1];
const deferred = <T>() => {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (!complete) throw new Error('Promise not initialized');
      complete(value);
    },
  };
};
const setup = () => {
  const handlers = new Map<string, Handler>();
  const event = { sender: { id: 42 } } as unknown as IpcMainInvokeEvent;
  const memory = createSessionMemoryStore({ summarizer: async () => 'summary' });
  const remember = vi.spyOn(memory, 'remember');
  const clear = vi.spyOn(memory, 'clearSession');
  const snapshot = vi.spyOn(memory, 'snapshot');
  const verifySender = vi.fn(() => true);
  const resolve = vi.fn(
    async (_conversationId: string): Promise<{ memoryId: string; running: boolean } | undefined> => ({
      memoryId: 'private-memory',
      running: false,
    })
  );
  const confirm = vi.fn(async () => true);
  const audit = vi.fn(
    async (_record: { conversationId: string; requestId: string; operation: string; status: string }): Promise<void> =>
      undefined
  );
  const dispose = registerSessionMemoryBridge({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
    },
    verifySender,
    resolve,
    memory,
    confirm,
    audit,
  });
  const call = (operation: keyof typeof SESSION_MEMORY_CHANNELS, payload: unknown): Promise<unknown> => {
    const handler = handlers.get(SESSION_MEMORY_CHANNELS[operation]);
    if (!handler) throw new Error('Missing IPC handler');
    return Promise.resolve(handler(event, payload));
  };
  return { call, handlers, memory, remember, clear, snapshot, verifySender, resolve, confirm, audit, dispose };
};

describe('native Core session memory IPC contract', () => {
  it('denies an untrusted sender before resolving any memory owner', async () => {
    const fixture = setup();
    fixture.verifySender.mockReturnValue(false);
    expect(await fixture.call('snapshot', { sessionId: 'conversation-1' })).toEqual({ ok: false, error: 'DENIED' });
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(fixture.snapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['snapshot', { sessionId: '' }],
    ['snapshot', { sessionId: 'a'.repeat(257) }],
    ['snapshot', { sessionId: '../outside' }],
    ['snapshot', { sessionId: 'c', memoryId: 'private-memory' }],
    ['remember', { sessionId: 'c', text: 'a'.repeat(16001) }],
    ['remember', { sessionId: 'c', text: '  ' }],
    ['remember', { sessionId: 'c', text: 'note', kind: 'summary' }],
    ['remember', { sessionId: 'c', text: 'note', pinned: 'true' }],
    ['clear', { sessionId: 'c', approve: true }],
  ] as const)('rejects a malformed strict %s payload', async (operation, payload) => {
    const fixture = setup();
    expect(await fixture.call(operation, payload)).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(fixture.confirm).not.toHaveBeenCalled();
    expect(fixture.remember).not.toHaveBeenCalled();
    expect(fixture.clear).not.toHaveBeenCalled();
  });

  it('rejects an unknown conversation without exposing private store identifiers', async () => {
    const fixture = setup();
    fixture.resolve.mockResolvedValue(undefined);
    expect(await fixture.call('snapshot', { sessionId: 'conversation-unknown' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(fixture.snapshot).not.toHaveBeenCalled();
  });

  it('maps conversation identity privately and removes secret keys and values from snapshots', async () => {
    const fixture = setup();
    fixture.memory.setSecret('private-memory', 'PRIVATE_API_TOKEN', 'vault-opaque-sensitive-value');
    await fixture.memory.remember('private-memory', {
      text: 'Value vault-opaque-sensitive-value; Bearer bearer123; api_key=abc123; sk-abcdefghijklmnop',
      pinned: true,
    });
    await fixture.memory.remember('other-memory', { text: 'OTHER-OWNER' });
    const result = await fixture.call('snapshot', { sessionId: 'conversation-1' });
    expect(fixture.resolve).toHaveBeenCalledWith('conversation-1');
    expect(fixture.snapshot).toHaveBeenCalledWith('private-memory');
    expect(result).toMatchObject({ ok: true, data: { sessionId: 'conversation-1', secretKeys: [] } });
    const serialized = JSON.stringify(result);
    for (const secret of [
      'private-memory',
      'PRIVATE_API_TOKEN',
      'vault-opaque-sensitive-value',
      'bearer123',
      'abc123',
      'sk-abcdefghijklmnop',
      'OTHER-OWNER',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('[redacted]');
    expect(fixture.confirm).not.toHaveBeenCalled();
  });

  it('approves and audits a sanitized remember against only the Main-owned store id', async () => {
    const fixture = setup();
    fixture.memory.setSecret('private-memory', 'SECRET', 'stored-secret-value');
    const result = await fixture.call('remember', {
      sessionId: 'conversation-1',
      text: 'Keep stored-secret-value',
      kind: 'decision',
      pinned: true,
    });
    expect(result).toMatchObject({
      ok: true,
      data: { item: { text: 'Keep [redacted]', kind: 'decision', pinned: true } },
    });
    expect(fixture.remember).toHaveBeenCalledWith('private-memory', {
      text: 'Keep [redacted]',
      kind: 'decision',
      pinned: true,
    });
    expect(fixture.audit.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ conversationId: 'conversation-1', operation: 'remember', status: 'approved' }),
      expect.objectContaining({ conversationId: 'conversation-1', operation: 'remember', status: 'completed' }),
    ]);
    expect(JSON.stringify(fixture.audit.mock.calls)).not.toContain('stored-secret-value');
  });

  it('clears an idle approved session without touching another owner', async () => {
    const fixture = setup();
    await fixture.memory.remember('private-memory', { text: 'DELETE-ME' });
    await fixture.memory.remember('other-memory', { text: 'KEEP-ME' });
    expect(await fixture.call('clear', { sessionId: 'conversation-1' })).toEqual({ ok: true, data: true });
    expect(fixture.clear).toHaveBeenCalledWith('private-memory');
    expect(fixture.memory.snapshot('private-memory').items).toEqual([]);
    expect(fixture.memory.snapshot('other-memory').items[0]?.text).toBe('KEEP-ME');
  });

  it('denies clearing a running session before asking for approval', async () => {
    const fixture = setup();
    fixture.resolve.mockResolvedValue({ memoryId: 'private-memory', running: true });
    expect(await fixture.call('clear', { sessionId: 'conversation-1' })).toEqual({ ok: false, error: 'BUSY' });
    expect(fixture.confirm).not.toHaveBeenCalled();
    expect(fixture.clear).not.toHaveBeenCalled();
  });

  it('cancellation causes no audit or mutation', async () => {
    const fixture = setup();
    fixture.confirm.mockResolvedValue(false);
    expect(await fixture.call('remember', { sessionId: 'conversation-1', text: 'note' })).toEqual({
      ok: false,
      error: 'CANCELLED',
    });
    expect(fixture.audit).not.toHaveBeenCalled();
    expect(fixture.remember).not.toHaveBeenCalled();
  });

  it('fails closed when approved audit cannot persist', async () => {
    const fixture = setup();
    fixture.audit.mockRejectedValue(new Error('disk unavailable'));
    expect(await fixture.call('remember', { sessionId: 'conversation-1', text: 'note' })).toEqual({
      ok: false,
      error: 'IO_ERROR',
    });
    expect(fixture.remember).not.toHaveBeenCalled();
    expect(fixture.clear).not.toHaveBeenCalled();
  });

  it('rechecks sender after identity resolution before returning private data', async () => {
    const fixture = setup();
    fixture.resolve.mockImplementation(async () => {
      fixture.verifySender.mockReturnValue(false);
      return { memoryId: 'private-memory', running: false };
    });
    expect(await fixture.call('snapshot', { sessionId: 'conversation-1' })).toEqual({ ok: false, error: 'DENIED' });
    expect(fixture.snapshot).not.toHaveBeenCalled();
  });

  it('revocation during approval prevents mutation', async () => {
    const fixture = setup();
    fixture.confirm.mockImplementation(async () => {
      fixture.verifySender.mockReturnValue(false);
      return true;
    });
    expect(await fixture.call('remember', { sessionId: 'conversation-1', text: 'note' })).toEqual({
      ok: false,
      error: 'DENIED',
    });
    expect(fixture.audit).not.toHaveBeenCalled();
    expect(fixture.remember).not.toHaveBeenCalled();
  });

  it('revocation during audit prevents mutation', async () => {
    const fixture = setup();
    fixture.audit.mockImplementation(async () => {
      fixture.verifySender.mockReturnValue(false);
    });
    expect(await fixture.call('remember', { sessionId: 'conversation-1', text: 'note' })).toEqual({
      ok: false,
      error: 'DENIED',
    });
    expect(fixture.remember).not.toHaveBeenCalled();
  });

  it.each([2, 3])('revocation during identity resolution %s prevents a memory write', async (revocationCall) => {
    const fixture = setup();
    let calls = 0;
    fixture.resolve.mockImplementation(async () => {
      calls += 1;
      if (calls === revocationCall) fixture.verifySender.mockReturnValue(false);
      return { memoryId: 'private-memory', running: false };
    });
    expect(await fixture.call('remember', { sessionId: 'conversation-1', text: 'note' })).toEqual({
      ok: false,
      error: 'DENIED',
    });
    expect(fixture.remember).not.toHaveBeenCalled();
  });

  it('identity replacement while approval is pending never touches either store', async () => {
    const fixture = setup();
    fixture.resolve.mockResolvedValueOnce({ memoryId: 'private-memory', running: false });
    fixture.resolve.mockResolvedValue({ memoryId: 'other-memory', running: false });
    expect(await fixture.call('clear', { sessionId: 'conversation-1' })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(fixture.clear).not.toHaveBeenCalled();
  });

  it('rechecks running state after approved audit', async () => {
    const fixture = setup();
    fixture.resolve.mockResolvedValueOnce({ memoryId: 'private-memory', running: false });
    fixture.resolve.mockResolvedValueOnce({ memoryId: 'private-memory', running: false });
    fixture.resolve.mockResolvedValue({ memoryId: 'private-memory', running: true });
    expect(await fixture.call('clear', { sessionId: 'conversation-1' })).toEqual({ ok: false, error: 'BUSY' });
    expect(fixture.clear).not.toHaveBeenCalled();
  });

  it.each(['identity-drift', 'sender-revoked', 'account-revoked', 'running'] as const)(
    'closes approved audit with a terminal receipt when final admission is %s, without mutation',
    async (reason) => {
      const fixture = setup();
      fixture.resolve.mockResolvedValueOnce({ memoryId: 'private-memory', running: false });
      fixture.resolve.mockResolvedValueOnce({ memoryId: 'private-memory', running: false });
      fixture.resolve.mockImplementation(async () => {
        if (reason === 'sender-revoked') fixture.verifySender.mockReturnValue(false);
        if (reason === 'account-revoked') return undefined;
        return {
          memoryId: reason === 'identity-drift' ? 'other-memory' : 'private-memory',
          running: reason === 'running',
        };
      });
      const result = await fixture.call(reason === 'running' ? 'clear' : 'remember', {
        sessionId: 'conversation-1',
        ...(reason === 'running' ? {} : { text: 'Never store this' }),
      });
      expect(result).toEqual({ ok: false, error: reason === 'running' ? 'BUSY' : 'DENIED' });
      expect(fixture.remember).not.toHaveBeenCalled();
      expect(fixture.clear).not.toHaveBeenCalled();
      expect(fixture.audit).toHaveBeenCalledTimes(2);
      const approved = fixture.audit.mock.calls[0]?.[0];
      expect(approved).toMatchObject({ conversationId: 'conversation-1', status: 'approved' });
      expect(fixture.audit.mock.calls[1]?.[0]).toEqual({
        ...approved,
        status: reason === 'running' ? 'busy-before-mutation' : 'denied-before-mutation',
      });
    }
  );

  it('awaits the terminal denial audit before returning the final rejected result', async () => {
    const fixture = setup();
    fixture.resolve.mockResolvedValueOnce({ memoryId: 'private-memory', running: false });
    fixture.resolve.mockResolvedValueOnce({ memoryId: 'private-memory', running: false });
    fixture.resolve.mockResolvedValue(undefined);
    const receipt = deferred<void>();
    fixture.audit.mockImplementation(async (record) => {
      if (record.status === 'denied-before-mutation') await receipt.promise;
    });
    let settled = false;
    const pending = fixture.call('remember', { sessionId: 'conversation-1', text: 'note' }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(fixture.audit).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    expect(fixture.remember).not.toHaveBeenCalled();
    receipt.resolve(undefined);
    expect(await pending).toEqual({ ok: false, error: 'DENIED' });
    expect(settled).toBe(true);
  });

  it('locks duplicate mutations while a human decision is pending and releases the lock after cancellation', async () => {
    const fixture = setup();
    const approval = deferred<boolean>();
    fixture.confirm.mockImplementationOnce(() => approval.promise);
    const first = fixture.call('remember', { sessionId: 'conversation-1', text: 'first' });
    await vi.waitFor(() => expect(fixture.confirm).toHaveBeenCalledTimes(1));
    expect(await fixture.call('clear', { sessionId: 'conversation-1' })).toEqual({ ok: false, error: 'BUSY' });
    approval.resolve(false);
    expect(await first).toEqual({ ok: false, error: 'CANCELLED' });
    expect(await fixture.call('remember', { sessionId: 'conversation-1', text: 'next' })).toMatchObject({ ok: true });
    expect(fixture.remember).toHaveBeenCalledTimes(1);
  });

  it('disposal unregisters channels and prevents an in-flight approval from mutating memory', async () => {
    const fixture = setup();
    const approval = deferred<boolean>();
    fixture.confirm.mockImplementationOnce(() => approval.promise);
    const pending = fixture.call('remember', { sessionId: 'conversation-1', text: 'note' });
    await vi.waitFor(() => expect(fixture.confirm).toHaveBeenCalledTimes(1));
    fixture.dispose();
    expect(fixture.handlers.size).toBe(0);
    approval.resolve(true);
    expect(await pending).toEqual({ ok: false, error: 'DENIED' });
    expect(fixture.remember).not.toHaveBeenCalled();
  });
});

describe('forgetting one Save item', () => {
  it('drops only the chosen item after native approval and records a receipt', async () => {
    const fixture = setup();
    const keep = await fixture.memory.remember('private-memory', { text: 'KEEP-ME', kind: 'fact' });
    const drop = await fixture.memory.remember('private-memory', { text: 'DROP-ME', kind: 'fact' });

    expect(await fixture.call('forget', { sessionId: 'conversation-1', itemId: drop.item.id })).toEqual({
      ok: true,
      data: true,
    });
    expect(fixture.confirm).toHaveBeenCalledWith(expect.anything(), 'forget');
    expect(fixture.memory.snapshot('private-memory').items.map((item) => item.id)).toEqual([keep.item.id]);
    expect(fixture.audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'forget', status: 'completed' }));
  });

  it('keeps the item when the user cancels the approval', async () => {
    const fixture = setup();
    const kept = await fixture.memory.remember('private-memory', { text: 'KEEP-ME', kind: 'fact' });
    fixture.confirm.mockResolvedValue(false);
    expect(await fixture.call('forget', { sessionId: 'conversation-1', itemId: kept.item.id })).toEqual({
      ok: false,
      error: 'CANCELLED',
    });
    expect(fixture.memory.snapshot('private-memory').items).toHaveLength(1);
  });

  it('reports false for an unknown item and rejects malformed requests', async () => {
    const fixture = setup();
    expect(await fixture.call('forget', { sessionId: 'conversation-1', itemId: 'missing' })).toEqual({
      ok: true,
      data: false,
    });
    expect(await fixture.call('forget', { sessionId: 'conversation-1' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await fixture.call('forget', { sessionId: 'conversation-1', itemId: '../x' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
  });

  it('never touches another conversation memory', async () => {
    const fixture = setup();
    fixture.resolve.mockResolvedValue({ memoryId: 'other-memory', running: false });
    const mine = await fixture.memory.remember('private-memory', { text: 'MINE', kind: 'fact' });
    expect(await fixture.call('forget', { sessionId: 'conversation-2', itemId: mine.item.id })).toEqual({
      ok: true,
      data: false,
    });
    expect(fixture.memory.snapshot('private-memory').items).toHaveLength(1);
  });
});
