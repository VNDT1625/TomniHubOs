import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (request: unknown) => Promise<unknown>>();

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: (request: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler);
      },
      invoke: vi.fn(),
    }),
  },
}));

import { PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL } from '@/common/integrations/cli/packageCli';
import { registerPackageCliBridge } from '@process/integrations/connections/ipc/packageCliBridge';

describe('package CLI terminal bridge', () => {
  it('answers on its own channel with what the service says, and nothing after it is disposed', async () => {
    const terminalLaunch = vi.fn(async () => ({ ok: true as const, title: 'T', commandLine: 'ctx7 docs' }));
    const dispose = registerPackageCliBridge({ terminalLaunch });
    const handler = handlers.get(PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL);
    expect(handler).toBeDefined();

    const request = { packageId: 'com.x.y', connectionId: 'ctx7' };
    expect(await handler?.(request)).toEqual({ ok: true, title: 'T', commandLine: 'ctx7 docs' });
    expect(terminalLaunch).toHaveBeenCalledWith(request);

    dispose();
    expect(await handler?.(request)).toEqual({ ok: false, error: 'UNAVAILABLE' });
    expect(terminalLaunch).toHaveBeenCalledTimes(1);
  });

  it('hands the raw request to the service, which is the one that validates it', async () => {
    const terminalLaunch = vi.fn(async () => ({ ok: false as const, error: 'INVALID_REQUEST' as const }));
    registerPackageCliBridge({ terminalLaunch });
    const evil = { packageId: 'com.x.y', connectionId: 'ctx7', command: 'calc', cwd: 'C:\\' };
    expect(await handlers.get(PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL)?.(evil)).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(terminalLaunch).toHaveBeenCalledWith(evil);
  });
});
