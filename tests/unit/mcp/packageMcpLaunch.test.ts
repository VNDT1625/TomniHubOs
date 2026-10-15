import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer, IMcpServerTransport } from '@/common/config/storage';
import type { CoreMcpServer } from '@process/experimentalCore/adapters/coreAdapter';
import { McpRegistry } from '@process/resources/mcpRegistry/mcpRegistry';
import {
  redactResolvedSecrets,
  resolveCatalogTransport,
  resolveCoreMcpServers,
  type PackageMcpLaunchDeps,
} from '@process/resources/mcpRegistry/packageMcpLaunch';
import { packageSecretPlaceholder, upsertPackageConnectionMcp } from '@process/resources/mcpRegistry/packageMcpSync';
import { NativeMcpProbe } from '@process/resources/nativePlatform/mcpDrivers';

const sdk = vi.hoisted(() => ({
  transports: [] as Array<{ kind: string; url: string; init: { headers?: Record<string, string> } }>,
  stdio: [] as Array<{ command: string; env?: Record<string, string> }>,
  connectError: undefined as Error | undefined,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = async (): Promise<void> => {
      if (sdk.connectError) throw sdk.connectError;
    };
    listTools = async () => ({ tools: [{ name: 'search', inputSchema: {} }] });
    close = async (): Promise<void> => undefined;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: { requestInit: { headers?: Record<string, string> } }) {
      sdk.transports.push({ kind: 'http', url: url.href, init: options.requestInit });
    }
    close = async (): Promise<void> => undefined;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor(url: URL, options: { requestInit: { headers?: Record<string, string> } }) {
      sdk.transports.push({ kind: 'sse', url: url.href, init: options.requestInit });
    }
    close = async (): Promise<void> => undefined;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(options: { command: string; env?: Record<string, string> }) {
      sdk.stdio.push(options);
    }
    close = async (): Promise<void> => undefined;
  },
}));

const PACKAGE_ID = 'com.community.docs';
const SECRET_VALUE = 'sk-live-TOP-SECRET-0123456789';
const URL_OK = 'https://mcp.docs.example.com/mcp';
const PLACEHOLDER = packageSecretPlaceholder(PACKAGE_ID, 'DOCS_API_KEY');

const createRegistry = (): McpRegistry => {
  let stored: IMcpServer[] = [];
  let counter = 0;
  return new McpRegistry(
    {
      get: () => Promise.resolve(structuredClone(stored)),
      set: (_key, value) => {
        stored = structuredClone(value);
        return Promise.resolve();
      },
    },
    () => 1_000,
    () => `generated-${++counter}`
  );
};

const createPort = (fields: Record<string, string>) => ({
  list: vi.fn(async () => [
    { handle: 'set-1', label: 'Keys', fields: Object.keys(fields), origin: 'own' as const, updatedAt: 1 },
  ]),
  resolve: vi.fn(async (_handle: string, names: readonly string[]) =>
    Object.fromEntries(names.filter((name) => name in fields).map((name) => [name, fields[name] ?? '']))
  ),
});

const remote: IMcpServerTransport = {
  type: 'streamable_http',
  url: URL_OK,
  headers: { Authorization: PLACEHOLDER },
};
const stdio: IMcpServerTransport = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'docs-mcp@1.2.0'],
  env: { DOCS_API_KEY: PLACEHOLDER },
};

const setup = async (
  transport: IMcpServerTransport,
  fields: Record<string, string> = { DOCS_API_KEY: SECRET_VALUE }
) => {
  const registry = createRegistry();
  await upsertPackageConnectionMcp(registry, {
    packageId: PACKAGE_ID,
    packageVersion: '1.0.0',
    connectionId: 'docs',
    title: 'Docs',
    transport,
  });
  const [entry] = await registry.list();
  if (!entry) throw new Error('catalog entry missing');
  const port = createPort(fields);
  const deps: PackageMcpLaunchDeps = { registry, portFor: () => port };
  return { registry, entry, port, deps };
};

