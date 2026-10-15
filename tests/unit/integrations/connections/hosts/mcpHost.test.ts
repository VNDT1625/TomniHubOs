/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import { parseAdapterDocument, type AdapterConnection } from '@/common/packages/adapter';
import { computeApprovalHash } from '@process/integrations/connections/core/approval';
import { createConnectionRegistry, type LoadedPackage } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import type { AnyConnectionHost, HostContext } from '@process/integrations/connections/core/types';
import { createMcpHost } from '@process/integrations/connections/hosts/exec/mcpHost';
import { McpRegistry } from '@process/resources/mcpRegistry/mcpRegistry';
import {
  packageConnectionMcpId,
  resolvePackageMcpTransport,
  syncPackageMcpServers,
} from '@process/resources/mcpRegistry/packageMcpSync';
import type { PackageSecretInfo } from '@process/resources/packageSecrets/packageSecretPort';

const PACKAGE_ID = 'com.community.docs';
const SECRET_VALUE = 'sk-live-TOP-SECRET-0123456789';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-mcphost-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createRegistry = (initial: IMcpServer[] = []): McpRegistry => {
  let stored = structuredClone(initial);
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

const userServer = (name: string): IMcpServer => ({
  id: `user-${name}`,
  name,
  enabled: true,
  transport: { type: 'stdio', command: 'node', args: ['mine.js'] },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
});

/** A secret store with one own set; `resolve` is the only call that returns a value. */
const createPort = (fields: Record<string, string>, packageId = PACKAGE_ID) => {
  const info: PackageSecretInfo = {
    handle: `${packageId}-set`,
    label: 'Keys',
    fields: Object.keys(fields),
    origin: 'own',
    updatedAt: 1,
  };
  return {
    list: vi.fn(async () => (Object.keys(fields).length > 0 ? [info] : [])),
    resolve: vi.fn(async (_handle: string, names: readonly string[]) =>
      Object.fromEntries(names.filter((name) => name in fields).map((name) => [name, fields[name] ?? '']))
    ),
  };
};

const connectionsOf = (...raw: unknown[]): AdapterConnection[] => [
  ...parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections: raw }).connections,
];
const mcpOf = (raw: Record<string, unknown>) => {
  const [connection] = connectionsOf({ kind: 'mcp', ...raw });
  if (connection?.kind !== 'mcp') throw new Error('fixture is not a valid mcp connection');
  return connection;
};

const npxDocs = { id: 'docs', title: 'Docs', args: ['-y', 'docs-mcp@1.2.0'], command: 'npx' };
const remoteDocs = (extra: Record<string, unknown> = {}) => ({
  id: 'docs-http',
  title: 'Docs remote',
  transport: 'http',
  url: 'https://mcp.docs.example.com/mcp',
  headers: [{ name: 'Authorization', fromEnv: 'DOCS_API_KEY' }],
  ...extra,
});

const context = (packageDirectory = '/pkg'): HostContext => ({
  packageId: PACKAGE_ID,
  packageVersion: '1.0.0',
  packageDirectory,
  readPackageFile: async () => Buffer.from(''),
});

const setup = (options: { fields?: Record<string, string>; initial?: IMcpServer[]; missing?: string[] } = {}) => {
  const registry = createRegistry(options.initial);
  const port = createPort(options.fields ?? { DOCS_API_KEY: SECRET_VALUE });
  const exists = vi.fn(async (command: string) => !(options.missing ?? []).includes(command));
  const host = createMcpHost({ registry: async () => registry, secretPort: () => port, commandExists: exists });
  return { registry, port, host, exists };
};

