import { describe, expect, it } from 'vitest';
import { parseAdapterDocument, type AdapterConnection } from '@/common/packages/adapter';
import { mcpConfig } from '@/common/integrations/detectors/agent/mcpConfig';
import { fixtureInventory, inventoryOf } from './mcpFixtures';

const run = (texts: Record<string, string>, extraFiles: readonly string[] = []) =>
  mcpConfig.detect(inventoryOf(texts, extraFiles));

const only = (connections: readonly AdapterConnection[]): AdapterConnection => {
  expect(connections).toHaveLength(1);
  return connections[0] as AdapterConnection;
};

const asDocument = (result: ReturnType<typeof run>) =>
  parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: result.connections,
    openItems: result.openItems,
  });

const mcpById = (result: ReturnType<typeof run>, id: string) =>
  result.connections.find((connection) => connection.kind === 'mcp' && connection.id === id);

describe('mcp-config: identity', () => {
  it('is a versioned detector', () => {
    expect(mcpConfig.id).toBe('mcp-config');
    expect(mcpConfig.version).toBe(1);
  });
});

describe('mcp-config: multi-host-plugin fixture', () => {
  const result = mcpConfig.detect(fixtureInventory('multi-host-plugin'));
  const inPlugin = (needle: string) =>
    result.connections.find((connection) => (connection.plugin ?? '').includes(needle));

  it('reads every host layout of the same server', () => {
    const mcp = result.connections.filter((connection) => connection.kind === 'mcp');
    expect(mcp).toHaveLength(5);
    expect(new Set(mcp.map((connection) => connection.id))).toEqual(new Set(['context7']));
    const transports = mcp.map((connection) => ('url' in connection ? connection.transport : 'stdio'));
    expect(transports.toSorted()).toEqual(['http', 'http', 'http', 'http', 'stdio']);
  });

  it('accepts the wrapper-less map of a Claude plugin and keeps the key out of the package', () => {
    expect(inPlugin('plugins/claude/context7')).toMatchObject({
      transport: 'http',
      url: 'https://mcp.context7.com/mcp',
      headers: [{ name: 'Authorization', fromEnv: 'CONTEXT7_API_KEY' }],
      plugin: 'source/plugins/claude/context7',
      origin: 'mcp-config',
    });
    expect(result.openItems).toContainEqual(
      expect.objectContaining({ kind: 'env-value', connection: 'context7', name: 'CONTEXT7_API_KEY', required: true })
    );
  });

  it('reads serverUrl and streamable-http', () => {
    expect(inPlugin('plugins/antigravity/context7')).toMatchObject({ transport: 'http' });
    expect(inPlugin('plugins/copilot/context7')).toMatchObject({ transport: 'http' });
  });

  it('reads an npx server as stdio', () => {
    expect(inPlugin('plugins/codex/context7')).toMatchObject({
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    });
  });

  it('claims exactly the configuration files it handled', () => {
    expect(result.claimed.toSorted()).toEqual([
      'plugins/agent-plugins/context7/mcp.json',
      'plugins/antigravity/context7/mcp_config.json',
      'plugins/claude/context7/.mcp.json',
      'plugins/codex/context7/.mcp.json',
      'plugins/copilot/context7/.mcp.json',
    ]);
  });
});

describe('mcp-config: mcpb-node fixture', () => {
  const result = mcpConfig.detect(fixtureInventory('mcpb-node'));

  it('turns the bundle into a stdio server that runs from source/', () => {
    expect(only(result.connections)).toEqual({
      kind: 'mcp',
      id: 'weather-bundle',
      title: 'Weather Bundle',
      description: 'Weather forecasts as an MCPB bundle (hand-written fixture).',
      command: 'node',
      args: ['server/index.js'],
      cwd: 'source',
      env: [
        { name: 'WEATHER_API_KEY', required: true, hint: 'Weather API key' },
        { name: 'UNITS', required: false },
      ],
      origin: 'mcpb',
    });
    expect(result.claimed).toEqual(['manifest.json']);
    expect(result.openItems).toEqual([
      expect.objectContaining({ kind: 'env-value', connection: 'weather-bundle', name: 'WEATHER_API_KEY' }),
    ]);
    expect(asDocument(result).connections).toHaveLength(1);
  });
});

