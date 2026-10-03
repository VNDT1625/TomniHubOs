import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureLegacyImport: vi.fn(),
  getBuiltinMcpScriptPath: vi.fn(() => '/mock/builtin-mcp-image-gen.js'),
  listReadyProviders: vi.fn(),
  registry: {
    importMany: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    toggle: vi.fn(),
  },
}));

vi.mock('@process/resources/mcpRegistry/mcpRegistryBridge', () => ({
  ensureLegacyMcpImported: mocks.ensureLegacyImport,
  getMcpRegistry: () => mocks.registry,
}));

vi.mock('@process/services/tomnyProviderBridge', () => ({
  listReadyProviders: mocks.listReadyProviders,
}));

vi.mock('@process/utils/initStorage', () => ({
  getBuiltinMcpScriptPath: mocks.getBuiltinMcpScriptPath,
}));
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer } from '@/common/config/storage';
import {
  createCoreNativeMcpRegistrars,
  createDisabledNativeImageMcpServer,
  ensureNativeDefaultMcpServers,
  resetNativeMcpBootstrapForTests,
  runNativeMcpBootstrap,
  type NativeMcpRegistrar,
} from '@process/resources/mcpRegistry/nativeMcpBootstrap';

beforeEach(() => {
  vi.clearAllMocks();
  resetNativeMcpBootstrapForTests();
  mocks.ensureLegacyImport.mockResolvedValue(undefined);
  mocks.registry.importMany.mockResolvedValue([]);
  mocks.registry.list.mockResolvedValue([]);
  mocks.registry.update.mockResolvedValue(undefined);
  mocks.registry.toggle.mockResolvedValue(undefined);
});

describe('native MCP bootstrap lifecycle', () => {
  it('keeps optional and account-gated MCP hosts out of the pre-login Hub bootstrap', () => {
    const registrarNames = createCoreNativeMcpRegistrars().map((registrar) => registrar.name);
    expect(registrarNames).toEqual([
      'agent-orchestrator',
      'secret-context',
      'cron',
      'manager',
      'system-info',
      'realtime-knowledge',
    ]);
    expect(registrarNames).not.toContain('automation');
  });

  it('disables the legacy BYOK image MCP and removes the provider credential before it can run', () => {
    const legacyServer: IMcpServer = {
      id: 'image-server',
      name: BUILTIN_IMAGE_GEN_NAME,
      description: 'legacy image MCP',
      enabled: true,
      builtin: true,
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['legacy-image-server.js'],
        env: {
          TOMNY_IMG_PROVIDER_ID: 'provider-1',
          TOMNY_IMG_PLATFORM: 'gemini',
          TOMNY_IMG_BASE_URL: 'https://provider.example',
          TOMNY_IMG_API_KEY: 'provider-key-must-not-reach-child',
          TOMNY_IMG_MODEL: 'image-model',
          SAFE_LOCAL_FLAG: 'preserved',
        },
      },
      original_json: '{}',
      created_at: 1,
      updated_at: 1,
    };

    const server = createDisabledNativeImageMcpServer(legacyServer);

    expect(server.enabled).toBe(false);
    expect(server.transport.type).toBe('stdio');
    if (server.transport.type !== 'stdio') return;
    expect(server.transport.env).toEqual({ SAFE_LOCAL_FLAG: 'preserved' });
    expect(server.original_json).not.toContain('provider-key-must-not-reach-child');
    expect(server.original_json).not.toContain('TOMNY_IMG_API_KEY');
  });

  it('persists the disabled, scrubbed image descriptor before a legacy child can be started', async () => {
    const legacyServer: IMcpServer = {
      id: 'image-server',
      name: BUILTIN_IMAGE_GEN_NAME,
      description: 'legacy image MCP',
      enabled: true,
      builtin: true,
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['legacy-image-server.js'],
        env: {
          TOMNY_IMG_API_KEY: 'provider-key-must-not-reach-child',
          SAFE_LOCAL_FLAG: 'preserved',
        },
      },
      original_json: '{"contains":"provider-key-must-not-reach-child"}',
      created_at: 1,
      updated_at: 1,
    };
    mocks.registry.list.mockResolvedValue([legacyServer]);

    await ensureNativeDefaultMcpServers();

    expect(mocks.listReadyProviders).not.toHaveBeenCalled();
    const imageUpdate = mocks.registry.update.mock.calls.find(([id]) => id === legacyServer.id);
    expect(imageUpdate).toBeDefined();
    expect(mocks.registry.toggle).toHaveBeenCalledWith(legacyServer.id);
    const transport = imageUpdate?.[1]?.transport;
    expect(transport).toMatchObject({ type: 'stdio', env: { SAFE_LOCAL_FLAG: 'preserved' } });
    expect(JSON.stringify(imageUpdate?.[1])).not.toContain('provider-key-must-not-reach-child');
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