describe('mcp host: enabling and disabling', () => {
  it('adds a stdio server to the catalog on enable, is idempotent, and removes exactly it on disable', async () => {
    const { registry, host } = setup({ initial: [userServer('Mine')] });
    const connection = mcpOf(npxDocs);

    const first = await host.enable(context(), connection as never);
    const second = await host.enable(context(), connection as never);

    const id = packageConnectionMcpId(PACKAGE_ID, 'docs');
    expect(first.installed).toEqual([id]);
    expect(second.installed).toEqual([id]);
    const servers = await registry.list();
    expect(servers.filter((server) => server.id === id)).toHaveLength(1);
    expect(servers.find((server) => server.id === id)).toMatchObject({
      name: 'Docs',
      enabled: true,
      transport: { type: 'stdio', command: 'npx', args: ['-y', 'docs-mcp@1.2.0'] },
      extension: { name: `package:${PACKAGE_ID}`, version: '1.0.0' },
    });

    await host.disable(context(), connection as never, first.installed);
    await host.disable(context(), connection as never, first.installed);
    expect((await registry.list()).map((server) => server.id)).toEqual(['user-Mine']);
  });

  it('re-enables and refreshes an entry the user switched off or that went stale', async () => {
    const { registry, host } = setup();
    await host.enable(context(), mcpOf(npxDocs) as never);
    await registry.toggle(packageConnectionMcpId(PACKAGE_ID, 'docs'));

    await host.enable(context(), mcpOf({ ...npxDocs, args: ['-y', 'docs-mcp@2.0.0'] }) as never);

    const [server] = await registry.list();
    expect(server).toMatchObject({ enabled: true, transport: { args: ['-y', 'docs-mcp@2.0.0'] } });
  });

  it('adds a remote server with the matching transport and header placeholders only', async () => {
    const { registry, host } = setup();
    await host.enable(context(), mcpOf(remoteDocs()) as never);
    await host.enable(context(), mcpOf(remoteDocs({ id: 'docs-sse', transport: 'sse' })) as never);

    const servers = await registry.list();
    expect(servers.map((server) => server.transport.type).toSorted()).toEqual(['sse', 'streamable_http']);
    expect(servers[0]?.transport).toMatchObject({
      url: 'https://mcp.docs.example.com/mcp',
      headers: { Authorization: `package-secret://${PACKAGE_ID}/DOCS_API_KEY` },
    });
  });

  it('refuses to enable while a header or required variable has no value, naming it without any value', async () => {
    const { registry, host } = setup({ fields: {} });
    await expect(host.enable(context(), mcpOf(remoteDocs()) as never)).rejects.toThrow(/DOCS_API_KEY/);
    await expect(
      host.enable(context(), mcpOf({ ...npxDocs, env: [{ name: 'DOCS_TOKEN', required: true }] }) as never)
    ).rejects.toThrow(/DOCS_TOKEN/);
    expect(await registry.list()).toEqual([]);
  });

  it('leaves optional variables out when the package has no value for them', async () => {
    const { registry, host } = setup({ fields: { A_KEY: 'x' } });
    await host.enable(
      context(),
      mcpOf({
        ...npxDocs,
        env: [
          { name: 'A_KEY', required: true },
          { name: 'B_KEY', required: false },
        ],
      }) as never
    );
    const [server] = await registry.list();
    expect(server?.transport).toMatchObject({ env: { A_KEY: `package-secret://${PACKAGE_ID}/A_KEY` } });
    expect(JSON.stringify(server?.transport)).not.toContain('B_KEY');
  });

  it('makes a taken name unique with the package id, and fails rather than overwrite when that is taken too', async () => {
    const { registry, host } = setup({ initial: [userServer('Docs')] });
    await host.enable(context(), mcpOf(npxDocs) as never);
    expect((await registry.list()).map((server) => server.name).toSorted()).toEqual(['Docs', `Docs (${PACKAGE_ID})`]);

    const crowded = setup({ initial: [userServer('Docs'), userServer(`Docs (${PACKAGE_ID})`)] });
    await expect(crowded.host.enable(context(), mcpOf(npxDocs) as never)).rejects.toThrow(/already exists/);
    expect(await crowded.registry.list()).toHaveLength(2);
  });

  it('is not undone by the snapshot sync of manifest-declared servers', async () => {
    const { registry, host } = setup();
    await host.enable(context(), mcpOf(npxDocs) as never);
    await syncPackageMcpServers(registry, { mcpServers: [] });
    expect(await registry.list()).toHaveLength(1);
  });
});

