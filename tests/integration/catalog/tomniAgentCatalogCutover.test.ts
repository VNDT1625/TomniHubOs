import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@process/experimentalCore/coreRegistry', () => ({
  detectCoreTargets: vi.fn(async () => [
    {
      id: 'codex',
      name: 'Codex CLI',
      protocol: 'codex-app-server',
      candidates: ['codex'],
      args: ['app-server'],
      detail: 'Codex',
      runnable: true,
      detected: true,
      available: true,
      command: 'codex',
    },
  ]),
  resolveExecutableOnPath: vi.fn(async (candidates: string[]) => (candidates[0] === 'missing' ? null : candidates[0])),
}));

import { createAssistantCatalogStore } from '@process/resources/assistantCatalogStore';
import { createAgentCatalogStore } from '@process/resources/agentCatalogStore';
import { readLegacyCatalog } from '@process/services/database/legacyCatalogReader';

describe('Tomny assistant and agent catalog cutover', () => {
  it('persists assistant CRUD, state and import without legacy HTTP', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-assistants-'));
    const store = createAssistantCatalogStore(path.join(root, 'assistants.json'));
    const created = await store.create({ id: 'writer', name: 'Writer', models: ['model-a'] });
    expect(created).toMatchObject({ id: 'writer', enabled: true, source: 'user' });
    await store.setState({ id: 'writer', enabled: false, sort_order: 3 });
    expect(await store.update({ id: 'writer', description: 'Updated' })).toMatchObject({
      enabled: false,
      sort_order: 3,
      description: 'Updated',
    });
    expect(
      await store.importMany([
        { id: 'writer', name: 'Duplicate' },
        { id: 'reviewer', name: 'Reviewer' },
      ])
    ).toMatchObject({ imported: 1, skipped: 1, failed: 0 });
    expect((await store.list()).map((row) => row.id)).toEqual(['reviewer', 'writer']);
    expect(
      await store.importExisting([
        {
          id: 'legacy',
          source: 'extension',
          name: 'Legacy',
          name_i18n: { vi: 'Cũ' },
          description_i18n: {},
          enabled: false,
          sort_order: -1,
          preset_agent_type: 'acp',
          enabled_skills: [],
          custom_skill_names: [],
          disabled_builtin_skills: [],
          context_i18n: {},
          prompts: [],
          prompts_i18n: {},
          models: [],
          last_used_at: 42,
        },
      ])
    ).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    expect((await store.list())[0]).toMatchObject({
      id: 'legacy',
      source: 'extension',
      enabled: false,
      sort_order: -1,
      last_used_at: 42,
    });
    await store.remove('writer');
    expect((await store.list()).map((row) => row.id)).toEqual(['legacy', 'reviewer']);
  });

  it('merges detected adapters with durable custom agents and enabled overrides', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-agents-'));
    const filePath = path.join(root, 'agents.json');
    const store = createAgentCatalogStore(filePath);
    expect(await store.list()).toEqual([expect.objectContaining({ id: 'codex', available: true })]);
    const custom = await store.create({ name: 'Local ACP', command: 'local-acp', args: ['acp'] });
    expect(custom).toMatchObject({ agent_source: 'custom', available: true });
    expect(await store.setEnabled(custom.id, false)).toMatchObject({ enabled: false });
    expect(await store.test({ command: 'missing' })).toMatchObject({ step: 'fail_cli' });
    const restarted = createAgentCatalogStore(filePath);
    expect(await restarted.list()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: custom.id, enabled: false })])
    );
  });

  it('normalizes legacy provider capabilities and rejects unsupported agent types', async () => {
    const snapshot = await readLegacyCatalog({
      readConfig: vi.fn(async (key: string): Promise<unknown> => {
        if (key === 'model.config') {
          return [
            {
              id: 'provider-1',
              platform: 'openai',
              name: 'Provider',
              capabilities: JSON.stringify([{ type: 'reasoning' }]),
            },
          ];
        }
        if (key === 'agents') {
          return [{ id: 'legacy-agent', name: 'Legacy agent', command: 'legacy-agent', agent_type: 'removed-core' }];
        }
        return [];
      }),
    });

    expect(snapshot.providers[0]?.capabilities).toEqual([{ type: 'reasoning' }]);
    expect(snapshot.agents[0]?.agent_type).toBe('acp');
  });

  it('filters malformed legacy catalog fields instead of trusting JSON shapes', async () => {
    const snapshot = await readLegacyCatalog({
      readConfig: vi.fn(async (key: string): Promise<unknown> => {
        if (key === 'model.config') {
          return [
            {
              id: 'provider-1',
              platform: 'openai',
              name: 'Provider',
              context_limit: '200000',
              capabilities: JSON.stringify([
                { type: 'reasoning', isUserSelected: true },
                { type: 'removed-capability' },
                'reasoning',
              ]),
              model_protocols: JSON.stringify({ valid: 'openai', invalid: 42 }),
              model_enabled: JSON.stringify({ valid: true, invalid: 'yes' }),
              bedrock_config: JSON.stringify({ auth_method: 'removed-method', region: 'us-east-1' }),
            },
          ];
        }
        if (key === 'agents') {
          return [
            {
              id: 'agent-1',
              name: 'Agent',
              command: 'agent',
              env: JSON.stringify([{ name: 'TOKEN', value: 'secret' }, { name: 'INVALID' }, 'TOKEN=leak']),
              behavior_policy: JSON.stringify({ supports_side_question: 'yes' }),
            },
          ];
        }
        return [];
      }),
    });

    expect(snapshot.providers[0]).toMatchObject({
      context_limit: 200000,
      capabilities: [{ type: 'reasoning', isUserSelected: true }],
      model_protocols: { valid: 'openai' },
      model_enabled: { valid: true },
      bedrock_config: { auth_method: 'accessKey', region: 'us-east-1' },
    });
    expect(snapshot.agents[0]).toMatchObject({
      env: [{ name: 'TOKEN', value: 'secret' }],
      behavior_policy: undefined,
    });
  });

  it('keeps catalog routes out of ipcBridge while preserving explicit import boundaries', async () => {
    const ipcSource = await readFile(
      path.join(process.cwd(), 'packages/desktop/src/common/adapter/ipcBridge.ts'),
      'utf8'
    );
    expect(ipcSource).not.toMatch(/httpGet<AgentMetadata\[\], void>/u);
    expect(ipcSource).not.toMatch(/httpGet<Assistant\[\], void>/u);
    expect(ipcSource).not.toContain("'/api/agents'");
    expect(ipcSource).not.toContain("'/api/assistants'");
    expect(ipcSource).not.toContain('/api/conversations/:id/mode');
    expect(ipcSource).not.toContain('/api/conversations/:id/model');
    expect(ipcSource).toContain('...agentChannels');
    expect(ipcSource).toContain('...sessionChannels');
    expect(ipcSource).toContain('assistants = assistantChannels');
    const boundary = await readFile(
      path.join(process.cwd(), 'packages/desktop/src/process/resources/agentCatalogBridge.ts'),
      'utf8'
    );
    expect(boundary).not.toContain('/api/assistants');
    expect(boundary).not.toContain('/api/agents');
    expect(boundary).toContain('readLegacyCatalog');
    expect(boundary).toContain('discoverLegacyDatabasePaths');
  });

  it('removes the generic provider-health route and makes Model Modal use only native saved-provider discovery', async () => {
    const [agentChannels, catalogBridge, modal, discoveryClient] = await Promise.all([
      readFile(path.join(process.cwd(), 'packages/desktop/src/common/types/agent/agentChannels.ts'), 'utf8'),
      readFile(path.join(process.cwd(), 'packages/desktop/src/process/resources/agentCatalogBridge.ts'), 'utf8'),
      readFile(
        path.join(
          process.cwd(),
          'packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx'
        ),
        'utf8'
      ),
      readFile(path.join(process.cwd(), 'packages/desktop/src/renderer/hooks/agent/useModeModeList.ts'), 'utf8'),
    ]);

    expect(agentChannels).not.toContain('tomni-agent.provider-health');
    expect(catalogBridge).not.toContain('checkProviderHealth');
    expect(catalogBridge).not.toContain('fetchProviderModelList');
    expect(modal).toContain('checkSavedProviderModelHealth(platform.id, modelName)');
    expect(modal).not.toContain('checkProviderHealth.invoke');
    expect(discoveryClient).toContain('providerDiscovery.fetchModels({ providerId })');
    expect(discoveryClient).not.toContain('import { ipcBridge }');
  });
});
