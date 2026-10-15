import { describe, expect, it } from 'vitest';
import {
  mergeLiveImageOutputUpdate,
  parseLiveImageOutputUpdate,
  type LiveImageOutputUpdate,
} from '@/common/chat/liveImageOutput';

const baseUpdate = {
  schemaVersion: 1,
  outputId: 'image-output-1',
  revision: 1,
  conversationId: 'conversation-1',
  runId: 'run-1',
  source: 'browser-screenshot',
} as const;

const parse = (update: Record<string, unknown>) => parseLiveImageOutputUpdate(update);

describe('live image output contract', () => {
  it('accepts a queued output without exposing bytes or locations', () => {
    expect(parse({ ...baseUpdate, state: 'queued' })).toEqual({ ...baseUpdate, state: 'queued' });
  });

  it('accepts a receipt-gated completed image with an opaque output reference', () => {
    expect(
      parse({
        ...baseUpdate,
        state: 'completed',
        image: {
          outputRef: 'outref_abcdEF0123',
          mimeType: 'image/png',
          width: 1024,
          height: 768,
        },
        receiptId: 'rcpt_run-1_123',
      })
    ).toEqual({
      ...baseUpdate,
      state: 'completed',
      image: {
        outputRef: 'outref_abcdEF0123',
        mimeType: 'image/png',
        width: 1024,
        height: 768,
      },
      receiptId: 'rcpt_run-1_123',
    });
  });

  it.each([
    { ...baseUpdate, state: 'completed' },
    { ...baseUpdate, state: 'queued', workspacePath: '.tomni/artifacts/live-images/secret.png' },
    { ...baseUpdate, state: 'queued', imageUrl: 'https://example.test/image.png' },
    { ...baseUpdate, state: 'queued', image: { data: 'data:image/png;base64,abc' } },
    { ...baseUpdate, state: 'running', errorCode: 'CAPTURE_FAILED' },
    { ...baseUpdate, state: 'failed', errorCode: 'UNEXPECTED' },
    {
      ...baseUpdate,
      state: 'completed',
      image: { outputRef: 'outref_abcdEF0123', mimeType: 'image/jpeg', width: 1, height: 1 },
      receiptId: 'rcpt_run-1_123',
    },
  ])('rejects untrusted or lifecycle-invalid payloads: %#', (payload) => {
    expect(parse(payload)).toBeUndefined();
  });

  it('keeps the newest valid revision and never regresses a terminal lifecycle', () => {
    const running = parse({ ...baseUpdate, state: 'running', revision: 2 });
    const finalizing = parse({ ...baseUpdate, state: 'finalizing', revision: 3 });
    const completed = parse({
      ...baseUpdate,
      state: 'completed',
      revision: 4,
      image: { outputRef: 'outref_abcdEF0123', mimeType: 'image/png', width: 1, height: 1 },
      receiptId: 'rcpt_run-1_123',
    });
    const staleRunning = parse({ ...baseUpdate, state: 'running', revision: 5 });

    if (!running || !finalizing || !completed || !staleRunning) {
      throw new Error('test setup created invalid updates');
    }

    expect(mergeLiveImageOutputUpdate(running, finalizing)).toEqual(finalizing);
    expect(mergeLiveImageOutputUpdate(finalizing, completed)).toEqual(completed);
    expect(mergeLiveImageOutputUpdate(completed, staleRunning)).toEqual(completed);
    expect(mergeLiveImageOutputUpdate(completed, { ...completed, revision: 3 } as LiveImageOutputUpdate)).toEqual(
      completed
    );
  });
});