describe('mcp host: what can run on this machine', () => {
  it('accepts catalog programs that exist and says plainly when one is missing', async () => {
    const { host } = setup({ missing: ['uvx'] });
    expect(await host.check(context(), mcpOf(npxDocs) as never)).toEqual({ ok: true });
    const missing = await host.check(context(), mcpOf({ ...npxDocs, command: 'uvx', args: ['docs-mcp'] }) as never);
    expect(missing).toMatchObject({ ok: false });
    expect(missing.ok === false && missing.reason).toContain('uvx');
  });

  it('does not run anything that needs the package source or the process runtime', async () => {
    const { host, exists } = setup();
    const cases = [
      { ...npxDocs, command: 'node', args: ['source/server.js'] },
      { ...npxDocs, command: 'python', args: ['source/server.py'] },
      { ...npxDocs, command: 'python', args: ['-m', 'srv'], cwd: 'source/srv' },
      { ...npxDocs, setup: [['npm', 'install']] },
    ];
    for (const raw of cases) {
      const result = await host.check(context(), mcpOf(raw) as never);
      expect(result.ok, JSON.stringify(raw)).toBe(false);
    }
    expect(exists).toHaveBeenCalledWith('python');
  });

  it.each([
    'https://localhost/mcp',
    'https://app.localhost/mcp',
    'https://127.0.0.1/mcp',
    'https://10.1.2.3/mcp',
    'https://192.168.0.5/mcp',
    'https://172.20.0.1/mcp',
    'https://169.254.169.254/latest',
    'https://[::1]/mcp',
    'https://[fd00::1]/mcp',
    'https://intranet/mcp',
    'https://printer.local/mcp',
    'https://user:pass@mcp.example.com/mcp',
  ])('refuses the remote address %s', async (url) => {
    const { host } = setup();
    const result = await host.check(context(), mcpOf(remoteDocs({ url })) as never);
    expect(result.ok).toBe(false);
  });

  it('accepts a public https endpoint', async () => {
    const { host } = setup();
    expect(await host.check(context(), mcpOf(remoteDocs()) as never)).toEqual({ ok: true });
  });
});

describe('mcp host: approval subject', () => {
  it('lists exactly the command, working folder and variable names for stdio', async () => {
    const { host } = setup();
    const subject = await host.describe(
      context('/pkgs/docs'),
      mcpOf({ ...npxDocs, env: [{ name: 'DOCS_TOKEN', required: false }] }) as never
    );
    expect(subject.kind).toBe('mcp');
    const lines = Object.fromEntries(subject.lines.map((line) => [line.label, line.value]));
    expect(lines.Command).toBe('npx -y docs-mcp@1.2.0');
    expect(lines['Working folder']).toBe('not set');
    expect(lines['Variables (from the package secret store)']).toBe('DOCS_TOKEN (optional)');
  });

  it('lists the URL, host and header names for a remote server, never a value', async () => {
    const { host } = setup();
    const subject = await host.describe(context(), mcpOf(remoteDocs()) as never);
    const text = JSON.stringify(subject);
    expect(text).toContain('https://mcp.docs.example.com/mcp');
    expect(text).toContain('mcp.docs.example.com');
    expect(text).toContain('Authorization (from secret DOCS_API_KEY)');
    expect(text).not.toContain(SECRET_VALUE);
  });

  it('shows the resolved working folder and covers files named in the arguments, so the hash follows their content', async () => {
    const { host } = setup();
    const connection = mcpOf({ ...npxDocs, command: 'python', args: ['source/server.py'], cwd: 'source' });
    const subject = await host.describe(context('/pkgs/docs'), connection as never);
    expect(subject.files).toEqual(['source/server.py']);
    expect(subject.lines.find((line) => line.label === 'Working folder')?.value).toBe(
      path.join('/pkgs/docs', 'source')
    );

    const original = computeApprovalHash(connection, subject, new Map([['source/server.py', Buffer.from('print(1)')]]));
    const changed = computeApprovalHash(connection, subject, new Map([['source/server.py', Buffer.from('print(2)')]]));
    expect(changed).not.toBe(original);
  });

  it('changes the approval when the command line or the URL changes', async () => {
    const { host } = setup();
    const hashOf = async (raw: Record<string, unknown>): Promise<string> => {
      const connection = mcpOf(raw);
      return computeApprovalHash(connection, await host.describe(context(), connection as never), new Map());
    };
    expect(await hashOf(npxDocs)).not.toBe(await hashOf({ ...npxDocs, args: ['-y', 'docs-mcp@9.9.9'] }));
    expect(await hashOf(remoteDocs())).not.toBe(await hashOf(remoteDocs({ url: 'https://evil.example.com/mcp' })));
  });
});

