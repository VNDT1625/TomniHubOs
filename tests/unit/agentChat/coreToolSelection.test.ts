import { describe, expect, it } from 'vitest';

import {
  resolveCoreCapabilityServerNames,
  resolveCoreToolCatalogPolicy,
    sessionMcpToolPatterns,
  shouldPrefetchAttachedFileTools,

} from '../../../packages/desktop/src/process/experimentalCore/experimentalCoreRuntime';

const capability = (id: string, serverName: string, toolPatterns: string[]) => ({
  id,
  label: id,
  kind: 'mcp' as const,
  serverName,
  toolPatterns,
  minimumPermissionMode: 'read-only' as const,
});

const chatSurface = {
  manifest: { id: 'chat' },
  capabilities: [
    capability('core.skill-workflow', 'tomny-tool-selector', ['tools_search', 'skills_*']),
    capability('core.agent-orchestrator', 'tomny-agent-orchestrator', ['agent_spawn', 'agent_result']),
    capability('core.workspace-read', 'tomny-core-workspace', ['tomny_read']),
    capability('core.secret-context', 'tomny-secret-context', ['tomny_secret_capture']),
  ],
} as never;

describe('auto-preloaded attachment tools', () => {
  it('only preloads bounded file schemas for Main-verified large files with granted read AND search', () => {
    expect(shouldPrefetchAttachedFileTools(true, ['tomny_read', 'tomny_search'], ['tomny-core-workspace'])).toBe(true);
    expect(shouldPrefetchAttachedFileTools(true, ['tomny_*'], ['tomny-ide'])).toBe(true);
    expect(shouldPrefetchAttachedFileTools(false, ['tomny_*'], ['tomny-ide'])).toBe(false);
    expect(shouldPrefetchAttachedFileTools(true, ['tomny_read'], ['tomny-core-workspace'])).toBe(false);
    expect(shouldPrefetchAttachedFileTools(true, ['tomny_*'], ['tomny-browser-control'])).toBe(false);
  });
});

describe('the tool catalog a surface exposes does not depend on what the pipeline chose', () => {
  it('keeps every tool of the surface findable, so a wrong choice costs a step and never a tool', () => {
    const catalog = resolveCoreToolCatalogPolicy(chatSurface, false);
    expect(catalog.mode).toBe('surface');
    expect(catalog.patterns).toEqual(
      expect.arrayContaining([
        'tomny_session_actions',
        'tools_search',
        'skills_*',
        'agent_spawn',
        'tomny_read',
        'tomny_secret_capture',
      ])
    );
    expect(resolveCoreCapabilityServerNames(chatSurface, undefined, false)).toEqual([
      'tomny-tool-selector',
      'tomny-agent-orchestrator',
      'tomny-core-workspace',
      'tomny-secret-context',
    ]);
  });

  it('lets the tools of an MCP server the user picked for the conversation through the catalog', () => {
    const catalog = resolveCoreToolCatalogPolicy(chatSurface, false, [{ name: 'Context7' }, { name: 'my server' }]);
    expect(catalog.patterns).toEqual(
      expect.arrayContaining(['mcp__Context7__*', 'mcp__my server__*', 'mcp__my_server__*', 'tomny_session_actions'])
    );
    const without = resolveCoreToolCatalogPolicy(chatSurface, false);
    expect(without.patterns.some((pattern) => pattern.startsWith('mcp__'))).toBe(false);
  });

  it('writes no pattern for a server without a name', () => {
    expect(sessionMcpToolPatterns([{ name: '  ' }])).toEqual([]);
    expect(sessionMcpToolPatterns()).toEqual([]);
  });

  it('keeps Super limited to the resolved capability set rather than advertising every catalog entry', () => {
    expect(resolveCoreToolCatalogPolicy(chatSurface, true)).toEqual({
      mode: 'super',
      patterns: [
        'tomny_session_actions',
        'tools_search',
        'skills_*',
        'agent_spawn',
        'agent_result',
        'tomny_read',
        'tomny_secret_capture',
      ],
    });
  });
});
