import { describe, expect, it } from 'vitest';
import { createSelectionLog, type SelectionLogFs } from '@/process/toolselect/selectionLog';

const memoryFs = () => {
  let content: string | undefined;
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const fs: SelectionLogFs = {
    readFile: async () => {
      if (content === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return content;
    },
    writeFile: async (_path, data) => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await Promise.resolve();
      content = data;
      activeWrites -= 1;
    },
    rename: async () => undefined,
    mkdir: async () => undefined,
  };
  return { fs, getMaxActiveWrites: () => maxActiveWrites };
};

describe('SelectionLog outcome-aware persistence', () => {
  it('serializes concurrent writes and keeps the bounded newest records', async () => {
    const memory = memoryFs();
    let now = 0;
    const log = createSelectionLog({ filePath: 'C:\\selection.json', fs: memory.fs, maxEntries: 2, now: () => ++now });

    await Promise.all([
      log.record('one', ['a'], { outcome: 'verified' }),
      log.record('two', ['b'], { outcome: 'failed' }),
      log.record('three', ['c'], { outcome: 'cancelled' }),
    ]);

    expect((await log.all()).map((entry) => entry.requestSnippet)).toEqual(['three', 'two']);
    expect(memory.getMaxActiveWrites()).toBe(1);
  });

  it('recalls verified outcomes only and supports clear/reset', async () => {
    const memory = memoryFs();
    const log = createSelectionLog({ filePath: 'C:\\selection.json', fs: memory.fs });
    await log.record('same', ['good'], { outcome: 'verified' });
    await log.record('same', ['bad'], { outcome: 'timed_out' });

    expect((await log.recall('same'))?.chosen).toEqual(['good']);
    await log.clear?.();
    expect(await log.all()).toEqual([]);
  });

  it('summarizes outcomes and decays old verified signals', async () => {
    const memory = memoryFs();
    let now = 0;
    const log = createSelectionLog({
      filePath: 'C:\\selection.json',
      fs: memory.fs,
      now: () => now,
      decayHalfLifeMs: 100,
    });
    await log.record('old', ['a'], { outcome: 'verified', latencyMs: 10, cost: 2, fallbackCount: 1 });
    now = 100;
    await log.record('new', ['b'], { outcome: 'verified', latencyMs: 30, cost: 4 });
    await log.record('failure', ['c'], { outcome: 'failed' });

    const summary = await log.summary?.();
    expect(summary).toMatchObject({
      total: 3,
      verified: 2,
      failed: 1,
      successRate: 2 / 3,
      averageCost: 3,
      p95LatencyMs: 30,
      fallbackCount: 1,
    });
    expect(summary?.decayedSuccessWeight).toBeCloseTo(1.5);
  });
});
