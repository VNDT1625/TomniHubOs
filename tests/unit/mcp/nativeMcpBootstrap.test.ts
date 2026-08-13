import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCoreNativeMcpRegistrars,
  resetNativeMcpBootstrapForTests,
  runNativeMcpBootstrap,
  type NativeMcpRegistrar,
} from '@process/resources/mcpRegistry/nativeMcpBootstrap';

beforeEach(() => {
  resetNativeMcpBootstrapForTests();
});

describe('native MCP bootstrap lifecycle', () => {
  it('keeps optional application MCP registrars out of the Hub base', () => {
    expect(createCoreNativeMcpRegistrars().map((registrar) => registrar.name)).toEqual([
      'agent-orchestrator',
      'secret-context',
      'cron',
      'manager',
      'system-info',
      'automation',
      'realtime-knowledge',
    ]);
  });

  it('seeds and registers MCP servers when the legacy backend is not started', async () => {
    const calls: string[] = [];
    const registrars: NativeMcpRegistrar[] = [
      { name: 'ide', run: async () => (calls.push('ide'), true) },
      { name: 'browser', run: async () => (calls.push('browser'), true) },
    ];

    const result = await runNativeMcpBootstrap({
      legacyBackendStarted: false,
      ensureLegacyImport: async () => {
        calls.push('legacy-import');
      },
      seedDefaults: async () => {
        calls.push('defaults');
      },
      registrars,
    });

    expect(result).toEqual({ seeded: true, registered: ['ide', 'browser'], failed: [] });
    expect(calls).toEqual(['legacy-import', 'defaults', 'ide', 'browser']);
  });

  it('is idempotent and does not start built-in hosts twice', async () => {
    const register = vi.fn(async () => true);
    const options = {
      legacyBackendStarted: false,
      ensureLegacyImport: vi.fn(async () => undefined),
      seedDefaults: vi.fn(async () => undefined),
      registrars: [{ name: 'ide', run: register }],
    };

    await Promise.all([runNativeMcpBootstrap(options), runNativeMcpBootstrap(options)]);

    expect(options.seedDefaults).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('continues other registrations when one built-in host fails', async () => {
    const result = await runNativeMcpBootstrap({
      legacyBackendStarted: false,
      ensureLegacyImport: async () => undefined,
      seedDefaults: async () => undefined,
      registrars: [
        { name: 'broken', run: async () => Promise.reject(new Error('port unavailable')) },
        { name: 'healthy', run: async () => true },
      ],
    });

    expect(result.registered).toEqual(['healthy']);
    expect(result.failed).toEqual([{ name: 'broken', error: 'port unavailable' }]);
  });
});
