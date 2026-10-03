import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_GEN_ENV_KEYS } from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer, type IProvider } from '@/common/config/storage';
import { runBackendMigrations } from '@/process/utils/runBackendMigrations';

const {
  batchImportServersMock,
  configFileGetMock,
  configFileSetMock,
  httpRequestMock,
  listServersMock,
  testMcpConnectionMock,
  toggleServerMock,
  updateServerMock,
} = vi.hoisted(() => ({
  batchImportServersMock: vi.fn(),
  configFileGetMock: vi.fn(),
  configFileSetMock: vi.fn(),
  httpRequestMock: vi.fn(),
  listServersMock: vi.fn(),
  testMcpConnectionMock: vi.fn(),
  toggleServerMock: vi.fn(),
  updateServerMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: httpRequestMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    listServers: { invoke: listServersMock },
    batchImportServers: { invoke: batchImportServersMock },
    updateServer: { invoke: updateServerMock },
    toggleServer: { invoke: toggleServerMock },
    testMcpConnection: { invoke: testMcpConnectionMock },
  },
}));

vi.mock('@/common/config/configMigration', () => ({
  migrateConfigStorage: vi.fn().mockResolvedValue(undefined),

  migrateProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/process/utils/initStorage', () => ({
  getBuiltinMcpScriptPath: (name: string) => `/mock/${name}.js`,
}));

vi.mock('@/process/utils/migrateAssistants', () => ({
  migrateAssistantsToBackend: vi.fn().mockResolvedValue(true),
}));

vi.mock('@process/browser/registerBrowserControlMcp', () => ({
  ensureBrowserControlMcpRegistered: vi.fn().mockResolvedValue(true),
}));

vi.mock('@process/cron/registerCronMcp', () => ({
  ensureCronMcpRegistered: vi.fn().mockResolvedValue(true),
}));

vi.mock('@process/manager/registerManagerMcp', () => ({
  ensureManagerMcpRegistered: vi.fn().mockResolvedValue(true),
}));

vi.mock('@process/automation/registerAutomationMcp', () => ({
  ensureAutomationMcpRegistered: vi.fn().mockResolvedValue(true),
}));

vi.mock('@process/editor/registerOfficeEditorMcp', () => ({
  ensureOfficeEditorMcpRegistered: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/common/config/constants', () => ({
  MUSIC_STUDIO_ENABLED: false,
}));

const provider: IProvider = {
  id: 'provider-1',
  platform: 'gemini',
  name: 'Gemini',
  base_url: 'https://generativelanguage.googleapis.com',
  api_key: 'provider-key',
  models: ['gemini-image'],
  enabled: true,
};

const imageEnv = {
  [IMAGE_GEN_ENV_KEYS.providerId]: 'provider-1',
  [IMAGE_GEN_ENV_KEYS.platform]: 'gemini',
  [IMAGE_GEN_ENV_KEYS.baseUrl]: 'https://generativelanguage.googleapis.com',
  [IMAGE_GEN_ENV_KEYS.apiKey]: 'provider-key',
  [IMAGE_GEN_ENV_KEYS.model]: 'gemini-image',
};

const antigravityCommand = process.platform === 'win32' ? 'agi.exe' : 'agi';

const imageServer = (): IMcpServer => ({
  id: 'image-server-id',
  name: BUILTIN_IMAGE_GEN_NAME,
  description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
  enabled: true,
  builtin: true,
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['/mock/builtin-mcp-image-gen.js'],
    env: imageEnv,
  },
  created_at: 1,
  updated_at: 1,
  original_json: JSON.stringify(
    {
      mcpServers: {
        [BUILTIN_IMAGE_GEN_NAME]: {
          command: 'node',
          args: ['/mock/builtin-mcp-image-gen.js'],
          env: imageEnv,
        },
      },
    },
    null,
    2
  ),
});

const configFile = {
  get: configFileGetMock,
  set: configFileSetMock,
};

beforeEach(() => {
  vi.clearAllMocks();
  configFileGetMock.mockResolvedValue(undefined);
  configFileSetMock.mockResolvedValue(undefined);
  batchImportServersMock.mockResolvedValue([]);
  updateServerMock.mockImplementation(async ({ id, data }) => ({
    ...imageServer(),
    id,
    ...data,
  }));
  toggleServerMock.mockImplementation(async ({ id }) => ({ ...imageServer(), id, enabled: false }));
  testMcpConnectionMock.mockResolvedValue({ success: false, error: 'Command not found: npx' });
  httpRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api/settings/client') {
      return {
        'tools.imageGenerationModel': {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
        },
      };
    }
    if (method === 'GET' && path === '/api/providers') {
      return [provider];
    }
    return undefined;
  });
});

