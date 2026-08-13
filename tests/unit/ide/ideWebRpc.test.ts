/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdeWebRpc } from '@process/ide/mcp/ideWebRpc';

type RpcResult<T> = {
  ok: true;
  data: T;
};

type ListedEntry = {
  name: string;
  fullPath: string;
  isDir: boolean;
};

type ReadResult = {
  text: string;
  totalLines: number;
  truncated: boolean;
};

type LocatedHit = {
  path: string;
  line: number;
  column: number;
  text: string;
};

describe('browser IDE RPC workspace confinement', () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), 'tomni-ide-web-rpc-'));
    await mkdir(path.join(rootPath, 'src'));
    await writeFile(path.join(rootPath, 'README.md'), '# Fixture\nsecond line\n', 'utf8');
    await writeFile(
      path.join(rootPath, 'src', 'billing.ts'),
      'export const billingTotal = 42;\nexport const readBilling = () => billingTotal;\n',
      'utf8'
    );
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it('reports the normalized active workspace root', async () => {
    const rpc = createIdeWebRpc(path.join(rootPath, '.'));

    await expect(rpc({ method: 'workspace.info' })).resolves.toEqual({ rootPath: path.resolve(rootPath) });
  });

  it('lists entries inside the active workspace', async () => {
    const rpc = createIdeWebRpc(rootPath);

    const result = (await rpc({ method: 'ide.listDir', params: { dir: '.' } })) as RpcResult<ListedEntry[]>;

    expect(result.ok).toBe(true);
    expect(result.data.map(({ name, isDir }) => ({ name, isDir }))).toEqual([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false },
    ]);
  });

  it('reads a requested line range from a workspace file', async () => {
    const rpc = createIdeWebRpc(rootPath);

    const result = (await rpc({
      method: 'ide.readFile',
      params: { path: 'README.md', from: 2, to: 2, lineNumbers: false },
    })) as RpcResult<ReadResult>;

    expect(result.data.text).toBe('second line');
    expect(result.data).toMatchObject({ totalLines: 3, truncated: false });
  });

  it('returns absolute search paths with one-based line and column positions', async () => {
    const rpc = createIdeWebRpc(rootPath);

    const result = (await rpc({
      method: 'ide.search',
      params: { rootPath, query: 'billingTotal' },
    })) as RpcResult<LocatedHit[]>;

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      path: path.join(rootPath, 'src', 'billing.ts'),
      line: 1,
      column: 14,
    });
  });

  it('locates symbol definitions with an absolute path', async () => {
    const rpc = createIdeWebRpc(rootPath);

    const result = (await rpc({
      method: 'ide.findDefinition',
      params: { rootPath, name: 'billingTotal' },
    })) as RpcResult<LocatedHit[]>;

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      path: path.join(rootPath, 'src', 'billing.ts'),
      line: 1,
      column: 14,
    });
  });

  it('locates symbol references with absolute paths and source positions', async () => {
    const rpc = createIdeWebRpc(rootPath);

    const result = (await rpc({
      method: 'ide.findReferences',
      params: { rootPath, name: 'billingTotal' },
    })) as RpcResult<LocatedHit[]>;

    expect(result.data).toHaveLength(2);
    expect(result.data.map(({ path: hitPath, line, column }) => ({ path: hitPath, line, column }))).toEqual([
      { path: path.join(rootPath, 'src', 'billing.ts'), line: 1, column: 14 },
      { path: path.join(rootPath, 'src', 'billing.ts'), line: 2, column: 34 },
    ]);
  });

  it('rejects paths that escape the active workspace', async () => {
    const rpc = createIdeWebRpc(rootPath);

    await expect(rpc({ method: 'ide.readFile', params: { path: '../outside.txt' } })).rejects.toThrow(
      'path must stay inside the active workspace.'
    );
  });

  it('refuses to delete the active workspace root', async () => {
    const rpc = createIdeWebRpc(rootPath);

    await expect(rpc({ method: 'ide.deleteFile', params: { path: rootPath } })).rejects.toThrow(
      'The active workspace root cannot be renamed or deleted.'
    );
    await expect(stat(rootPath)).resolves.toMatchObject({});
  });
});
