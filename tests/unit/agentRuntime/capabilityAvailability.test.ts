import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBuiltinSurfaceManifests,
  createSurfaceRegistry,
  validateSurfaceManifest,
} from '@process/agentRuntime/surfaceRegistry';
import {
  resolveCoreCapabilityServerNames,
  resolveCoreSuperCapabilities,
  resolveCoreToolCatalogPolicy,
} from '@process/experimentalCore/experimentalCoreRuntime';
import { createToolSelectorServer } from '@process/resources/builtinMcp/toolSelectorServer';
import { renderToolNameGuide } from '@process/toolselect/builtinToolCatalog';
import { getToolScope, registerToolScope } from '@process/toolselect/toolScope';

const request = {
  model: { targetKind: 'builtin' as const, protocol: 'tomny-json-stream' },
  permissionMode: 'full-access' as const,
  grantedPermissionScopes: [
    'workspace.read',
    'workspace.write',
    'browser.control',
    'office.read',
    'office.write',
    'make-film.read',
    'make-film.write',
    'music.read',
    'music.write',
  ],
  explicitlyGrantedCapabilityIds: [
    'surface.ide',
    'surface.browser',
    'surface.office',
    'surface.make-film',
    'surface.music',
  ],
};

const registry = () => createSurfaceRegistry({ manifests: createBuiltinSurfaceManifests(), defaultSurfaceId: 'chat' });

const availabilityOf = (id: string): string | undefined =>
  createBuiltinSurfaceManifests()
    .flatMap((manifest) => manifest.capabilities)
    .find((capability) => capability.id === id)?.availability;

describe('capability availability tiers', () => {
  it('tags each built-in capability with where its tools can load', () => {
    for (const id of ['core.skill-workflow', 'core.agent-orchestrator', 'core.secret-context', 'core.workspace-read']) {
      expect(availabilityOf(id)).toBe('core');
    }
    for (const id of ['surface.browser', 'surface.office']) expect(availabilityOf(id)).toBe('portable');
    for (const id of ['surface.ide', 'surface.make-film', 'surface.music']) {
      expect(availabilityOf(id)).toBe('surface-only');
    }
  });

  it('rejects a capability whose availability is not a known tier', () => {
    const manifest = createBuiltinSurfaceManifests().find((item) => item.id === 'office');
    const broken = structuredClone(manifest);
    (broken?.capabilities[broken.capabilities.length - 1] as { availability?: string }).availability = 'everywhere';
    const result = validateSurfaceManifest(broken);
    expect(result.valid).toBe(false);
  });

  it('gives Super the portable capabilities but not a surface-only one it is not inside', () => {
    const hosts = [
      'tomny-tool-selector',
      'tomny-agent-orchestrator',
      'tomny-secret-context',
      'tomny-core-workspace',
      'tomny-browser-control',
      'tomny-office-editor',
      'tomny-ide',
      'tomny-make-film',
      'tomny-music',
    ];
    const capabilities = resolveCoreSuperCapabilities(registry(), request, hosts, 'chat');
    const ids = capabilities.map((capability) => capability.id);

    expect(ids).toEqual(expect.arrayContaining(['core.workspace-read', 'surface.browser', 'surface.office']));
    for (const surfaceOnly of ['surface.ide', 'surface.make-film', 'surface.music']) {
      expect(ids).not.toContain(surfaceOnly);
    }

    const policy = resolveCoreToolCatalogPolicy(undefined, true, [], capabilities);
    expect(policy.patterns).toEqual(expect.arrayContaining(['browser_*', 'office_*', 'tomny_read']));
    expect(policy.patterns).not.toContain('ide_*');
    expect(resolveCoreCapabilityServerNames(undefined, registry(), true, hosts, capabilities)).not.toContain(
      'tomny-ide'
    );
  });

  it('loads a surface-only capability once Super is inside its own surface', () => {
    const hosts = ['tomny-ide', 'tomny-browser-control', 'tomny-office-editor', 'tomny-music'];
    const ids = resolveCoreSuperCapabilities(registry(), request, hosts, 'ide').map((capability) => capability.id);

    expect(ids).toEqual(expect.arrayContaining(['surface.ide', 'surface.browser', 'surface.office']));
    expect(ids).not.toContain('surface.music');
  });

  it('treats a capability that does not declare a tier as surface-only', () => {
    const custom = createBuiltinSurfaceManifests().find((item) => item.id === 'chat');
    const manifest = {
      ...structuredClone(custom),
      id: 'plugin-surface',
      priority: 1,
      capabilities: [
        {
          id: 'plugin.tools',
          label: 'Plugin tools',
          kind: 'mcp' as const,
          serverName: 'plugin-host',
          toolPatterns: ['plugin_*'],
          minimumPermissionMode: 'read-only' as const,
        },
      ],
    };
    const custom2 = createSurfaceRegistry({ manifests: [manifest as never], defaultSurfaceId: 'plugin-surface' });
    expect(resolveCoreSuperCapabilities(custom2, request, undefined, 'chat')).toEqual([]);
    expect(resolveCoreSuperCapabilities(custom2, request, undefined, 'plugin-surface')).toHaveLength(1);
  });
});

describe('tool scope for the selector', () => {
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  const connect = async (patterns?: readonly string[]): Promise<Client> => {
    const server = createToolSelectorServer(
      {
        toolSelector: { shortlist: vi.fn(async () => []), select: vi.fn() },
        selectionLog: {
          hashRequest: vi.fn(),
          record: vi.fn(),
          recall: vi.fn(async () => undefined),
          all: vi.fn(async () => []),
        } as never,
      },
      patterns
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'scope-test', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);
    return client;
  };

  const text = (result: Awaited<ReturnType<Client['callTool']>>): string => {
    const block = result.content[0];
    return block?.type === 'text' ? block.text : '';
  };

  it('names only the tools the conversation can load', () => {
    const guide = renderToolNameGuide(undefined, ['browser_*', 'quick_test_*', 'tomny_read']);
    expect(guide).toContain('browser_open');
    expect(guide).toContain('quick_test_discover');
    expect(guide).toContain('tomny_read');
    expect(guide).not.toContain('office_read_document');
    expect(guide).not.toContain('ide_quick_test_run');
    expect(guide).not.toContain('tomny_command');
  });

  it('answers tools_guide for the scope of the conversation, and for all tools without one', async () => {
    const scoped = await connect(['office_*']);
    const reply = text(await scoped.callTool({ name: 'tools_guide', arguments: {} }));
    expect(reply).toContain('office_set_cells');
    expect(reply).not.toContain('browser_open');

    const open = await connect();
    expect(text(await open.callTool({ name: 'tools_guide', arguments: {} }))).toContain('browser_open');
  });

  it('gives the same scope id for the same tool set and resolves it', () => {
    const first = registerToolScope(['b_*', 'a_*']);
    expect(registerToolScope(['a_*', 'b_*', ' a_* '])).toBe(first);
    expect(getToolScope(first)).toEqual(['a_*', 'b_*']);
    expect(getToolScope('missing')).toBeUndefined();
    expect(getToolScope(null)).toBeUndefined();
  });
});
