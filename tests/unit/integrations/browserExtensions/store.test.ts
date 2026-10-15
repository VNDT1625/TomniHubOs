import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExtensionStore } from '@process/integrations/browserExtensions/store';
import { useTempRoots } from './extensionFixture';

const temp = useTempRoots();
const ID = 'a'.repeat(32);

describe('extension store', () => {
  it('remembers keys and loaded extensions across a restart', async () => {
    const file = path.join(await temp(), 'state.json');
    const first = createExtensionStore(file);
    await first.initialize();
    await first.setKey('pkg', 'ext', 'QUJD');
    await first.saveLoaded({ packageId: 'pkg', connectionId: 'ext', extensionId: ID, name: 'Name', version: '1' });

    const second = createExtensionStore(file);
    await second.initialize();
    expect(second.getKey('pkg', 'ext')).toBe('QUJD');
    expect(second.getLoaded('pkg', 'ext')).toMatchObject({ extensionId: ID, name: 'Name' });
    expect(second.getKey('pkg', 'other')).toBeUndefined();

    await second.removeLoaded('pkg', 'ext');
    const third = createExtensionStore(file);
    await third.initialize();
    expect(third.listLoaded()).toEqual([]);
    expect(third.getKey('pkg', 'ext')).toBe('QUJD');
  });

  it('fails closed on a corrupt file and drops invalid records', async () => {
    const root = await temp();
    const corrupt = path.join(root, 'corrupt.json');
    await writeFile(corrupt, '{not json');
    const broken = createExtensionStore(corrupt);
    await broken.initialize();
    expect(broken.listLoaded()).toEqual([]);

    const partial = path.join(root, 'partial.json');
    await writeFile(
      partial,
      JSON.stringify({
        schemaVersion: 1,
        keys: [{ packageId: '../x', connectionId: 'a', publicKey: 'QUJD' }],
        loaded: [
          { packageId: 'pkg', connectionId: 'ok', extensionId: ID },
          { packageId: 'pkg', connectionId: 'bad', extensionId: 'not-an-id' },
        ],
      })
    );
    const store = createExtensionStore(partial);
    await store.initialize();
    expect(store.listLoaded().map((record) => record.connectionId)).toEqual(['ok']);
    expect(store.getKey('../x', 'a')).toBeUndefined();
  });

  it('refuses to save a record that does not validate', async () => {
    const store = createExtensionStore(path.join(await temp(), 'state.json'));
    await store.initialize();
    await expect(store.saveLoaded({ packageId: 'pkg', connectionId: 'a', extensionId: 'short' })).rejects.toThrow();
    await expect(store.setKey('pkg', 'a', 'not base64!')).rejects.toThrow();
  });
});