describe('mcp host: secrets stay in Main', () => {
  it('never puts a value in the catalog, an approval line, an error or a log', async () => {
    const out = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];
    const { registry, host, port } = setup();
    const remote = mcpOf(remoteDocs());
    const stdio = mcpOf({ ...npxDocs, id: 'docs-local', env: [{ name: 'DOCS_API_KEY', required: true }] });

    const subjects = [await host.describe(context(), remote as never), await host.describe(context(), stdio as never)];
    await host.enable(context(), remote as never);
    await host.enable(context(), stdio as never);

    const catalog = JSON.stringify(await registry.list());
    expect(catalog).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(subjects)).not.toContain(SECRET_VALUE);
    expect(port.resolve).not.toHaveBeenCalled();
    for (const spy of out) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET_VALUE);
  });

  it('hands the value to Main only when a connection is made, and only for the entry the catalog holds', async () => {
    const { registry, host, port } = setup();
    await host.enable(context(), mcpOf(remoteDocs()) as never);
    const [server] = await registry.list();
    if (!server) throw new Error('no server');

    const resolved = await resolvePackageMcpTransport(registry, server, () => port);
    expect(resolved).toMatchObject({ headers: { Authorization: SECRET_VALUE } });
    // The catalog itself is unchanged by resolving.
    expect(JSON.stringify(await registry.list())).not.toContain(SECRET_VALUE);

    // A snapshot the renderer rewrote (another URL) is refused instead of being sent the secret.
    const tampered = { name: server.name, transport: { ...server.transport, url: 'https://evil.example.com/' } };
    await expect(resolvePackageMcpTransport(registry, tampered, () => port)).rejects.toThrow(
      /differs from the catalog/
    );

    // A placeholder for another package's variable is refused even if the entry was edited in the catalog.
    await registry.update(server.id, {
      transport: {
        type: 'streamable_http',
        url: 'https://mcp.docs.example.com/mcp',
        headers: { Authorization: 'package-secret://com.other.pkg/DOCS_API_KEY' },
      },
    });
    const [edited] = await registry.list();
    if (!edited) throw new Error('no server');
    const error = await resolvePackageMcpTransport(registry, edited, () => port).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/another package/);
    expect(String(error)).not.toContain(SECRET_VALUE);
  });

  it('reads a placeholder in a server the user made as plain text', async () => {
    const mine = userServer('Mine');
    mine.transport = {
      type: 'sse',
      url: 'https://x.example.com/',
      headers: { A: `package-secret://${PACKAGE_ID}/DOCS_API_KEY` },
    };
    const registry = createRegistry([mine]);
    const port = createPort({ DOCS_API_KEY: SECRET_VALUE });
    const result = await resolvePackageMcpTransport(registry, mine, () => port);
    expect(result).toEqual(mine.transport);
    expect(port.resolve).not.toHaveBeenCalled();
  });

  it('fails with the variable name, not a value, when the secret has gone', async () => {
    const { registry, host } = setup();
    await host.enable(context(), mcpOf(remoteDocs()) as never);
    const [server] = await registry.list();
    if (!server) throw new Error('no server');
    const error = await resolvePackageMcpTransport(registry, server, () => createPort({})).catch(
      (caught: unknown) => caught
    );
    expect(String(error)).toContain('DOCS_API_KEY');
  });
});

describe('mcp host: reconcile', () => {
  it('removes servers the host made for packages or connections that no longer stay on, and nothing else', async () => {
    const gone = packageConnectionMcpId('com.gone.pkg', 'old');
    const staying = packageConnectionMcpId(PACKAGE_ID, 'docs');
    const off = packageConnectionMcpId(PACKAGE_ID, 'was-on');
    const manifest: IMcpServer = { ...userServer('Manifest'), id: 'package:com.x/manifest' };
    const entry = (id: string, name: string): IMcpServer => ({ ...userServer(name), id });
    const { registry, host } = setup({
      initial: [
        entry(gone, 'Gone'),
        entry(staying, 'Staying'),
        entry(off, 'Off'),
        manifest,
        userServer('Mine'),
        { ...userServer('Lookalike'), id: 'pkgconn:Bad Id' },
      ],
    });

    await host.reconcile?.({ keep: new Set([`${PACKAGE_ID}\u0000mcp:docs`]) });

    expect((await registry.list()).map((server) => server.id).toSorted()).toEqual(
      [staying, 'package:com.x/manifest', 'pkgconn:Bad Id', 'user-Mine'].toSorted()
    );
  });
});

