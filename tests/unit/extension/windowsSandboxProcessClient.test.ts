import { describe, expect, it, vi } from 'vitest';
import {
  bindWindowsProcessTreeCleanup,
  terminateWindowsProcessTree,
} from '@/process/extensions/windowsSandboxProcessClient';
import type { WindowsCreatorSandboxNativeClient } from '@/process/extensions/windowsSandboxProtocol';

const createClient = (): {
  client: WindowsCreatorSandboxNativeClient;
  stop: ReturnType<typeof vi.fn>;
} => {
  const stop = vi.fn(async () => undefined);
  return {
    client: {
      start: vi.fn(async () => ({ capabilities: ['creator-sandbox.v1'] })),
      request: vi.fn(async () => ({})) as WindowsCreatorSandboxNativeClient['request'],
      stop,
      subscribeUnexpectedExit: vi.fn(() => () => undefined),
    },
    stop,
  };
};

const runningProcess = (pid = 42) => ({
  pid,
  killed: false,
  exitCode: null,
  signalCode: null,
});

describe('Windows Creator Preview process-tree cleanup', () => {
  it('invokes taskkill without a shell for a bounded process id', async () => {
    const execFileProcess = vi.fn((_file, _args, _options, callback: (error: Error | null) => void) => {
      callback(null);
    });

    await terminateWindowsProcessTree(42, execFileProcess);

    expect(execFileProcess).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '42', '/T', '/F'],
      { timeout: 8_000, windowsHide: true },
      expect.any(Function)
    );
  });

  it('rejects an invalid process id before invoking the operating system', async () => {
    const execFileProcess = vi.fn();

    await expect(terminateWindowsProcessTree(0, execFileProcess)).rejects.toThrow('positive safe integer');
    expect(execFileProcess).not.toHaveBeenCalled();
  });

  it('coalesces concurrent stops and terminates the full tree before stopping the client', async () => {
    const fixture = createClient();
    const order: string[] = [];
    fixture.stop.mockImplementation(async () => {
      order.push('client');
    });
    const terminate = vi.fn(async () => {
      order.push('tree');
    });
    const client = bindWindowsProcessTreeCleanup(fixture.client, () => runningProcess(), terminate);

    await Promise.all([client.stop(), client.stop()]);
    await client.stop();

    expect(terminate).toHaveBeenCalledOnce();
    expect(fixture.stop).toHaveBeenCalledOnce();
    expect(order).toEqual(['tree', 'client']);
  });

  it('surfaces tree termination failure permanently after the client fallback stops', async () => {
    const fixture = createClient();
    const terminate = vi.fn(async () => {
      throw new Error('taskkill denied');
    });
    const client = bindWindowsProcessTreeCleanup(fixture.client, () => runningProcess(), terminate);

    await expect(client.stop()).rejects.toThrow('taskkill denied');
    await expect(client.stop()).rejects.toThrow('taskkill denied');
    expect(terminate).toHaveBeenCalledOnce();
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('does not target a reused process id after the tracked root has exited', async () => {
    const fixture = createClient();
    const terminate = vi.fn(async () => undefined);
    const client = bindWindowsProcessTreeCleanup(
      fixture.client,
      () => ({ ...runningProcess(), exitCode: 0 }),
      terminate
    );

    await client.stop();

    expect(terminate).not.toHaveBeenCalled();
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('fails closed when a stale client tries to restart after disposal', async () => {
    const fixture = createClient();
    const client = bindWindowsProcessTreeCleanup(
      fixture.client,
      () => runningProcess(),
      vi.fn(async () => undefined)
    );

    await client.stop();

    await expect(client.start()).rejects.toThrow('process client is stopped');
    await expect(client.request('sandbox.health')).rejects.toThrow('process client is stopped');
    expect(fixture.client.start).not.toHaveBeenCalled();
  });

  it('notifies lifecycle cleanup once when a running sidecar exits without a requested stop', async () => {
    const fixture = createClient();
    let onExit: (() => void) | undefined;
    const process = {
      ...runningProcess(),
      once: vi.fn((_event: 'exit', listener: () => void) => {
        onExit = listener;
      }),
    };
    const client = bindWindowsProcessTreeCleanup(
      fixture.client,
      () => process,
      vi.fn(async () => undefined)
    );
    const onUnexpectedExit = vi.fn();

    const unsubscribe = client.subscribeUnexpectedExit(onUnexpectedExit);
    await client.start();
    onExit?.();
    onExit?.();
    unsubscribe();

    expect(process.once).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(onUnexpectedExit).toHaveBeenCalledOnce();
  });
});
