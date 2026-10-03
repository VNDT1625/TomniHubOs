import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import { createModelRequestHistory } from '@process/tomnigateway';
import { describe, expect, it } from 'vitest';

describe('model request history', () => {
  it('persists redacted terminal usage and recovers it after restart', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-history-'));
    const file = path.join(root, 'history.jsonl');
    const first = createModelRequestHistory(new JsonlDurableEventStore(file));
    await first.begin({
      requestId: 'request-1',
      sessionId: 'session-1',
      consumerId: 'consumer-1',
      actorId: 'account-secret',
      model: 'model-1',
      startedAt: 10,
    });

    await first.complete({
      requestId: 'request-1',
      sessionId: 'session-1',
      consumerId: 'consumer-1',
      actorId: 'account-secret',
      model: 'model-1',
      providerId: 'provider-1',
      status: 'completed',
      receiptId: 'model-receipt-1',
      startedAt: 10,
      finishedAt: 25,
      usage: {
        source: 'reported',
        promptCount: 3,
        completionCount: 4,
        totalCount: 7,
        cachedCount: 1,
        reasoningCount: 2,
      },
    });
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('account-secret');

    const recovered = createModelRequestHistory(new JsonlDurableEventStore(file));
    await expect(recovered.list({ actorId: 'account-secret', consumerId: 'consumer-1' })).resolves.toEqual([
      expect.objectContaining({
        requestId: 'request-1',
        status: 'completed',
        providerId: 'provider-1',
        usage: expect.objectContaining({ source: 'reported', totalCount: 7, cachedCount: 1, reasoningCount: 2 }),
      }),
    ]);
    await expect(recovered.list({ providerId: 'provider-1' })).resolves.toHaveLength(1);
  });

  it('deduplicates terminal completion and preserves unknown usage on failure', async () => {
    const store = new JsonlDurableEventStore(
      path.join(await mkdtemp(path.join(os.tmpdir(), 'tomni-model-history-')), 'history.jsonl')
    );
    const history = createModelRequestHistory(store);
    const input = {
      requestId: 'request-2',
      sessionId: 'session-2',
      consumerId: 'consumer-2',
      actorId: 'account-2',
      model: 'model-2',
      startedAt: 1,
    };
    await history.begin(input);
    const terminal = {
      ...input,
      status: 'failed' as const,
      receiptId: 'model-receipt-2',
      finishedAt: 4,
      usage: { source: 'unavailable' as const },
      errorCode: 'PROVIDER_EXECUTION_ABORTED',
    };
    await history.complete(terminal);
    await history.complete(terminal);
    await expect(history.list()).resolves.toEqual([
      expect.objectContaining({
        requestId: 'request-2',
        status: 'failed',
        usage: { source: 'unavailable' },
        errorCode: 'PROVIDER_EXECUTION_ABORTED',
      }),
    ]);
  });
});