describe('mcp host with the connection registry', () => {
  const group = (id: string) => ({
    kind: 'mcp',
    ...remoteDocs({ id, title: id, url: `https://${id}.example.com/mcp`, group: 'docs' }),
  });

  const build = async () => {
    const dir = await temp();
    await mkdir(path.join(dir, 'source'), { recursive: true });
    const { registry: catalog, port } = setup();
    const host: AnyConnectionHost = createMcpHost({
      registry: async () => catalog,
      secretPort: () => port,
      commandExists: async () => true,
    });
    const adapter = parseAdapterDocument({
      schemaVersion: 1,
      generatedBy: 'classifier',
      connections: [{ kind: 'mcp', ...npxDocs, group: 'docs-alt' }, group('alt-a'), group('alt-b')],
    });
    let loaded: LoadedPackage | undefined = {
      packageId: PACKAGE_ID,
      packageVersion: '1.0.0',
      packageDirectory: dir,
      adapter,
    };
    const store = createJsonConnectionStateStore(path.join(dir, 'state.json'));
    await store.initialize();
    const registry = createConnectionRegistry({
      store,
      hosts: [host],
      loadPackage: async (id) => (id === PACKAGE_ID ? loaded : undefined),
      listInstalledPackageIds: async () => (loaded ? [PACKAGE_ID] : []),
    });
    const turnOn = async (key: string) => {
      const { approvalHash } = await registry.describe(PACKAGE_ID, key);
      return registry.enable(PACKAGE_ID, key, approvalHash);
    };
    return {
      catalog,
      registry,
      turnOn,
      uninstall: (): void => {
        loaded = undefined;
      },
      dir,
    };
  };

  it('turns the other alternative of a group off when one is turned on', async () => {
    const { catalog, registry, turnOn } = await build();
    await registry.syncPackage(PACKAGE_ID);

    await turnOn('mcp:alt-a');
    expect((await catalog.list()).map((server) => server.id)).toEqual([packageConnectionMcpId(PACKAGE_ID, 'alt-a')]);

    await turnOn('mcp:alt-b');
    expect((await catalog.list()).map((server) => server.id)).toEqual([packageConnectionMcpId(PACKAGE_ID, 'alt-b')]);
    const states = Object.fromEntries((await registry.view(PACKAGE_ID)).map((view) => [view.key, view.state.status]));
    expect(states['mcp:alt-a']).toBe('off');
    expect(states['mcp:alt-b']).toBe('on');
  });

  it('refuses an approval hash that does not match what the dialog showed', async () => {
    const { catalog, registry } = await build();
    await registry.syncPackage(PACKAGE_ID);
    await expect(registry.enable(PACKAGE_ID, 'mcp:alt-a', 'sha256-forged')).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(await catalog.list()).toEqual([]);
  });

  it('removes the server when the connection is turned off, and when the package goes away (reconcile)', async () => {
    const { catalog, registry, turnOn, uninstall } = await build();
    await registry.syncPackage(PACKAGE_ID);
    await turnOn('mcp:docs');
    await registry.disable(PACKAGE_ID, 'mcp:docs');
    expect(await catalog.list()).toEqual([]);

    await turnOn('mcp:docs');
    expect(await catalog.list()).toHaveLength(1);
    uninstall();
    await registry.reconcile();
    expect(await catalog.list()).toEqual([]);
  });

  it('cleans up an orphan left in the catalog by a crash before the state was saved', async () => {
    const { catalog, registry, turnOn } = await build();
    await registry.syncPackage(PACKAGE_ID);
    await turnOn('mcp:docs');
    await registry.setAutoStart(PACKAGE_ID, 'mcp:docs', true);
    await catalog.importMany([
      { ...userServer('Orphan'), id: packageConnectionMcpId(PACKAGE_ID, 'not-declared'), name: 'Orphan' },
    ]);
    await registry.reconcile();
    expect((await catalog.list()).map((server) => server.id)).toEqual([packageConnectionMcpId(PACKAGE_ID, 'docs')]);
  });
});
