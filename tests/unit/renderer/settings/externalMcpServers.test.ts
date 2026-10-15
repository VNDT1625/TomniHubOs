import { describe, expect, it } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import { selectExternalMcpServers } from '@/renderer/pages/settings/ToolsSettings/externalMcpServers';
import { packageOwnerOfMcpServer } from '@process/resources/mcpRegistry/packageMcpSync';

const server = (name: string, builtin?: boolean): IMcpServer =>
  ({
    id: name,
    name,
    enabled: true,
    transport: { type: 'stdio', command: 'node', args: [] },
    created_at: 1,
    updated_at: 1,
    ...(builtin === undefined ? {} : { builtin }),
  }) as IMcpServer;

describe('selectExternalMcpServers', () => {
  it('hides the loopback servers behind in-app Tomny capabilities', () => {
    const all = [
      server('tomny-agent-orchestrator', true),
      server('tomny-secret-context', true),
      server('browser-control', true),
      server('github'),
      server('from-repo', false),
    ];
    expect(selectExternalMcpServers(all).map((item) => item.name)).toEqual(['github', 'from-repo']);
  });

  it('hides the servers a package made, because its plugin switches them', () => {
    const all = [
      server('github'),
      { ...server('context-mode'), id: 'pkgconn:com.x.context:context-mode' } as IMcpServer,
      { ...server('legacy-mirror'), id: 'package:com.x.legacy/mcp' } as IMcpServer,
    ];
    expect(selectExternalMcpServers(all).map((item) => item.name)).toEqual(['github']);
  });

  it('names the package that owns a connection or a legacy server', () => {
    expect(packageOwnerOfMcpServer({ id: 'pkgconn:com.x.context:context-mode' })).toBe('com.x.context');
    expect(packageOwnerOfMcpServer({ id: 'package:com.x.legacy/mcp' })).toBe('com.x.legacy');
    expect(packageOwnerOfMcpServer({ id: 'github' })).toBeUndefined();
  });

  it('keeps an empty list empty and does not mutate its input', () => {
    const all = [server('a', true), server('b')];
    expect(selectExternalMcpServers([])).toEqual([]);
    selectExternalMcpServers(all);
    expect(all.map((item) => item.name)).toEqual(['a', 'b']);
  });
});