describe('mcp-config: secret-leak fixture', () => {
  const read: string[] = [];
  const inventory = fixtureInventory('secret-leak', ['.env'], (path) => read.push(path));
  const result = mcpConfig.detect(inventory);
  const serialized = JSON.stringify(result);

  it('never copies a literal key, token or URL secret', () => {
    for (const secret of ['sk_test_FAKE', 'ghp_FAKE', 'FAKE0123', 'api_key=', 'Bearer ']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('never opens a file outside the declaration list', () => {
    expect(read).not.toContain('.env');
    expect(inventory.text('.env')).toBeUndefined();
  });

  it('keeps the servers it can express as placeholders only', () => {
    expect(mcpById(result, 'vendor-api')).toMatchObject({
      transport: 'http',
      headers: [
        { name: 'Authorization', fromEnv: 'VENDOR_API_AUTHORIZATION' },
        { name: 'X-Api-Key', fromEnv: 'VENDOR_API_KEY' },
      ],
    });
    expect(mcpById(result, 'github')).toMatchObject({
      command: 'npx',
      args: ['-y', '@example/github-mcp@1.2.3'],
      env: [
        { name: 'GITHUB_TOKEN', required: true },
        { name: 'LOG_LEVEL', required: false },
      ],
    });
    expect(result.connections).toHaveLength(2);
  });

  it('asks for the values and reports what it refused', () => {
    const names = result.openItems.filter((item) => item.kind === 'env-value').map((item) => item.name);
    expect(names.toSorted()).toEqual(['GITHUB_TOKEN', 'VENDOR_API_AUTHORIZATION', 'VENDOR_API_KEY']);
    const notes = result.openItems.filter((item) => item.kind === 'unrecognized').map((item) => item.note);
    expect(notes.some((note) => note.includes('leaky-url') && note.includes('xác thực'))).toBe(true);
    expect(notes.some((note) => note.includes('danger') && note.includes('bash'))).toBe(true);
    expect(asDocument(result).connections).toHaveLength(2);
  });
});

describe('mcp-config: layouts and paths', () => {
  it('reads .vscode/mcp.json with comments, trailing commas and input variables', () => {
    const result = run({
      '.vscode/mcp.json': `{
        // VS Code allows comments
        "inputs": [{ "id": "github-token", "type": "promptString" }],
        "servers": {
          "gh": {
            "type": "http",
            "url": "https://api.example.com/mcp/", /* trailing comma follows */
            "headers": { "Authorization": "Bearer \${input:github-token}" },
          },
        },
      }`,
    });
    expect(only(result.connections)).toMatchObject({
      id: 'gh',
      transport: 'http',
      headers: [{ name: 'Authorization', fromEnv: 'GITHUB_TOKEN' }],
    });
  });

  it('resolves ${workspaceFolder} against the repository and flags a missing build output', () => {
    const result = run({
      'sub/.cursor/mcp.json': JSON.stringify({
        mcpServers: { local: { command: 'node', args: ['${workspaceFolder}/dist/index.js'] } },
      }),
    });
    expect(only(result.connections)).toMatchObject({ command: 'node', args: ['dist/index.js'], cwd: 'source' });
    expect(result.openItems).toContainEqual(
      expect.objectContaining({ kind: 'needs-build', connection: 'local', path: 'source/dist/index.js' })
    );
  });

  it('starts relative scripts from the folder of the file (and the parent of .cursor)', () => {
    const result = run(
      { 'tools/.mcp.json': JSON.stringify({ mcpServers: { a: { command: 'node', args: ['./server.js'] } } }) },
      ['tools/server.js']
    );
    expect(only(result.connections)).toMatchObject({ args: ['server.js'], cwd: 'source/tools' });
    expect(result.openItems).toEqual([]);
    const cursor = run({
      'tools/.cursor/mcp.json': JSON.stringify({ mcpServers: { a: { command: 'python3', args: ['srv.py'] } } }),
    });
    expect(only(cursor.connections)).toMatchObject({ command: 'python', args: ['srv.py'], cwd: 'source/tools' });
  });

  it('unwraps Windows launchers', () => {
    const result = run({
      'mcp.json': JSON.stringify({
        mcpServers: {
          a: { command: 'cmd', args: ['/c', 'npx', '-y', 'pkg-a@1.0.0'] },
          b: { command: 'C:\\Program Files\\nodejs\\npx.cmd', args: ['-y', 'pkg-b@1.0.0'] },
        },
      }),
    });
    expect(result.connections.map((connection) => ('args' in connection ? connection.args : []))).toEqual([
      ['-y', 'pkg-a@1.0.0'],
      ['-y', 'pkg-b@1.0.0'],
    ]);
  });

  it('skips disabled servers silently and duplicate ids loudly', () => {
    const result = run({
      '.mcp.json': JSON.stringify({
        mcpServers: {
          off: { command: 'npx', args: ['-y', 'p@1.0.0'], disabled: true },
          'My Server': { command: 'npx', args: ['-y', 'p@1.0.0'] },
          'my-server': { command: 'npx', args: ['-y', 'q@1.0.0'] },
        },
      }),
    });
    expect(only(result.connections)).toMatchObject({ id: 'my-server', title: 'My Server' });
    expect(result.openItems).toHaveLength(1);
  });

  it('marks a plugin folder with the plugin path', () => {
    const result = run(
      { 'p/.mcp.json': JSON.stringify({ mcpServers: { a: { command: 'npx', args: ['-y', 'pkg@1.0.0'] } } }) },
      ['p/.claude-plugin/plugin.json']
    );
    expect(only(result.connections)).toMatchObject({ plugin: 'source/p' });
  });
});

describe('mcp-config: refusals', () => {
  const refused = (server: Record<string, unknown>) => {
    const result = run({ '.mcp.json': JSON.stringify({ mcpServers: { s: server } }) });
    expect(result.connections).toEqual([]);
    expect(result.openItems).toHaveLength(1);
    expect(result.openItems[0]).toMatchObject({ kind: 'unrecognized', path: 'source/.mcp.json' });
    return result.openItems[0]?.note ?? '';
  };

  it.each([
    ['a program outside the allow list', { command: 'sh', args: ['-c', 'x'] }],
    ['a flag the adapter refuses', { command: 'docker', args: ['run', '-v', '/:/host', 'img'] }],
    ['a docker verb other than run', { command: 'docker', args: ['exec', '-i', 'box', 'sh'] }],
    ['a flag that is not on the list of the program', { command: 'npx', args: ['-i', 'pkg'] }],
    ['a variable in an argument', { command: 'npx', args: ['-y', 'pkg', '--key=${API_KEY}'] }],
    ['a path that leaves the repository', { command: 'node', args: ['${workspaceFolder}/../x.js'] }],
    ['plain http', { type: 'http', url: 'http://api.example.com/mcp' }],
    ['a loopback address', { type: 'http', url: 'http://localhost:3000/mcp' }],
    ['user info in the address', { url: 'https://user:pw@api.example.com/mcp' }],
    ['a variable in the address', { url: 'https://${HOST}/mcp' }],
    ['a secret in the query string', { url: 'https://api.example.com/mcp?token=abc' }],
    ['no command and no address', { env: { A: '1' } }],
    ['a wrong shape', { command: 42 }],
  ])('refuses %s', (_label, server) => {
    refused(server);
  });

  it('never echoes control characters from the repository', () => {
    const note = refused({ command: 'evil\u0007\ncommand', args: ['x'] });
    expect([...note].every((character) => character.charCodeAt(0) >= 32)).toBe(true);
  });

  it('accepts docker run, uvx --from and python -m with their fixed flags, and keeps secrets out', () => {
    const result = run({
      '.mcp.json': JSON.stringify({
        mcpServers: {
          box: { command: 'docker', args: ['run', '-i', '--rm', 'ghcr.io/acme/box:1.0.0'] },
          tool: { command: 'uvx', args: ['--from', 'acme-tool==1.0.0', 'acme-tool'] },
          py: { command: 'python3', args: ['-m', 'acme_server'] },
          leaky: { command: 'docker', args: ['run', '-i', '--rm', '-e', 'API_TOKEN=abc123', 'img'] },
        },
      }),
    });
    expect(mcpById(result, 'box')).toMatchObject({
      command: 'docker',
      args: ['run', '-i', '--rm', 'ghcr.io/acme/box:1.0.0'],
    });
    expect(mcpById(result, 'tool')).toMatchObject({
      command: 'uvx',
      args: ['--from', 'acme-tool==1.0.0', 'acme-tool'],
    });
    expect(mcpById(result, 'py')).toMatchObject({ command: 'python', args: ['-m', 'acme_server'] });
    expect(mcpById(result, 'leaky')).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('abc123');
    expect(() => asDocument(result)).not.toThrow();
  });
  it('turns broken JSON into an open item on the file', () => {
    const result = run({ '.mcp.json': '{ "mcpServers": ' });
    expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized', path: 'source/.mcp.json' })]);
    expect(result.claimed).toEqual(['.mcp.json']);
  });

  it('reports a configuration without servers and ignores an empty list', () => {
    expect(run({ 'mcp.json': '{"hello":1}' }).openItems).toHaveLength(1);
    expect(run({ 'mcp.json': '{"mcpServers":{}}' }).openItems).toEqual([]);
  });

  it('ignores browser and web manifests and does not claim them', () => {
    const result = run({
      'manifest.json': JSON.stringify({ manifest_version: 3, name: 'x', background: { service_worker: 'a.js' } }),
      'web/manifest.json': JSON.stringify({ name: 'x', start_url: '/', display: 'standalone' }),
    });
    expect(result).toEqual({ connections: [], openItems: [], reasons: [], claimed: [] });
  });

  it('hands a binary bundle to needs-runtime', () => {
    const result = run({
      'manifest.json': JSON.stringify({
        manifest_version: '0.2',
        name: 'native',
        server: { type: 'binary', entry_point: 'bin/server' },
      }),
    });
    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([expect.objectContaining({ kind: 'needs-runtime', connection: 'native' })]);
  });

  it('survives garbage without throwing', () => {
    for (const text of ['[]', 'null', '"x"', '123', '{"mcpServers":[]}', '{"mcpServers":{"a":null}}', '\u0000']) {
      expect(() => run({ '.mcp.json': text })).not.toThrow();
    }
  });

  it('does not copy a literal env value even when the key is not secret-looking', () => {
    const result = run({
      '.mcp.json': JSON.stringify({
        mcpServers: {
          s: { command: 'npx', args: ['-y', 'pkg@1.0.0'], env: { REGION: 'eu-west-1-internal', lower: 'x' } },
        },
      }),
    });
    expect(JSON.stringify(result)).not.toContain('eu-west-1-internal');
    expect(only(result.connections)).toMatchObject({ env: [{ name: 'REGION', required: false }] });
  });
});
