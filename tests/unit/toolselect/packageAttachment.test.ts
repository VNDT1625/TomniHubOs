/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Enabled package plugins attach in every capability mode (2026-10-16). The wiring gathers each enabled package-owned
 * MCP server with its package's skills and active hooks; the pure attachment then names the server, its tools and its
 * skills in the context block. A failing plugin is named as not connected and is never attached. The limit is four
 * package servers per turn, newest first, and a server auto select already attached counts against it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer, TChatConversation } from '@/common/config/storage';
import {
  PACKAGE_PLUGIN_ATTACH_LIMIT,
  buildPackageAttachmentTurn,
  type CapabilityTurn,
  type PackagePluginEntry,
} from '@process/services/chatPipeline/stages/capabilitySelect';
import { configureCapabilityRegistrySource, resolvePackageAttachmentTurn } from '@process/toolselect/wiring';

const fixtures = vi.hoisted(() => ({
  skills: [] as unknown[],
  hooks: [] as unknown[],
}));

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/tomny-package-attachment' } }));
vi.mock('@process/resources/nativePlatform/capabilityBridge', () => ({
  createNativeSkillCatalog: () => ({ list: async () => fixtures.skills }),
}));
vi.mock('@process/integrations/hookRuntime/hookDispatcher', () => ({
  getHookRegistry: async () => ({ listHooks: async () => fixtures.hooks }),
}));
vi.mock('@process/resources/builtinMcp/capabilityFallback', () => ({
  activatedCapabilityIds: () => [],
  createCapabilityFallback: () => ({}),
  packageCandidates: () => [],
}));
vi.mock('@process/toolselect/catalog', () => ({ createCatalog: () => ({}) }));
vi.mock('@process/toolselect/builtinToolCatalog', () => ({ listBuiltinMcpToolCatalog: () => [] }));
vi.mock('@process/toolselect/selectionLog', () => ({ createSelectionLog: () => ({}) }));
vi.mock('@process/toolselect/toolSelector', () => ({ createToolSelector: () => ({}) }));

const server = (id: string, overrides: Partial<IMcpServer> = {}): IMcpServer => ({
  id,
  name: id.split(':')[1] === 'context-mode' ? 'context-mode-source' : id.replace(/[^a-z0-9]+/g, '-'),
  enabled: true,
  transport: { type: 'stdio', command: 'npx', args: ['-y', 'context-mode'] },
  last_test_status: 'connected',
  tools: [{ name: 'ctx_search' }, { name: 'ctx_index' }],
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
  extension: { name: 'package:context-mode', displayName: 'Context Mode' },
  ...overrides,
});

const CONTEXT_MODE = 'pkgconn:context-mode:source';

const conversation = (extra: Record<string, unknown> = {}): TChatConversation =>
  ({ id: 'conv-1', type: 'acp', extra: { capabilityMode: 'manual', ...extra } }) as unknown as TChatConversation;

const entry = (serverId: string, overrides: Partial<PackagePluginEntry> = {}): PackagePluginEntry => ({
  serverId,
  serverName: serverId,
  title: serverId,
  packageId: 'pkg',
  updatedAt: 1,
  health: 'connected',
  toolNames: [],
  skills: [],
  hookCount: 0,
  session: { id: serverId, name: serverId, transport: { type: 'stdio', command: 'npx', args: [] } },
  ...overrides,
});

