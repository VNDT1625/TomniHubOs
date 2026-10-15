/* oxlint-disable no-await-in-loop -- the steps of one scenario must run in order */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), isPackaged: false }, ipcMain: {}, shell: {} }));

import { parseAdapterDocument } from '@/common/packages/adapter';
import {
  createCoreWorkspaceServer,
  registerCoreWorkspacePackageCliPort,
  type CorePackageCliPort,
} from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';
import { tomnyToolAccessForPermission } from '@process/experimentalCore/adapters/tomnyCoreAdapter';
import type { CliExecPort, CliExecRequest } from '@process/integrations/connections/cli/cliExec';
import {
  createCorePackageCliPort,
  createPackageCliService,
} from '@process/integrations/connections/cli/packageCliService';

const PACKAGE_ID = 'com.community.context7';
const TOOL = 'tomny_package_cli';

const roots: string[] = [];
afterEach(async () => {
  registerCoreWorkspacePackageCliPort(undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const workspace = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-clitool-'));
  roots.push(root);
  return root;
};

const connect = async (root: string, deps: Partial<Parameters<typeof createCoreWorkspaceServer>[0]> = {}) => {
  const server = createCoreWorkspaceServer({ workspace: root, ...deps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'package-cli-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
};

const textOf = (value: unknown): string =>
  ((value as { content?: Array<{ text?: string }> }).content ?? []).map((item) => item.text ?? '').join('\n');
const isError = (value: unknown): boolean => (value as { isError?: boolean }).isError === true;

/** The real service and port over a fake registry and a fake runner, so the whole path of one call is exercised. */
const realPort = (exec: CliExecPort, options: { secrets?: readonly string[] } = {}): CorePackageCliPort => {
  const [connection] = parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: [{ kind: 'cli', id: 'ctx7', title: 'Context7', command: 'ctx7', args: ['docs'], display: 'terminal' }],
  }).connections;
  const service = createPackageCliService({
    registry: {
      enabledOfKind: async (kind) =>
        kind === 'cli' && connection
          ? [
              {
                packageId: PACKAGE_ID,
                packageVersion: '1.0.0',
                key: 'cli:ctx7',
                connection,
                context: {
                  packageId: PACKAGE_ID,
                  packageVersion: '1.0.0',
                  packageDirectory: os.tmpdir(),
                  readPackageFile: async () => Buffer.alloc(0),
                },
              },
            ]
          : [],
    },
    exec,
    ports: {
      env: { PATH: 'C:\\bin' },
      exists: async (file) => file.toLowerCase() === 'c:\\bin\\ctx7.exe',
      platform: 'win32',
    },
    baseEnv: () => ({ PATH: 'C:\\bin' }),
    secretValues: async () => options.secrets ?? [],
  });
  return createCorePackageCliPort(service);
};

describe('tomny_package_cli: availability', () => {
  it('is offered by the full server and not by the read-only one', async () => {
    const root = await workspace();
    const full = await connect(root);
    expect((await full.listTools()).tools.map((tool) => tool.name)).toContain(TOOL);
    const readOnly = await connect(root, { readOnly: true });
    expect((await readOnly.listTools()).tools.map((tool) => tool.name)).not.toContain(TOOL);
  });

  it('stays unavailable until the host composes a governed port', async () => {
    const client = await connect(await workspace());
    const result = await client.callTool({ name: TOOL, arguments: { packageId: PACKAGE_ID, connectionId: 'ctx7' } });
    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain('CORE_WORKSPACE_PACKAGE_CLI_GOVERNANCE_REQUIRED');
  });

  it('uses the port the host registered, and an explicit one first', async () => {
    const root = await workspace();
    const registered = vi.fn(async () => ({ ok: true, message: 'registered' }));
    const explicit = vi.fn(async () => ({ ok: true, message: 'explicit' }));
    registerCoreWorkspacePackageCliPort({ run: registered });
    expect(textOf(await (await connect(root)).callTool({ name: TOOL, arguments: {} }))).toBe('registered');
    expect(
      textOf(await (await connect(root, { packageCli: { run: explicit } })).callTool({ name: TOOL, arguments: {} }))
    ).toBe('explicit');
  });
});

describe('tomny_package_cli: what reaches the port', () => {
  it('gives the port the granted workspace, the ids, the arguments and a cancellation signal', async () => {
    const root = await workspace();
    const run = vi.fn(async () => ({ ok: true, message: 'ok' }));
    const client = await connect(root, { packageCli: { run } });
    await client.callTool({
      name: TOOL,
      arguments: { packageId: PACKAGE_ID, connectionId: 'ctx7', args: ['react', '-v'], timeoutSeconds: 30 },
    });
    const input = (run.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    expect(input).toMatchObject({
      workspace: await realpath(root),
      packageId: PACKAGE_ID,
      connectionId: 'ctx7',
      args: ['react', '-v'],
      timeoutSeconds: 30,
    });
    expect(input?.['signal']).toBeInstanceOf(AbortSignal);
  });

  it('lists when no program is named, and refuses half a name', async () => {
    const run = vi.fn(async () => ({ ok: true, message: 'listing' }));
    const client = await connect(await workspace(), { packageCli: { run } });
    expect(textOf(await client.callTool({ name: TOOL, arguments: {} }))).toBe('listing');
    const half = await client.callTool({ name: TOOL, arguments: { packageId: PACKAGE_ID } });
    expect(isError(half)).toBe(true);
    expect(textOf(half)).toContain('Give both packageId and connectionId');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('turns a refused outcome into a tool error the model can read', async () => {
    const client = await connect(await workspace(), {
      packageCli: { run: async () => ({ ok: false, message: 'Argument 1 was refused: nope.' }) },
    });
    const result = await client.callTool({ name: TOOL, arguments: { packageId: PACKAGE_ID, connectionId: 'ctx7' } });
    expect(isError(result)).toBe(true);
    expect(textOf(result)).toBe('Argument 1 was refused: nope.');
  });
});

describe('tomny_package_cli: input schema', () => {
  const rejected = async (args: Record<string, unknown>): Promise<boolean> => {
    const run = vi.fn(async () => ({ ok: true, message: 'ran' }));
    const client = await connect(await workspace(), { packageCli: { run } });
    let failed = false;
    try {
      failed = isError(await client.callTool({ name: TOOL, arguments: args }));
    } catch {
      failed = true;
    }
    expect(run).not.toHaveBeenCalled();
    return failed;
  };

  it('bounds the argument list, one argument, the ids and the timeout before the port is reached', async () => {
    expect(await rejected({ packageId: 'p', connectionId: 'c', args: Array.from({ length: 25 }, () => 'a') })).toBe(
      true
    );
    expect(await rejected({ packageId: 'p', connectionId: 'c', args: ['a'.repeat(201)] })).toBe(true);
    expect(await rejected({ packageId: 'p', connectionId: 'c', args: [''] })).toBe(true);
    expect(await rejected({ packageId: 'p', connectionId: 'c', args: [1] })).toBe(true);
    expect(await rejected({ packageId: 'p'.repeat(129), connectionId: 'c' })).toBe(true);
    expect(await rejected({ packageId: 'p', connectionId: 'c'.repeat(65) })).toBe(true);
    expect(await rejected({ packageId: 'p', connectionId: 'c', timeoutSeconds: 121 })).toBe(true);
    expect(await rejected({ packageId: 'p', connectionId: 'c', timeoutSeconds: 0 })).toBe(true);
  });
});

describe('tomny_package_cli: the whole call with the real service', () => {
  it('refuses a shell separator or a path out of the workspace with nothing started', async () => {
    const exec = vi.fn<CliExecPort>();
    const client = await connect(await workspace(), { packageCli: realPort(exec) });
    for (const bad of ['a;calc', '$(calc)', 'a b', '../../secret', '/etc/passwd', 'C:/x', '--out=../x']) {
      const result = await client.callTool({
        name: TOOL,
        arguments: { packageId: PACKAGE_ID, connectionId: 'ctx7', args: [bad] },
      });
      expect(isError(result)).toBe(true);
      expect(textOf(result)).toContain('Argument 1 was refused');
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it('runs an allowed call in the workspace with a timeout and a capped output, and renders the exit code', async () => {
    const root = await workspace();
    const exec = vi.fn<CliExecPort>(async () => ({
      exitCode: 0,
      output: 'hello\n',
      truncated: false,
      timedOut: false,
      cancelled: false,
    }));
    const client = await connect(root, { packageCli: realPort(exec) });
    const result = await client.callTool({
      name: TOOL,
      arguments: { packageId: PACKAGE_ID, connectionId: 'ctx7', args: ['react'], timeoutSeconds: 10 },
    });
    expect(isError(result)).toBe(false);
    expect(textOf(result)).toMatch(/^exit code 0 in [\d.]+ s\nhello/u);
    const request = exec.mock.calls[0]?.[0] as CliExecRequest;
    expect(request).toMatchObject({
      file: 'C:\\bin\\ctx7.exe',
      args: ['docs', 'react'],
      cwd: await realpath(root),
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });
  });

  it('reports the time limit as an error', async () => {
    const client = await connect(await workspace(), {
      packageCli: realPort(async () => ({
        exitCode: null,
        output: 'partial\n',
        truncated: false,
        timedOut: true,
        cancelled: false,
      })),
    });
    const result = await client.callTool({ name: TOOL, arguments: { packageId: PACKAGE_ID, connectionId: 'ctx7' } });
    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain('Stopped after the time limit');
    expect(textOf(result)).toContain('partial');
  });

  it('never lets a package secret value, or a recognisable key, reach the model', async () => {
    const secret = 'pkg-secret-value-123';
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const client = await connect(await workspace(), {
      packageCli: realPort(
        async () => ({
          exitCode: 0,
          output: `token ${secret}\nGITHUB_TOKEN=${token}\n`,
          truncated: false,
          timedOut: false,
          cancelled: false,
        }),
        { secrets: [secret] }
      ),
    });
    const result = await client.callTool({ name: TOOL, arguments: { packageId: PACKAGE_ID, connectionId: 'ctx7' } });
    const text = textOf(result);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(token);
    expect(text).toContain('[redacted]');
  });

  it('lists the programs that are on', async () => {
    const client = await connect(await workspace(), { packageCli: realPort(vi.fn<CliExecPort>()) });
    expect(textOf(await client.callTool({ name: TOOL, arguments: {} }))).toContain(
      `${PACKAGE_ID} / ctx7 (cli): ctx7 docs`
    );
  });
});

describe('tomny_package_cli: permission', () => {
  it('goes through the host permission path: denied in read-only, asked in workspace-write, allowed only in full access', () => {
    expect(tomnyToolAccessForPermission('read-only', TOOL)).toBe('deny');
    expect(tomnyToolAccessForPermission('workspace-write', TOOL)).toBe('prompt');
    expect(tomnyToolAccessForPermission('full-access', TOOL)).toBe('approve');
    // It is not on the list of tools that need no question.
    expect(tomnyToolAccessForPermission('workspace-write', 'tomny_read')).toBe('approve');
  });
});
