import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createJsonConnectionStateStore,
  parseConnectionState,
  type InstalledConnectionState,
} from '@process/integrations/connections/core/state';

const roots: string[] = [];
const tempFile = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-conn-state-'));
  roots.push(root);
  return path.join(root, 'connections.json');
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const record = (overrides: Partial<InstalledConnectionState> = {}): InstalledConnectionState => ({
  packageId: 'com.community.sample',
  packageVersion: '1.0.0',
  connectionKey: 'mcp:context7',
  enabled: false,
  status: 'off',
  ...overrides,
});

describe('connection state store', () => {
  it('round-trips records across a restart', async () => {
    const file = await tempFile();
    const store = createJsonConnectionStateStore(file);
    await store.initialize();
    await store.save(record());
    await store.save(
      record({
        connectionKey: 'skill:source/skills/a',
        enabled: true,
        status: 'on',
        approvalHash: `sha256-${'a'.repeat(64)}`,
        installed: ['a'],
      })
    );

    const reopened = createJsonConnectionStateStore(file);
    await reopened.initialize();
    expect(reopened.list()).toHaveLength(2);
    expect(reopened.get('com.community.sample', 'skill:source/skills/a')?.installed).toEqual(['a']);
    expect(reopened.list('other.package')).toEqual([]);
  });

  it('treats a missing, unreadable or wrongly shaped file as nothing enabled', async () => {
    const missing = createJsonConnectionStateStore(await tempFile());
    await missing.initialize();
    expect(missing.list()).toEqual([]);

    const garbage = await tempFile();
    await writeFile(garbage, '{not json');
    const corrupt = createJsonConnectionStateStore(garbage);
    await corrupt.initialize();
    expect(corrupt.list()).toEqual([]);

    const wrong = await tempFile();
    await writeFile(wrong, JSON.stringify({ schemaVersion: 2, records: [] }));
    const other = createJsonConnectionStateStore(wrong);
    await other.initialize();
    expect(other.list()).toEqual([]);
  });

  it('drops one invalid record without losing the others', async () => {
    const file = await tempFile();
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        records: [
          record(),
          { ...record({ connectionKey: 'hook:bad' }), enabled: true, status: 'off' },
          { ...record({ connectionKey: 'cli:extra' }), surprise: true },
          'nonsense',
        ],
      })
    );
    const store = createJsonConnectionStateStore(file);
    await store.initialize();
    expect(store.list().map((item) => item.connectionKey)).toEqual(['mcp:context7']);
  });

  it('rejects invalid records on save and keeps the previous state', async () => {
    const store = createJsonConnectionStateStore(await tempFile());
    await store.initialize();
    await store.save(record());
    await expect(store.save(record({ enabled: true, status: 'off' }))).rejects.toThrow();
    await expect(store.save(record({ packageId: '../escape' }))).rejects.toThrow();
    await expect(store.save(record({ approvalHash: 'sha256-short' }))).rejects.toThrow();
    expect(store.get('com.community.sample', 'mcp:context7')?.enabled).toBe(false);
  });

  it('replaces and removes a whole package without touching others', async () => {
    const file = await tempFile();
    const store = createJsonConnectionStateStore(file);
    await store.initialize();
    await store.save(record({ connectionKey: 'mcp:a' }));
    await store.save(record({ connectionKey: 'mcp:b' }));
    await store.save(record({ packageId: 'com.community.other', connectionKey: 'mcp:a' }));

    await store.replaceForPackage('com.community.sample', [record({ connectionKey: 'mcp:c' })]);
    expect(store.list('com.community.sample').map((item) => item.connectionKey)).toEqual(['mcp:c']);
    await expect(
      store.replaceForPackage('com.community.sample', [record({ packageId: 'com.community.other' })])
    ).rejects.toThrow(/different package/);

    await store.removePackage('com.community.sample');
    expect(store.list().map((item) => item.packageId)).toEqual(['com.community.other']);
    expect(JSON.parse(await readFile(file, 'utf8')).records).toHaveLength(1);
  });

  it('rolls memory back when the write fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-conn-state-'));
    roots.push(root);
    // The target path is a directory, so the final rename fails.
    const store = createJsonConnectionStateStore(root);
    await store.initialize();
    await expect(store.save(record())).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });

  it('returns copies so callers cannot mutate stored state', async () => {
    const store = createJsonConnectionStateStore(await tempFile());
    await store.initialize();
    await store.save(record({ installed: ['x'] }));
    const copy = store.get('com.community.sample', 'mcp:context7');
    copy?.installed?.push('y');
    expect(store.get('com.community.sample', 'mcp:context7')?.installed).toEqual(['x']);
    expect(parseConnectionState({ nonsense: true })).toBeUndefined();
  });
});
