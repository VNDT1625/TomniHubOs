import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileSyncStoragePort } from '@process/integrations/browserExtensions/wiring/syncStoragePort';

const ID = 'a'.repeat(32);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'tomny-sync-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('file-backed sync storage', () => {
  it('reads nothing for an extension that never stored anything, and round-trips what it writes', async () => {
    const port = createFileSyncStoragePort(dir);
    expect(await port.read(ID)).toBeUndefined();
    await port.write(ID, { a: 1, nested: { b: [true] } });
    expect(await port.read(ID)).toEqual({ a: 1, nested: { b: [true] } });
    expect(JSON.parse(await readFile(path.join(dir, `${ID}.json`), 'utf8'))).toEqual({ a: 1, nested: { b: [true] } });
  });

  it('rejects damaged data instead of treating it as empty, so a write cannot erase it', async () => {
    const port = createFileSyncStoragePort(dir);
    await writeFile(path.join(dir, `${ID}.json`), '{not json', 'utf8');
    await expect(port.read(ID)).rejects.toThrow();
    await writeFile(path.join(dir, `${ID}.json`), '[1,2]', 'utf8');
    await expect(port.read(ID)).rejects.toThrow(/damaged/);
  });

  it('refuses a folder that is not absolute, and an id that could name another file', async () => {
    expect(() => createFileSyncStoragePort('relative/folder')).toThrow(/absolute/);
    const port = createFileSyncStoragePort(dir);
    await expect(port.read('../escape')).rejects.toThrow(/not well formed/);
    await expect(port.write('../escape', {})).rejects.toThrow(/not well formed/);
  });
});
