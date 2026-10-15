import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { createMcpHost } from '@process/integrations/connections/hosts/exec/mcpHost';
import { createSourceMcpRuntime } from '@process/integrations/runtime/mcpSourceRuntime';
import type { HostContext } from '@process/integrations/connections/core/types';
import { McpRegistry } from '@process/resources/mcpRegistry/mcpRegistry';
import { packageConnectionMcpId } from '@process/resources/mcpRegistry/packageMcpSync';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MCPB/source → package MCP host → catalog (T5.7)', () => {
  it('enables an approved local Node script with Electron Node, cwd and package-owned cleanup', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tomny-mcpb-host-'));
    dirs.push(dir);
    await mkdir(path.join(dir, 'source', 'server'), { recursive: true });
    await writeFile(path.join(dir, 'source', 'server', 'index.js'), 'process.stdin.resume();\n');
    const parsed = parseAdapterDocument({
      schemaVersion: 1,
      generatedBy: 'classifier',
      connections: [
        {
          kind: 'mcp',
          id: 'weather-bundle',
          title: 'Weather MCPB',
          command: 'node',
          args: ['server/index.js'],
          cwd: 'source',
          origin: 'mcpb',
        },
      ],
    });
    const connection = parsed.connections[0];
    if (!connection || connection.kind !== 'mcp') throw new Error('Bad fixture');
    const context: HostContext = {
      packageId: 'community.weather',
      packageVersion: '1.0.0',
      packageDirectory: dir,
      readPackageFile: (name) => readFile(path.join(dir, name)),
    };
    const sourceRuntime = createSourceMcpRuntime({
      markerDirectory: path.join(dir, '.markers'),
      runtimeDirectory: path.join(dir, '.runtime'),
      nodeExecutable: 'ELECTRON_EXE',
    });
    let entries: Awaited<ReturnType<McpRegistry['list']>> = [];
    const registry = new McpRegistry({
      get: async () => structuredClone(entries),
      set: async (_key, next) => {
        entries = structuredClone(next);
      },
    });
    const host = createMcpHost({
      registry: async () => registry,
      secretPort: () => ({ list: async () => [], resolve: async () => ({}) }),
      commandExists: async () => false, // This machine intentionally has no system Node.
      sourceRuntime,
    });

    expect(await host.check(context, connection as never)).toEqual({ ok: true });
    const approval = await host.describe(context, connection as never);
    expect(approval.files).toContain('source/server/index.js');
    expect(await registry.list()).toHaveLength(0);
    const enabled = await host.enable(context, connection as never);
    expect(enabled.installed).toEqual([packageConnectionMcpId('community.weather', 'weather-bundle')]);
    expect(await registry.list()).toHaveLength(1);
    expect((await registry.list())[0]).toMatchObject({ enabled: true });
    // The server runs from a copy under the runtime folder, never from the signed package folder.
    const transport = (await registry.list())[0]?.transport as { cwd?: string; args?: string[]; command?: string };
    expect(transport).toMatchObject({ type: 'stdio', command: 'ELECTRON_EXE', env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(transport.cwd?.startsWith(path.join(dir, '.runtime', 'community.weather') + path.sep)).toBe(true);
    expect(transport.cwd).not.toBe(path.join(dir, 'source'));
    expect(transport.args).toEqual([path.join(transport.cwd ?? '', 'server', 'index.js')]);
    await host.disable(context, connection as never, enabled.installed);
    expect(await registry.list()).toEqual([]);
  });
});
