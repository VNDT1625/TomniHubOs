import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertLocalExplorerRoot, moveExplorerItem } from '@process/resources/explorer/nativeMove';

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const fixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-explorer-native-'));
  fixtures.push(directory);
  return directory;
};
describe.skipIf(process.platform !== 'win32')('Windows no-replace Explorer moves', () => {
  it('moves names containing quotes and dollar signs as data and preserves contents', async () => {
    const root = await fixture();
    await assertLocalExplorerRoot(root);
    const source = path.join(root, "original '$name.txt");
    const target = path.join(root, "renamed '$name.txt");
    await writeFile(source, 'preserved');
    const original = await stat(source);
    await moveExplorerItem(source, target);
    expect(await readFile(target, 'utf8')).toBe('preserved');
    expect((await stat(target)).mtimeMs).toBe(original.mtimeMs);
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses an existing destination without overwriting either file', async () => {
    const root = await fixture();
    const source = path.join(root, 'source.txt');
    const target = path.join(root, 'existing.txt');
    await writeFile(source, 'source');
    await writeFile(target, 'target');
    await expect(moveExplorerItem(source, target)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(source, 'utf8')).toBe('source');
    expect(await readFile(target, 'utf8')).toBe('target');
  });
  it('renames a directory without copying or losing its contents', async () => {
    const root = await fixture();
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    await mkdir(source);
    await writeFile(path.join(source, 'child.txt'), 'child');
    await moveExplorerItem(source, target);
    expect(await readFile(path.join(target, 'child.txt'), 'utf8')).toBe('child');
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
