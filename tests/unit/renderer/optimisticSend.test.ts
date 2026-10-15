/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { sendWithOptimisticBubble } from '@/renderer/pages/conversation/platforms/tomnyagentic/optimisticSend';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('sendWithOptimisticBubble', () => {
  it('shows the bubble before the warm-up and the send have finished', async () => {
    const events: string[] = [];
    const warmup = deferred<void>();
    const sent = deferred<{ msg_id: string }>();

    const pending = sendWithOptimisticBubble({
      userMessageId: 'u-1',
      showBubble: () => events.push('show'),
      removeBubble: () => events.push('remove'),
      beforeSend: () => {
        events.push('warmup');
        return warmup.promise;
      },
      send: (loadingId) => {
        events.push(`send:${loadingId}`);
        return sent.promise;
      },
    });

    // Nothing has resolved yet, and the bubble is already on screen.
    expect(events).toEqual(['show', 'warmup']);

    warmup.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['show', 'warmup', 'send:u-1']);

    sent.resolve({ msg_id: 'u-1' });
    await expect(pending).resolves.toEqual({ msg_id: 'u-1' });
    expect(events).not.toContain('remove');
  });

  it('hands the same id to the main process as the bubble was drawn with', async () => {
    let loading: string | undefined;
    await sendWithOptimisticBubble({
      userMessageId: 'u-2',
      showBubble: () => undefined,
      removeBubble: () => undefined,
      send: async (loadingId) => {
        loading = loadingId;
        return { msg_id: loadingId };
      },
    });
    expect(loading).toBe('u-2');
  });

  it('takes the bubble back and rethrows when the send fails, e.g. the pipeline blocked it', async () => {
    const removed: string[] = [];
    await expect(
      sendWithOptimisticBubble({
        userMessageId: 'u-3',
        showBubble: () => undefined,
        removeBubble: (id) => removed.push(id),
        send: async () => {
          throw new Error('CHAT_PIPELINE_BLOCKED_CREDENTIAL');
        },
      })
    ).rejects.toThrow('CHAT_PIPELINE_BLOCKED_CREDENTIAL');
    expect(removed).toEqual(['u-3']);
  });

  it('also takes the bubble back when the warm-up fails, without sending', async () => {
    const removed: string[] = [];
    let sends = 0;
    await expect(
      sendWithOptimisticBubble({
        userMessageId: 'u-4',
        showBubble: () => undefined,
        removeBubble: (id) => removed.push(id),
        beforeSend: async () => {
          throw new Error('warmup failed');
        },
        send: async () => {
          sends++;
          return { msg_id: 'x' };
        },
      })
    ).rejects.toThrow('warmup failed');
    expect(removed).toEqual(['u-4']);
    expect(sends).toBe(0);
  });
});