describe('runBackendMigrations', () => {
  it('disables and scrubs the legacy image MCP before any provider lookup or MCP preflight', async () => {
    listServersMock.mockResolvedValue([imageServer()]);

    await runBackendMigrations(configFile as never);

    expect(httpRequestMock).not.toHaveBeenCalledWith('GET', '/api/providers');
    expect(httpRequestMock).not.toHaveBeenCalledWith('GET', '/api/settings/client');
    expect(configFileGetMock).not.toHaveBeenCalled();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(updateServerMock).toHaveBeenCalledWith({
      id: 'image-server-id',
      data: expect.objectContaining({ transport: expect.objectContaining({ env: {} }) }),
    });
    expect(toggleServerMock).toHaveBeenCalledWith({ id: 'image-server-id' });

    const imageUpdate = updateServerMock.mock.calls.find(([request]) => request.id === 'image-server-id')?.[0];
    expect(JSON.stringify(imageUpdate)).not.toContain('provider-key');
  });

  it('registers a missing image MCP disabled with no provider environment', async () => {
    listServersMock.mockResolvedValue([]);

    await runBackendMigrations(configFile as never);

    expect(httpRequestMock).not.toHaveBeenCalledWith('GET', '/api/providers');
    expect(testMcpConnectionMock).not.toHaveBeenCalled();

    const importedServers = batchImportServersMock.mock.calls[0]?.[0]?.servers as IMcpServer[];
    const importedImageServer = importedServers.find((server) => server.name === BUILTIN_IMAGE_GEN_NAME);
    expect(importedImageServer).toMatchObject({
      enabled: false,
      transport: { type: 'stdio', env: {} },
    });
    expect(JSON.stringify(importedImageServer)).not.toContain('provider-key');
  });

  it('rewrites a stale legacy image MCP JSON without re-enabling it', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        original_json: '{"legacy":true}',
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'yes',
      'yes',
      'yes'
    );
  });

  it('registers missing bootstrap CLI agents and refreshes the agent cache', async () => {
    listServersMock.mockResolvedValue([imageServer()]);
    httpRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return {};
      }
      if (method === 'GET' && path === '/api/providers') {
        return [provider];
      }
      if (method === 'GET' && path === '/api/agents') {
        return [];
      }
      return undefined;
    });

    await runBackendMigrations(configFile as never);

    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/agents/custom', {
      name: 'DeepSeek TUI',
      command: 'deepseek-tui',
      icon: 'ai-china/deepseek.svg',
      args: ['acp'],
      advanced: {
        description: 'DeepSeek Terminal UI (codewhale)',
        yolo_id: 'yolo',
      },
    });
    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/agents/custom', {
      name: 'Antigravity',
      command: antigravityCommand,
      icon: 'tools/antigravity.svg',
      args: ['acp'],
      advanced: {
        description: 'Antigravity CLI (agi.exe / agi)',
        yolo_id: 'yolo',
      },
    });
    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/agents/refresh');
  });

  it('updates stale bootstrap CLI agents instead of skipping them', async () => {
    listServersMock.mockResolvedValue([imageServer()]);
    httpRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return {};
      }
      if (method === 'GET' && path === '/api/providers') {
        return [provider];
      }
      if (method === 'GET' && path === '/api/agents') {
        return [
          {
            id: 'deepseek-row',
            agent_source: 'custom',
            name: 'DeepSeek TUI',
            command: 'deepseek-tui',
            args: [],
          },
          {
            id: 'antigravity-row',
            agent_source: 'custom',
            name: 'Antigravity',
            command: 'agi',
            args: [],
          },
        ];
      }
      return undefined;
    });

    await runBackendMigrations(configFile as never);

    expect(httpRequestMock).toHaveBeenCalledWith('PUT', '/api/agents/custom/deepseek-row', {
      name: 'DeepSeek TUI',
      command: 'deepseek-tui',
      icon: 'ai-china/deepseek.svg',
      args: ['acp'],
      advanced: {
        description: 'DeepSeek Terminal UI (codewhale)',
        yolo_id: 'yolo',
      },
    });
    expect(httpRequestMock).toHaveBeenCalledWith('PUT', '/api/agents/custom/antigravity-row', {
      name: 'Antigravity',
      command: antigravityCommand,
      icon: 'tools/antigravity.svg',
      args: ['acp'],
      advanced: {
        description: 'Antigravity CLI (agi.exe / agi)',
        yolo_id: 'yolo',
      },
    });
    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/agents/refresh');
  });
});