describe('enabled package plugins attach in every capability mode', () => {
  beforeEach(() => {
    fixtures.skills = [
      { name: 'ctx-doctor', description: 'Diagnose the Context Mode setup', packageId: 'context-mode' },
      { name: 'ctx-stats', description: '', packageId: 'context-mode' },
      { name: 'pptx', description: 'Create slides', packageId: undefined },
    ];
    fixtures.hooks = [
      { id: 'h1', pluginId: 'context-mode', event: 'PostToolUse', enabled: true, approved: true, active: true },
      { id: 'h2', pluginId: 'context-mode', event: 'Stop', enabled: true, approved: true, active: false },
    ];
    configureCapabilityRegistrySource(async () => [server(CONTEXT_MODE)]);
  });

  it('attaches a connected plugin in manual mode with its server, tools, skills and hook count', async () => {
    const turn = await resolvePackageAttachmentTurn(conversation(), undefined);
    expect(turn?.attachedServerIds).toEqual([CONTEXT_MODE]);
    expect(turn?.mcpServers.map((item) => item.name)).toEqual(['context-mode-source']);
    expect(turn?.hint).toContain(
      '- Context Mode (package context-mode): MCP server context-mode-source, enabled and connected.'
    );
    expect(turn?.hint).toContain('mcp__context-mode-source__ctx_search, mcp__context-mode-source__ctx_index');
    expect(turn?.hint).toContain('    - ctx-doctor: Diagnose the Context Mode setup');
    expect(turn?.hint).toContain('    - ctx-stats');
    expect(turn?.hint).not.toContain('pptx');
    expect(turn?.hint).toContain('1 run automatically on their events');
    expect(turn?.hint).toContain(`id "mcp:${CONTEXT_MODE}"`);
    expect(turn?.hint).toContain('Do not call tools_search');
  });

  it('leaves out the skills the conversation opted out of', async () => {
    const turn = await resolvePackageAttachmentTurn(
      conversation({ exclude_auto_inject_skills: ['ctx-doctor'] }),
      undefined
    );
    expect(turn?.hint).not.toContain('ctx-doctor');
    expect(turn?.hint).toContain('    - ctx-stats');
  });

  it('returns nothing when no package plugin is enabled, so the send is unchanged', async () => {
    configureCapabilityRegistrySource(async () => [
      server(CONTEXT_MODE, { enabled: false }),
      server('builtin-browser', { builtin: true, extension: undefined }),
    ]);
    expect(await resolvePackageAttachmentTurn(conversation(), undefined)).toBeUndefined();
  });

  it('returns nothing when the registry cannot be read', async () => {
    configureCapabilityRegistrySource(async () => {
      throw new Error('registry unavailable');
    });
    expect(await resolvePackageAttachmentTurn(conversation(), undefined)).toBeUndefined();
  });

  it('never attaches a failing plugin, names it as not connected, and does not repeat its error', async () => {
    configureCapabilityRegistrySource(async () => [
      server(CONTEXT_MODE, { last_test_status: 'error', last_test_error: 'token=sk-test-123 refused' }),
    ]);
    const turn = await resolvePackageAttachmentTurn(conversation(), undefined);
    expect(turn?.mcpServers).toEqual([]);
    expect(turn?.attachedServerIds).toEqual([]);
    expect(turn?.hint).toContain(
      'Context Mode (package context-mode): enabled but not connected and not attached this turn (its last connection test failed; reconnect it in Settings).'
    );
    expect(turn?.hint).not.toContain('sk-test-123');
  });

  it('attaches an untested plugin and says it is not connected yet', async () => {
    configureCapabilityRegistrySource(async () => [server(CONTEXT_MODE, { last_test_status: undefined })]);
    const turn = await resolvePackageAttachmentTurn(conversation(), undefined);
    expect(turn?.attachedServerIds).toEqual([CONTEXT_MODE]);
    expect(turn?.hint).toContain('enabled but not connected yet');
  });

  it('caps the package servers at the limit, newest first, and names the ones left out', async () => {
    configureCapabilityRegistrySource(async () =>
      Array.from({ length: 6 }, (_unused, index) =>
        server(`pkgconn:pkg-${index}:source`, {
          name: `server-${index}`,
          updated_at: index,
          extension: undefined,
          tools: [],
        })
      )
    );
    const turn = await resolvePackageAttachmentTurn(conversation(), undefined);
    expect(PACKAGE_PLUGIN_ATTACH_LIMIT).toBe(4);
    expect(turn?.attachedServerIds).toEqual([
      'pkgconn:pkg-5:source',
      'pkgconn:pkg-4:source',
      'pkgconn:pkg-3:source',
      'pkgconn:pkg-2:source',
    ]);
    expect(turn?.mcpServers).toHaveLength(PACKAGE_PLUGIN_ATTACH_LIMIT);
    expect(turn?.hint).toContain(
      '(package pkg-1): enabled, not attached this turn (the limit is 4 package plugins per turn).'
    );
    expect(turn?.hint).toContain('mcp__server-5__<tool> (names are known at run start)');
  });

  it('counts a server that auto select already attached against the same limit', async () => {
    configureCapabilityRegistrySource(async () =>
      Array.from({ length: 6 }, (_unused, index) =>
        server(`pkgconn:pkg-${index}:source`, {
          name: `server-${index}`,
          updated_at: index,
          extension: undefined,
          tools: [],
        })
      )
    );
    const autoTurn = { mcpServerIds: ['pkgconn:pkg-0:source'] } as unknown as CapabilityTurn;
    const turn = await resolvePackageAttachmentTurn(conversation({ capabilityMode: 'auto' }), autoTurn);
    expect(turn?.attachedServerIds).toHaveLength(PACKAGE_PLUGIN_ATTACH_LIMIT);
    expect(turn?.attachedServerIds).toContain('pkgconn:pkg-0:source');
    expect(turn?.attachedServerIds).not.toContain('pkgconn:pkg-2:source');
  });
});

describe('buildPackageAttachmentTurn', () => {
  it('returns nothing without entries', () => {
    expect(buildPackageAttachmentTurn({ entries: [] })).toBeUndefined();
  });

  it('describes a connected plugin without any secret-looking transport value', () => {
    const turn = buildPackageAttachmentTurn({
      entries: [
        entry('pkgconn:alpha:one', {
          serverName: 'alpha-one',
          title: 'Alpha',
          packageId: 'alpha',
          session: {
            id: 'pkgconn:alpha:one',
            name: 'alpha-one',
            transport: { type: 'stdio', command: 'npx', args: ['--token', 'sk-live-should-not-appear'] },
          },
        }),
      ],
    });
    expect(turn?.hint).toContain('- Alpha (package alpha): MCP server alpha-one, enabled and connected.');
    expect(turn?.hint).not.toContain('sk-live-should-not-appear');
  });
});
