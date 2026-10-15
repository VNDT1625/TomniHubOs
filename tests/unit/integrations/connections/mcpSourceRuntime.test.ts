import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSourceMcpRuntime } from '@process/integrations/runtime/mcpSourceRuntime';
import type { HostContext } from '@process/integrations/connections/core/types';

const roots: string[] = [];
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-mcp-source-'));
  roots.push(root);
  await mkdir(path.join(root, 'source', 'server'), { recursive: true });
  await writeFile(path.join(root, 'source', 'server', 'index.js'), 'process.stdin.resume();');
  await writeFile(path.join(root, 'source', 'package.json'), '{"private":true}');
  const ctx: HostContext = {
    packageId: 'local.demo',
    packageVersion: '1.0.0',
    packageDirectory: root,
    readPackageFile: (file) => readFile(path.join(root, file)),
  };
  return {
    root,
    ctx,
    markerDirectory: path.join(root, '.setup-state'),
    runtimeDirectory: path.join(root, '.runtime'),
  };
};
const connection = (extra: Record<string, unknown> = {}) => ({
  kind: 'mcp',
  id: 'bundle',
  title: 'Bundle',
  command: 'node',
  args: ['server/index.js'],
  cwd: 'source',
  ...extra,
});
const sealedFiles = async (root: string) => (await readdir(path.join(root, 'source'))).toSorted();
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('T5.7 MCP source runtime', () => {
  it('runs from a copy under the runtime folder and never from the sealed package, without running setup at enable', async () => {
    const { root, ctx, markerDirectory, runtimeDirectory } = await fixture();
    const before = await sealedFiles(root);
    const setup = vi.fn();
    const runtime = createSourceMcpRuntime({
      markerDirectory,
      runtimeDirectory,
      nodeExecutable: 'ELECTRON_BINARY',
      runSetup: setup,
    });
    expect(await runtime.check(ctx, connection() as never)).toEqual({ ok: true });
    const transport = await runtime.prepare(ctx, connection() as never);
    expect(transport).toMatchObject({
      type: 'stdio',
      command: 'ELECTRON_BINARY',
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    const cwd = transport.cwd ?? '';
    expect(cwd.startsWith(path.join(runtimeDirectory, 'local.demo') + path.sep)).toBe(true);
    expect(transport.args).toEqual([path.join(cwd, 'server', 'index.js')]);
    expect(await readFile(path.join(cwd, 'server', 'index.js'), 'utf8')).toBe('process.stdin.resume();');
    expect(setup).not.toHaveBeenCalled();
    expect(await sealedFiles(root)).toEqual(before);
  });

  it('never copies setup output (a top-level node_modules) into the runtime folder', async () => {
    const { root, ctx, markerDirectory, runtimeDirectory } = await fixture();
    await mkdir(path.join(root, 'source', 'node_modules', 'dep'), { recursive: true });
    await writeFile(path.join(root, 'source', 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');
    const runtime = createSourceMcpRuntime({ markerDirectory, runtimeDirectory, nodeExecutable: 'ELECTRON_BINARY' });
    const transport = await runtime.prepare(ctx, connection() as never);
    expect(existsSync(path.join(transport.cwd ?? '', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(root, 'source', 'node_modules', 'dep', 'index.js'))).toBe(true);
  });

  it('keeps setup output in the copy: a setup that writes files never changes the sealed folder', async () => {
    const { root, ctx, markerDirectory, runtimeDirectory } = await fixture();
    const before = await sealedFiles(root);
    const setup = vi.fn(async (_command: string, _args: readonly string[], cwd: string) => {
      await mkdir(path.join(cwd, 'node_modules'), { recursive: true });
      await writeFile(path.join(cwd, 'node_modules', 'installed.js'), 'x');
      await writeFile(path.join(cwd, 'hooks.json'), '{"rewritten":true}');
    });
    const runtime = createSourceMcpRuntime({
      markerDirectory,
      runtimeDirectory,
      nodeExecutable: 'ELECTRON_BINARY',
      runSetup: setup,
    });
    const transport = await runtime.prepare(ctx, connection({ setup: [['npm', 'install']] }) as never);
    expect(setup).toHaveBeenCalledWith('npm', ['install'], transport.cwd, expect.any(Object));
    expect(existsSync(path.join(transport.cwd ?? '', 'hooks.json'))).toBe(true);
    expect(await sealedFiles(root)).toEqual(before);
    expect(existsSync(path.join(root, 'source', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(root, 'source', 'hooks.json'))).toBe(false);
  });

  it('runs ordered setup once for a version and retry after a failed setup', async () => {
    const { ctx, markerDirectory, runtimeDirectory } = await fixture();
    const setup = vi.fn(async () => undefined);
    const runtime = createSourceMcpRuntime({
      markerDirectory,
      runtimeDirectory,
      nodeExecutable: 'ELECTRON_BINARY',
      runSetup: setup,
    });
    const withSetup = connection({ setup: [['node', 'scripts/setup.js']] });
    expect(await runtime.check(ctx, withSetup as never)).toEqual({ ok: true });
    expect(setup).not.toHaveBeenCalled();
    const first = await runtime.prepare(ctx, withSetup as never);
    await runtime.prepare(ctx, withSetup as never);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith(
      'ELECTRON_BINARY',
      ['scripts/setup.js'],
      first.cwd,
      expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' })
    );
    const broken = createSourceMcpRuntime({
      markerDirectory,
      runtimeDirectory,
      runSetup: vi.fn().mockRejectedValue(new Error('setup failed')),
    });
    await expect(broken.prepare(ctx, connection({ setup: [['node', 'broken.js']] }) as never)).rejects.toThrow(
      'setup failed'
    );
  });

  it('rebuilds the copy when it is missing even if the setup marker is present', async () => {
    const { ctx, markerDirectory, runtimeDirectory } = await fixture();
    const setup = vi.fn(async () => undefined);
    const runtime = createSourceMcpRuntime({
      markerDirectory,
      runtimeDirectory,
      nodeExecutable: 'ELECTRON_BINARY',
      runSetup: setup,
    });
    const withSetup = connection({ setup: [['node', 'scripts/setup.js']] });
    const first = await runtime.prepare(ctx, withSetup as never);
    await rm(first.cwd ?? '', { recursive: true, force: true });
    await runtime.prepare(ctx, withSetup as never);
    expect(setup).toHaveBeenCalledTimes(2);
    expect(await readFile(path.join(first.cwd ?? '', 'server', 'index.js'), 'utf8')).toBe('process.stdin.resume();');
  });

  it('rejects traversal, missing scripts and symlinks leaving the package', async () => {
    const { root, ctx, markerDirectory, runtimeDirectory } = await fixture();
    const runtime = createSourceMcpRuntime({ markerDirectory, runtimeDirectory });
    expect((await runtime.check(ctx, connection({ args: ['../secret.js'] }) as never)).ok).toBe(false);
    expect((await runtime.check(ctx, connection({ args: ['missing.js'] }) as never)).ok).toBe(false);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'tomny-outside-mcp-'));
    roots.push(outside);
    await writeFile(path.join(outside, 'outside.js'), 'console.log("no");');
    await symlink(path.join(outside, 'outside.js'), path.join(root, 'source', 'escape.js'));
    expect((await runtime.check(ctx, connection({ args: ['escape.js'] }) as never)).ok).toBe(false);
  });

  it('refuses to copy a source folder that contains a symbolic link', async () => {
    const { root, ctx, markerDirectory, runtimeDirectory } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'tomny-outside-link-'));
    roots.push(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'nope');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'source', 'link.txt'));
    const runtime = createSourceMcpRuntime({ markerDirectory, runtimeDirectory, nodeExecutable: 'ELECTRON_BINARY' });
    await expect(runtime.prepare(ctx, connection() as never)).rejects.toThrow('symbolic link');
  });

  it('rejects setup programs that are not explicitly allowed', async () => {
    const { ctx, markerDirectory, runtimeDirectory } = await fixture();
    const runtime = createSourceMcpRuntime({ markerDirectory, runtimeDirectory });
    const checked = await runtime.check(ctx, connection({ setup: [['powershell', 'script']] }) as never);
    expect(checked.ok).toBe(false);
  });
});
