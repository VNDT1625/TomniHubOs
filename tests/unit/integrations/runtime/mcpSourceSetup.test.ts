import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostContext } from '@process/integrations/connections/core/types';
import { createSourceMcpRuntime, setupInvocation } from '@process/integrations/runtime/mcpSourceRuntime';

const roots: string[] = [];
const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-mcp-setup-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

describe('setup steps of a source MCP server', () => {
  it('runs npm on Windows through its own CLI script, found on PATH, instead of a .cmd shim', async () => {
    const bin = path.join(await tempRoot(), 'nodejs');
    const cli = path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, '');
    await writeFile(path.join(bin, 'node.exe'), '');
    const previousPath = process.env.PATH;
    process.env.PATH = bin;
    try {
      expect(setupInvocation('npm', ['ci'], 'win32')).toEqual({
        command: path.join(bin, 'node.exe'),
        args: [cli, 'ci'],
      });
      expect(setupInvocation('npm', ['ci'], 'linux')).toEqual({ command: 'npm', args: ['ci'] });
      expect(setupInvocation('python', ['-m', 'pip'], 'win32')).toEqual({ command: 'python', args: ['-m', 'pip'] });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('the enable path hands the npm setup step to the runner, once per recipe, before the server is prepared', async () => {
    const packageDirectory = await tempRoot();
    await mkdir(path.join(packageDirectory, 'source'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'source', 'index.mjs'), 'export {};\n');
    const markerDirectory = path.join(await tempRoot(), 'markers');
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const runtime = createSourceMcpRuntime({
      markerDirectory,
      nodeExecutable: 'C:/node/node.exe',
      runSetup: async (command, args, cwd) => {
        calls.push({ command, args: [...args], cwd });
      },
    });
    const context = {
      packageId: 'demo-pack',
      packageVersion: '1.0.0',
      packageDirectory,
      readPackageFile: async () => Buffer.from(''),
    } as HostContext;
    const connection = {
      kind: 'mcp',
      id: 'ctx',
      title: 'ctx',
      command: 'node',
      args: ['source/index.mjs'],
      cwd: 'source',
      setup: [['npm', 'ci']],
    } as never;

    const transport = await runtime.prepare(context, connection);

    expect(calls).toEqual([{ command: 'npm', args: ['ci'], cwd: expect.stringContaining('source') }]);
    expect(transport).toMatchObject({ type: 'stdio', command: 'C:/node/node.exe' });
    await runtime.prepare(context, connection);
    expect(calls).toHaveLength(1);
  });

  it('a failing setup step fails the enable and records no success marker', async () => {
    const packageDirectory = await tempRoot();
    await mkdir(path.join(packageDirectory, 'source'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'source', 'index.mjs'), 'export {};\n');
    const markerDirectory = path.join(await tempRoot(), 'markers');
    const runtime = createSourceMcpRuntime({
      markerDirectory,
      nodeExecutable: 'C:/node/node.exe',
      runSetup: async () => {
        throw new Error('npm exited with code 1');
      },
    });
    const context = {
      packageId: 'demo-pack',
      packageVersion: '1.0.0',
      packageDirectory,
      readPackageFile: async () => Buffer.from(''),
    } as HostContext;
    const connection = {
      kind: 'mcp',
      id: 'ctx',
      title: 'ctx',
      command: 'node',
      args: ['source/index.mjs'],
      cwd: 'source',
      setup: [['npm', 'ci']],
    } as never;

    await expect(runtime.prepare(context, connection)).rejects.toThrow('npm exited with code 1');
    expect(existsSync(markerDirectory) ? await readdir(markerDirectory) : []).toEqual([]);
  });
});
