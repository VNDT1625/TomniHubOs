/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createCoreWorkspaceServer } from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';
import { createBuiltinSurfaceManifests, createSurfaceRegistry } from '@process/agentRuntime/surfaceRegistry';
import {
  BUILTIN_AVAILABLE_CAPABILITIES,
  resolveCoreCapabilityServerNames,
  resolveCoreToolCatalogPolicy,
} from '@process/experimentalCore/experimentalCoreRuntime';
import { createElectronSurfaceCapabilityHosts } from '@process/experimentalCore/electronSurfaceCapabilityHosts';
import {
    startCoreWorkspaceReadHost,
  startAttachedFileToolsHost,
  stopCoreWorkspaceReadHosts,
} from '@process/resources/nativeFile/coreWorkspaceMcpHost';

const folders: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch((): void => undefined)));
  await stopCoreWorkspaceReadHosts();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const workspace = (): string => {
  const folder = mkdtempSync(path.join(tmpdir(), 'tomny-read-host-'));
  folders.push(folder);
  return folder;
};

const toolNames = async (client: Client): Promise<string[]> =>
  (await client.listTools()).tools.map((tool) => tool.name).toSorted();

const connectInMemory = async (options: { readOnly?: boolean }): Promise<Client> => {
  const server = createCoreWorkspaceServer({ workspace: workspace(), ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'read-only-test', version: '1.0.0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
};

describe('the read-only Core workspace server', () => {
  it('only exposes eager read and search schemas for oversized attached files', async () => {
    const server = createCoreWorkspaceServer({ workspace: workspace(), readOnly: true, focusedFileToolsOnly: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'attached-files', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);
    expect(await toolNames(client)).toEqual(['tomny_read', 'tomny_search']);
    const escaped = await client.callTool({ name: 'tomny_read', arguments: { filePath: '../outside.txt' } });
    expect(escaped.isError).toBe(true);
  });

  it('offers only tools that read, search and explain, never one that changes a file', async () => {
    expect(await toolNames(await connectInMemory({ readOnly: true }))).toEqual([
      'tomny_compact',
      'tomny_compass',
      'tomny_diff',
      'tomny_glob',
      'tomny_library_search',
      'tomny_read',
      'tomny_search',
      'tomny_wiki',
    ]);
  });

  it('keeps the full tool set for the callers that govern writing', async () => {
    expect(await toolNames(await connectInMemory({}))).toEqual([
      'tomny_command',
      'tomny_compact',
      'tomny_compass',
      'tomny_diff',
      'tomny_edit',
      'tomny_glob',
      'tomny_library_search',
      'tomny_package_cli',
      'tomny_read',
      'tomny_search',
      'tomny_wiki',
      'tomny_write',
    ]);
  });
});

describe('the MTUI-backed understanding tools', () => {
  const connectWithRunner = async (answer: (args: string[]) => Record<string, unknown>) => {
    const calls: string[][] = [];
    const server = createCoreWorkspaceServer({
      workspace: workspace(),
      readOnly: true,
      mtui: async (args) => {
        calls.push(args);
        return answer(args);
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'understanding-test', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);
    return { client, calls };
  };
  const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string =>
    ((result.content as Array<{ text?: string }>)[0]?.text ?? '');

  it('asks the project Wiki with a bounded limit and returns its text', async () => {
    const { client, calls } = await connectWithRunner(() => ({ ok: true, text: 'The vault lives in agentRuntime.' }));
    const result = await client.callTool({ name: 'tomny_wiki', arguments: { query: 'secret vault', limit: 3 } });

    expect(textOf(result)).toBe('The vault lives in agentRuntime.');
    expect(calls[0]).toEqual(['--json', 'wiki', '--limit', '3', '--', 'secret vault']);
  });

  it('falls back to the code graph when the Wiki is not built, and says so', async () => {
    const { client, calls } = await connectWithRunner((args) =>
      args.includes('wiki')
        ? { ok: false, message: 'Project Wiki not found at .tomni/wiki/wiki.json' }
        : { ok: true, text: 'src/vault.ts: secret vault' }
    );
    const result = await client.callTool({ name: 'tomny_wiki', arguments: { query: 'secret vault' } });

    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain('Wiki has not been built');
    expect(textOf(result)).toContain('code graph (Understand)');
    expect(textOf(result)).toContain('src/vault.ts: secret vault');
    expect(calls.map((args) => args[1])).toEqual(['wiki', 'context']);
  });

  it('tells the model what to do when neither the Wiki nor the code graph exists, and passes other errors on', async () => {
    const neither = await connectWithRunner(() => ({ ok: false, message: 'Project Wiki not found at .tomni/wiki/wiki.json' }));
    const missing = await neither.client.callTool({ name: 'tomny_wiki', arguments: { query: 'anything' } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('Neither the project Wiki nor the Understand code graph exists');
    expect(textOf(missing)).toContain('mtui understand build');

    const other = await connectWithRunner(() => ({ ok: false, message: 'Wiki file is corrupt' }));
    const failed = await other.client.callTool({ name: 'tomny_wiki', arguments: { query: 'anything' } });
    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toContain('Wiki file is corrupt');
    expect(other.calls).toHaveLength(1);
  });

  it('reads a file compressed, passing the query and listing the omitted ranges', async () => {
    const root = workspace();
    const server = createCoreWorkspaceServer({
      workspace: root,
      readOnly: true,
      mtui: async (args) => {
        calls.push(args);
        return { ok: true, text: '10: kept line', next_read_commands: ['mtui read a.ts --from 20 --to 30'] };
      },
    });
    const calls: string[][] = [];
    writeFileSync(path.join(root, 'a.ts'), 'x');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'compass-test', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);

    const result = await client.callTool({ name: 'tomny_compass', arguments: { filePath: 'a.ts', query: 'vault' } });

    expect(textOf(result)).toContain('10: kept line');
    expect(textOf(result)).toContain('Omitted ranges, read with: mtui read a.ts --from 20 --to 30');
    expect(calls[0]).toEqual(expect.arrayContaining(['compass', 'read', '--query', 'vault']));
    expect(calls[0]!.at(-1)).toBe('a.ts');

    const outside = await client.callTool({ name: 'tomny_compass', arguments: { filePath: '../escape.ts' } });
    expect(outside.isError).toBe(true);
  });

  it('shows a diff with plain paths, and wants exactly one of operationId or last', async () => {
    const { client, calls } = await connectWithRunner(() => ({
      ok: true,
      files: [{ file: '\\\\?\\C:\\repo\\a.ts', insertions: 1, deletions: 2, diff: '@@ -1 +1 @@\n-old\n+new' }],
    }));

    const shown = await client.callTool({ name: 'tomny_diff', arguments: { last: true } });
    expect(textOf(shown)).toBe('C:\\repo\\a.ts (+1 -2)\n@@ -1 +1 @@\n-old\n+new');
    expect(calls[0]).toEqual(['--json', 'diff', '--last']);

    const byId = await client.callTool({ name: 'tomny_diff', arguments: { operationId: 'op_1' } });
    expect(byId.isError).not.toBe(true);
    expect(calls[1]).toEqual(['--json', 'diff', '--operation', 'op_1']);

    expect((await client.callTool({ name: 'tomny_diff', arguments: {} })).isError).toBe(true);
    expect((await client.callTool({ name: 'tomny_diff', arguments: { last: true, operationId: 'op_1' } })).isError).toBe(
      true
    );
  });

  it('compacts a log file that lives inside the workspace and nowhere else', async () => {
    const root = workspace();
    const calls: string[][] = [];
    const server = createCoreWorkspaceServer({
      workspace: root,
      readOnly: true,
      mtui: async (args) => {
        calls.push(args);
        return { ok: true, text: 'error TS2322 (x3)' };
      },
    });
    writeFileSync(path.join(root, 'build.log'), 'noise');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'compact-test', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);

    const result = await client.callTool({ name: 'tomny_compact', arguments: { filePath: 'build.log', profile: 'tsc' } });
    expect(textOf(result)).toBe('error TS2322 (x3)');
    expect(calls[0]).toEqual(['--json', 'compact', '--file', 'build.log', '--profile', 'tsc', '--max-lines', '80']);

    expect((await client.callTool({ name: 'tomny_compact', arguments: { filePath: '../outside.log' } })).isError).toBe(true);
  });
});

describe('the read-only workspace host', () => {
  it('serves the read tools to a caller with the host credential, and nothing to anyone else', async () => {
    const host = await startCoreWorkspaceReadHost(workspace());
    const authorization = host.headers[0].value;

    const denied = await fetch(host.url);
    expect(denied.status).toBe(401);

    const transport = new SSEClientTransport(new URL(host.url), {
      requestInit: { headers: { Authorization: authorization } },
      eventSourceInit: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            headers: { ...(init?.headers as Record<string, string>), Authorization: authorization },
          }),
      },
    });
    const client = new Client({ name: 'host-test', version: '1.0.0' });
    await client.connect(transport);
    clients.push(client);
    expect(await toolNames(client)).toEqual([
      'tomny_compact',
      'tomny_compass',
      'tomny_diff',
      'tomny_glob',
      'tomny_library_search',
      'tomny_read',
      'tomny_search',
      'tomny_wiki',
    ]);
  });

    it('registers an eager, authenticated read/search-only MCP host for large attachments', async () => {
    const folder = workspace();
    const registry = createElectronSurfaceCapabilityHosts();
    const [server] = await registry.resolve(['tomny-attached-file-tools'], [], {
      sessionId: 'session-1', workspace: folder, surface: 'chat', permissionMode: 'read-only',
    });
    expect(server).toMatchObject({ name: 'tomny-attached-file-tools', deferred: false });
    const focused = await startAttachedFileToolsHost(folder);
    const usual = await startCoreWorkspaceReadHost(folder);
    expect(focused.url).not.toBe(usual.url);
    const token = focused.headers[0].value;
    expect((await fetch(focused.url)).status).toBe(401);
    const transport = new SSEClientTransport(new URL(focused.url), {
      requestInit: { headers: { Authorization: token } },
      eventSourceInit: {
        fetch: (input, init) => fetch(input, {
          ...init, headers: { ...(init?.headers as Record<string, string>), Authorization: token },
        }),
      },
    });
    const client = new Client({ name: 'focused-eager-tool-test', version: '1.0.0' });
    await client.connect(transport);
    clients.push(client);
    expect(await toolNames(client)).toEqual(['tomny_read', 'tomny_search']);
  });

  it('reuses one host per workspace', async () => {
    const folder = workspace();
    const first = await startCoreWorkspaceReadHost(folder);
    const second = await startCoreWorkspaceReadHost(folder);
    expect(second.url).toBe(first.url);
    expect((await startCoreWorkspaceReadHost(workspace())).url).not.toBe(first.url);
  });

  it('is registered so a surface can ask for it by name, and refuses to start without a workspace', async () => {
    const registry = createElectronSurfaceCapabilityHosts();
    expect(registry.names()).toContain('tomny-core-workspace');
    await expect(registry.resolve(['tomny-core-workspace'])).rejects.toThrow('conversation workspace');
  });
});

describe('which surfaces get read access', () => {
  const capabilityIds = (surfaceId: string): string[] =>
    createBuiltinSurfaceManifests()
      .find((manifest) => manifest.id === surfaceId)!
      .capabilities.map((capability) => capability.id);

  it('gives plain chat a way to read files', () => {
    expect(capabilityIds('chat')).toContain('core.workspace-read');
  });

  it('does not give it to the IDE surface, which already serves tomny_* names', () => {
    expect(capabilityIds('ide')).not.toContain('core.workspace-read');
  });

  it('is really resolved for a plain chat turn with the availability every Core session has', () => {
    const registry = createSurfaceRegistry({ manifests: createBuiltinSurfaceManifests(), defaultSurfaceId: 'chat' });
    const result = registry.resolve({
      surfaceId: 'chat',
      model: { targetKind: 'builtin', protocol: 'tomny-json-stream', modelId: 'm', capabilities: [] },
      permissionMode: 'read-only',
      availableCapabilityIds: [...BUILTIN_AVAILABLE_CAPABILITIES],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
        expect(result.value.capabilities.map((capability) => capability.id)).toContain('core.workspace-read');
    expect(result.value.capabilities.map((capability) => capability.id)).toContain('core.tool-workflow');

    const hostNames = createElectronSurfaceCapabilityHosts().names();
        expect(resolveCoreCapabilityServerNames(result.value, registry, false, hostNames)).toContain(
      'tomny-core-workspace'
    );
    expect(resolveCoreCapabilityServerNames(result.value, registry, false, hostNames)).toContain('tomny-workflow');
    expect(resolveCoreToolCatalogPolicy(result.value, false, []).patterns).toEqual(
            expect.arrayContaining(['tomny_read', 'tomny_glob', 'tomny_search', 'workflow_run'])
    );
  });
});
