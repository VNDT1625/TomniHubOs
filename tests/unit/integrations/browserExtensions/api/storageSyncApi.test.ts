import { describe, expect, it } from 'vitest';
import {
  SYNC_MAX_ITEMS,
  SYNC_QUOTA_BYTES,
  type SyncItems,
  type SyncStoragePort,
} from '@process/integrations/browserExtensions/api/groups/data/storageSync';
import { ID_A, ID_B, call, manifestOf, shimWith, workerOf } from './shimFixture';

const ID_C = 'cccccccccccccccccccccccccccccccc';

/** The disk: one stored object per extension id. Writes are copied, as a file would be. */
const fakeDisk = () => {
  const files = new Map<string, SyncItems>();
  let failWrites = false;
  const port: SyncStoragePort = {
    read: async (id) => files.get(id),
    write: async (id, items) => {
      if (failWrites) throw new Error('disk full');
      files.set(id, JSON.parse(JSON.stringify(items)) as SyncItems);
    },
  };
  return {
    port,
    files,
    failWrites: (value: boolean) => {
      failWrites = value;
    },
  };
};

const setup = () => {
  const disk = fakeDisk();
  const shim = shimWith(
    {
      [ID_A]: manifestOf({ permissions: ['storage'] }),
      [ID_B]: manifestOf({ permissions: ['tabs'] }),
      [ID_C]: manifestOf({ permissions: ['storage'] }),
    },
    { ports: { syncStorage: disk.port } }
  );
  return { shim, disk };
};

describe('chrome.storage.sync permission and round trip', () => {
  it('needs the storage permission for every method', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_B), 'storage.sync.get', null)).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    expect(await call(shim, workerOf(ID_B), 'storage.sync.set', { a: 1 })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
  });

  it('reads back what it stored, with each form of the keys argument', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', { a: 1, b: 'x' })).toEqual({ ok: true, value: null });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', null)).toEqual({ ok: true, value: { a: 1, b: 'x' } });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get')).toEqual({ ok: true, value: { a: 1, b: 'x' } });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', 'a')).toEqual({ ok: true, value: { a: 1 } });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', ['a', 'missing'])).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', { a: 9, missing: 'd' })).toEqual({
      ok: true,
      value: { a: 1, missing: 'd' },
    });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.getKeys')).toEqual({ ok: true, value: ['a', 'b'] });
  });

  it('keeps each extension apart, and persists through the port', async () => {
    const { shim, disk } = setup();
    await call(shim, workerOf(ID_A), 'storage.sync.set', { secret: 'a' });
    expect(await call(shim, workerOf(ID_C), 'storage.sync.get', null)).toEqual({ ok: true, value: {} });
    expect(disk.files.get(ID_A)).toEqual({ secret: 'a' });
    const restarted = shimWith(
      { [ID_A]: manifestOf({ permissions: ['storage'] }) },
      { ports: { syncStorage: disk.port } }
    );
    expect(await call(restarted, workerOf(ID_A), 'storage.sync.get', 'secret')).toEqual({
      ok: true,
      value: { secret: 'a' },
    });
  });
});

describe('chrome.storage.sync quotas and validation', () => {
  it('refuses a write over the per-item quota and stores none of it', async () => {
    const { shim, disk } = setup();
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', { big: 'x'.repeat(9000) })).toMatchObject({
      ok: false,
      code: 'REJECTED',
      message: 'QUOTA_BYTES_PER_ITEM quota exceeded',
    });
    expect(disk.files.get(ID_A)).toBeUndefined();
  });

  it('refuses a write that takes the total over the byte quota, or the item count over its maximum', async () => {
    const { shim } = setup();
    // Each call stays under the envelope limit of the router (64 KB), so the quota is reached over three calls.
    expect(SYNC_QUOTA_BYTES).toBe(102_400);
    const batch = (from: number): SyncItems => {
      const items: SyncItems = {};
      for (let index = from; index < from + 5; index += 1) items[`k${index}`] = 'x'.repeat(7000);
      return items;
    };
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', batch(0))).toEqual({ ok: true, value: null });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', batch(5))).toEqual({ ok: true, value: null });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', batch(10))).toMatchObject({
      ok: false,
      code: 'REJECTED',
      message: 'QUOTA_BYTES quota exceeded',
    });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.getKeys')).toEqual({
      ok: true,
      value: ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'],
    });

    const count: SyncItems = {};
    for (let index = 0; index <= SYNC_MAX_ITEMS; index += 1) count[`n${index}`] = 1;
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', count)).toMatchObject({
      ok: false,
      code: 'REJECTED',
      message: 'MAX_ITEMS quota exceeded',
    });
  });

  it('refuses the reserved key and values that are not JSON', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', JSON.parse('{"__proto__": 1}'))).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', { fn: () => 1 })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });

  it('reports the bytes in use the way Chrome counts them: key plus JSON value', async () => {
    const { shim } = setup();
    await call(shim, workerOf(ID_A), 'storage.sync.set', { a: '1' });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.getBytesInUse', ['a'])).toEqual({ ok: true, value: 4 });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.getBytesInUse')).toEqual({ ok: true, value: 4 });
  });
});

describe('chrome.storage.sync removal, ordering and failures', () => {
  it('removes keys and clears everything', async () => {
    const { shim } = setup();
    await call(shim, workerOf(ID_A), 'storage.sync.set', { a: 1, b: 2, c: 3 });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.remove', ['a', 'b'])).toEqual({ ok: true, value: null });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', null)).toEqual({ ok: true, value: { c: 3 } });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.clear')).toEqual({ ok: true, value: null });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', null)).toEqual({ ok: true, value: {} });
  });

  it('keeps every write of concurrent calls, because each waits for the one before', async () => {
    const { shim } = setup();
    await Promise.all([
      call(shim, workerOf(ID_A), 'storage.sync.set', { a: 1 }),
      call(shim, workerOf(ID_A), 'storage.sync.set', { b: 2 }),
      call(shim, workerOf(ID_A), 'storage.sync.set', { c: 3 }),
    ]);
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', null)).toEqual({
      ok: true,
      value: { a: 1, b: 2, c: 3 },
    });
  });

  it('changes nothing when the disk refuses the write', async () => {
    const { shim, disk } = setup();
    await call(shim, workerOf(ID_A), 'storage.sync.set', { a: 1 });
    disk.failWrites(true);
    expect(await call(shim, workerOf(ID_A), 'storage.sync.set', { a: 2 })).toMatchObject({ ok: false, code: 'FAILED' });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', 'a')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('answers UNSUPPORTED when the sync storage is not wired', async () => {
    const shim = shimWith({ [ID_A]: manifestOf({ permissions: ['storage'] }) });
    expect(await call(shim, workerOf(ID_A), 'storage.sync.get', null)).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED',
    });
  });
});
