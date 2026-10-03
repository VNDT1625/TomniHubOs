import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelReplayStore, type ModelReplayCodec } from '@process/tomnigateway';
import { describe, expect, it } from 'vitest';

const codec = (): ModelReplayCodec => ({
  isAvailable: () => true,
  encrypt: (value) => `ENC:${Buffer.from(value, 'utf8').toString('base64')}`,
  decrypt: (value) => Buffer.from(value.slice(4), 'base64').toString('utf8'),
});

describe('model replay store', () => {
  it('is disabled by default and persists only redacted encrypted samples after opt-in', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-replay-'));
    const file = path.join(root, 'replay.enc');
    const store = createModelReplayStore({ filePath: file, codec: codec(), now: () => 100 });
    await expect(
      store.capture({
        actorId: 'account-1',
        requestId: 'request-1',
        sessionId: 'session-1',
        consumerId: 'consumer-1',
        model: 'model-1',
        capturedAt: 100,
        input: { password: 'secret-value', text: 'Bearer sk-test-abcdefghijklmnop' },
        output: 'token=hidden answer',
      })
    ).resolves.toBeUndefined();
    await store.configure({ enabled: true, ttlMs: 10_000, maxBytes: 100_000 });
    const sampleId = await store.capture({
      actorId: 'account-1',
      requestId: 'request-1',
      sessionId: 'session-1',
      consumerId: 'consumer-1',
      model: 'model-1',
      capturedAt: 100,
      input: { password: 'secret-value', text: 'Bearer sk-test-abcdefghijklmnop' },
      output: 'token=hidden answer',
    });
    expect(sampleId).toMatch(/^model-replay-/u);
    const raw = await readFile(file, 'utf8');
    expect(raw.startsWith('ENC:')).toBe(true);
    expect(raw).not.toContain('secret-value');
    await expect(store.preview('account-1')).resolves.toMatchObject({ enabled: true, count: 1 });
    await expect(store.exportSamples('account-1')).resolves.toEqual([
      expect.objectContaining({
        requestId: 'request-1',
        input: { password: '[REDACTED]', text: 'Bearer [REDACTED]' },
        output: '[REDACTED] answer',
      }),
    ]);
    const recovered = createModelReplayStore({ filePath: file, codec: codec(), now: () => 100 });
    await expect(recovered.preview('account-1')).resolves.toMatchObject({ enabled: true, count: 1 });
  });

  it('supports expiry cleanup, deletion, and capture-off without deleting by default', async () => {
    let at = 100;
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-replay-'));
    const store = createModelReplayStore({ filePath: path.join(root, 'replay.enc'), codec: codec(), now: () => at });
    await store.configure({ enabled: true, ttlMs: 10, maxBytes: 100_000 });
    const id = await store.capture({
      actorId: 'account-2',
      requestId: 'request-2',
      sessionId: 'session-2',
      consumerId: 'consumer-2',
      model: 'model-2',
      capturedAt: at,
      input: [],
      output: 'ok',
    });
    await store.configure({ enabled: false });
    await expect(
      store.capture({
        actorId: 'account-2',
        requestId: 'r',
        sessionId: 's',
        consumerId: 'c',
        model: 'm',
        capturedAt: at,
        input: [],
        output: 'x',
      })
    ).resolves.toBeUndefined();
    await expect(store.delete('account-2', id)).resolves.toBe(1);
    await expect(store.preview('account-2')).resolves.toMatchObject({ enabled: false, count: 0 });
    at = 200;
    await expect(store.cleanup()).resolves.toBe(0);
  });

  it('persists an enabled configuration before the first sample is captured', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-replay-'));
    const file = path.join(root, 'replay.enc');
    const store = createModelReplayStore({ filePath: file, codec: codec(), now: () => 100 });
    await store.configure({ enabled: true, ttlMs: 10, maxBytes: 10_000 });
    const restarted = createModelReplayStore({ filePath: file, codec: codec(), now: () => 100 });
    await expect(restarted.preview('account-1')).resolves.toMatchObject({ enabled: true, count: 0 });
  });
});
