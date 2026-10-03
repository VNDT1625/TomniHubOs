import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonlDurableEventStore, MemoryDurableEventStore } from '@process/services/agentChat/durability';
import { createModelQuotaSnapshotStore } from '@process/tomnigateway';
import { describe, expect, it } from 'vitest';

describe('model quota snapshots', () => {
  it('persists the latest snapshot and binds reads to the Main actor', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-quota-'));
    const file = path.join(root, 'quota.jsonl');
    const first = createModelQuotaSnapshotStore(new JsonlDurableEventStore(file));
    await first.save({
      actorId: 'account-1',
      snapshot: {
        status: 'reported',
        source: 'provider',
        unit: 'tokens',
        consumerId: 'consumer-1',
        model: 'model-1',
        providerId: 'provider-1',
        observedAt: 10,
        resetAt: 20,
        remaining: 90,
        limit: 100,
      },
    });
    await first.save({
      actorId: 'account-1',
      snapshot: {
        status: 'reported',
        source: 'provider',
        unit: 'tokens',
        consumerId: 'consumer-1',
        model: 'model-1',
        observedAt: 5,
        remaining: 1,
      },
    });

    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('account-1');
    const recovered = createModelQuotaSnapshotStore(new JsonlDurableEventStore(file));
    await expect(
      recovered.latest({ actorId: 'account-1', consumerId: 'consumer-1', model: 'model-1' })
    ).resolves.toEqual(expect.objectContaining({ remaining: 90, limit: 100, observedAt: 10 }));
    await expect(
      recovered.latest({ actorId: 'account-2', consumerId: 'consumer-1', model: 'model-1' })
    ).resolves.toBeUndefined();
  });

  it('rejects balances when quota is explicitly unknown', async () => {
    const store = createModelQuotaSnapshotStore(new MemoryDurableEventStore());
    await expect(
      store.save({
        actorId: 'account-1',
        snapshot: {
          status: 'unknown',
          source: 'unsupported',
          unit: 'tokens',
          consumerId: 'consumer-1',
          observedAt: 1,
          remaining: 0,
        },
      })
    ).rejects.toThrow('MODEL_QUOTA_INVALID_UNKNOWN_BALANCE');
  });
});