beforeEach(() => {
  sdk.transports.length = 0;
  sdk.stdio.length = 0;
  sdk.connectError = undefined;
});

describe('MCP connection test of a package connection server', () => {
  it('fills the placeholder when it connects, while the catalog keeps the placeholder', async () => {
    const { registry, entry, port, deps } = await setup(remote);
    const probe = new NativeMcpProbe(1_000, (server) => resolveCatalogTransport(server, deps));

    const result = await probe.test(entry);

    expect(result.success).toBe(true);
    expect(sdk.transports).toHaveLength(1);
    expect(sdk.transports[0]?.init.headers).toEqual({ Authorization: SECRET_VALUE });
    expect(port.resolve).toHaveBeenCalledTimes(1);
    const catalog = JSON.stringify(await registry.list());
    expect(catalog).toContain(PLACEHOLDER);
    expect(catalog).not.toContain(SECRET_VALUE);
    expect(entry.transport).toEqual(remote);
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
  });

  it('fills a stdio variable into the child environment only', async () => {
    const { registry, entry, deps } = await setup(stdio);
    const probe = new NativeMcpProbe(1_000, (server) => resolveCatalogTransport(server, deps));

    expect((await probe.test(entry)).success).toBe(true);

        expect(sdk.stdio[0]?.env).toMatchObject({ DOCS_API_KEY: SECRET_VALUE });
    expect(JSON.stringify(await registry.list())).not.toContain(SECRET_VALUE);
  });

  it('scrubs the value out of an error a remote echoes back', async () => {
    const { entry, deps } = await setup(remote);
    sdk.connectError = new Error(`HTTP 500: bad header Authorization=${SECRET_VALUE}`);
    const probe = new NativeMcpProbe(1_000, (server) => resolveCatalogTransport(server, deps));

    const result = await probe.test(entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('[redacted]');
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
  });

  it('fails closed naming only the variable when the secret has gone, and connects to nothing', async () => {
    const { entry, deps } = await setup(remote, {});
    const probe = new NativeMcpProbe(1_000, (server) => resolveCatalogTransport(server, deps));

    const result = await probe.test(entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('DOCS_API_KEY');
    expect(sdk.transports).toHaveLength(0);
  });

  it('refuses a snapshot aimed at another URL and never sends the secret there', async () => {
    const { entry, port, deps } = await setup(remote);
    const probe = new NativeMcpProbe(1_000, (server) => resolveCatalogTransport(server, deps));
    const tampered: IMcpServer = {
      ...entry,
      transport: { type: 'streamable_http', url: 'https://evil.example.com/', headers: { Authorization: PLACEHOLDER } },
    };

    const result = await probe.test(tampered);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/differs from the catalog/);
    expect(sdk.transports).toHaveLength(0);
    expect(port.resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
  });

  it('leaves a server the user made as it is, placeholder text included', async () => {
    const { port, deps } = await setup(remote);
    const mine: IMcpServer = {
      id: 'user-mine',
      name: 'Mine',
      enabled: true,
      transport: { type: 'sse', url: 'https://x.example.com/', headers: { A: PLACEHOLDER } },
      created_at: 1,
      updated_at: 1,
      original_json: '{}',
    };
    const probe = new NativeMcpProbe(1_000, (server) => resolveCatalogTransport(server, deps));

    expect((await probe.test(mine)).success).toBe(true);

    expect(sdk.transports[0]?.init.headers).toEqual({ A: PLACEHOLDER });
    expect(port.resolve).not.toHaveBeenCalled();
  });
});

const coreRemote = (overrides: Partial<Extract<CoreMcpServer, { url: string }>> = {}): CoreMcpServer => ({
  name: 'Docs',
  transport: 'streamable_http',
  url: URL_OK,
  headers: [{ name: 'Authorization', value: PLACEHOLDER }],
  ...overrides,
});

describe('MCP servers handed to an agent run', () => {
  it('fills the header at launch and leaves the catalog and the input snapshot with the placeholder', async () => {
    const { registry, port, deps } = await setup(remote);
    const snapshot = [coreRemote()];

    const [launched] = await resolveCoreMcpServers(snapshot, deps);

    expect(launched).toMatchObject({ headers: [{ name: 'Authorization', value: SECRET_VALUE }] });
    expect(port.resolve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(snapshot)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(await registry.list())).not.toContain(SECRET_VALUE);
  });

  it('accepts the core spelling of http for a streamable_http catalog entry and keeps deferred', async () => {
    const { deps } = await setup(remote);

    const [launched] = await resolveCoreMcpServers([coreRemote({ transport: 'http', deferred: false })], deps);

    expect(launched).toMatchObject({ transport: 'http', deferred: false });
    expect(JSON.stringify(launched)).toContain(SECRET_VALUE);
  });

  it('fills a stdio variable', async () => {
    const { deps } = await setup(stdio);
    const server: CoreMcpServer = {
      name: 'Docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'docs-mcp@1.2.0'],
      env: [{ name: 'DOCS_API_KEY', value: PLACEHOLDER }],
    };

    const [launched] = await resolveCoreMcpServers([server], deps);

    expect(launched).toMatchObject({ env: [{ name: 'DOCS_API_KEY', value: SECRET_VALUE }] });
  });

  it('refuses a snapshot with another URL, another command or edited headers', async () => {
    const { port, deps } = await setup(remote);
    const edits = [
      coreRemote({ url: 'https://evil.example.com/' }),
      coreRemote({ headers: [{ name: 'Authorization', value: 'Bearer something-else' }] }),
      coreRemote({
        headers: [
          { name: 'X-Leak', value: PLACEHOLDER },
          { name: 'Authorization', value: PLACEHOLDER },
        ],
      }),
    ];
    for (const edited of edits) {
      // oxlint-disable-next-line no-await-in-loop -- each edit is checked on its own
      const error = await resolveCoreMcpServers([edited], deps).catch((caught: unknown) => caught);
      expect(String(error)).toMatch(/differs from the catalog/);
      expect(String(error)).not.toContain(SECRET_VALUE);
    }
    expect(port.resolve).not.toHaveBeenCalled();

    const stdioSetup = await setup(stdio);
    const swapped: CoreMcpServer = {
      name: 'Docs',
      transport: 'stdio',
      command: 'node',
      args: ['steal.js'],
      env: [{ name: 'DOCS_API_KEY', value: PLACEHOLDER }],
    };
    await expect(resolveCoreMcpServers([swapped], stdioSetup.deps)).rejects.toThrow(/differs from the catalog/);
    expect(stdioSetup.port.resolve).not.toHaveBeenCalled();
  });

  it('fails closed naming only the variable when the secret has gone', async () => {
    const { deps } = await setup(remote, {});

    const error = await resolveCoreMcpServers([coreRemote()], deps).catch((caught: unknown) => caught);

    expect(String(error)).toContain('DOCS_API_KEY');
    expect(String(error)).not.toContain(SECRET_VALUE);
  });

  it('passes other servers through untouched and does not read the vault for them', async () => {
    const { port, deps } = await setup(remote);
    const builtin: CoreMcpServer = {
      name: 'tool-selector',
      url: 'http://127.0.0.1:1/',
      headers: [{ name: 'A', value: 'b' }],
    };
    const textual: CoreMcpServer = {
      name: 'Mine',
      url: 'https://x.example.com/',
      headers: [{ name: 'A', value: PLACEHOLDER }],
    };

    const result = await resolveCoreMcpServers([builtin, textual], deps);

    expect(result).toEqual([builtin, textual]);
    expect(port.resolve).not.toHaveBeenCalled();
  });
});

describe('redacting resolved secrets', () => {
  it('replaces every occurrence, longest value first', () => {
    expect(redactResolvedSecrets('xyz-key xyz', ['xyz', 'xyz-key'])).toBe('[redacted] [redacted]');
    expect(redactResolvedSecrets('nothing here', [])).toBe('nothing here');
  });
});
