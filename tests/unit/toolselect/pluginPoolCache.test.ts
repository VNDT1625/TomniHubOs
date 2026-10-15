/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plugin tool candidate pool (2026-10-16). The pool of one conversation is loaded once per TTL window, concurrent
 * calls share one load, a failed load is retried on the next call, and the cache stays bounded.
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITY_POOL_TTL_MS, createCapabilityFallback } from '@process/resources/builtinMcp/capabilityFallback';
import type { CapabilityCandidate } from '@process/services/chatPipeline/stages/capabilitySelect';

const pool: CapabilityCandidate[] = [
  {
    id: 'skill:ctx-search',
    kind: 'skill',
    name: 'ctx-search',
    description: 'Search the index',
    enabled: true,
    approved: true,
    runsCode: false,
  },
];

describe('plugin tool candidate pool cache', () => {
  it('uses a 5 to 10 second TTL', () => {
    expect(CAPABILITY_POOL_TTL_MS).toBeGreaterThanOrEqual(5_000);
    expect(CAPABILITY_POOL_TTL_MS).toBeLessThanOrEqual(10_000);
  });

  it('loads a conversation pool once within the TTL and again after it', async () => {
    let clock = 0;
    let loads = 0;
    const fallback = createCapabilityFallback(
      async () => {
        loads += 1;
        return pool;
      },
      { ttlMs: 1_000, now: () => clock }
    );
    await fallback.run('conv-1', { action: 'map' });
    clock = 500;
    await fallback.run('conv-1', { action: 'map' });
    expect(loads).toBe(1);
    clock = 1_500;
    await fallback.run('conv-1', { action: 'map' });
    expect(loads).toBe(2);
  });

  it('shares one in-flight load between concurrent calls', async () => {
    let loads = 0;
    const fallback = createCapabilityFallback(async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return pool;
    });
    const results = await Promise.all([
      fallback.run('conv-2', { action: 'map' }),
      fallback.run('conv-2', { action: 'map' }),
      fallback.run('conv-2', { action: 'map' }),
    ]);
    expect(loads).toBe(1);
    expect(results.every((result) => !result.isError)).toBe(true);
  });

  it('does not cache a failed load', async () => {
    let attempts = 0;
    const fallback = createCapabilityFallback(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('registry unavailable');
      return pool;
    });
    await expect(fallback.run('conv-3', { action: 'map' })).rejects.toThrow('registry unavailable');
    const retry = await fallback.run('conv-3', { action: 'map' });
    expect(attempts).toBe(2);
    expect(retry.text).toContain('ctx-search');
  });

  it('keeps the connect rules on the cached pool', async () => {
    const fallback = createCapabilityFallback(async () => [{ ...pool[0], enabled: false } as CapabilityCandidate]);
    const result = await fallback.run('conv-4', { action: 'connect', id: 'skill:ctx-search' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('disabled');
  });
});
